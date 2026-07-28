import fs from "fs-extra";
import path from "path";
import AdmZip from "adm-zip";
import { execa } from "execa";

/**
 * Hybrid build strategy (how real MCP-style packs work):
 * 1. Seed build/classes from the deobfuscated client jar (always valid bytecode)
 * 2. Overlay recompiled .java sources on top (user edits)
 * 3. Package the jar — succeeds even when javac can't compile every decompiler artifact
 */
export async function extractDeobfClasses(deobfJarPath, classesDir) {
  if (!(await fs.pathExists(deobfJarPath))) {
    throw new Error(`Deobfuscated jar not found: ${deobfJarPath}\nRe-run create.js to repair the workspace.`);
  }

  await fs.ensureDir(classesDir);
  await fs.emptyDir(classesDir);

  const zip = new AdmZip(deobfJarPath);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.endsWith(".class")) continue;
    const target = path.join(classesDir, entry.entryName);
    await fs.ensureDir(path.dirname(target));
    await fs.writeFile(target, entry.getData());
  }

  const count = zip.getEntries().filter((e) => e.entryName.endsWith(".class")).length;
  return count;
}

export async function findJavaFiles(dir, resourcesDir, metaMtime = 0) {
  const results = [];
  if (!(await fs.pathExists(dir))) return results;

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (full === resourcesDir) continue;
        await walk(full);
      } else if (entry.name.endsWith(".java")) {
        const stat = await fs.stat(full);
        if (stat.mtimeMs > metaMtime) {
          results.push(full);
        }
      }
    }
  }

  await walk(dir);
  return results;
}

export async function collectClasspath(libDir) {
  const jars = [];
  async function scan(dir) {
    if (!(await fs.pathExists(dir))) return;
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await scan(full);
      else if (entry.name.endsWith(".jar")) jars.push(full);
    }
  }
  await scan(libDir);
  return jars;
}

export async function compileSources({
  javaFiles,
  classesDir,
  classpath,
  javacBin,
  buildCfg,
  argsFilePath,
  logPath,
}) {
  if (javaFiles.length === 0) return { success: true, output: "", compiled: 0 };

  await fs.ensureDir(path.dirname(argsFilePath));
  await fs.writeFile(argsFilePath, javaFiles.map((f) => `"${f}"`).join("\n"));

  const targetVersion = buildCfg.build?.javaVersion;
  const extraFlags = buildCfg.build?.extraJavacFlags || [];
  let versionFlags = [];
  if (targetVersion > 0) {
    try {
      const { stdout, stderr } = await execa(javacBin, ["--release", "--help"], { stdio: "pipe", timeout: 5000 });
      versionFlags = ["--release", String(targetVersion)];
    } catch {
      versionFlags = ["-source", String(targetVersion), "-target", String(targetVersion)];
    }
  }
  const javacArgs = [
    "-d", classesDir,
    "-encoding", buildCfg.build?.encoding || "UTF-8",
    ...versionFlags,
    ...(classpath ? ["-cp", classpath] : []),
    "-Xmaxerrs", "100",
    "-Xmaxwarns", "100",
    ...extraFlags,
    `@${argsFilePath}`,
  ];

  try {
    const result = await execa(javacBin, javacArgs, { stdio: "pipe", all: true });
    const output = result.all || "";
    if (logPath) await fs.writeFile(logPath, output, "utf8");
    return { success: true, output, compiled: javaFiles.length };
  } catch (err) {
    const output = err.all || err.stdout || err.stderr || err.message || "";
    if (logPath) await fs.writeFile(logPath, output, "utf8");
    return { success: false, output, compiled: 0 };
  }
}

export async function packageJar(classesDir, resourcesDir, outputJar, vanillaJar) {
  const zip = new AdmZip();
  zip.addLocalFolder(classesDir);

  if (vanillaJar && (await fs.pathExists(vanillaJar))) {
    const vzip = new AdmZip(vanillaJar);
    for (const entry of vzip.getEntries()) {
      if (entry.entryName.startsWith("assets/") && !entry.isDirectory) {
        zip.addFile(entry.entryName, entry.getData());
      }
    }
  }

  if (await fs.pathExists(resourcesDir)) {
    zip.addLocalFolder(resourcesDir);
    for (const entry of zip.getEntries()) {
      if (/^META-INF\/(?:.*\.(?:SF|RSA|DSA|EC)|MANIFEST\.MF)$/i.test(entry.entryName)) {
        zip.deleteFile(entry);
      }
    }
  }
  await fs.ensureDir(path.dirname(outputJar));
  zip.writeZip(outputJar);
}

export function countCompileErrors(output) {
  const matches = output.match(/\.java:\d+: error:/g);
  return matches ? matches.length : 0;
}

export function countCompileWarnings(output) {
  const matches = output.match(/\.java:\d+: warning:/g);
  return matches ? matches.length : 0;
}
