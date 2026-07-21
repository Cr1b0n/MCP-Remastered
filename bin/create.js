#!/usr/bin/env node
import chalk from "chalk";
import ora from "ora";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { search, confirm, input, select } from "@inquirer/prompts";
import { Listr } from "listr2";

import { printBanner } from "../lib/banner.js";
import { makeReporter } from "../lib/progressDisplay.js";
import { detectJavaInstallations, suggestJavaForVersion } from "../lib/javaDetect.js";
import { fetchVersionManifest } from "../lib/manifest.js";
import { runPipeline, repairPipeline } from "../lib/pipeline.js";
import { versionDir } from "../lib/paths.js";
import { getDecompilableVersions } from "../lib/versionIndex.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_PATH = path.join(__dirname, "key.json");
const CANCEL_PATH = path.join(__dirname, "cancel.json");

const TYPE_LABEL = {
  release: chalk.green("release"),
  snapshot: chalk.yellow("snapshot"),
  old_beta: chalk.magenta("beta"),
  old_alpha: chalk.red("alpha"),
};

async function setupGeminiKey() {
  if (await fs.pathExists(CANCEL_PATH)) return;
  if (await fs.pathExists(KEY_PATH)) return;

  console.log(chalk.cyan("\n  Gemini AI Integration"));
  console.log(chalk.gray("  MCP-Remastered can use Google Gemini AI to help fix"));
  console.log(chalk.gray("  decompilation errors and assist with modding.\n"));

  const answer = await input({
    message: "Enter your Gemini API key (or type 'cancel' to skip, 'cancel_forever' to never ask):",
  });

  const trimmed = answer.trim();

  if (trimmed.toLowerCase() === "cancel_forever") {
    await fs.ensureDir(path.dirname(CANCEL_PATH));
    await fs.writeJson(CANCEL_PATH, { canceled: true, forever: true });
    console.log(chalk.gray("Gemini integration disabled permanently.\n"));
    return;
  }

  if (trimmed.toLowerCase() === "cancel" || !trimmed) {
    console.log(chalk.gray("Skipping Gemini setup.\n"));
    return;
  }

  await fs.ensureDir(path.dirname(KEY_PATH));
  await fs.writeJson(KEY_PATH, { key: trimmed });
  console.log(chalk.green("Gemini API key saved.\n"));
}

async function promptUseGemini(versionId) {
  if (await fs.pathExists(CANCEL_PATH)) return false;
  if (!(await fs.pathExists(KEY_PATH))) return false;

  const useGemini = await confirm({
    message: `Use Gemini AI to assist with ${versionId}? (applies fixups and generates helpers)`,
    default: false,
  });

  return useGemini;
}

async function generateGeminiConfig(versionId) {
  const dir = versionDir(versionId);
  const geminiTemplate = path.join(__dirname, "..", "templates", "gemini.js");
  if (await fs.pathExists(geminiTemplate)) {
    const template = await fs.readFile(geminiTemplate, "utf8");
    const rendered = template.replaceAll("{{VERSION}}", versionId);
    const geminiPath = path.join(dir, "gemini.js");
    await fs.writeFile(geminiPath, rendered, { mode: 0o755 });
    console.log(chalk.green(`  Generated gemini.js for ${versionId}\n`));
    return geminiPath;
  }
  return null;
}

async function pickVersion(versions) {
  return search({
    message: "Choose a Minecraft version (type to filter):",
    source: async (input) => {
      const filtered = !input
        ? versions.slice(0, 50)
        : versions.filter((v) => v.id.toLowerCase().includes(input.toLowerCase()));
      return filtered.slice(0, 50).map((v) => ({
        name: `${v.id}  ${TYPE_LABEL[v.type] || v.type}`,
        value: v,
      }));
    },
  });
}

