#!/usr/bin/env node
import chalk from "chalk";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { printBanner } from "../lib/banner.js";
import * as ui from "../lib/ui.js";
import { palette } from "../lib/mcptui/theme.js";
import { select, search, confirm, input } from "../lib/mcptui/prompt.js";
import { makeReporter } from "../lib/progressDisplay.js";
import { createLoader } from "../lib/mcptui/loading.js";
import { termWidth } from "../lib/mcptui/renderer.js";

import { detectJavaInstallations, suggestJavaForVersion } from "../lib/javaDetect.js";
import { fetchVersionManifest } from "../lib/manifest.js";
import { runPipeline, repairPipeline } from "../lib/pipeline.js";
import { ROOT, versionDir } from "../lib/paths.js";
import { getDecompilableVersions } from "../lib/versionIndex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TYPE_LABEL = {
  release: ui.badge("RELEASE", ui.c.success),
  snapshot: ui.badge("SNAPSHOT", ui.c.warning),
  old_beta: ui.badge("BETA", ui.c.accent),
  old_alpha: ui.badge("ALPHA", ui.c.error),
};


// ------------------------------------------------------- workspace index --

export async function listWorkspaces() {
  if (!(await fs.pathExists(ROOT))) return [];
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const workspaces = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const base = path.join(ROOT, entry.name);
    const metaPath = path.join(base, "metadata.json");
    if (!(await fs.pathExists(metaPath))) continue;
    try {
      const meta = await fs.readJson(metaPath);
      const hasBuild = (await fs.pathExists(path.join(base, "build")))
        ? (await fs.readdir(path.join(base, "build"))).length > 0
        : false;
      workspaces.push({ dir: entry.name, base, meta, hasBuild });
    } catch {
    }
  }
  return workspaces.sort((a, b) => (b.meta.createdAt || "").localeCompare(a.meta.createdAt || ""));
}

function printQuickStart(dirs, { isServer } = {}) {
  const lines = [
    `${ui.c.muted("Workspace Path".padEnd(18))}${ui.badge(dirs.base, ui.c.secondary)}`,
    "",
    `${ui.c.primary.bold("node app.js").padEnd(24)}${ui.c.muted("show flags & usage help")}`,
    `${ui.c.primary.bold("node app.js --info").padEnd(24)}${ui.c.muted("version + build info")}`,
    `${ui.c.primary.bold("node app.js --build").padEnd(24)}${ui.c.muted("package remastered.jar")}`,
    `${ui.c.primary.bold(isServer ? "node app.js --server" : "node app.js --run").padEnd(24)}${ui.c.muted(isServer ? "launch dedicated server" : "best-effort dev launch")}`,
    `${ui.c.primary.bold("node app.js --fix").padEnd(24)}${ui.c.muted("fix decompiler artifacts in src/")}`,
    `${ui.c.primary.bold("node app.js --setup").padEnd(24)}${ui.c.muted("configure build.js & properties.js")}`,
    "",
    `  ${ui.c.primaryBright("build.js")}       ${ui.c.muted("gradle-like build config")}`,
    `  ${ui.c.primaryBright("properties.js")}  ${ui.c.muted("runtime config (memory, assets, java)")}`,
  ];
  ui.box("Quick Start Guide", lines);
  ui.line("");
}

// ------------------------------------------------------------- doctor --

