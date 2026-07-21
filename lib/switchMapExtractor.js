import { execa } from "execa";
import fs from "fs-extra";
import path from "path";

const UNREPRESENTABLE_RE = /<unrepresentable>\.\$SwitchMap\$([^\[]+)\[/g;

/** Collect enum paths (with $ separators) still referenced as <unrepresentable> in src/. */
export async function collectNeededEnumPaths(srcDir) {
  const needed = new Set();
  if (!(await fs.pathExists(srcDir))) return needed;

  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "resources") continue;
        await walk(full);
      } else if (entry.name.endsWith(".java")) {
        const content = await fs.readFile(full, "utf8");
        if (!content.includes("<unrepresentable>")) continue;
        for (const m of content.matchAll(UNREPRESENTABLE_RE)) {
          needed.add(m[1]);
        }
      }
    }
  }

  await walk(srcDir);
  return needed;
}

/** Outer class paths (slash-separated) that still contain <unrepresentable> switches. */
export async function collectOuterClassesWithUnrepresentable(srcDir) {
  const outers = new Set();
  if (!(await fs.pathExists(srcDir))) return outers;

  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "resources") continue;
        await walk(full);
      } else if (entry.name.endsWith(".java")) {
        const content = await fs.readFile(full, "utf8");
        if (!content.includes("<unrepresentable>")) continue;
        const rel = path.relative(srcDir, full).replace(/\.java$/, "");
        outers.add(rel);
      }
    }
  }

  await walk(srcDir);
  return outers;
}

function enumKeyToPath(enumKey) {
  return enumKey.replace(/\$/g, "/");
}

function pathToEnumKey(enumPath) {
  return enumPath.replace(/\//g, "$");
}

function hasMappingFor(maps, enumKey) {
  const slash = enumKeyToPath(enumKey);
  const m = maps[slash] || maps[enumKey];
  return m && Object.keys(m).length > 0;
}

/**
 * Load or build switch maps for the **current version workspace**.
 * Only reads from that version's deobf jar + switch-maps.json cache.
 */
export async function resolveSwitchMaps(versionDir, srcDir, { onProgress } = {}) {
  const mapsPath = path.join(versionDir, "switch-maps.json");
  const deobfJar = path.join(versionDir, "raw", "client-deobf.jar");

  let maps = {};
  if (await fs.pathExists(mapsPath)) {
    try {
      maps = await fs.readJson(mapsPath);
    } catch {
      maps = {};
    }
  }

  const needed = await collectNeededEnumPaths(srcDir);
  if (needed.size === 0) return maps;

  const missing = [...needed].filter((key) => !hasMappingFor(maps, key));
  if (missing.length === 0) return maps;

  if (!(await fs.pathExists(deobfJar))) {
    throw new Error(
      `This version is missing raw/client-deobf.jar — cannot resolve enum switch maps.\n` +
        `Re-run create.js and choose Repair for this version.`
    );
  }

  onProgress?.(`Indexing ${missing.length} enum switch map(s) from this version's deobf jar...`);
  const extracted = await extractSwitchMapsTargeted(deobfJar, srcDir);
  maps = { ...maps, ...extracted };
  await fs.writeJson(mapsPath, maps, { spaces: 2 });
  return maps;
}

/**
 * Extract switch maps only for inner classes belonging to source files
 * that still contain <unrepresentable> (fast + version-accurate).
 */
export async function extractSwitchMapsTargeted(deobfJarPath, srcDir) {
  const outerClasses = await collectOuterClassesWithUnrepresentable(srcDir);
  if (outerClasses.size === 0) return {};

  let listing;
  try {
    const { stdout } = await execa("jar", ["tf", deobfJarPath]);
    listing = stdout.split("\n");
  } catch {
    return {};
  }

  const innerClasses = listing.filter((e) => {
    if (!e.endsWith(".class") || !/\$\d+\.class$/.test(e)) return false;
    const outer = e.replace(/\$\d+\.class$/, "");
    return outerClasses.has(outer);
  });

  const maps = {};
  const CONCURRENCY = 16;
  let cursor = 0;

  async function worker() {
    while (cursor < innerClasses.length) {
      const i = cursor++;
      try {
        await processInnerClass(deobfJarPath, innerClasses[i], maps);
      } catch {
        // skip
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, innerClasses.length || 1) }, worker));
  return maps;
}

/**
 * Full scan — used once during pipeline install to pre-cache all switch maps.
 */
