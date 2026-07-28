#!/usr/bin/env node
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { printBanner } from "../lib/banner.js";
import { fixVersionWorkspace } from "../lib/fixups.js";
import * as ui from "../lib/ui.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.clear();
  printBanner();

  const target = process.argv[2];
  if (!target) {
    ui.box("Fix Artifact Usage", [
      `${ui.c.primary.bold("Command:")} ${ui.c.text("node bin/fix.js <path-to-version-dir>")}`,
      `${ui.c.muted("Example:")} ${ui.c.text("node bin/fix.js ~/MCP-Remastered/1.20.4")}`,
    ]);
    ui.line("");
    process.exitCode = 1;
    return;
  }

  let versionDir = path.resolve(target);
  if (path.basename(versionDir) === "src") {
    versionDir = path.dirname(versionDir);
  }

  const srcDir = path.join(versionDir, "src");
  if (!(await fs.pathExists(srcDir))) {
    ui.failure(`Version workspace not found at ${ui.c.accent(versionDir)}`);
    ui.line("");
    process.exitCode = 1;
    return;
  }

  const versionId = path.basename(versionDir);
  ui.box(`Fix Workspace · ${versionId}`, [
    `${ui.c.muted("Target Directory".padEnd(18))}${ui.badge(versionDir, ui.c.secondary)}`,
  ]);
  ui.line("");

  const loader = ui.createLoader();
  loader.start("Scanning workspace source files for decompiler artifacts...");

  try {
    const { filesFixed, totalChanges, remainingUnrepresentable } = await fixVersionWorkspace(versionDir, {
      onProgress: (msg) => loader.text(msg),
    });

    loader.stop();
    ui.separator(42, { color: ui.c.success });

    if (filesFixed === 0 && remainingUnrepresentable === 0) {
      ui.success("No fixable artifacts found - workspace source code is clean.");
    } else {
      if (totalChanges > 0) {
        ui.success(`Repaired ${ui.badge(`${totalChanges} artifact(s)`, ui.c.success)} in ${filesFixed} file(s).`);
      }
      if (remainingUnrepresentable > 0) {
        ui.warning(`${remainingUnrepresentable} file(s) still contain unresolved switch maps.`);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    loader.fail(`Fix process encountered error: ${err.message}`);
    process.exitCode = 1;
  }
  ui.line("");
}


main();
