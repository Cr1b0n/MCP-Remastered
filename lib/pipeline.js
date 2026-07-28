import fs from "fs-extra";
import path from "path";
import AdmZip from "adm-zip";
import { execa } from "execa";
import { fileURLToPath } from "url";

import { fetchVersionMeta, hasOfficialMappings } from "./manifest.js";
import { downloadIfMissing, downloadFile } from "./downloader.js";
import { renderBar } from "./progressDisplay.js";
import { TOOLS_DIR, SHARED_LIB_DIR, versionSubdirs } from "./paths.js";
import { downloadLibraries } from "./libraryResolver.js";
import { applyKnownFixups, fixVersionWorkspace } from "./fixups.js";

/** Quick check whether a file is a valid zip by attempting to open it. */
async function isValidZip(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return false;
    const stat = await fs.stat(filePath);
    if (stat.size < 22) return false;
    new AdmZip(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Download a jar, retrying once if the result isn't a valid zip. */
async function downloadJar(url, destPath, onProgress) {
  if (await isValidZip(destPath)) return { destPath, skipped: true };
  await downloadIfMissing(url, destPath, onProgress);
  if (!(await isValidZip(destPath))) {
    await fs.remove(destPath);
    await downloadIfMissing(url, destPath, onProgress);
    if (!(await isValidZip(destPath))) {
      throw new Error(`Downloaded corrupt jar (not a valid zip): ${destPath}`);
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function syncSharedLib() {
  const srcLib = path.join(__dirname);
  const files = ["fixups.js", "buildSupport.js", "switchMapExtractor.js"];
  await fs.ensureDir(SHARED_LIB_DIR);
  for (const file of files) {
    const src = path.join(srcLib, file);
    const dest = path.join(SHARED_LIB_DIR, file);
    if (src !== dest) {
      await fs.copy(src, dest, { overwrite: true });
    }
  }
}

async function extractSourcesFromJar(decompiledJarPath, dirs, switchMaps, report) {
  if (!(await isValidZip(decompiledJarPath))) {
    throw new Error(
      `Decompiled jar is corrupted or missing. Re-run to re-decompile.\n` +
      `File: ${decompiledJarPath}`
    );
  }
  const zip = new AdmZip(decompiledJarPath);
  let fixupCount = 0;
  let extractedCount = 0;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const isJava = entry.entryName.endsWith(".java");
    const target = isJava
      ? path.join(dirs.src, entry.entryName)
      : path.join(dirs.resources, entry.entryName);
    await fs.ensureDir(path.dirname(target));
    if (isJava) {
      try {
        const { text, changes } = applyKnownFixups(entry.getData().toString("utf8"), { switchMaps });
        fixupCount += changes;
        await fs.writeFile(target, text);
        extractedCount++;
      } catch (err) {
        report("extract", 50, `Warning: could not extract ${entry.entryName} (${err.message})`);
      }
    } else {
      await fs.writeFile(target, entry.getData());
    }
  }
  return { fixupCount, extractedCount };
}

// ART_VERSION: Updated to 1.1.2 to support Java 21 class files (major version 65).
// Version 0.1.22 bundled an older ASM that didn't support Java 21.
const ART_VERSION = "1.1.2";
// VINEFLOWER_VERSION: verified current release on Maven Central (1.12.0) as
// of this update. Needs Java 17+ to *run* the decompiler itself, which is
// unrelated to which Java version the Minecraft version being decompiled
// targets - Vineflower is a separate build-time tool.
const VINEFLOWER_VERSION = "1.12.0";

const ART_URL = `https://maven.minecraftforge.net/net/minecraftforge/ForgeAutoRenamingTool/${ART_VERSION}/ForgeAutoRenamingTool-${ART_VERSION}-all.jar`;
const VINEFLOWER_URL = `https://repo1.maven.org/maven2/org/vineflower/vineflower/${VINEFLOWER_VERSION}/vineflower-${VINEFLOWER_VERSION}.jar`;

/**
 * ART needs `-e <jar>` (one per library) for inheritance calculations when
 * fixing up bytecode - without it, more complex versions (records, newer
 * synthetic-parameter patterns) can fail mid-remap with "can't find ..."
 * errors because ART can't resolve a superclass/interface that lives in a
 * dependency jar rather than the client jar itself.
 */
async function buildLibraryFlags(libDir) {
  if (!(await fs.pathExists(libDir))) return [];
  const flags = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".jar")) flags.push("-e", full);
    }
  }
  await walk(libDir);
  return flags;
}

