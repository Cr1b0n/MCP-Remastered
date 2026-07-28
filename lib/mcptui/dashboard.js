import chalk from "chalk";
import ansiEscapes from "ansi-escapes";
import { c, palette, glyph, badge } from "./theme.js";
import { termWidth, renderBox } from "./renderer.js";

const bold = chalk.bold;

const STEPS = [
  { id: "meta", title: "Java & metadata", icon: "⚙" },
  { id: "download-client", title: "Downloading client.jar", icon: "⬇" },
  { id: "download-mappings", title: "Downloading mappings", icon: "⬇" },
  { id: "tools", title: "Fetching tooling", icon: "⚙" },
  { id: "libraries", title: "Downloading libraries", icon: "⬇" },
  { id: "remap", title: "Deobfuscating names", icon: "⇄" },
  { id: "decompile", title: "Decompiling bytecode", icon: "⚔" },
  { id: "extract", title: "Extracting assets", icon: "✦" },
  { id: "switchmaps", title: "Indexing switch maps", icon: "△" },
  { id: "scaffold", title: "Writing workspace files", icon: "✍" },
];

function parseHex(h) {
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

function lerpColor(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  };
}

function toHex(c) {
  return `#${c.r.toString(16).padStart(2, "0")}${c.g.toString(16).padStart(2, "0")}${c.b.toString(16).padStart(2, "0")}`;
}

function miniBar(percent, w = 20) {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * w);
  const cFrom = parseHex(palette.primary);
  const cTo = parseHex(palette.accent);
  let s = "";
  for (let i = 0; i < w; i++) {
    const t = w > 1 ? i / (w - 1) : 0;
    const col = toHex(lerpColor(cFrom, cTo, t));
    s += i < filled ? chalk.hex(col)("█") : c.dim("░");
  }
  return s;
}

function cleanLogLine(line) {
  return (line || "")
    .replace(/\u001b\[\d+(;\d+)*m/g, "")
    .replace(/[\u2580-\u259f]+\s*\d+%/g, "")
    .trim();
}

function buildView(stepStates, currentLine) {
  const lines = [];

  const total = STEPS.length;
  const done = stepStates.filter((s) => s.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const headerContent = `${c.primary.bold("Pipeline Status")}  ${c.muted(`[${done}/${total}]`)}  ${miniBar(pct, 22)}  ${c.primaryBright.bold(`${pct}%`)}`;
  lines.push(headerContent);
  lines.push(c.dim("─".repeat(56)));

  for (const s of stepStates) {
    if (s.status === "done") {
      lines.push(`  ${c.success(glyph.check)}  ${c.muted(s.title.padEnd(28))} ${badge("DONE", c.success)}`);
    } else if (s.status === "active") {
      const bar = miniBar(s.percent, 16);
      lines.push(`  ${c.primary(glyph.pointer)}  ${c.text.bold(s.title.padEnd(28))} ${bar} ${c.primaryBright.bold(`${s.percent}%`.padStart(4))}`);
    } else {
      lines.push(`  ${c.dim("○")}  ${c.dim(s.title.padEnd(28))} ${c.dim("pending")}`);
    }
  }

  if (currentLine) {
    lines.push(c.dim("─".repeat(56)));
    lines.push(`  ${c.muted("log:")} ${c.text(currentLine.slice(0, 48))}`);
  }

  return renderBox("Decompiler Pipeline", lines, { width: Math.min(termWidth() - 4, 68), active: true });
}

export function createDashboard() {
  let active = false;
  let lineCount = 0;
  let stepStates = STEPS.map((s) => ({ title: s.title, status: "pending", percent: 0 }));

  function render(output) {
    const n = output.split("\n").length;
    if (lineCount > 0) {
      process.stdout.write(ansiEscapes.cursorUp(lineCount));
    }
    process.stdout.write(ansiEscapes.cursorTo(0));
    process.stdout.write(ansiEscapes.eraseDown);
    process.stdout.write(output + "\n");
    lineCount = n + 1;
  }

  return {
    start() {
      active = true;
      stepStates = STEPS.map((s) => ({ title: s.title, status: "pending", percent: 0 }));
      process.stdout.write(ansiEscapes.cursorHide);
      render(buildView(stepStates, ""));
    },

    update(stepId, percent, line) {
      if (!active) return;
      const clean = cleanLogLine(line);

      const knownIdx = STEPS.findIndex((s) => s.id === stepId);

      if (knownIdx >= 0) {
        stepStates = STEPS.map((s) => {
          if (s.id === stepId) {
            return { title: s.title, status: percent >= 100 ? "done" : "active", percent: Math.round(percent) };
          }
          const thisIdx = STEPS.findIndex((x) => x.id === s.id);
          return {
            title: s.title,
            status: thisIdx < knownIdx ? "done" : "pending",
            percent: thisIdx < knownIdx ? 100 : 0,
          };
        });
      }

      render(buildView(stepStates, clean));
    },

    stop() {
      if (!active) return;
      active = false;
      process.stdout.write(ansiEscapes.cursorShow);
    },
  };
}

export { STEPS as dashboardSteps };

export function renderBar(percent, from = palette.primary, to = palette.accent) {
  const W = Math.min(termWidth() - 20, 60);
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * W);
  const cFrom = parseHex(from);
  const cTo = parseHex(to);
  let s = "";
  for (let i = 0; i < W; i++) {
    const t = W > 1 ? i / (W - 1) : 0;
    const col = toHex(lerpColor(cFrom, cTo, t));
    s += i < filled ? chalk.hex(col)("█") : c.dim("░");
  }
  return s;
}

