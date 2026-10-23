import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { strFromU8, unzipSync } from 'fflate';
import * as fontkit from 'fontkit';
import { measureText, registerFont } from 'measury';
import { FONT_FAMILY, FONT_FILES, FONT_STACK } from '../shared/common/font.mjs';
import { buildWebPage } from '../shared/common/webpage.mjs';
import { infographic } from '../shared/common/infographic.mjs';
import { embeddedFontCss } from '../shared/service/fonts.mjs';
import { buildDocx } from '../shared/service/builders/docx.mjs';
import { buildPdf } from '../shared/service/builders/pdf.mjs';
import { buildPptx } from '../shared/service/builders/pptx.mjs';
import { buildXlsx } from '../shared/service/builders/xlsx.mjs';
import { buildInfographicFile } from '../shared/service/builders/infographic.mjs';

const fontDirectory = new URL('../shared/fonts/', import.meta.url);
const source = JSON.parse(await fs.readFile(new URL('Iosevka-SOURCE.json', fontDirectory), 'utf8'));
const metrics = JSON.parse(await fs.readFile(new URL('Iosevka-metrics.json', fontDirectory), 'utf8'));
const bytes = new Map(await Promise.all(source.files.map(async (file) => [file.name, await fs.readFile(new URL(file.name, fontDirectory))])));
const faces = Object.values(FONT_FILES).map((file) => ({ file, font: fontkit.create(bytes.get(file.ttf)) }));
const md5 = (value) => createHash('md5').update(value).digest('hex');
const sample = 'Caf\u00e9 \u03a9 \u0416 \u2192 \u2211 \u{1d400}; a\u0301 1\u20442 != ->';
const meta = { title: 'Font sample', source: 'Sample notes', createdAt: new Date('2026-10-22T12:00:00Z'), notes: [] };
const report = { title: 'Font sample', subtitle: '', sections: [{ heading: 'Symbols', paragraphs: [sample], bullets: ['One point'], table: { columns: ['Symbol'], rows: [['\u2192']] } }] };

test('bundled Iosevka files match the official full Normal-width regular/bold assets', async () => {
  assert.equal(FONT_FAMILY, 'Iosevka');
  assert.equal(source.version, '34.9.0');
  assert.equal(source.license.spdx, 'OFL-1.1');
  assert.deepEqual(source.files.map((file) => file.name).sort(), Object.values(FONT_FILES).flatMap((file) => [file.ttf, file.woff2]).sort());
  for (const file of source.files) {
    assert.equal(bytes.get(file.name).length, file.bytes, file.name);
    assert.equal(md5(bytes.get(file.name)), file.md5, `${file.name} differs from the verified release entry`);
  }
  for (const { file, font } of faces) {
    const webFont = fontkit.create(bytes.get(file.woff2));
    for (const face of [font, webFont]) {
      assert.equal(face.familyName, 'Iosevka');
      assert.equal(face.subfamilyName, file.weight === 400 ? 'Regular' : 'Bold');
      assert.equal(face.postscriptName, file.weight === 400 ? 'Iosevka' : 'Iosevka-Bold');
      assert.match(face.version, /^Version 34\.9\.0;/);
      assert.equal(face['OS/2'].usWeightClass, file.weight);
      assert.equal(face['OS/2'].usWidthClass, 5);
      assert.equal(face.italicAngle, 0);
      assert.equal(face.glyphForCodePoint(0x6e).advanceWidth / face.unitsPerEm, 0.5);
      assert.equal(face.characterSet.length, 7758);
      assert.equal(face.numGlyphs, file.weight === 400 ? 48725 : 48719);
      assert.ok(Object.values(face['OS/2'].fsType).every((flag) => !flag), 'embedding/subsetting is unrestricted');
      for (const character of sample) assert.ok(face.hasGlyphForCodePoint(character.codePointAt(0)), character);
    }
    assert.deepEqual(webFont.characterSet, font.characterSet, 'web fonts retain full Unicode coverage');
  }
  const license = await fs.readFile(new URL(source.license.file, fontDirectory), 'utf8');
  assert.equal(md5(license.replaceAll('\r\n', '\n')), source.license.md5Lf);
  assert.match(license, /Copyright \(c\) 2015-2026, Renzhi Li/);
  assert.match(license, /SIL Open Font License v1\.1/);
  assert.match(license, /OTHER DEALINGS IN THE FONT SOFTWARE\./);
  assert.ok(!(await fs.readdir(fontDirectory)).some((name) => name.startsWith('Inter-')));
});

