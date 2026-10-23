// Reads a project file and returns its text for the model. Runs in the service, which can read
// any file type; the sandboxed panel can only read UTF-8 text. Every extractor is a library or
// parser with no OCR and no code execution; a file without readable text is refused, not guessed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { decodeHTML, decodeXML } from 'entities';
import mammoth from 'mammoth';
import { LIMITS, StudioError } from '../common/core.mjs';
import { SOURCE_KINDS, sourceKind } from '../common/sources.mjs';
import { excelDateText, isDateFormat } from './excel-dates.mjs';
import { docText, xlsText } from './legacy.mjs';
import { pptText } from './legacy-ppt.mjs';

// Larger files are almost always data dumps or scans, and slow to parse.
const FILE_BYTES = 25 * 1024 * 1024;

// ---------- plain text and markup ----------

function decodeText(bytes) {
  if (bytes.includes(0)) throw new StudioError('NOT_TEXT', 'is not readable as text.');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { throw new StudioError('NOT_TEXT', 'is in a text format Studio cannot read.'); }
}

// Keeps the readable text of a page: scripts and styles go, block elements become line breaks.
export function htmlText(html) {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|table|ul|ol|dt|dd)\s*>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  return decodeHTML(text).replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Office Open XML (slides and sheets) ----------