const JAVAX_FALLBACKS = [
  ["jsr305-3.0.2.jar", "https://repo1.maven.org/maven2/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar"],
  ["javax.annotation-api-1.3.2.jar", "https://repo1.maven.org/maven2/javax/annotation/javax.annotation-api/1.3.2/javax.annotation-api-1.3.2.jar"],
  ["jaxb-api-2.3.1.jar", "https://repo1.maven.org/maven2/javax/xml/bind/jaxb-api/2.3.1/jaxb-api-2.3.1.jar"],
  ["annotations-24.0.1.jar", "https://repo1.maven.org/maven2/org/jetbrains/annotations/24.0.1/annotations-24.0.1.jar"],
];

async function downloadJavaxFallbacks(libDir, targetMajor, report) {
  report("libraries", 50, "Adding extra dependency jars (javax, jetbrains annotations)...");
  for (const [name, url] of JAVAX_FALLBACKS) {
    const dest = path.join(libDir, name);
    if (!(await fs.pathExists(dest))) {
      try {
        await downloadFile(url, dest);
      } catch {}
    }
  }
}

async function runRemapWithRetry(dirs, artJarPath, clientJarPath, deobfJarPath, mappingsPath, versionMeta, report, logPath, maxRetries = 3) {
  const memories = ["3G", "4G", "6G"];
  let attempt = 0;
  let lastError;

  while (attempt < maxRetries) {
    if (attempt > 0) {
      await fs.remove(deobfJarPath);
    }
    const mem = memories[Math.min(attempt, memories.length - 1)];
    const label = attempt > 0 ? ` (retry ${attempt}, -Xmx${mem})` : "";
    report("remap", 0, `Deobfuscating...${label}`);

    try {
      const libFlags = await buildLibraryFlags(dirs.libraries);
      await runJavaWithLiveOutput(
        [
          `-Xmx${mem}`,
          "-jar", artJarPath,
          "--input", clientJarPath,
          "--output", deobfJarPath,
          "--map", mappingsPath,
          "--reverse",
          "--ann-fix",
          "--ids-fix",
          "--src-fix",
          "--record-fix",
          ...libFlags,
        ],
        (line) => report("remap", 50, line),
        logPath,
      );
      return;
    } catch (err) {
      lastError = err;
      const msg = err.message;
      const isOOM = /OutOfMemoryError|Java heap space/i.test(msg);
      const cantFind = /Can't find|ClassNotFoundException|NoClassDefFoundError/i.test(msg);

      if (isOOM && attempt < maxRetries - 1) {
        report("remap", 50, `Out of memory, retrying with larger heap...`);
        attempt++;
        continue;
      }

      if (cantFind && attempt < maxRetries - 1) {
        report("remap", 50, `Class resolution error, re-downloading libraries and retrying...`);
        try {
          await fs.remove(dirs.libraries);
          await fs.ensureDir(dirs.libraries);
          if (versionMeta.libraries?.length > 0) {
            await downloadLibraries(versionMeta, dirs.libraries, (pct, line) => {
              report("libraries", pct, line);
            });
          }
        } catch {}
        attempt++;
        continue;
      }

      throw err;
    }
  }

  throw lastError;
}

