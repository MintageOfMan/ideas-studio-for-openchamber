import { createHash } from 'node:crypto';
import { AlignmentType, Document, Footer, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { FONT_FAMILY } from '../../common/font.mjs';
import { boldTtf, regularTtf } from '../fonts.mjs';
import { GENERATOR, normalizeZip, provenance } from './shared.mjs';

const tableOf = ({ columns, rows }) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: columns.map((column) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: column, bold: true })] })] })) }),
    ...rows.map((row) => new TableRow({ children: row.map((value) => new TableCell({ children: [new Paragraph(value ?? '')] })) })),
  ],
});

// Word embeds fonts "obfuscated": the first 32 bytes are XORed with a key taken from the
// font's GUID, read back to front (ECMA-376 Part 1, 17.8.1). The docx library picks a random
// GUID, which would make every build differ, so the key is replaced with one derived from
// the font bytes and the font is re-obfuscated with it.
function obfuscate(font, guid) {
  const hex = guid.replace(/[{}-]/g, '');
  const key = Array.from({ length: 16 }, (_, index) => parseInt(hex.slice(30 - index * 2, 32 - index * 2), 16));
  const out = Uint8Array.from(font);
  for (let index = 0; index < 32; index += 1) out[index] ^= key[index % 16];
  return out;
}

function stableFontKeys(bytes, fonts) {
  const entries = unzipSync(bytes);
  const table = strFromU8(entries['word/fontTable.xml']);
  const faces = fonts.map((font, index) => {
    const hex = createHash('md5').update(font).digest('hex').toUpperCase();
    const guid = `{${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}}`;
    entries[`word/fonts/font${index + 1}.odttf`] = obfuscate(font, guid);
    return `<w:${index === 0 ? 'embedRegular' : 'embedBold'} r:id="rId${index + 1}" w:fontKey="${guid}"/>`;
  }).join('');
  // docx exposes regular faces only. Its two generated relationships/files are retained, but
  // Word needs both faces under one family, with the second marked embedBold rather than a
  // duplicate regular family. Omit the library's generic (non-Iosevka) Unicode signature.
  const family = `<w:font w:name="${FONT_FAMILY}"><w:family w:val="modern"/><w:pitch w:val="fixed"/>${faces}</w:font>`;
  entries['word/fontTable.xml'] = strToU8(table.replace(/<w:font\b[^>]*>[\s\S]*?<\/w:font>/g, '').replace('</w:fonts>', `${family}</w:fonts>`));
  return zipSync(entries);
}

export async function buildDocx(artifact, meta) {
  const fonts = await Promise.all([regularTtf(), boldTtf()]);
  const children = [new Paragraph({ text: artifact.title, heading: HeadingLevel.TITLE })];
  if (artifact.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: artifact.subtitle, italics: true, size: 28 })] }));
  for (const section of artifact.sections) {
    if (section.heading) children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_1 }));
    for (const paragraph of section.paragraphs) children.push(new Paragraph(paragraph));
    for (const bullet of section.bullets) children.push(new Paragraph({ text: bullet, bullet: { level: 0 } }));
    // An empty paragraph after a table keeps Word from merging it with the next one.
    if (section.table) children.push(tableOf(section.table), new Paragraph(''));
  }
  if (meta.notes.length) {
    children.push(new Paragraph({ text: 'Changes Studio made', heading: HeadingLevel.HEADING_2 }));
    for (const note of meta.notes) children.push(new Paragraph({ text: note, bullet: { level: 0 } }));
  }
  // Every built-in style (headings, title) inherits the document default font.
  const run = { font: FONT_FAMILY };
  const document = new Document({
    creator: GENERATOR, lastModifiedBy: GENERATOR, title: artifact.title, description: `Made from ${meta.source}.`,
    // Both original faces are embedded, so compatible Word viewers can use true Iosevka bold.
    fonts: fonts.map((data) => ({ name: FONT_FAMILY, data })),
    theme: { fonts: { headings: FONT_FAMILY, body: FONT_FAMILY } },
    styles: {
      default: {
        document: { run: { ...run, size: 22 } },
        title: { run }, heading1: { run }, heading2: { run }, heading3: { run },
      },
    },
    sections: [{
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: provenance(meta), size: 16, color: '666666' })] })] }) },
      children,
    }],
  });
  const packed = stableFontKeys(await Packer.toBuffer(document), fonts);
  return { bytes: normalizeZip(packed, meta.createdAt), notes: [], pages: null };
}
