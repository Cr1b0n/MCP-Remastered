import chalk from "chalk";

const W = 36;

export function renderBar(percent, color = chalk.cyan) {
  const p = Math.max(0, Math.min(100, percent));
  const filled = Math.round((p / 100) * W);
  return color("\u2588".repeat(filled)) + chalk.gray("\u2591".repeat(W - filled));
}

export function makeReporter(isRepair) {
  let currentStep = null;
  let lastLine = "";
  let lastReportedPct = -1;

  return (step, percent, line) => {
    const label = STEP_TITLES[step] || step;

    if (step !== currentStep) {
      if (currentStep !== null) process.stdout.write("\n");
      currentStep = step;
      const prefix = isRepair ? chalk.gray("[Repair] ") : "";
      process.stdout.write(`  ${prefix}${chalk.bold(label)}\n`);
      lastLine = "";
      lastReportedPct = -1;
    }

    if (percent === 100) {
      process.stdout.write(
        `    ${renderBar(100, chalk.green)} ${chalk.green.bold("100%")}  ${chalk.green("\u2713")}\n`
      );
      if (line && line !== lastLine) {
        process.stdout.write(`    ${chalk.gray(line)}\n`);
      }
      lastLine = line || "";
      lastReportedPct = 100;
      return;
    }

    const cleanLine = (line || "").replace(/\[[\u2580-\u259f]+\]\s*\d+%/g, "").trim();

    const pctRound = Math.round(percent);
    const pctDiff = pctRound - lastReportedPct;
    const textChanged = cleanLine && cleanLine !== lastLine;

    if (pctDiff >= 3 || textChanged || percent === 0) {
      const bar = renderBar(percent, chalk.cyan);
      const pct = `${pctRound}%`.padStart(4);
      process.stdout.write(`    ${bar} ${chalk.bold(pct)}  ${chalk.gray(cleanLine)}\n`);
      lastLine = cleanLine;
      lastReportedPct = pctRound;
    }
  };
}

const STEP_TITLES = {
  meta: "Checking Java & fetching version metadata",
  "download-client": "Downloading client.jar",
  "download-mappings": "Downloading official mappings",
  tools: "Fetching decompiler tooling",
  libraries: "Downloading dependency libraries from Mojang",
  remap: "Deobfuscating (rewriting obfuscated names)",
  decompile: "Decompiling",
  extract: "Extracting source & resources",
  switchmaps: "Indexing enum switch maps",
  scaffold: "Writing version scaffold (app.js, build.js, properties.js)",
};
