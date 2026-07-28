export { palette, c, colors, glyph, badge } from "./theme.js";

import { glyph } from "./theme.js";
export {
  termWidth,
  termHeight,

  contentWidth,
  contentIndent,
  gradient,
  stripAnsi,
  centerText,
  box,
  heading,
  subheading,
  text,
  line,
  success,
  warning,
  failure,
  info,
  muted,
  step,
  kv,
  kvp,
  command,
  bullet,
  spacer,
  rule,
  divider,
  separator,
} from "./renderer.js";
export { select, search, confirm, input } from "./prompt.js";
export { createDashboard, dashboardSteps } from "./dashboard.js";
export { createLoader, loader } from "./loading.js";

import { c } from "./theme.js";
export const dim = c.muted;
export const accent = c.primary;
export const ok = c.success;
export const warn = c.warning;
export const err = c.error;
export const icons = {
  ok: glyph.check,
  warn: glyph.warn,
  err: glyph.cross,
  arrow: glyph.arrow,
  bullet: glyph.bullet,
  corner: glyph.corner,
};