const xmlText = (value) => decodeXML(value);
const zipEntries = (bytes) => {
  try { return unzipSync(bytes); } catch { throw new StudioError('BAD_FILE', 'could not be opened; it may be damaged.'); }
};
const part = (entries, name) => (entries[name] ? strFromU8(entries[name]) : '');
const relationships = (xml) => new Map([...xml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
  .map((m) => [m[1].match(/\bId="([^"]+)"/)?.[1], m[1].match(/\bTarget="([^"]+)"/)?.[1]]).filter(([id, target]) => id && target));
const byNumber = (a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0);

// Text of DrawingML paragraphs (<a:p> holding <a:t> runs), one line per paragraph.
function drawingParagraphs(xml) {
  return [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map((match) => [...match[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((run) => xmlText(run[1])).join('').trim())
    .filter(Boolean);
}

export function pptxText(bytes) {
  const entries = zipEntries(bytes);
  // Slide order comes from the presentation's slide list, not file names.
  const presentation = part(entries, 'ppt/presentation.xml');
  const rels = part(entries, 'ppt/_rels/presentation.xml.rels');
  const targets = relationships(rels);
  let slides = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => targets.get(m[1])).filter(Boolean)
    .map((target) => path.posix.normalize(path.posix.join('ppt', target)));
  if (!slides.length) slides = Object.keys(entries).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(byNumber);
  const out = [];
  slides.forEach((slide, index) => {
    const lines = drawingParagraphs(part(entries, slide));
    const slideRels = part(entries, slide.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
    const notesTarget = slideRels.match(/Target="([^"]*notesSlide\d+\.xml)"/)?.[1];
    // Notes repeat the slide number placeholder; keep only real sentences.
    const notes = notesTarget ? drawingParagraphs(part(entries, path.posix.normalize(path.posix.join(path.posix.dirname(slide), notesTarget)))).filter((line) => !/^\d+$/.test(line)) : [];
    if (!lines.length && !notes.length) return;
    out.push(`Slide ${index + 1}`, ...lines, ...(notes.length ? ['Notes:', ...notes] : []), '');
  });
  return out.join('\n').trim();
}

// Column letters to a zero-based index: A -> 0, AA -> 26.
const column = (ref) => [...ref.replace(/\d+/g, '')].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;

export function xlsxText(bytes) {
  const entries = zipEntries(bytes);
  const shared = [...part(entries, 'xl/sharedStrings.xml').matchAll(/<si\b[\s\S]*?<\/si>/g)]
    .map((si) => [...si[0].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''));
  const workbook = part(entries, 'xl/workbook.xml');
  const rels = part(entries, 'xl/_rels/workbook.xml.rels');
  // Dates are numbers whose cell style points at a date format; find which styles those are.
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);
  const stylesXml = part(entries, 'xl/styles.xml');
  const customFormats = new Map([...stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)].map((m) => [Number(m[1].match(/\bnumFmtId="(\d+)"/)?.[1]), xmlText(m[1].match(/\bformatCode="([^"]*)"/)?.[1] ?? '')]));
  const cellStyles = [...(stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] ?? '').matchAll(/<xf\b([^>]*)/g)].map((m) => Number(m[1].match(/\bnumFmtId="(\d+)"/)?.[1] ?? 0));
  const targets = relationships(rels);
  // Attribute order varies between writers, so each attribute is read on its own.
  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
    const target = targets.get(m[1].match(/\br:id="([^"]+)"/)?.[1]) ?? '';
    return { name: xmlText(m[1].match(/\bname="([^"]*)"/)?.[1] ?? 'Sheet'), file: target.startsWith('/') ? target.slice(1) : path.posix.normalize(path.posix.join('xl', target)) };
  });
  const numberText = (raw, attrs) => {
    const formatId = cellStyles[Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? 0)];
    const value = Number(raw);
    return isDateFormat(formatId, customFormats.get(formatId)) ? excelDateText(value, date1904, customFormats.get(formatId)) : xmlText(raw);
  };
  const out = [];
  for (const sheet of sheets) {
    const rows = [];
    for (const row of part(entries, sheet.file).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? '';
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        const value = type === 's' ? shared[Number(raw)] ?? ''
          : type === 'inlineStr' ? [...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join('')
            : type === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE')
              : raw === undefined ? ''
                : type === undefined || type === 'n' ? numberText(raw, attrs)
                  : xmlText(raw);
        cells[ref ? column(ref) : cells.length] = value.replace(/\s+/g, ' ').trim();
      }
      if (cells.some(Boolean)) rows.push(Array.from(cells, (value) => value ?? '').join('\t'));
    }
    if (rows.length) out.push(`Sheet: ${sheet.name}`, ...rows, '');
  }
  return out.join('\n').trim();
}

// ---------- Word and PDF ----------

async function docxText(bytes) {
  try { return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value.replace(/\n{3,}/g, '\n\n').trim(); }
  catch { throw new StudioError('BAD_FILE', 'could not be opened; it may be damaged.'); }
}

// pdf.js runs with its worker code in this thread ("fake worker"), so no worker file is shipped.
let pdfjs;
async function loadPdfjs() {
  pdfjs ??= (async () => {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    globalThis.pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return pdfjs;
}

async function pdfText(bytes) {
  const { getDocument, VerbosityLevel } = await loadPdfjs();
  let task;
  let document;
  try {
    task = getDocument({
      data: new Uint8Array(bytes), verbosity: VerbosityLevel.ERRORS,
      isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false,
    });
    document = await task.promise;
  } catch (error) {
      void task?.destroy();
    if (error?.name === 'PasswordException') throw new StudioError('LOCKED_FILE', 'is password-protected.');
    throw new StudioError('BAD_FILE', 'could not be opened; it may be damaged.');
  }
  try {
    const pages = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      // hasEOL marks line ends; items on one line are joined with what pdf.js reports between them.
      pages.push(content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ''}`).join('').replace(/[ \t]+/g, ' ').trim());
      page.cleanup();
    }
    const text = pages.filter(Boolean).map((page, index) => `Page ${index + 1}\n${page}`).join('\n\n').trim();
    if (!text) throw new StudioError('NO_TEXT', 'has no text Studio can read; it may be a scanned picture.');
    return text;
  } finally {
    await task.destroy();
  }
}

// ---------- entry points ----------

const EXTRACTORS = {
  text: (bytes) => decodeText(bytes),
  html: (bytes) => htmlText(decodeText(bytes)),
  docx: docxText,
  pdf: pdfText,
  pptx: pptxText,
  xlsx: xlsxText,
  doc: docText,
  xls: xlsText,
  ppt: pptText,
};

function projectParts(relative, allowRoot) {
  if (typeof relative !== 'string' || /[\\:\0]/.test(relative)
    || (!relative && !allowRoot)
    || (relative && relative.split('/').some((part) => !part || part === '.' || part === '..'))) {
    throw new StudioError('BAD_SOURCE', 'is outside this project.');
  }
  return relative ? relative.split('/') : [];
}

async function sourceInfo(target) {
  const info = await fs.lstat(target).catch(() => null);
  if (!info) throw new StudioError('MISSING_SOURCE', 'no longer exists.');
  return info;
}

async function sourceRealpath(target) {
  try { return await fs.realpath(target); }
  catch { throw new StudioError('MISSING_SOURCE', 'no longer exists.'); }
}

// Check every component, not just the final file: a regular file can sit behind a directory
// shortcut. Resolve the trusted root once, and never follow a shortcut below it.
async function projectEntry(directory, relative, allowRoot = false) {
  const parts = projectParts(relative, allowRoot);
  const root = await sourceRealpath(directory);
  let target = root;
  let info = await sourceInfo(target);
  for (const part of parts) {
    if (!info.isDirectory()) throw new StudioError('BAD_SOURCE', 'is not inside a folder.');
    target = path.join(target, part);
    info = await sourceInfo(target);
    if (info.isSymbolicLink()) throw new StudioError('BAD_SOURCE', 'is a shortcut or a folder, not a file.');
    target = await sourceRealpath(target);
    const inside = path.relative(root, target);
    if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) {
      throw new StudioError('BAD_SOURCE', 'is outside this project.');
    }
  }
  return { target, info };
}

// Resolves a project-relative path to a regular file inside the project, refusing links out.
async function projectFile(directory, relative) {
  const { target, info } = await projectEntry(directory, relative);
  if (!info.isFile()) throw new StudioError('BAD_SOURCE', 'is a shortcut or a folder, not a file.');
  if (info.size > FILE_BYTES) throw new StudioError('FILE_TOO_LARGE', `is too big (over ${FILE_BYTES / 1024 / 1024} MB).`);
  return { target, info };
}

// Cache by path, size and modification time, so explicit selection and the job share one parse.
const cache = new Map();

export async function readSource(directory, relative) {
  const kind = sourceKind(relative);
  if (!kind) throw new StudioError('BAD_SOURCE', 'is a kind of file Studio cannot read.');
  const { target, info } = await projectFile(directory, relative);
  const key = `${target}|${info.size}|${info.mtimeMs}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const text = (await EXTRACTORS[SOURCE_KINDS[kind].extractor](await fs.readFile(target))).trim();
      if (!text) throw new StudioError('NO_TEXT', 'has no text in it.');
      return text;
    })());
    // A failed read is not remembered: the file may be fixed and tried again.
    cache.get(key).catch(() => cache.delete(key));
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

// Prefixes the file name so every error reads as a sentence: "notes.pdf is password-protected."
export async function readSourceOrExplain(directory, relative) {
  try { return { text: await readSource(directory, relative) }; }
  catch (error) {
    if (!(error instanceof StudioError)) return { error: { code: 'BAD_FILE', message: `${relative} could not be read.` } };
    return { error: { code: error.code, message: `${relative} ${error.message}` } };
  }
}

// Called only when the user selects a file. Its text stays in the service and its parse cache.
export async function inspectSource(directory, relative) {
  const { text, error } = await readSourceOrExplain(directory, relative);
  return error ? { path: relative, error: error.message } : { path: relative, characters: text.length };
}

// ---------- listing ----------

const PAGE_ENTRIES = 100;
const SORT_FIELDS = new Set(['name', 'size', 'createdAt', 'modifiedAt']);
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareNames = (a, b) => names.compare(a.name, b.name) || a.name.localeCompare(b.name);
const entryType = (info) => (info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other');

async function entryMetadata(target, folder, entry) {
  const relative = folder ? `${folder}/${entry.name}` : entry.name;
  const result = {
    path: relative, name: entry.name, folder, entryType: entryType(entry),
    kind: entry.isFile() ? sourceKind(entry.name) : null,
    size: null, createdAt: null, modifiedAt: null,
  };
  let info;
  try { info = await fs.lstat(path.join(target, entry.name)); }
  catch (error) {
    return { ...result, error: error.code === 'ENOENT' ? 'no longer exists.' : 'could not be checked.' };
  }
  result.entryType = entryType(info);
  result.kind = info.isFile() ? sourceKind(entry.name) : null;
  // Folder sizes would require walking their contents. Zero birthtime means unavailable on
  // some filesystems; never substitute modification/change time for a missing creation date.
  result.size = info.isFile() && Number.isFinite(info.size) && info.size >= 0 ? info.size : null;
  result.createdAt = Number.isFinite(info.birthtimeMs) && info.birthtimeMs !== 0 ? info.birthtimeMs : null;
  result.modifiedAt = Number.isFinite(info.mtimeMs) ? info.mtimeMs : null;
  if (info.isSymbolicLink()) result.error = 'is a shortcut and cannot be opened.';
  else if (result.entryType === 'other') result.error = 'is not a regular file or folder.';
  else if (info.isFile() && !result.kind) result.error = 'is a kind of file Studio cannot read.';
  else if (info.isFile() && info.size > FILE_BYTES) result.error = `is too big (over ${FILE_BYTES / 1024 / 1024} MB).`;
  return result;
}

function compareEntries(sort, direction) {
  const order = direction === 'asc' ? 1 : -1;
  return (a, b) => {
    const folders = Number(b.entryType === 'directory') - Number(a.entryType === 'directory');
    if (folders) return folders;
    if (sort === 'name') return order * compareNames(a, b);
    // Unknown values stay last within each group, even when sorting downwards.
    if (a[sort] === null && b[sort] !== null) return 1;
    if (b[sort] === null && a[sort] !== null) return -1;
    return order * ((a[sort] === null ? 0 : a[sort] - b[sort]) || compareNames(a, b));
  };
}

// Lists only this folder's immediate children. Browsing never opens or extracts a file, and
// hidden/tool folders and unsupported files are kept visible. Paths keep their original names.
export async function listSources(directory, { folder = '', offset = 0, sort = 'name', direction = 'asc' } = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new StudioError('BAD_OFFSET', 'Invalid folder page.');
  if (!SORT_FIELDS.has(sort) || !['asc', 'desc'].includes(direction)) throw new StudioError('BAD_SORT', 'Choose a supported folder order.');
  let target;
  try {
    const entry = await projectEntry(directory, folder, true);
    if (!entry.info.isDirectory()) throw new StudioError('BAD_SOURCE', 'is not a folder.');
    target = entry.target;
  } catch (error) {
    if (error instanceof StudioError) throw new StudioError(error.code, `${folder || 'This project'} ${error.message}`);
    throw error;
  }
  let children;
  try { children = await fs.readdir(target, { withFileTypes: true }); }
  catch { throw new StudioError('BAD_FOLDER', 'This folder could not be opened.'); }
  const found = new Array(children.length);
  let cursor = 0;
  // Bounded metadata requests; no recursive walk or background parsing after this call returns.
  await Promise.all(Array.from({ length: Math.min(8, children.length) }, async () => {
    while (cursor < children.length) {
      const index = cursor++;
      found[index] = await entryMetadata(target, folder, children[index]);
    }
  }));
  found.sort(compareEntries(sort, direction));
  const entries = [];
  const total = found.length;
  let end = offset;
  let length = JSON.stringify({ folder, entries, total, next: total }).length;
  // Very deep paths repeat in each entry. Also cap serialized length so a page still fits the
  // bridge when fewer than 100 long names fill it, leaving room for the route's other metadata.
  while (end < total && entries.length < PAGE_ENTRIES) {
    const size = JSON.stringify(found[end]).length + 1;
    if (length + size > LIMITS.response - 4_000) {
      if (!entries.length) throw new StudioError('FOLDER_TOO_LARGE', 'This folder has names too long to show.');
      break;
    }
    entries.push(found[end++]);
    length += size;
  }
  return { folder, entries, total, next: end < total ? end : null };
}