async function main() {
  console.clear();
  printBanner();

  await setupGeminiKey();

  const forceRefresh = process.argv.includes("--refresh");
  const serverMode = process.argv.includes("--server");
  if (serverMode) {
    console.log(chalk.yellow("  [EXPERIMENTAL] Server mode enabled. Use at your own risk.\n"));
  }

  const spinner = ora("Fetching Minecraft version list...").start();
  let manifest;
  try {
    manifest = await fetchVersionManifest();
    spinner.succeed(`Loaded ${manifest.versions.length} versions from Mojang.`);
  } catch (err) {
    spinner.fail(`Could not reach Mojang's version manifest: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const compatSpinner = ora(
    forceRefresh
      ? "Refreshing decompilable-version list (checking each version's real mappings)..."
      : "Checking which versions this tool can decompile..."
  ).start();
  let decompilable;
  try {
    decompilable = await getDecompilableVersions(manifest, {
      forceRefresh,
      onProgress: (done, total) => {
        compatSpinner.text = `Checking versions for official mappings... ${done}/${total}`;
      },
    });
    const supported = manifest.versions.filter((v) => decompilable.versions.has(v.id));
    manifest = { ...manifest, versions: supported };
    compatSpinner.succeed(
      `${supported.length} version(s) confirmed decompilable ` +
        `(checked live against Mojang's own mappings data, cached ${new Date(
          decompilable.builtAt
        ).toLocaleString()}). Run with --refresh to force a recheck.`
    );
  } catch (err) {
    compatSpinner.warn(
      `Couldn't verify which versions are decompilable (${err.message}) - showing the full unfiltered list instead.`
    );
  }

  const chosen = await pickVersion(manifest.versions);

  const side = serverMode ? "server" : "client";
  const dirId = side === "server" ? `${chosen.id}-server` : chosen.id;
  const dir = versionDir(dirId);
  const alreadyExists = await fs.pathExists(path.join(dir, "metadata.json"));
  let action = null;

  if (alreadyExists) {
    console.log(chalk.yellow(`\n  Version ${chosen.id} already exists at:`));
    console.log(`  ${chalk.cyan(dir)}\n`);
    action = await select({
      message: "What would you like to do?",
      choices: [
        { name: "Repair / reinstall missing files (downloads only what's needed)", value: "repair" },
        { name: "Full reinstall (delete and redo everything)", value: "fresh" },
        { name: "Cancel", value: "cancel" },
      ],
    });

    if (action === "cancel") {
      console.log(chalk.gray("Cancelled."));
      return;
    }

    if (action === "fresh") {
      console.log(chalk.yellow(`Removing ${dir}...`));
      await fs.remove(dir);
      console.log(chalk.green("Done.\n"));
    }
  }

  if (!alreadyExists || action === "fresh") {
    console.log(
      `\nThis will create ${chalk.cyan(dir)} and download the ` +
        `${side} jar, official mappings, and decompiler tooling.\n`
    );
  } else {
    console.log(
      `\nRepair mode: checking ${chalk.cyan(dir)} for missing files.\n`
    );
  }

  if (!alreadyExists || action === "fresh") {
    const proceed = await confirm({ message: `Continue with ${chosen.id}?`, default: true });
    if (!proceed) {
      console.log(chalk.gray("Cancelled."));
      return;
    }
  }

  const javas = await detectJavaInstallations();
  let selectedJava = null;
  const targetJavaMajor = chosen.id.startsWith("1.") ? parseInt(chosen.id.split(".")[1] || "8", 10) : parseInt(chosen.id.split(".")[0] || "21", 10);
  const suggested = suggestJavaForVersion(targetJavaMajor, javas);

  if (javas.length > 0) {
    const javaChoices = javas.map(j => ({
      name: `JDK ${j.major} (${j.vendor}) - ${j.java}${j === suggested ? "  " + chalk.green("[recommended]") : ""}`,
      value: j,
      short: `JDK ${j.major}`,
    }));
    javaChoices.unshift({ name: `${chalk.gray("Default (java on PATH)")}${suggested ? "" : "  " + chalk.green("[recommended]")}`, value: null, short: "Default" });
    const javaChoice = await select({
      message: `Choose a Java JDK for ${chosen.id} (needs Java ${targetJavaMajor}+):`,
      choices: javaChoices,
      default: suggested ? javaChoices.findIndex(c => c.value === suggested) + 1 : 0,
    });
    if (javaChoice) selectedJava = javaChoice;
  }

  const useGemini = await promptUseGemini(chosen.id);

  const isRepair = alreadyExists && action === "repair";
  const pipelineFn = isRepair ? repairPipeline : runPipeline;
  const extraOpts = { ...(selectedJava ? { javaBin: selectedJava.java } : {}), side };

  let pipelineResult;
  try {
    console.log("");
    pipelineResult = await pipelineFn(chosen, makeReporter(isRepair), extraOpts);
  } catch (err) {
    console.error(chalk.red(`\n  \u2716 Failed: ${err.message}`));
    process.exitCode = 1;
    return;
  }

  if (useGemini) {
    const geminiTasks = new Listr(
      [
        {
          title: "Setting up Gemini integration",
          task: async (ctx, task) => {
            const geminiPath = await generateGeminiConfig(chosen.id);
            task.title = geminiPath ? "Gemini integration ready" : "Skipped Gemini setup";
          },
        },
      ],
      { rendererOptions: { showTimer: true } }
    );
    await geminiTasks.run();
  }

  const { dirs, skipped, repaired } = pipelineResult;

  console.log(chalk.green(`\n  \u2713 Done! Workspace ready at:`));
  console.log(`    ${chalk.cyan(dirs.base)}\n`);

  if (isRepair) {
    console.log(chalk.bold("  Repair summary:"));
    console.log(`    ${chalk.green(`${repaired} item(s) repaired`)} ${chalk.gray(`(${skipped} already up-to-date)`)}`);
    console.log(`    Scaffold files (app.js, build.js, properties.js) regenerated.\n`);
  }

  const isServerSide = side === "server";
  console.log(chalk.bold("  Quick start:"));
  console.log(`    cd ${dirs.base}`);
  console.log(`    node app.js            ${chalk.gray("# show flags")}`);
  console.log(`    node app.js --info     ${chalk.gray("# show version + build info")}`);
  console.log(`    node app.js --build    ${chalk.gray("# package remastered.jar (works first try)")}`);
  if (isServerSide) {
    console.log(`    node app.js --server   ${chalk.gray("# launch dedicated server (--nogui)")}`);
  } else {
    console.log(`    node app.js --run      ${chalk.gray("# best-effort dev launch")}`);
  }
  console.log(`    node app.js --fix      ${chalk.gray("# fix decompiler artifacts in src/")}`);
  console.log(`    node app.js --setup    ${chalk.gray("# configure build.js & properties.js")}`);

  if (useGemini) {
    console.log(`    node app.js --gemini   ${chalk.gray("# interactive Gemini assistant")}`);
  }

  console.log(`\n  ${chalk.cyan("build.js")} - Gradle-like build config`);
  console.log(`  ${chalk.cyan("properties.js")} - Runtime configuration (memory, assets, etc.)\n`);
}

main();
