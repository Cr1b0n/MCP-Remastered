import chalk from "chalk";

const THEMES = {
  dawn: {
    primary: "#c84e0b",         // Deep Burnt Orange
    primaryBright: "#e07020",   // Warm Orange
    secondary: "#1a6b7a",       // Teal
    accent: "#9b4075",          // Mauve
    success: "#2d6a4f",         // Forest Green
    error: "#c1121f",           // Crimson
    warning: "#b8860b",         // Dark Goldenrod
    info: "#1e6091",            // Ocean Blue
    text: "#1c1c1c",            // Near Black
    muted: "#7f6e5d",           // Warm Gray
    dim: "#bcab93",             // Light Tan
    bgDark: "#fdf4e3",          // Warm Cream
    bgPanel: "#f5ebd3",         // Light Beige
    bgElement: "#eaddc4",       // Beige
    border: "#cbb89e",          // Tan
    borderActive: "#a08972",    // Warm Gray
    borderHighlight: "#c84e0b", // Burnt Orange
  },
  dusk: {
    primary: "#fab283",         // Warm Peach
    primaryBright: "#ffc09f",   // Bright Warm Peach
    secondary: "#5c9cf5",       // Soft Blue
    accent: "#9d7cd8",          // Soft Violet
    success: "#7fd88f",         // Mint Green
    error: "#e06c75",           // Soft Red
    warning: "#f5a742",         // Warm Amber
    info: "#56b6c2",            // Cyan
    text: "#eeeeee",            // White
    muted: "#808080",           // Gray
    dim: "#484848",             // Dark Gray
    bgDark: "#0a0a0a",          // Deep Black
    bgPanel: "#141414",         // Dark Surface
    bgElement: "#1e1e1e",       // Dark Element
    border: "#323232",          // Subtle Border
    borderActive: "#606060",    // Active Border
    borderHighlight: "#fab283", // Peach Border
  },
  midnight: {
    primary: "#00e5ff",         // Bright Cyan
    primaryBright: "#64ffda",   // Mint Cyan
    secondary: "#7c4dff",       // Deep Purple
    accent: "#ea80fc",          // Magenta
    success: "#00e676",         // Bright Green
    error: "#ff1744",           // Bright Red
    warning: "#ffea00",         // Yellow
    info: "#40c4ff",            // Light Blue
    text: "#e0e0e0",            // Light Gray
    muted: "#616161",           // Medium Gray
    dim: "#424242",             // Dark Gray
    bgDark: "#000000",          // Pure Black
    bgPanel: "#0a0a0a",         // Near Black
    bgElement: "#121212",       // Very Dark
    border: "#263238",          // Blue-Gray
    borderActive: "#00e5ff",    // Cyan Border
    borderHighlight: "#00e5ff", // Cyan Highlight
  },
  forest: {
    primary: "#a3be8c",         // Sage Green
    primaryBright: "#c5e0b4",   // Light Sage
    secondary: "#5e81ac",       // Slate Blue
    accent: "#b48ead",          // Heather
    success: "#8fbc8f",         // Moss Green
    error: "#bf616a",           // Rust Red
    warning: "#d08770",         // Clay
    info: "#88c0d0",            // Ice Blue
    text: "#e5e9e8",            // Light Gray
    muted: "#7b8a7a",           // Sage Gray
    dim: "#4a5a49",             // Dark Sage
    bgDark: "#1e241e",          // Deep Forest
    bgPanel: "#2a332a",         // Forest Floor
    bgElement: "#354035",       // Moss Dark
    border: "#4a5a49",          // Dark Sage
    borderActive: "#6b7f6a",    // Mid Sage
    borderHighlight: "#a3be8c", // Sage Green
  },
  ocean: {
    primary: "#4fc3f7",         // Sky Blue
    primaryBright: "#81d4fa",   // Light Sky
    secondary: "#7e57c2",       // Deep Purple
    accent: "#26c6da",          // Cyan
    success: "#66bb6a",         // Green
    error: "#ef5350",           // Red
    warning: "#ffa726",         // Orange
    info: "#42a5f5",            // Blue
    text: "#e0f2fe",            // Ice White
    muted: "#78909c",           // Blue Gray
    dim: "#37474f",             // Dark Blue Gray
    bgDark: "#0a1628",          // Abyssal Blue
    bgPanel: "#122338",         // Deep Sea
    bgElement: "#1a3050",       // Mid Ocean
    border: "#2a4a6a",          // Teal Dark
    borderActive: "#4fc3f7",    // Sky Blue
    borderHighlight: "#4fc3f7", // Sky Blue
  },
  lava: {
    primary: "#ff7043",         // Lava Orange
    primaryBright: "#ff8a65",   // Bright Lava
    secondary: "#ffd54f",       // Gold
    accent: "#e53935",          // Red
    success: "#66bb6a",         // Green (oasis)
    error: "#ef5350",           // Red
    warning: "#ffa726",         // Amber
    info: "#ff8a65",            // Orange
    text: "#fff3e0",            // Warm White
    muted: "#8d6e63",           // Brown Gray
    dim: "#4e342e",             // Dark Brown
    bgDark: "#1a0a00",          // Pitch Black-Red
    bgPanel: "#2c1308",         // Ember Dark
    bgElement: "#3d1c0e",       // Charcoal
    border: "#5d2c16",          // Rust
    borderActive: "#ff7043",    // Lava
    borderHighlight: "#ff7043", // Lava
  },
  violet: {
    primary: "#ce93d8",         // Light Purple
    primaryBright: "#e1bee7",   // Pale Purple
    secondary: "#80cbc4",       // Teal
    accent: "#f48fb1",          // Pink
    success: "#a5d6a7",         // Light Green
    error: "#ef9a9a",           // Light Red
    warning: "#ffe082",         // Light Yellow
    info: "#90caf9",            // Light Blue
    text: "#f3e5f5",            // Lavender White
    muted: "#9575cd",           // Medium Purple
    dim: "#5e3577",             // Dark Purple
    bgDark: "#1a0d26",          // Deep Violet
    bgPanel: "#2a1740",         // Royal Purple
    bgElement: "#3a2255",       // Velvet
    border: "#4a3068",          // Plum
    borderActive: "#ce93d8",    // Light Purple
    borderHighlight: "#ce93d8", // Light Purple
  },
  mono: {
    primary: "#c0c0c0",         // Silver
    primaryBright: "#e0e0e0",   // Light Silver
    secondary: "#a0a0a0",       // Gray
    accent: "#b0b0b0",          // Mid Gray
    success: "#9e9e9e",         // Gray Green
    error: "#757575",           // Dark Gray
    warning: "#bdbdbd",         // Light Gray
    info: "#909090",            // Cool Gray
    text: "#f5f5f5",            // White
    muted: "#808080",           // Gray
    dim: "#505050",             // Dark Gray
    bgDark: "#0a0a0a",          // Black
    bgPanel: "#141414",         // Near Black
    bgElement: "#1e1e1e",       // Very Dark
    border: "#333333",          // Dark Border
    borderActive: "#666666",    // Mid Border
    borderHighlight: "#c0c0c0", // Silver
  },
  sakura: {
    primary: "#d81b60",         // Deep Pink
    primaryBright: "#f06292",   // Bright Pink
    secondary: "#7b1fa2",       // Purple
    accent: "#f48fb1",          // Light Pink
    success: "#81c784",         // Soft Green
    error: "#e53935",           // Red
    warning: "#ffb74d",         // Orange
    info: "#4dd0e1",            // Cyan
    text: "#2c1b1b",            // Dark Brown-Black
    muted: "#8d6e63",           // Brown Gray
    dim: "#bcaaa4",             // Beige
    bgDark: "#fce4ec",          // Pinkish Cream
    bgPanel: "#f8d7e3",         // Light Pink
    bgElement: "#f0c4d3",       // Dusty Pink
    border: "#d6a7b9",          // Mauve Pink
    borderActive: "#ad5a7a",    // Dusty Rose
    borderHighlight: "#d81b60", // Deep Pink
  },
  nord: {
    primary: "#88c0d0",         // Ice Blue
    primaryBright: "#8fbcbb",   // Frost Green
    secondary: "#81a1c1",       // Steel Blue
    accent: "#b48ead",          // Heather
    success: "#a3be8c",         // Sage
    error: "#bf616a",           // Red
    warning: "#d08770",         // Orange
    info: "#81a1c1",            // Steel Blue
    text: "#eceff4",            // Snow
    muted: "#616e87",           // Gray Blue
    dim: "#3b4252",             // Dark Gray Blue
    bgDark: "#141821",          // Deep Nord
    bgPanel: "#1e2433",         // Polar Night
    bgElement: "#2e3440",       // Night
    border: "#3b4252",          // Dark Border
    borderActive: "#5e687d",    // Active Border
    borderHighlight: "#88c0d0", // Ice Blue
  },
  solarized: {
    primary: "#cb4b16",         // Orange
    primaryBright: "#dc322f",   // Red
    secondary: "#268bd2",       // Blue
    accent: "#6c71c4",          // Violet
    success: "#859900",         // Green
    error: "#dc322f",           // Red
    warning: "#b58900",         // Yellow
    info: "#2aa198",            // Cyan
    text: "#839496",            // Base1
    muted: "#657b83",           // Base00
    dim: "#586e75",             // Base01
    bgDark: "#002b36",          // Base03
    bgPanel: "#073642",         // Base02
    bgElement: "#0d4a54",       // Slightly lighter
    border: "#184a52",          // Dark Cyan
    borderActive: "#2aa198",    // Cyan
    borderHighlight: "#cb4b16", // Orange
  },
  dracula: {
    primary: "#ff79c6",         // Pink
    primaryBright: "#ff92df",   // Bright Pink
    secondary: "#8be9fd",       // Cyan
    accent: "#bd93f9",          // Purple
    success: "#50fa7b",         // Green
    error: "#ff5555",           // Red
    warning: "#f1fa8c",         // Yellow
    info: "#8be9fd",            // Cyan
    text: "#f8f8f2",            // White
    muted: "#6272a4",           // Comment Gray
    dim: "#44475a",             // Selection
    bgDark: "#16161e",          // Darker Than Black
    bgPanel: "#21222c",         // Dark Background
    bgElement: "#2d2f3e",       // Current Line
    border: "#44475a",          // Selection
    borderActive: "#6272a4",    // Comment
    borderHighlight: "#ff79c6", // Pink
  },
  onedark: {
    primary: "#61afef",         // Blue
    primaryBright: "#56b6c2",   // Cyan
    secondary: "#c678dd",       // Purple
    accent: "#e5c07b",          // Yellow
    success: "#98c379",         // Green
    error: "#e06c75",           // Red
    warning: "#d19a66",         // Orange
    info: "#56b6c2",            // Cyan
    text: "#abb2bf",            // Light Gray
    muted: "#5c6370",           // Comment Gray
    dim: "#3e4451",             // Darker Gray
    bgDark: "#17171d",          // Darker BG
    bgPanel: "#21222c",         // Panel BG
    bgElement: "#2c323c",       // Element BG
    border: "#3e4451",          // Border
    borderActive: "#5c6370",    // Active Border
    borderHighlight: "#61afef", // Blue
  },
};

