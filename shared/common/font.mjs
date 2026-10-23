// Studio's single typeface. Standard Iosevka 34.9.0, normal width, upright regular and bold
// (SIL Open Font License 1.1, shared/fonts/Iosevka-LICENSE.txt). Markdown itself carries no font;
// its Studio viewer uses this family, as do the panel, previews and supported file formats.
// Shared by the panel and the service: names only, no file access here.
export const FONT_FAMILY = 'Iosevka';
// CSS fallbacks for places that cannot carry the font file (only reached if loading fails).
export const FONT_STACK = `${FONT_FAMILY}, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`;
export const FONT_FILES = Object.freeze({
  regular: { ttf: 'Iosevka-Regular.ttf', woff2: 'Iosevka-Regular.woff2', weight: 400 },
  bold: { ttf: 'Iosevka-Bold.ttf', woff2: 'Iosevka-Bold.woff2', weight: 700 },
});

// @font-face rules with the fonts inlined, so a saved web page or SVG carries Iosevka with it.
export function fontFaceCss(woff2Base64) {
  return Object.entries(FONT_FILES).map(([key, file]) => `@font-face { font-family: ${FONT_FAMILY}; font-style: normal; font-weight: ${file.weight}; font-display: swap; src: url(data:font/woff2;base64,${woff2Base64[key]}) format("woff2"); }`).join('\n');
}
