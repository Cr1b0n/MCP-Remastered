import os from "os";
import chalk from "chalk";
import { c, palette, glyph } from "./mcptui/theme.js";
import { termWidth, layoutWidth, layoutIndent, stripAnsi, gradient, centerText } from "./mcptui/renderer.js";

export const CREDITS = "Cr1b0n & saad2001";

const MCP_ASCII = [
  "█▀▄▀█ █▀▀ █▀█",
  "█ ▀ █ █▄▄ █▀▀",
];

const REMASTERED_ASCII = [
  "█▀█ █▀▀ █▀▄▀█ █▀█ █▀ ▀█▀ █▀▀ █▀█ █▀▀ █▀▄",
  "█▀▄ ██▄ █ ▀ █ █▀█ ▄█  █  ██▄ █▀▄ ██▄ █▄▀",
];

export function printBanner() {
  const W = layoutWidth();
  const LI = layoutIndent();
  const pad = (n) => " ".repeat(n);
  const lines = [""];

  // Header Bar across top, centered in the terminal
  const title = ` ${glyph.sparkle} `;
  const brandMCP = c.primary.bold("MCP");
  const brandRemastered = c.muted("Remastered");
  const ver = c.dim("v1.3.0");

  const headerLeft = `${title}${brandMCP} ${brandRemastered} ${c.dim("·")} ${ver}`;
  lines.push(centerText(headerLeft, termWidth()));
  lines.push(c.dim("─".repeat(termWidth())));
  lines.push("");

  // Logo: MCP in colored gradient, REMASTERED in gray gradient
  for (let i = 0; i < 2; i++) {
    const mcpPart = gradient(MCP_ASCII[i], palette.primary, palette.primaryBright);
    const remPart = gradient(REMASTERED_ASCII[i], "#a0a0a0", "#606060");
    const fullLine = `${mcpPart}   ${remPart}`;
    const cleanLen = stripAnsi(fullLine).length;
    const logoPad = Math.max(0, Math.floor((W - cleanLen) / 2));
    lines.push(pad(LI + logoPad) + fullLine);
  }

  lines.push("");
  const subtitle = `${brandMCP} ${brandRemastered} ${c.dim("·")} ${c.muted("Minecraft Decompiler Pack")} ${c.dim("·")} ${c.muted(CREDITS)} ${c.dim("·")} ${c.muted(`node ${process.version}`)}`;
  const subPad = Math.max(0, Math.floor((W - stripAnsi(subtitle).length) / 2));
  lines.push(pad(LI + subPad) + subtitle);
  lines.push("");

  console.log(lines.join("\n"));
}