export async function runDoctor() {
  const cpuModel = os.cpus().length ? os.cpus()[0].model.replace(/\(R\)|\(TM\)/g, "").trim() : "unknown";
  const cpuStr = cpuModel ? `${cpuModel} · ${os.cpus().length} thread(s)` : "unknown";

  const sysLines = [
    `${ui.c.muted("Node Version".padEnd(18))}${ui.badge(process.version, ui.c.primary)}`,
    `${ui.c.muted("Platform".padEnd(18))}${ui.c.text(`${os.platform()} (${os.arch()})`)}`,
    `${ui.c.muted("Memory".padEnd(18))}${ui.c.text(`${(os.freemem() / 1024 ** 3).toFixed(1)} GB free / ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB total`)}`,
    `${ui.c.muted("CPU Model".padEnd(18))}${ui.c.text(cpuStr)}`,
  ];
  ui.box("System Diagnostic Check", sysLines);

  if (Number((os.totalmem() / 1024 ** 3).toFixed(1)) < 8) {
    ui.warning("Under 8GB RAM detected - decompiling large versions may take longer.");
  }

  if (fs.promises && typeof fs.promises.statfs === "function") {
    try {
      const stat = await fs.promises.statfs(os.homedir());
      const freeDiskGB = ((stat.bfree * stat.bsize) / 1024 ** 3).toFixed(1);
      ui.kv("  Disk space", `${freeDiskGB} GB free in home directory`);
    } catch {
    }
  }

  ui.spacer();
  const javaLoader = createLoader();
  javaLoader.start("Scanning system for installed JDKs...");
  const javas = await detectJavaInstallations();
  javaLoader.stop();
  if (javas.length === 0) {
    ui.warning("No JDK installations found on PATH or in standard Java directories.");
  } else {
    ui.success(`${javas.length} JDK installation(s) detected:`);
    for (const j of javas) {
      ui.kv(`  JDK ${j.major}`, `${ui.badge(j.vendor, ui.c.secondary)}  ${ui.c.muted(j.java)}`);
    }
  }

  ui.spacer();
  const netLoader = createLoader();
  netLoader.start("Checking network access to Mojang services...");
  try {
    const manifest = await fetchVersionManifest();
    netLoader.succeed(`Mojang API reachable (${ui.badge(`${manifest.versions.length} versions`, ui.c.success)})`);
  } catch (err) {
    netLoader.fail(`Mojang API unreachable: ${err.message}`);
  }

  const workspaces = await listWorkspaces();
  ui.spacer();
  ui.kv("  Workspaces", `${workspaces.length} workspace(s) active at ${ROOT}`);
  ui.spacer();
}

// ---------------------------------------------------- manage workspaces --

export async function manageWorkspaces() {
  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    ui.warning("No workspaces found. Select 'Create a new workspace' to get started.");
    return;
  }

  const chosen = await select({
    message: "Select workspace to manage:",
    choices: [
      ...workspaces.map((w) => ({
        name: `${w.meta.id.padEnd(12)} ${w.meta.side === "server" ? ui.badge("SERVER", ui.c.warning) : ui.badge("CLIENT", ui.c.secondary)} ${w.hasBuild ? ui.badge("BUILT", ui.c.success) : ui.badge("READY", ui.c.info)}  ${ui.c.muted(`JDK ${w.meta.javaMajor ?? "?"}`)}`,
        value: w,
      })),
      { name: ui.c.muted("‹ Back to main menu"), value: null },
    ],
  });
  if (!chosen) return;

  const action = await select({
    message: `Workspace Actions · ${chosen.dir}:`,
    choices: [
      { name: "Show quick-start commands", value: "start" },
      { name: "Repair (re-download missing files)", value: "repair" },
      { name: "Delete workspace", value: "delete" },
      { name: ui.c.muted("‹ Back"), value: "back" },
    ],
  });

  if (action === "start") {
    printQuickStart(
      { base: chosen.base },
      { isServer: chosen.meta.side === "server" }
    );
    return;
  }

  if (action === "delete") {
    const sure = await confirm({ message: `Permanently delete workspace ${chosen.dir}?`, default: false });
    if (!sure) return;
    await fs.remove(chosen.base);
    ui.success(`Removed workspace ${chosen.dir}.`);
    return;
  }

  if (action === "repair") {
    const loader = createLoader();
    loader.start("Fetching version manifest...");
    let manifest;
    try {
      manifest = await fetchVersionManifest();
      loader.stop();
    } catch (err) {
      loader.fail(`Could not reach Mojang: ${err.message}`);
      return;
    }
    const versionEntry = manifest.versions.find((v) => v.id === chosen.meta.id);
    if (!versionEntry) {
      ui.failure(`${chosen.meta.id} no longer appears in Mojang's manifest - can't repair.`);
      return;
    }
    const side = chosen.meta.side === "server" ? "server" : "client";
    try {
      const result = await repairPipeline(versionEntry, makeReporter(true), { side });
      ui.success(`Repaired: ${result.repaired} item(s) fixed, ${result.skipped} already up to date.`);
    } catch (err) {
      ui.failure(`Repair failed: ${err.message}`);
    }
  }
}


// -------------------------------------------------------- version picker --


