// Studio's font inside the panel. The panel runs in a sandboxed frame with an opaque origin, so
// fetching font files is a cross-origin request the host does not allow. The two Iosevka faces are
// bundled into the panel script instead and used as data: URLs (allowed by the host's font-src)
// for the panel, the sandboxed previews and pictures drawn for saving.
import regular from '../fonts/Iosevka-Regular.woff2';
import bold from '../fonts/Iosevka-Bold.woff2';
import { FONT_STACK, fontFaceCss } from '../common/font.mjs';

const css = fontFaceCss({ regular, bold });
export const inlineFontCss = () => css;

export function installPanelFont() {
  const style = document.createElement('style');
  // Host theme updates set font tokens on html. Scope Studio's tokens to body so SDK controls
  // also keep the bundled font after a theme update, including controls styled as monospace.
  style.textContent = `${css}\nbody { --font-sans: ${FONT_STACK}; --font-mono: ${FONT_STACK}; --oc-font: ${FONT_STACK}; --oc-mono: ${FONT_STACK}; }`;
  document.head.prepend(style);
}