export async function extractSwitchMaps(deobfJarPath, onProgress) {
  if (!(await fs.pathExists(deobfJarPath))) return {};

  let listing;
  try {
    const { stdout } = await execa("jar", ["tf", deobfJarPath]);
    listing = stdout.split("\n");
  } catch {
    return {};
  }

  const innerClasses = listing.filter(
    (e) => e.endsWith(".class") && /\$\d+\.class$/.test(e)
  );

  const maps = {};
  const CONCURRENCY = 16;
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < innerClasses.length) {
      const i = cursor++;
      try {
        await processInnerClass(deobfJarPath, innerClasses[i], maps);
      } catch {
        // skip
      } finally {
        done++;
        if (onProgress && done % 50 === 0) {
          onProgress(done, innerClasses.length);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, innerClasses.length || 1) }, worker));
  return maps;
}

async function javapInnerClass(deobfJarPath, className) {
  return execa("javap", ["-c", "-p", "-cp", deobfJarPath, className]);
}

function mergeParsedMaps(target, parsed) {
  for (const [enumPath, mapping] of Object.entries(parsed)) {
    if (Object.keys(mapping).length > 0) {
      target[enumPath] = mapping;
    }
  }
}

function parseAllSwitchMaps(javapOutput) {
  const result = {};
  const lines = javapOutput.split("\n");
  let currentEnumPath = null;
  let pendingEnum = null;

  for (const line of lines) {
    const fieldInit = line.match(/putstatic\s+#\d+\s+\/\/ Field \$SwitchMap\$([^:]+):\[I/);
    if (fieldInit) {
      currentEnumPath = fieldInit[1].replace(/\$/g, "/");
      if (!result[currentEnumPath]) result[currentEnumPath] = {};
      pendingEnum = null;
      continue;
    }

    const enumMatch = line.match(/getstatic\s+#\d+\s+\/\/ Field (.+)\.(\w+):/);
    if (enumMatch && !enumMatch[1].includes("$SwitchMap")) {
      pendingEnum = enumMatch[2];
      continue;
    }

    if (pendingEnum && currentEnumPath) {
      const intMatch = line.match(/(?:iconst_(\d+)|bipush\s+(\d+))/);
      if (intMatch) {
        result[currentEnumPath][parseInt(intMatch[1] || intMatch[2], 10)] = pendingEnum;
        pendingEnum = null;
      }
    }
  }

  return result;
}

async function processInnerClass(deobfJarPath, entry, maps) {
  const className = entry.replace(".class", "").replace(/\//g, ".");
  const { stdout } = await javapInnerClass(deobfJarPath, className);
  if (!stdout.includes("$SwitchMap$")) return;
  mergeParsedMaps(maps, parseAllSwitchMaps(stdout));
}

/**
 * Fix Vineflower `<unrepresentable>` synthetic switch maps block-by-block.
 */
export function fixUnrepresentableSwitches(source, switchMaps) {
  if (!source.includes("<unrepresentable>")) return { text: source, changes: 0 };

  let text = source;
  let changes = 0;
  let searchFrom = text.length;

  while (true) {
    const idx = text.lastIndexOf("<unrepresentable>", searchFrom);
    if (idx === -1) break;

    const switchStart = text.lastIndexOf("switch", idx);
    let headerEnd = text.indexOf("{", idx);
    if (headerEnd === -1) headerEnd = text.indexOf(")", idx) + 1;
    const header = text.slice(switchStart, headerEnd);

    const mapMatch = header.match(/\$SwitchMap\$([^\[]+)\[/);
    const varMatch = header.match(/\[([^\]]+)\.ordinal\(\)\]/);
    if (!mapMatch || !varMatch) {
      searchFrom = switchStart - 1;
      continue;
    }

    const enumPath = mapMatch[1].replace(/\$/g, "/");
    const switchVar = varMatch[1].trim();
    const mapping = switchMaps[enumPath];
    if (!mapping) {
      searchFrom = switchStart - 1;
      continue;
    }

    const blockStart = headerEnd;
    let depth = 0;
    let blockEnd = blockStart;
    let started = false;

    for (let i = blockStart; i < text.length; i++) {
      if (text[i] === "{") {
        depth++;
        started = true;
      } else if (text[i] === "}") {
        depth--;
        if (started && depth === 0) {
          blockEnd = i + 1;
          break;
        }
      }
    }

    let block = text.slice(blockStart, blockEnd);
    for (const [caseNum, enumConst] of Object.entries(mapping)) {
      block = block.replace(
        new RegExp(`\\bcase\\s+${caseNum}\\b(\\s*(?::|->))`, "g"),
        `case ${enumConst}$1`
      );
    }

    const newSwitch = `switch (${switchVar})${block}`;
    text = text.slice(0, switchStart) + newSwitch + text.slice(blockEnd);
    changes++;
    searchFrom = switchStart - 1;
  }

  return { text, changes };
}