test('infographic metrics match every Iosevka code point, including supplementary symbols', () => {
  assert.equal(metrics.length, 2);
  for (const { file, font } of faces) {
    const measured = metrics.find((face) => face.fontWeight === file.weight);
    assert.equal(measured.fontFamily, FONT_FAMILY);
    assert.equal(measured.fontStyle, 'normal');
    assert.equal(measured.unitsPerEm, font.unitsPerEm);
    assert.deepEqual(measured.metrics, { ascender: font.ascent, descender: font.descent, lineGap: font.lineGap });
    assert.equal(Object.keys(measured.glyphs).length, font.characterSet.length);
    for (const code of font.characterSet) assert.equal(measured.glyphs[String.fromCodePoint(code)], font.glyphForCodePoint(code).advanceWidth, `U+${code.toString(16)}`);
    registerFont(measured);
    const advance = Array.from(sample, (character) => font.glyphForCodePoint(character.codePointAt(0)).advanceWidth).reduce((sum, width) => sum + width, 0);
    assert.equal(measureText(sample, { fontFamily: FONT_FAMILY, fontWeight: file.weight, fontSize: font.unitsPerEm }).width, advance);
  }
});

test('panel and saved HTML embed the exact WOFF2 faces, with Studio font tokens for SDK controls', async () => {
  const css = await embeddedFontCss();
  const inlined = [...css.matchAll(/font-weight: (400|700);[^}]+base64,([A-Za-z0-9+/=]+)\)/g)];
  assert.equal(inlined.length, 2);
  for (const [, weight, data] of inlined) {
    const file = Object.values(FONT_FILES).find((face) => face.weight === Number(weight));
    assert.equal(md5(Buffer.from(data, 'base64')), md5(bytes.get(file.woff2)));
  }
  const page = buildWebPage({ title: 'Font sample', sections: [{ heading: 'Symbols', paragraphs: [sample] }] }, meta, css);
  assert.ok(page.includes(css));
  assert.ok(page.includes(`font: 17px/1.65 ${FONT_STACK}`));
  assert.ok(page.includes("font-src data:"));

  const bundled = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['shared/panel/fonts.js'], bundle: true, platform: 'browser', format: 'iife', globalName: 'studioFonts', write: false, loader: { '.woff2': 'base64' } });
  let installed;
  const context = { document: { createElement: () => ({}), head: { prepend: (style) => { installed = style.textContent; } } } };
  vm.runInNewContext(`${bundled.outputFiles[0].text}\nstudioFonts.installPanelFont();`, context);
  assert.ok(installed.startsWith(css));
  for (const token of ['--font-sans', '--font-mono', '--oc-font', '--oc-mono']) assert.ok(installed.includes(`${token}: ${FONT_STACK}`));
  assert.ok(installed.includes('body {'), 'body tokens take precedence over later host-theme tokens on html');
});

