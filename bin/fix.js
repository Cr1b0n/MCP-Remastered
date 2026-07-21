#!/usr/bin/env node
import chalk from "chalk";
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { fixVersionWorkspace } from "../lib/fixups.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.log(chalk.cyan("\n  MCP-Remastered Fix"));
    console.log(chalk.gray("  Usage: node bin/fix.js <path-to-version-dir>\n"));
    console.log(chalk.gray("  Example: node bin/fix.js ~/MCP-Remastered/1.20.4\n"));
    process.exitCode = 1;
    return;
  }

  let versionDir = path.resolve(target);
  if (path.basename(versionDir) === "src") {
    versionDir = path.dirname(versionDir);
  }

  const srcDir = path.join(versionDir, "src");
  if (!(await fs.pathExists(srcDir))) {
    console.log(chalk.red(`\n  Version workspace not found: ${versionDir}\n`));
    process.exitCode = 1;
    return;
  }

  const versionId = path.basename(versionDir);
  console.log(chalk.cyan("\n  MCP-Remastered Fix"));
  console.log(chalk.gray(`  Version: ${versionId}\n`));

  try {
    const { filesFixed, totalChanges, remainingUnrepresentable } =
      await fixVersionWorkspace(versionDir, {
        onProgress: (msg) => console.log(chalk.gray(`  ${msg}`)),
      });

    if (filesFixed === 0 && remainingUnrepresentable === 0) {
      console.log(chalk.green("  ✓ No fixable artifacts found.\n"));
    } else {
      if (totalChanges > 0) {
        console.log(chalk.green(`  ✓ Fixed ${totalChanges} artifact(s) in ${filesFixed} file(s).\n`));
      }
      if (remainingUnrepresentable > 0) {
        console.log(chalk.yellow(`  ⚠ ${remainingUnrepresentable} file(s) still have unresolved switch maps.\n`));
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.log(chalk.red(`  ✗ ${err.message}\n`));
    process.exitCode = 1;
  }
}

main();