async function runDecompileWithRetry(vineflowerJarPath, deobfJarPath, decompiledJarPath, report, logPath, maxRetries = 3, isServer = false) {
  const memories = isServer ? ["4G", "6G", "8G"] : ["4G", "6G", "8G"];
  let attempt = 0;
  let lastError;

  while (attempt < maxRetries) {
    if (attempt > 0) {
      await fs.remove(decompiledJarPath);
    }
    const mem = memories[Math.min(attempt, memories.length - 1)];
    const label = attempt > 0 ? ` (retry ${attempt}, -Xmx${mem})` : "";
    report("decompile", 0, `Decompiling...${label}`);

    try {
      await runJavaWithLiveOutput(
        [
          `-Xmx${mem}`,
          "-jar", vineflowerJarPath,
          "-dgs=1",
          "-asc=1",
          "-din=1",
          deobfJarPath,
          decompiledJarPath,
        ],
        (line) => report("decompile", 50, line),
        logPath,
      );

      if (!(await fs.pathExists(decompiledJarPath))) {
        throw new Error("Decompiler produced no output file");
      }
      const stat = await fs.stat(decompiledJarPath);
      if (stat.size < 22) {
        throw new Error("Decompiler output is empty or truncated");
      }
      return;
    } catch (err) {
      lastError = err;
      const msg = err.message;
      if (/OutOfMemoryError|Java heap space/i.test(msg) && attempt < maxRetries - 1) {
        report("decompile", 50, `Out of memory, retrying with larger heap...`);
        attempt++;
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function extractBundledJar(jarPath, report) {
  if (!(await isValidZip(jarPath))) return jarPath;
  const zip = new AdmZip(jarPath);
  const entries = zip.getEntries();
  const versionJar = entries.find(e =>
    !e.isDirectory && e.entryName.startsWith("META-INF/versions/") && e.entryName.endsWith(".jar")
  );
  if (!versionJar) return jarPath;

  const extractedPath = jarPath.replace(/\.jar$/, "-extracted.jar");
  if (await fs.pathExists(extractedPath)) return extractedPath;

  report("extract-bundled", 50, `Extracting bundled server jar: ${versionJar.entryName}`);
  const data = versionJar.getData();
  await fs.writeFile(extractedPath, data);
  report("extract-bundled", 100, "Bundled server jar extracted.");
  return extractedPath;
}

async function runJavaWithLiveOutput(args, onLine, logFilePath) {
  if (logFilePath) await fs.ensureDir(path.dirname(logFilePath));

  return new Promise((resolve, reject) => {
    const logLines = [];
    const subprocess = execa("java", args, { reject: false });
    const tail = [];
    const handle = (data) => {
      for (const line of String(data).split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        logLines.push(line);
        onLine(line);
      }
    };
    subprocess.stdout?.on("data", handle);
    subprocess.stderr?.on("data", handle);
    subprocess.then(async (result) => {
      if (logFilePath) {
        await fs.writeFile(
          logFilePath,
          `$ java ${args.join(" ")}\n\n${logLines.join("\n")}\n`
        );
      }
      if (result.exitCode !== 0) {
        reject(
          new Error(
            `java exited with code ${result.exitCode}:\n${tail.join("\n")}` +
              (logFilePath ? `\n\nFull output saved to: ${logFilePath}` : "")
          )
        );
      } else {
        resolve(result);
      }
    }, reject);
  });
}

async function assertJavaAvailable(requiredMajor) {
  let versionText;
  try {
    const { stderr, stdout } = await execa("java", ["-version"]);
    versionText = `${stdout}\n${stderr}`;
  } catch {
    throw new Error(
      `Java was not found on PATH. Install a JDK` +
        (requiredMajor ? ` (Java ${requiredMajor}+)` : "") +
        ` and ensure \`java\` is on your PATH.`
    );
  }

  const match = versionText.match(/(\d+)\.(\d+)\.(\d+)/) || versionText.match(/(\d+)\.(\d+)/);
  const version = match ? parseInt(match[1], 10) : 0;
  const actualMajor = version >= 17 ? version : (match ? parseInt(match[2], 10) : 0);

  if (requiredMajor && actualMajor < requiredMajor) {
    throw new Error(
      `Java ${actualMajor} detected, but Minecraft ${requiredMajor} requires Java ${requiredMajor}+.\n` +
      `Install a JDK ${requiredMajor}+ and ensure it is first on your PATH.\n` +
      `Current java -version output:\n${versionText}`
    );
  }

  if (actualMajor < 17) {
    throw new Error(
      `Java ${actualMajor} is too old. Vineflower and FART require Java 17+.\n` +
      `Install JDK 17, 21, or 24 and ensure it is first on your PATH.\n` +
      `Current java -version output:\n${versionText}`
    );
  }

  return versionText;
}

async function checkStep(dirs, name, checkFn) {
  try {
    const ok = await checkFn(dirs);
    return ok;
  } catch {
    return false;
  }
}

function sideConfig(versionMeta, side) {
  const isServer = side === "server";
  const prefix = isServer ? "server" : "client";
  const jarUrl = isServer ? versionMeta.downloads.server.url : versionMeta.downloads.client.url;
  const mappingsUrl = isServer ? versionMeta.downloads.server_mappings.url : versionMeta.downloads.client_mappings.url;
  const mainClass = isServer ? "net.minecraft.server.Main" : (versionMeta.mainClass || "net.minecraft.client.main.Main");
  return { isServer, prefix, jarUrl, mappingsUrl, mainClass };
}

export async function repairPipeline(versionEntry, report, { javaBin = "java", side = "client" } = {}) {
  const dirId = side === "server" ? `${versionEntry.id}-server` : versionEntry.id;
  const dirs = versionSubdirs(dirId);
  await fs.ensureDir(dirs.raw);
  await fs.ensureDir(dirs.src);
  await fs.ensureDir(dirs.build);
  await fs.ensureDir(dirs.libraries);
  await fs.ensureDir(dirs.logs);
  await fs.ensureDir(TOOLS_DIR);
  await syncSharedLib();

  report("meta", 0, "Fetching version metadata...");
  const versionMeta = await fetchVersionMeta(versionEntry);

  if (!hasOfficialMappings(versionMeta, side)) {
    throw new Error(
      `Mojang did not publish official ${side} mappings for ${versionEntry.id} ` +
        `(only versions from ~1.14.4 onward have them).`
    );
  }

  const javaMajor = versionMeta.javaVersion?.majorVersion;
  await assertJavaAvailable(javaMajor);

  const { isServer, prefix, jarUrl, mappingsUrl, mainClass } = sideConfig(versionMeta, side);

  let clientJarPath = path.join(dirs.raw, `${prefix}.jar`);
  const mappingsPath = path.join(dirs.raw, `${prefix}_mappings.txt`);
  const deobfJarPath = path.join(dirs.raw, `${prefix}-deobf.jar`);
  const decompiledJarPath = path.join(dirs.raw, `${prefix}-decompiled.jar`);

  const hasJar = await checkStep(dirs, prefix, () => isValidZip(clientJarPath));
  const hasMappings = await checkStep(dirs, "mappings", () => fs.pathExists(mappingsPath));
  let hasDeobf = await checkStep(dirs, "deobf", () => fs.pathExists(deobfJarPath));
  const hasDecompiled = await checkStep(dirs, "decompiled", () => isValidZip(decompiledJarPath));
  const hasSrc = await checkStep(dirs, "src", async () => {
    if (!(await fs.pathExists(dirs.src))) return false;
    const files = await fs.readdir(dirs.src);
    return files.length > 0;
  });

  const artJarPath = path.join(TOOLS_DIR, `ForgeAutoRenamingTool-${ART_VERSION}.jar`);
  const vineflowerJarPath = path.join(TOOLS_DIR, `vineflower-${VINEFLOWER_VERSION}.jar`);

  let skipped = 0;
  let repaired = 0;

  if (!hasJar) {
    report(`download-${prefix}`, 0, `Downloading ${prefix}.jar...`);
    await downloadJar(jarUrl, clientJarPath, (pct) => {
      if (pct != null) report(`download-${prefix}`, pct, `Downloading ${prefix}.jar ${renderBar(pct)}`);
    });
    repaired++;
  } else {
    skipped++;
  }
  report(`download-${prefix}`, 100, hasJar ? `Already have ${prefix}.jar` : `${prefix}.jar downloaded.`);

  if (isServer) {
    clientJarPath = await extractBundledJar(clientJarPath, report);
    if (hasDeobf) {
      const stat = await fs.stat(deobfJarPath).catch(() => null);
      if (stat && stat.size < 1024 * 1024) {
        await fs.remove(deobfJarPath);
        hasDeobf = false;
        report("deobf", 50, "Server deobf jar too small (bundler stub), re-deobfuscating...");
      }
    }
  }

  if (!hasMappings) {
    await downloadIfMissing(mappingsUrl, mappingsPath, (pct) => {
      if (pct != null) report("download-mappings", pct, `Downloading mappings ${renderBar(pct)}`);
    });
    repaired++;
  } else {
    skipped++;
  }
  report("download-mappings", 100, hasMappings ? "Already have mappings" : "Mappings downloaded.");

  // Tools always check (cached across versions, downloadIfMissing skips if present)
  report("tools", 0, "Checking decompiler tooling...");
  await downloadIfMissing(ART_URL, artJarPath, (pct) => {
    if (pct != null) report("tools", pct, `Checking ForgeAutoRenamingTool ${renderBar(pct)}`);
  });
  await downloadIfMissing(VINEFLOWER_URL, vineflowerJarPath, (pct) => {
    if (pct != null) report("tools", pct, `Checking Vineflower ${renderBar(pct)}`);
  });
  report("tools", 100, "Tooling ready.");

  // Always download libraries (idempotent - skips existing)
  report("libraries", 0, "Checking dependency libraries...");
  let libAttempts = 0;
  const maxLibAttempts = 2;
  while (libAttempts < maxLibAttempts) {
    try {
      const libCount = versionMeta.libraries?.length || 0;
      if (libCount > 0) {
        await downloadLibraries(versionMeta, dirs.libraries, (pct, line) => {
          report("libraries", pct, line);
        });
      }
      break;
    } catch (err) {
      libAttempts++;
      if (libAttempts >= maxLibAttempts) {
        report("libraries", 100, `Warning: some libraries could not be downloaded (${err.message})`);
      } else {
        report("libraries", 50, `Library download issue, retrying... (${err.message})`);
      }
    }
  }
  // Verify library jars are valid
  const libDir = dirs.libraries;
  if (await fs.pathExists(libDir)) {
    let corruptCount = 0;
    for (const entry of await fs.readdir(libDir)) {
      if (!entry.endsWith(".jar")) continue;
      const jarPath = path.join(libDir, entry);
      if (!(await isValidZip(jarPath))) {
        await fs.remove(jarPath);
        corruptCount++;
      }
    }
    if (corruptCount > 0) {
      report("libraries", 100, `Removed ${corruptCount} corrupt library jar(s), re-downloading...`);
      try {
        await downloadLibraries(versionMeta, dirs.libraries, (pct, line) => {
          report("libraries", pct, line);
        });
      } catch {}
    }
  }
  await downloadJavaxFallbacks(dirs.libraries, javaMajor || 8, report);
  report("libraries", 100, "Libraries ready.");

  if (!hasDeobf) {
    try {
      await runRemapWithRetry(
        dirs, artJarPath, clientJarPath, deobfJarPath, mappingsPath, versionMeta, report,
        path.join(dirs.logs, "remap.log")
      );
    } catch (err) {
      throw new Error(`Deobfuscation failed.\n${err.message}`);
    }
    repaired++;
  } else {
    skipped++;
  }
  report("remap", 100, hasDeobf ? "Already deobfuscated" : "Deobfuscation complete.");

  if (!hasDecompiled) {
    try {
      await runDecompileWithRetry(
        vineflowerJarPath, deobfJarPath, decompiledJarPath, report,
        path.join(dirs.logs, "decompile.log"), 3, isServer
      );
    } catch (err) {
      throw new Error(`Decompilation failed.\n${err.message}`);
    }
    repaired++;
  } else {
    skipped++;
  }
  report("decompile", 100, hasDecompiled ? "Already decompiled" : "Decompilation complete.");

  report("switchmaps", 0, "Skipping full switch map scan (resolved on-demand)...");
  const switchMaps = {};

  if (!hasSrc) {
    report("extract", 0, "Extracting source files and assets...");
    const { fixupCount, extractedCount } = await extractSourcesFromJar(
      decompiledJarPath, dirs, switchMaps, report
    );
    repaired++;
    report(
      "extract",
      100,
      `Extracted ${extractedCount} sources to ${dirs.src}` +
        `${fixupCount ? ` (${fixupCount} decompiler artifact(s) auto-fixed)` : ""}`
    );
  } else {
    report("extract", 100, `Source already extracted (${(await fs.readdir(dirs.src)).length} entries)`);
    skipped++;
  }

  const switchFixResult = await fixVersionWorkspace(dirs.base, {
    onProgress(msg) {
      report("switchmaps", 50, msg);
    }
  });
  if (switchFixResult.switchMapCount > 0) {
    report("switchmaps", 100, `Fixed ${switchFixResult.totalChanges} unrepresentable switch(es) in ${switchFixResult.filesFixed} file(s)`);
  } else {
    report("switchmaps", 100, "No unrepresentable switches to fix.");
  }

  // Always regenerate scaffold (templates may have been updated)
  const metadata = {
    id: versionEntry.id,
    type: versionEntry.type,
    releaseTime: versionEntry.releaseTime,
    side: isServer ? "server" : "client",
    javaMajor: javaMajor ?? null,
    mainClass,
    assetIndex: isServer ? null : (versionMeta.assetIndex ?? null),
    createdAt: new Date().toISOString(),
    tools: { art: ART_VERSION, vineflower: VINEFLOWER_VERSION },
  };
  await fs.writeJson(path.join(dirs.base, "metadata.json"), metadata, { spaces: 2 });

  const templateName = isServer ? "server.js" : "client.js";
  const templatePath = path.join(__dirname, "..", "templates", templateName);
  const template = await fs.readFile(templatePath, "utf8");
  const rendered = template
    .replaceAll("{{VERSION}}", dirId)
    .replaceAll("{{CREATED}}", metadata.createdAt);
  const appPath = path.join(dirs.base, "app.js");
  await fs.writeFile(appPath, rendered, { mode: 0o755 });

  const memorySize = "4G";

  const propsTemplatePath = path.join(__dirname, "..", "templates", "properties.js");
  const propsTemplate = await fs.readFile(propsTemplatePath, "utf8");
  const propsRendered = propsTemplate
    .replaceAll("{{VERSION}}", dirId)
    .replaceAll("{{MEMORY}}", memorySize)
    .replaceAll("{{JAVA_VERSION}}", String(javaMajor || 8))
    .replaceAll("{{JAVA_PATH}}", javaBin || "java")
    .replaceAll("{{ASSET_INDEX}}", metadata.assetIndex?.id || dirId);
  await fs.writeFile(path.join(dirs.base, "properties.js"), propsRendered, { mode: 0o644 });

  const buildTemplatePath = path.join(__dirname, "..", "templates", "build.js");
  const buildTemplate = await fs.readFile(buildTemplatePath, "utf8");
  const buildRendered = buildTemplate
    .replaceAll("{{VERSION}}", dirId)
    .replaceAll("{{NAME}}", "MCP-Remastered")
    .replaceAll("{{GROUP}}", "com.mcp.remastered")
    .replaceAll("{{JAVA_VERSION}}", String(javaMajor || 8))
    .replaceAll("{{MAIN_CLASS}}", mainClass)
    .replaceAll("{{MEMORY}}", memorySize)
    .replaceAll("{{ASSET_INDEX}}", metadata.assetIndex?.id || dirId);
  await fs.writeFile(path.join(dirs.base, "build.js"), buildRendered, { mode: 0o644 });

  report("scaffold", 100, `Regenerated app.js, build.js, properties.js`);

  return { dirs, metadata, appPath, skipped, repaired };
}

export async function runPipeline(versionEntry, report, { javaBin = "java", side = "client" } = {}) {
  const dirId = side === "server" ? `${versionEntry.id}-server` : versionEntry.id;
  const dirs = versionSubdirs(dirId);
  await fs.ensureDir(dirs.raw);
  await fs.ensureDir(dirs.src);
  await fs.ensureDir(dirs.build);
  await fs.ensureDir(dirs.libraries);
  await fs.ensureDir(dirs.logs);
  await fs.ensureDir(TOOLS_DIR);
  await syncSharedLib();

  report("meta", 0, "Fetching version metadata...");
  const versionMeta = await fetchVersionMeta(versionEntry);

  if (!hasOfficialMappings(versionMeta, side)) {
    throw new Error(
      `Mojang did not publish official ${side} mappings for ${versionEntry.id} ` +
        `(only versions from ~1.14.4 onward have them).`
    );
  }

  const javaMajor = versionMeta.javaVersion?.majorVersion;
  await assertJavaAvailable(javaMajor);

  const { isServer, prefix, jarUrl, mappingsUrl, mainClass } = sideConfig(versionMeta, side);

  let clientJarPath = path.join(dirs.raw, `${prefix}.jar`);
  const mappingsPath = path.join(dirs.raw, `${prefix}_mappings.txt`);
  const deobfJarPath = path.join(dirs.raw, `${prefix}-deobf.jar`);
  const decompiledJarPath = path.join(dirs.raw, `${prefix}-decompiled.jar`);

  await downloadJar(jarUrl, clientJarPath, (pct) => {
    if (pct != null) report(`download-${prefix}`, pct, `Downloading ${prefix}.jar ${renderBar(pct)}`);
  });
  report(`download-${prefix}`, 100, `${prefix}.jar downloaded.`);

  if (isServer) {
    clientJarPath = await extractBundledJar(clientJarPath, report);
  }

  await downloadIfMissing(mappingsUrl, mappingsPath, (pct) => {
    if (pct != null) report("download-mappings", pct, `Downloading mappings ${renderBar(pct)}`);
  });
  report("download-mappings", 100, "Official mappings downloaded.");

  const artJarPath = path.join(TOOLS_DIR, `ForgeAutoRenamingTool-${ART_VERSION}.jar`);
  const vineflowerJarPath = path.join(TOOLS_DIR, `vineflower-${VINEFLOWER_VERSION}.jar`);

  await downloadIfMissing(ART_URL, artJarPath, (pct) => {
    if (pct != null) report("tools", pct, `Fetching ForgeAutoRenamingTool ${renderBar(pct)}`);
  });
  await downloadIfMissing(VINEFLOWER_URL, vineflowerJarPath, (pct) => {
    if (pct != null) report("tools", pct, `Fetching Vineflower ${renderBar(pct)}`);
  });
  report("tools", 100, "Tooling ready.");

  // Download runtime libraries from Mojang metadata
  report("libraries", 0, "Downloading dependency libraries...");
  let libAttempts = 0;
  const maxLibAttempts = 2;
  while (libAttempts < maxLibAttempts) {
    try {
      const libCount = versionMeta.libraries?.length || 0;
      if (libCount > 0) {
        await downloadLibraries(versionMeta, dirs.libraries, (pct, line) => {
          report("libraries", pct, line);
        });
      }
      break;
    } catch (err) {
      libAttempts++;
      if (libAttempts >= maxLibAttempts) {
        report("libraries", 100, `Warning: some libraries could not be downloaded (${err.message})`);
      } else {
        report("libraries", 50, `Library download issue, retrying... (${err.message})`);
      }
    }
  }
  // Verify library jars are valid before proceeding
  const libDir = dirs.libraries;
  if (await fs.pathExists(libDir)) {
    let corruptCount = 0;
    for (const entry of await fs.readdir(libDir)) {
      if (!entry.endsWith(".jar")) continue;
      const jarPath = path.join(libDir, entry);
      if (!(await isValidZip(jarPath))) {
        await fs.remove(jarPath);
        corruptCount++;
      }
    }
    if (corruptCount > 0) {
      report("libraries", 100, `Removed ${corruptCount} corrupt library jar(s), re-downloading...`);
      try {
        await downloadLibraries(versionMeta, dirs.libraries, (pct, line) => {
          report("libraries", pct, line);
        });
      } catch {}
    }
  }
  await downloadJavaxFallbacks(dirs.libraries, javaMajor || 8, report);
  report("libraries", 100, "Libraries ready.");

  try {
    await runRemapWithRetry(
      dirs, artJarPath, clientJarPath, deobfJarPath, mappingsPath, versionMeta, report,
      path.join(dirs.logs, "remap.log")
    );
  } catch (err) {
    throw new Error(
      `Deobfuscation step failed.\nFull log: ${path.join(dirs.logs, "remap.log")}\n` +
        `Original error: ${err.message}`
    );
  }
  report("remap", 100, "Deobfuscation complete.");

  try {
    await runDecompileWithRetry(
      vineflowerJarPath, deobfJarPath, decompiledJarPath, report,
      path.join(dirs.logs, "decompile.log"), 3, isServer
    );
  } catch (err) {
    throw new Error(
      `Decompilation step failed.\nFull log: ${path.join(dirs.logs, "decompile.log")}\n` +
        `Original error: ${err.message}`
    );
  }
  report("decompile", 100, "Decompilation complete.");

  report("switchmaps", 0, "Skipping full switch map scan (resolved on-demand after extraction)...");
  const switchMaps = {};

  report("extract", 0, "Extracting source files and assets...");
  const { fixupCount, extractedCount } = await extractSourcesFromJar(
    decompiledJarPath, dirs, switchMaps, report
  );
  report(
    "extract",
    100,
    `Extracted ${extractedCount} sources to ${dirs.src}` +
      `${fixupCount ? ` (${fixupCount} decompiler artifact(s) auto-fixed)` : ""}`
  );

  const switchFixResult = await fixVersionWorkspace(dirs.base, {
    onProgress(msg) {
      report("switchmaps", 50, msg);
    }
  });
  if (switchFixResult.switchMapCount > 0) {
    report("switchmaps", 100, `Fixed ${switchFixResult.totalChanges} unrepresentable switch(es) in ${switchFixResult.filesFixed} file(s)`);
  } else {
    report("switchmaps", 100, "No unrepresentable switches to fix.");
  }

  const metadata = {
    id: versionEntry.id,
    type: versionEntry.type,
    releaseTime: versionEntry.releaseTime,
    side: isServer ? "server" : "client",
    javaMajor: javaMajor ?? null,
    mainClass,
    assetIndex: isServer ? null : (versionMeta.assetIndex ?? null),
    createdAt: new Date().toISOString(),
    tools: { art: ART_VERSION, vineflower: VINEFLOWER_VERSION },
  };
  await fs.writeJson(path.join(dirs.base, "metadata.json"), metadata, { spaces: 2 });

  // Generate app.js from template
  const templateName = isServer ? "server.js" : "client.js";
  const templatePath = path.join(__dirname, "..", "templates", templateName);
  const template = await fs.readFile(templatePath, "utf8");
  const rendered = template
    .replaceAll("{{VERSION}}", dirId)
    .replaceAll("{{CREATED}}", metadata.createdAt);
  const appPath = path.join(dirs.base, "app.js");
  await fs.writeFile(appPath, rendered, { mode: 0o755 });

  // Generate properties.js from template
  const propsTemplatePath = path.join(__dirname, "..", "templates", "properties.js");
  const propsTemplate = await fs.readFile(propsTemplatePath, "utf8");
  const memorySize = "4G";
  const propsRendered = propsTemplate
    .replaceAll("{{VERSION}}", dirId)
    .replaceAll("{{MEMORY}}", memorySize)
    .replaceAll("{{JAVA_VERSION}}", String(javaMajor || 8))
    .replaceAll("{{JAVA_PATH}}", javaBin || "java")
    .replaceAll("{{ASSET_INDEX}}", metadata.assetIndex?.id || dirId);
  const propsPath = path.join(dirs.base, "properties.js");
  await fs.writeFile(propsPath, propsRendered, { mode: 0o644 });

  // Generate build.js from template
  const buildTemplatePath = path.join(__dirname, "..", "templates", "build.js");
  const buildTemplate = await fs.readFile(buildTemplatePath, "utf8");
  const buildRendered = buildTemplate
    .replaceAll("{{VERSION}}", dirId)
    .replaceAll("{{NAME}}", "MCP-Remastered")
    .replaceAll("{{GROUP}}", "com.mcp.remastered")
    .replaceAll("{{JAVA_VERSION}}", String(javaMajor || 8))
    .replaceAll("{{MAIN_CLASS}}", mainClass)
    .replaceAll("{{MEMORY}}", memorySize)
    .replaceAll("{{ASSET_INDEX}}", metadata.assetIndex?.id || versionEntry.id);
  const buildPath = path.join(dirs.base, "build.js");
  await fs.writeFile(buildPath, buildRendered, { mode: 0o644 });

  report("scaffold", 100, `Generated app.js, build.js, properties.js`);

  return { dirs, metadata, appPath };
}
