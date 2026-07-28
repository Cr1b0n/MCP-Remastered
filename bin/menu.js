#!/usr/bin/env node
import readline from "node:readline";
import chalk from "chalk";
import fs from "node:fs/promises";
import { createWorkspace, manageWorkspaces, runDoctor, listWorkspaces } from "./create.js";
import { c, palette, glyph, badge, setTheme } from "../lib/mcptui/theme.js";
import { termWidth, termHeight, layoutWidth, layoutIndent, stripAnsi, centerText, gradient, renderKeymapPills, renderBox } from "../lib/mcptui/renderer.js";
import { select } from "../lib/mcptui/prompt.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(__dirname, "settings.json");

const MCP_ASCII = [
  "█▀▄▀█ █▀▀ █▀█",
  "█ ▀ █ █▄▄ █▀▀",
];

const REMASTERED_ASCII = [
  "█▀█ █▀▀ █▀▄▀█ █▀█ █▀ ▀█▀ █▀▀ █▀█ █▀▀ █▀▄",
  "█▀▄ ██▄ █ ▀ █ █▀█ ▄█  █  ██▄ █▀▄ ██▄ █▄▀",
];

const ACTIONS = [
  { label: "Create a new workspace", desc: "Decompile fresh Minecraft client or server", tag: "NEW" },
  { label: "Manage existing workspaces", desc: "Inspect, repair, or delete workspaces", tag: "LIST" },
  { label: "System diagnostic check", desc: "Verify Node, Java JDKs & Mojang connectivity", tag: "CHECK" },
  { label: "Settings", desc: "UI & compiler preferences", tag: "SETTINGS" },
  { label: "Exit session", desc: "Close terminal session", tag: "QUIT" },
];

let selectedIndex = 0;
let isRunning = true;

