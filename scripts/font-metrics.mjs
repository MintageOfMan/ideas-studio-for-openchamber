// Development script: writes shared/fonts/Iosevka-metrics.json, the glyph advances the infographic
// renderer uses to measure Iosevka text in Node (it has no browser to measure with). Run after
// changing the font files: node scripts/font-metrics.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import { FONT_FAMILY, FONT_FILES } from '../shared/common/font.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const faces = [];
for (const file of Object.values(FONT_FILES)) {
  const font = fontkit.create(await fs.readFile(path.join(root, 'shared/fonts', file.ttf)));
  if (font.familyName !== FONT_FAMILY || font['OS/2'].usWeightClass !== file.weight || font.italicAngle !== 0) {
    throw new Error(`${file.ttf} does not match the configured family, upright style and weight.`);
  }
  const glyphs = {};
  // Measury iterates Unicode code points; retain supplementary-plane symbols as well as BMP text.
  for (const code of font.characterSet) {
    glyphs[String.fromCodePoint(code)] = font.glyphForCodePoint(code).advanceWidth;
  }
  faces.push({
    fontFamily: FONT_FAMILY, fontWeight: file.weight, fontStyle: 'normal', unitsPerEm: font.unitsPerEm,
    metrics: { ascender: font.ascent, descender: font.descent, lineGap: font.lineGap },
    defaultWidth: font.glyphForCodePoint(0x6e).advanceWidth, glyphs,
  });
}
await fs.writeFile(path.join(root, `shared/fonts/${FONT_FAMILY}-metrics.json`), JSON.stringify(faces) + '\n');
console.log(faces.map((face) => `${face.fontWeight}: ${Object.keys(face.glyphs).length} glyphs`).join(', '));