function buildPalette(name) {
  return { ...THEMES[name] };
}

export const palette = buildPalette("dusk");
const hex = (h) => chalk.hex(h);

function buildC(p) {
  return {
    primary: hex(p.primary),
    primaryBright: hex(p.primaryBright),
    secondary: hex(p.secondary),
    accent: hex(p.accent),
    success: hex(p.success),
    error: hex(p.error),
    warning: hex(p.warning),
    info: hex(p.info),
    text: hex(p.text),
    muted: hex(p.muted),
    dim: hex(p.dim),
    border: hex(p.border),
    borderActive: hex(p.borderActive),
    borderHighlight: hex(p.borderHighlight),
    bgPanel: hex(p.bgPanel),
    bgElement: hex(p.bgElement),
  };
}

export let c = buildC(palette);
export const colors = c;

export function setTheme(name) {
  if (!THEMES[name]) return;
  Object.assign(palette, THEMES[name]);
  Object.assign(c, buildC(palette));
}

export const glyph = {
  bullet: "●",
  pointer: "❯",
  arrow: "›",
  check: "✔",
  cross: "✖",
  warn: "⚠",
  info: "ℹ",
  dash: "─",
  dot: "·",
  corner: "╰",
  branch: "├",
  sparkle: "✦",
  gear: "⚙",
  boxTL: "╭",
  boxTR: "╮",
  boxBL: "╰",
  boxBR: "╯",
  boxV: "│",
  boxH: "─",
};

// OpenCode Badge Helper: renders a pill badge like [built] or [1.20.1]
export function badge(label, color = c.primary, bgHex = "#1e1e1e") {
  return chalk.bgHex(bgHex)(color(` ${label} `));
}