async function pickVersion(versions) {
  console.clear();
  printBanner();
  ui.box("Minecraft Version Selection", [
    `${ui.c.success(ui.glyph.check)} ${versions.length} version(s) confirmed decompilable`,
    `${ui.c.muted("Type to filter versions, use arrow keys to navigate")}`,
  ], { active: true });
  ui.spacer();

  const boxW = Math.min(termWidth() - 4, 120);
  const indent = Math.max(0, Math.floor((termWidth() - boxW) / 2));
  process.stdout.write(" ".repeat(indent));

  return search({
    message: "Search Minecraft version:",
    source: async (input) => {
      const filtered = !input
        ? versions
        : versions.filter((v) => v.id.toLowerCase().includes(input.toLowerCase()));
      return filtered.map((v) => ({
        name: `${ui.c.text.bold(v.id.padEnd(16))} ${TYPE_LABEL[v.type] || v.type}`,
        value: v,
      }));
    },
  });
}

// ------------------------------------------------------- create workspace --

export async function createWorkspace() {
  const forceRefresh = process.argv.includes("--refresh");
  const serverMode = process.argv.includes("--server");
  if (serverMode) ui.warning("Server mode is experimental.");

  console.clear();
  printBanner();

  const versionLoader = createLoader();
  versionLoader.start("Fetching Minecraft version list from Mojang...");
  let manifest;
  try {
    manifest = await fetchVersionManifest();
    versionLoader.succeed(`Loaded ${manifest.versions.length} versions from Mojang manifest.`);
  } catch (err) {
    versionLoader.fail(`Could not reach Mojang's version manifest: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const compatLoader = createLoader({ frames: "dots" });
  compatLoader.start(
    forceRefresh ? "Refreshing decompilable-version list..." : "Verifying decompilable version mappings..."
  );
  try {
    const decompilable = await getDecompilableVersions(manifest, {
      forceRefresh,
      onProgress: (done, total) => {
        compatLoader.text(`Verifying version mappings... ${done}/${total}`);
      },
    });
    const supported = manifest.versions.filter((v) => decompilable.versions.has(v.id));
    manifest = { ...manifest, versions: supported };
    compatLoader.succeed(`${supported.length} version(s) confirmed decompilable.`);
  } catch (err) {
    compatLoader.warn(`Couldn't verify decompilable versions (${err.message}) - showing all.`);
  }

  const chosen = await pickVersion(manifest.versions);

  const side = serverMode ? "server" : "client";
  const dirId = side === "server" ? `${chosen.id}-server` : chosen.id;
  const dir = versionDir(dirId);
  const alreadyExists = await fs.pathExists(path.join(dir, "metadata.json"));
  let action = null;

  if (alreadyExists) {
    console.clear();
    printBanner();
    ui.box("Workspace Warning", [
      `${ui.c.warning(ui.glyph.warn)} Workspace for ${chosen.id} already exists at ${dir}`,
    ], { active: true });
    ui.spacer();

    action = await select({
      message: "Select action for existing workspace:",
      choices: [
        { name: "Repair / reinstall missing files only", value: "repair" },
        { name: "Full reinstall (delete and redo everything)", value: "fresh" },
        { name: ui.c.muted("‹ Cancel"), value: "cancel" },
      ],
    });
    if (action === "cancel") return;
    if (action === "fresh") {
      await fs.remove(dir);
      ui.success("Removed old workspace.");
    }
  }

  const javas = await detectJavaInstallations();
  let selectedJava = null;
  const targetJavaMajor = chosen.id.startsWith("1.")
    ? parseInt(chosen.id.split(".")[1] || "8", 10)
    : parseInt(chosen.id.split(".")[0] || "21", 10);
  const suggested = suggestJavaForVersion(targetJavaMajor, javas);

  if (javas.length > 0) {
    console.clear();
    printBanner();
    ui.box("Java Runtime Selection", [
      `${ui.c.muted("Minecraft " + chosen.id + " requires Java " + targetJavaMajor + "+")}`,
      `${ui.c.text("Select an installed JDK for decompilation and workspace build")}`,
    ], { active: true });
    ui.spacer();

    const javaChoices = javas.map((j) => ({
      name: `JDK ${String(j.major).padEnd(4)} ${ui.badge(j.vendor, ui.c.secondary)} ${j === suggested ? "  " + ui.badge("RECOMMENDED", ui.c.success) : ""} ${ui.c.muted(j.java)}`,
      value: j,
      short: `JDK ${j.major}`,
    }));
    javaChoices.unshift({
      name: `Default   ${ui.badge("PATH", ui.c.info)} ${suggested ? "" : "  " + ui.badge("RECOMMENDED", ui.c.success)} ${ui.c.muted("system default java command")}`,
      value: null,
      short: "Default",
    });

    const javaChoice = await select({
      message: `Select Java JDK for ${chosen.id} (needs ${targetJavaMajor}+):`,
      choices: javaChoices,
      default: suggested ? javaChoices.findIndex((c) => c.value === suggested) + 1 : 0,
    });
    if (javaChoice) selectedJava = javaChoice;
  }

  if (!alreadyExists || action === "fresh") {
    console.clear();
    printBanner();
    const setupLines = [
      `${ui.c.muted("Minecraft Version".padEnd(20))}${ui.badge(chosen.id, ui.c.primary)}`,
      `${ui.c.muted("Target Directory".padEnd(20))}${ui.c.accent(dir)}`,
      `${ui.c.muted("Workspace Mode".padEnd(20))}${ui.badge(side.toUpperCase(), side === "server" ? ui.c.warning : ui.c.secondary)}`,
      `${ui.c.muted("JDK Runtime".padEnd(20))}${selectedJava ? ui.badge(`JDK ${selectedJava.major}`, ui.c.secondary) : ui.badge("System Default", ui.c.info)}`,
    ];
    ui.box("Workspace Creation Setup", setupLines, { active: true });
    ui.spacer();

    const proceed = await confirm({ message: `Begin decompiling ${chosen.id}?`, default: true });
    if (!proceed) return;
  } else {
  }


  const isRepair = alreadyExists && action === "repair";
  const pipelineFn = isRepair ? repairPipeline : runPipeline;
  const extraOpts = { ...(selectedJava ? { javaBin: selectedJava.java } : {}), side };

  const reporter = makeReporter(isRepair);

  let pipelineResult;
  try {
    ui.line("");
    pipelineResult = await pipelineFn(chosen, reporter, extraOpts);
  } catch (err) {
    reporter.done();
    ui.failure(`Failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  reporter.done();

  const { dirs, skipped, repaired } = pipelineResult;
  ui.separator(40, { color: ui.c.success });
  ui.success(`Workspace ready at ${ui.c.accent(dirs.base)}`);

  if (isRepair) {
    ui.kv("Repaired", `${repaired} item(s) (${skipped} already up to date)`);
  }

  printQuickStart(dirs, { isServer: side === "server" });
}

// ---- CLI actions requiring process.argv ----

export async function doctorFromCLI() {
  await runDoctor();
}

export async function manageFromCLI() {
  await manageWorkspaces();
}

export async function createFromCLI() {
  await createWorkspace();
}

// ------------------------------------------------------------------ main --

async function main() {
  console.clear();
  printBanner();

  if (process.argv.includes("--doctor")) return doctorFromCLI();
  if (process.argv.includes("--manage")) return manageFromCLI();

  if (process.argv.includes("--list")) {
    const workspaces = await listWorkspaces();
    if (workspaces.length === 0) {
      ui.muted("No workspaces yet - run without --list to create one.");
      return;
    }
    ui.box(`Workspaces (${workspaces.length})`, [
      ...workspaces.map((w) => {
        const tagSide = w.meta.side === "server" ? ui.badge("SERVER", ui.c.warning) : ui.badge("CLIENT", ui.c.secondary);
        const tagBuild = w.hasBuild ? ui.badge("BUILT", ui.c.success) : ui.badge("READY", ui.c.info);
        const idText = ui.c.primary.bold((w.meta.id + (w.meta.side === "server" ? " (server)" : "")).padEnd(16));
        return `${idText} ${tagSide} ${tagBuild} ${ui.c.muted(w.base)}`;
      }),
    ]);
    ui.line("");
    return;

  }

  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    return createFromCLI();
  }

  const bw = Math.min(termWidth() - 4, 120);
  process.stdout.write(" ".repeat(Math.max(0, Math.floor((termWidth() - bw) / 2))));

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Create a new workspace", value: "create" },
      { name: `Manage existing workspaces (${workspaces.length})`, value: "manage" },
      { name: "System check", value: "doctor" },
      { name: "Exit", value: "exit" },
    ],
  });

  if (action === "create") return createFromCLI();
  if (action === "manage") return manageFromCLI();
  if (action === "doctor") return doctorFromCLI();
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(__filename)
);

if (isMain) {
  main();
}