async function buildMenu() {
  const cols = termWidth();
  const W = layoutWidth();
  const pad = (n) => " ".repeat(n);
  const rows = termHeight();
  const cardWidth = Math.min(W - 4, 140);

  const workspaces = await listWorkspaces();
  ACTIONS[1].label = `Manage existing workspaces (${workspaces.length})`;

  // Header bar (always at top)
  const headerLine = centerText(` ${glyph.sparkle} ${c.primary.bold("MCP")} ${c.muted("Remastered")} ${c.dim("·")} ${c.dim("v1.3.0")}`, cols);
  const separatorLine = c.dim("─".repeat(cols));

  // Footer
  const lf = c.muted("~/MCP-Remastered");
  const rf = c.muted("v1.3.0");
  const footerLine = ` ${lf}${" ".repeat(Math.max(1, cols - 4 - stripAnsi(lf).length - stripAnsi(rf).length))}${rf} `;

  const bi = Math.max(0, Math.floor((cols - cardWidth) / 2));

  // Shared parts
  const cardLines = [];
  ACTIONS.forEach((act, idx) => {
    const sel = idx === selectedIndex;
    cardLines.push(`${sel ? ` ${c.primary.bold(glyph.pointer)} ` : "   "}${sel ? c.primaryBright.bold(act.label.padEnd(28)) : c.text(act.label.padEnd(28))} ${c.muted(act.desc)}`);
  });
  const wsLines = workspaces.slice(0, 3).map(w =>
    `  ${c.text.bold(w.meta.id.padEnd(12))} ${w.meta.side === "server" ? badge("SERVER", c.warning) : badge("CLIENT", c.secondary)} ${w.hasBuild ? badge("BUILT", c.success) : badge("READY", c.info)} ${c.dim("·")} ${w.meta.javaMajor ? c.muted(`JDK ${w.meta.javaMajor}`) : c.muted("Java ?")} ${c.dim("·")} ${c.muted(w.base)}`
  );
  const keymapLine = centerText(renderKeymapPills([
    { key: "↑/↓", label: "navigate" },
    { key: "↵", label: "select" },
    { key: "q", label: "quit" },
  ]), cols);

  // Build block — compact (text-only) when window is too small for the banner
  let block;
  if (rows < 30) {
    const compactTitle = centerText(c.text.bold("MCP Remastered") + c.dim(" · v1.3.0"), cols);
    const actionLines = ACTIONS.map((act, idx) => {
      const sel = idx === selectedIndex;
      const ptr = sel ? c.primary.bold(glyph.pointer) : " ";
      const name = sel ? c.primaryBright.bold(act.label) : c.text(act.label);
      const desc = c.muted(act.desc);
      return centerText(`${ptr}  ${name}  ${desc}`, cols);
    });
    let wsCompact = "";
    if (workspaces.length > 0) {
      const ids = workspaces.slice(0, 3).map(w => w.meta.id);
      wsCompact = centerText(c.text.bold(`${workspaces.length} workspace(s)`) + c.dim(" · ") + c.muted(ids.join(", ")), cols);
    }
    block = [
      compactTitle, "",
      ...actionLines, "",
      wsCompact ? wsCompact : null,
      wsCompact ? "" : null,
      keymapLine,
    ].filter(x => x !== null);
  } else {
    const logoLines = [];
    for (let i = 0; i < 2; i++) {
      const mcpPart = gradient(MCP_ASCII[i], palette.primary, palette.primaryBright);
      const remPart = gradient(REMASTERED_ASCII[i], "#a0a0a0", "#606060");
      const fullLine = `${mcpPart}   ${remPart}`;
      logoLines.push(pad(Math.max(0, Math.floor((cols - stripAnsi(fullLine).length) / 2))) + fullLine);
    }
    const subtitleLine = centerText(c.dim("Select workspace action below"), cols);
    const boxBlock = renderBox("Workspace Actions", cardLines, { width: cardWidth, active: true }).split("\n").map(l => pad(bi) + l).join("\n");
    let wsBlock = "";
    if (workspaces.length > 0) {
      wsBlock = renderBox(`Workspaces (${workspaces.length})`, wsLines, { width: cardWidth }).split("\n").map(l => pad(bi) + l).join("\n");
    }
    block = [
      ...logoLines, "", subtitleLine, "",
      boxBlock, "",
      wsBlock ? wsBlock : null,
      wsBlock ? "" : null,
      keymapLine,
    ].filter(x => x !== null);
  }

  const blockText = block.join("\n");
  const blockHeight = blockText.split("\n").length;

  // Vertical centering: header at top, block centered, footer at bottom
  const totalLines = 2 + blockHeight + 1 + 1; // header+sep + block + blank-line + footer
  const remaining = Math.max(0, rows - totalLines);
  const topPad = Math.min(Math.floor(remaining / 2), 3);
  const bottomPad = remaining - topPad;

  let output = headerLine + "\n" + separatorLine;
  for (let i = 0; i < topPad; i++) output += "\n";
  output += blockText;
  for (let i = 0; i < bottomPad; i++) output += "\n";
  output += "\n" + footerLine;
  return output;
}

