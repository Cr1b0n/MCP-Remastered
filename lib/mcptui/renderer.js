import chalk from "chalk";
import { c, palette, glyph } from "./theme.js";

const bold = chalk.bold;

export function termWidth() {
  return Math.max(60, process.stdout.columns || 80);
}

export function termHeight() {
  return process.stdout.rows || 24;
}

export function layoutWidth() {
  return termWidth();
}

export function layoutIndent() {
  return 0;
}

export function contentWidth() {
  return layoutWidth() - 8;
}

export function contentIndent() {
  return layoutIndent() + 2;
}

const P = () => " ".repeat(contentIndent());


export function stripAnsi(str) {
  return str.replace(/\u001b\[[0-9;]*m/g, "");
}

export function centerText(text, width) {
  width = width ?? termWidth(); // center within full terminal width
  return text
    .split("\n")
    .map((line) => {
      const clean = stripAnsi(line);
      const pad = Math.max(0, Math.floor((width - clean.length) / 2));
      return " ".repeat(pad) + line;
    })
    .join("\n");
}

function formatBoxLine(content, width) {
  const clean = stripAnsi(content).length;
  const padding = Math.max(0, width - 4 - clean);
  return c.border("│ ") + content + " ".repeat(padding) + c.border(" │");
}

function parseHex(h) {
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function gradient(text, from = palette.primary, to = palette.accent) {
  const f = parseHex(from);
  const t = parseHex(to);
  const chars = [...text];
  if (chars.length === 0) return "";
  return chars
    .map((ch, i) => {
      const p = chars.length > 1 ? i / (chars.length - 1) : 0;
      const r = Math.round(f.r + (t.r - f.r) * p);
      const g = Math.round(f.g + (t.g - f.g) * p);
      const b = Math.round(f.b + (t.b - f.b) * p);
      return chalk.hex(`#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`)(ch);
    })
    .join("");
}

// ── Box ────────────────────────────────────────────────────────

// ── Box & Card Rendering ──────────────────────────────────────

export function renderKeymapPills(keymaps) {
  // Keymaps array: [ { key: "↑/↓", label: "navigate" }, { key: "↵", label: "select" }, ... ]
  return keymaps
    .map((k) => `${chalk.bgHex("#242424")(c.text.bold(` ${k.key} `))} ${c.muted(k.label)}`)
    .join("   ");
}

export function renderBox(title, lines, opts = {}) {
  const rawWidth = opts.width ?? Math.min(layoutWidth() - 4, 140);
  const width = Math.max(42, rawWidth);
  const borderColor = opts.active ? c.borderActive : c.border;

  let borderTop = "";
  if (title) {
    const cleanTitle = ` ${glyph.sparkle} ${stripAnsi(title)} `;
    const titleStyled = c.primary.bold(` ${glyph.sparkle} ${title} `);
    const rightDashLen = Math.max(2, width - 2 - cleanTitle.length - 2);
    borderTop = borderColor("╭──") + titleStyled + borderColor("─".repeat(rightDashLen) + "╮");
  } else {
    borderTop = borderColor("╭" + "─".repeat(width - 2) + "╮");
  }

  const borderBottom = borderColor("╰" + "─".repeat(width - 2) + "╯");
  const result = [borderTop];

  if (opts.paddingTop !== false) {
    result.push(borderColor("│") + " ".repeat(width - 2) + borderColor("│"));
  }

  for (const l of lines) {
    const cleanLength = stripAnsi(l).length;
    const padding = Math.max(0, width - 4 - cleanLength);
    result.push(borderColor("│ ") + l + " ".repeat(padding) + borderColor(" │"));
  }

  if (opts.paddingBottom !== false) {
    result.push(borderColor("│") + " ".repeat(width - 2) + borderColor("│"));
  }

  result.push(borderBottom);
  return result.join("\n");
}

export function box(title, lines, opts = {}) {
  const rendered = renderBox(title, lines, opts);
  console.log(centerText(rendered, termWidth()));
}


export function heading(text) {
  console.log(`\n${P()}${c.primary(glyph.bullet)}  ${bold(text)}`);
}

export function subheading(text) {
  console.log(`${P()}  ${c.secondary(glyph.arrow)} ${bold(c.text(text))}`);
}

// ── Status & Text ──────────────────────────────────────────────

export function text(content = "") {
  console.log(`${P()}  ${content}`);
}

export function line(content = "") {
  console.log(content);
}

export function success(text) {
  console.log(`${P()}  ${c.success(glyph.check)}  ${text}`);
}

export function failure(text) {
  console.log(`${P()}  ${c.error(glyph.cross)}  ${text}`);
}

export function warning(text) {
  console.log(`${P()}  ${c.warning(glyph.warn)}  ${text}`);
}

export function info(text) {
  console.log(`${P()}  ${c.info(glyph.info)}  ${text}`);
}

export function muted(text) {
  console.log(`${P()}  ${c.muted(text)}`);
}

// ── Data ────────────────────────────────────────────────────────

export function kv(label, value, opts = {}) {
  const lw = opts.labelWidth ?? 16;
  console.log(`${P()}  ${c.muted(label.padEnd(lw))}${value}`);
}

export function kvp(label, value) {
  console.log(`${P()}  ${c.muted(label.padEnd(16))}${bold(c.text(value))}`);
}

export function command(cmd, desc) {
  console.log(`${P()}    ${c.primary(cmd.padEnd(24))}${c.muted(desc)}`);
}

export function bullet(text, color = c.primary) {
  console.log(`${P()}  ${color(glyph.bullet)}  ${text}`);
}

export function step(text, sub = false) {
  if (sub) {
    console.log(`${P()}      ${c.muted(text)}`);
  } else {
    console.log(`${P()}  ${c.secondary(glyph.arrow)} ${text}`);
  }
}

// ── Separators & Layout ────────────────────────────────────────

export function spacer() {
  console.log();
}

export function rule(opts = {}) {
  const W = opts.width ?? contentWidth();
  console.log(" ".repeat(contentIndent()) + c.dim("─".repeat(Math.max(4, W - 4))));
}

export function separator(width, opts = {}) {
  if (typeof width === "object") {
    opts = width;
    width = undefined;
  }
  const W = opts.width ?? width ?? termWidth();
  const { char = "─", color = c.dim } = opts;
  if (opts.accent && opts.accentChar) {
    const side = Math.max(0, W - 2);
    const left = Math.floor(side / 2);
    const right = side - left;
    console.log(color(char.repeat(left)) + opts.accent(opts.accentChar) + color(char.repeat(right)));
  } else {
    console.log(color(char.repeat(W)));
  }
}

export { separator as divider };