test('Word embeds both original faces under one Iosevka family with deterministic valid keys', async () => {
  const first = await buildDocx(report, meta);
  assert.equal(md5(first.bytes), md5((await buildDocx(report, meta)).bytes));
  const entries = unzipSync(first.bytes);
  const table = strFromU8(entries['word/fontTable.xml']);
  assert.equal((table.match(/<w:font\b/g) ?? []).length, 1);
  assert.ok(table.includes('w:name="Iosevka"'));
  const relationships = strFromU8(entries['word/_rels/fontTable.xml.rels']);
  for (const [index, { file }] of faces.entries()) {
    const tag = index === 0 ? 'embedRegular' : 'embedBold';
    const embedded = table.match(new RegExp(`<w:${tag}\\b[^>]+>`))?.[0];
    assert.ok(embedded, tag);
    const guid = embedded.match(/w:fontKey="\{([0-9A-F-]+)\}"/)?.[1];
    assert.ok(guid);
    assert.ok(embedded.includes(`r:id="rId${index + 1}"`));
    assert.ok(relationships.includes(`Target="fonts/font${index + 1}.odttf"`));
    const font = Uint8Array.from(entries[`word/fonts/font${index + 1}.odttf`]);
    const key = Buffer.from(guid.replaceAll('-', ''), 'hex').reverse();
    for (let position = 0; position < 32; position += 1) font[position] ^= key[position % 16];
    assert.equal(md5(font), md5(bytes.get(file.ttf)), `${tag} must decode to the full official TTF`);
  }
  assert.ok(strFromU8(entries['word/styles.xml']).includes('w:ascii="Iosevka"'));
  assert.equal((strFromU8(entries['word/theme/theme1.xml']).match(/<a:latin typeface="Iosevka"/g) ?? []).length, 2);
});

test('PDF embeds Iosevka while Slides and Spreadsheet name it without claiming embedded fonts', async () => {
  const pdf = await buildPdf(report, meta);
  assert.deepEqual(pdf.notes, []);
  const content = pdf.bytes.toString('latin1');
  assert.match(content, /\/BaseFont \/[A-Z]+\+Iosevka\s/);
  assert.match(content, /\/BaseFont \/[A-Z]+\+Iosevka-Bold\b/);
  assert.ok(content.includes('/FontFile2') && content.includes('/ToUnicode'));
  const slides = unzipSync((await buildPptx({ title: 'Font sample', subtitle: '', slides: [{ title: 'Symbols', bullets: [sample], notes: '' }] }, meta)).bytes);
  assert.ok(strFromU8(slides['ppt/theme/theme1.xml']).includes('typeface="Iosevka"'));
  assert.ok(strFromU8(slides['ppt/slides/slide2.xml']).includes('typeface="Iosevka"'));
  const bullets = [...strFromU8(slides['ppt/slideMasters/slideMaster1.xml']).matchAll(/<a:buFont\b[^>]+>/g)];
  assert.ok(bullets.length > 0 && bullets.every(([tag]) => tag.includes('typeface="Iosevka"')));
  const sheets = unzipSync((await buildXlsx({ title: 'Font sample', tables: [{ name: 'Symbols', description: '', columns: ['Text'], rows: [[sample]] }] }, meta)).bytes);
  assert.ok(strFromU8(sheets['xl/styles.xml']).includes('<name val="Iosevka"'));
  for (const entries of [slides, sheets]) assert.ok(!Object.keys(entries).some((name) => /\.(?:odttf|ttf|woff2)$/.test(name)));
});

test('infographic keeps a font-free bridge preview and embeds both Iosevka faces in the saved SVG', async () => {
  const { artifact } = infographic.build(JSON.stringify({ layout: 'steps', title: 'Font sample', desc: 'A short sequence', items: [{ label: 'Start', desc: sample }, { label: 'Check', desc: 'Review the symbols' }, { label: 'Finish', desc: 'Ready to read' }] }));
  const built = await buildInfographicFile(artifact);
  assert.ok(built.preview.includes('Iosevka'));
  assert.ok(built.preview.includes('Start') && built.preview.includes('Ready to read'));
  assert.ok(built.preview.length < 60_000 && !built.preview.includes('base64,'));
  assert.ok(!built.preview.includes('xml-stylesheet') && !built.preview.includes('assets.antv.antgroup.com'));
  assert.ok(built.bytes.toString('utf8').includes(await embeddedFontCss()));
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
});