async function showSettings() {
  const cols = termWidth();
  const pad = (n) => " ".repeat(n);
  const cardW = Math.min(cols - 4, 140);
  const bi = Math.max(0, Math.floor((cols - cardW) / 2));

  // Build header + logo
  const h = [
    centerText(` ${glyph.sparkle} ${c.primary.bold("MCP")} ${c.muted("Remastered")} ${c.dim("·")} ${c.dim("Settings")}`, cols),
    c.dim("─".repeat(cols)),
  ].join("\n");

  const logoLine1 = gradient(MCP_ASCII[0], palette.primary, palette.primaryBright);
  const logoLine2 = gradient(MCP_ASCII[1], palette.primary, palette.primaryBright);
  const remLine1 = gradient(REMASTERED_ASCII[0], "#a0a0a0", "#606060");
  const remLine2 = gradient(REMASTERED_ASCII[1], "#a0a0a0", "#606060");
  const logo = [
    pad(Math.max(0, Math.floor((cols - stripAnsi(`${logoLine1}   ${remLine1}`).length) / 2))) + `${logoLine1}   ${remLine1}`,
    pad(Math.max(0, Math.floor((cols - stripAnsi(`${logoLine2}   ${remLine2}`).length) / 2))) + `${logoLine2}   ${remLine2}`,
  ].join("\n");

  const box = renderBox("Preferences", [
    c.text("Choose a theme or configure compiler options below."),
  ], { width: cardW, active: true });
  const boxBlock = box.split("\n").map(l => pad(bi) + l).join("\n");

  // Center settings panel vertically, header at top
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(h + "\n\n");
  process.stdout.write(logo + "\n\n");
  process.stdout.write(boxBlock + "\n\n");

  const themeList = [
    ["dawn", "light, warm tones"],
    ["dusk", "warm peach, dark bg"],
    ["midnight", "cyan & black"],
    ["forest", "sage green, deep forest"],
    ["ocean", "sky blue, abyssal dark"],
    ["lava", "orange & red ember"],
    ["violet", "purple velvet"],
    ["mono", "monochrome grayscale"],
    ["sakura", "soft pink, light"],
    ["nord", "arctic ice & snow"],
    ["solarized", "sand & ocean"],
    ["dracula", "dark neon purple"],
    ["onedark", "code editor classic"],
  ];

  const chosen = await select({
    message: "Theme:",
    choices: [
      ...themeList.map(([v, d]) => ({ name: `${c.text(v.charAt(0).toUpperCase() + v.slice(1))}  ${c.muted(d)}`, value: v })),
      { name: c.muted("─".repeat(24)), value: "_" },
      { name: `${c.muted("Compiler:")}  ${c.text("Java path")}   ${c.muted("WIP")}`, value: "wip" },
      { name: `${c.muted("Compiler:")}  ${c.text("Memory allocation")}   ${c.muted("WIP")}`, value: "wip" },
      { name: c.muted("‹ Back to main menu"), value: null },
    ],
  });

  if (!chosen || chosen === "_") return;
  if (chosen === "wip") {
    process.stdout.write(c.muted("\nCompiler settings are not yet implemented.\n"));
  }
  if (chosen !== "wip") {
    setTheme(chosen);
    try {
      await fs.writeFile(SETTINGS_PATH, JSON.stringify({ theme: chosen }, null, 2));
    } catch {}
  }
}

async function render() {
  const output = await buildMenu();
  process.stdout.write("\x1b[2J\x1b[H" + output);
}

async function handleAction(index) {
  isRunning = false;
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.removeAllListeners("keypress");

  process.stdout.write("\x1b[2J\x1b[H");

  try {
    if (index === 4) {
      process.stdout.write("\n" + c.muted("Session closed. Goodbye!\n"));
      process.exit();
    }

    if (index === 0) await createWorkspace();
    else if (index === 1) await manageWorkspaces();
    else if (index === 2) await runDoctor();
    else if (index === 3) await showSettings();
  } catch (err) {
    process.stdout.write(c.error("\nError:") + " " + err.message + "\n");
    process.stdout.write(c.muted("\nPress Enter to return to main menu..."));
    await new Promise(resolve => {
      const h = (ch, key) => {
        if (key.name === "return" || key.name === "enter") {
          process.stdin.removeListener("keypress", h);
          resolve();
        }
      };
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      readline.emitKeypressEvents(process.stdin);
      process.stdin.on("keypress", h);
    });
  }

  isRunning = true;
  try {
    await render();
  } catch {
    await render();
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", handleKey);
}

function handleKey(str, key) {
  if (!isRunning) return;
  if (key.ctrl && key.name === "c") process.exit();
  if (key.name === "q") process.exit();

  if (key.name === "up") {
    selectedIndex = (selectedIndex - 1 + ACTIONS.length) % ACTIONS.length;
    render();
  } else if (key.name === "down") {
    selectedIndex = (selectedIndex + 1) % ACTIONS.length;
    render();
  } else if (key.name === "return") {
    handleAction(selectedIndex);
  }
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on("keypress", handleKey);
process.stdout.on("resize", () => {
  if (isRunning) render();
});

(async () => {
  try {
    const data = JSON.parse(String(await fs.readFile(SETTINGS_PATH)));
    if (data.theme) setTheme(data.theme);
  } catch {}
  render();
})();

