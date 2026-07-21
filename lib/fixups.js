/**
 * Decompiler artifact fixups for Vineflower output.
 * Applied during pipeline extraction and via --fix / bin/fix.js.
 */

import fs from "fs-extra";
import path from "path";
import { fixUnrepresentableSwitches } from "./switchMapExtractor.js";

const SIMPLE_RULES = [
  {
    name: "diamond-in-cast",
    pattern: /\(([\w.$]+)<>\)/g,
    replace: "($1)",
  },
  {
    name: "wildcard-cast-fix",
    pattern: /\((\w+)<\?(?: extends \w+)?>\)/g,
    replace: "($1)",
  },
  {
    name: "raw-type-diamond-new",
    pattern: /new (\w+)\.(\w+)<>\(/g,
    replace: "new $1.$2(",
  },
  {
    name: "vf-unrepresentable-comment",
    pattern: /\/\/ \$VF: Unable to simplify switch on enum[\s\S]*?\n/g,
    replace: "",
  },
];

function fixLvtWrongMethodArgs(source) {
  let text = source;
  let changes = 0;
  const methods =
    "push|popPush|incrementCounter|createString|createInt|mergeToPrimitive|getStringValue|getNumberValue|entries|empty|compressMaps|flatMap|map|apply|applyAsInt|apply2|resultOrPartial|orElseGet|parse|getValue|setValue|tell|get|addFreshEntity|levelEvent";

  text = text.replace(
    new RegExp(`\\.(${methods})\\(\\s*lvt_(\\d+)_(\\d+)_\\s*\\)`, "g"),
    (match, method, a, b) => {
      const x1 = `lvt_${a}_${b}x_`;
      const x2 = `lvt_${a}_${b}_x`;
      if (source.includes(x1)) {
        changes++; return `.${method}(${x1})`;
      }
      if (source.includes(x2)) {
        changes++; return `.${method}(${x2})`;
      }
      return match;
    }
  );

  text = text.replace(
    /\(T\)\s*lvt_(\d+)_(\d+)_\.createString/g,
    (match, a, b) => {
      const x1 = `lvt_${a}_${b}x_`;
      const x2 = `lvt_${a}_${b}_x`;
      if (source.includes(x1)) {
        changes++; return `(T)${x1}.createString`;
      }
      if (source.includes(x2)) {
        changes++; return `(T)${x2}.createString`;
      }
      return match;
    }
  );

  text = text.replace(
    /\blvt_(\d+)_(\d+)_\.(entries|compressMaps|getStringValue|getNumberValue|mergeToPrimitive|empty)\(/g,
    (match, a, b, method) => {
      const x1 = `lvt_${a}_${b}x_`;
      const x2 = `lvt_${a}_${b}_x`;
      if (source.includes(x1)) {
        changes++; return `${x1}.${method}(`;
      }
      if (source.includes(x2)) {
        changes++; return `${x2}.${method}(`;
      }
      return match;
    }
  );

  return { text, changes };
}

/** Rename catch variables that collide with lambda parameters in the same block. */
function fixCatchLambdaCollision(source) {
  let changes = 0;
  const text = source.replace(
    /(\([^)]*\blvt_(\d+)_(\d+)x_[^)]*\)\s*->\s*\{[\s\S]*?)catch\s*\(\s*(\w+(?:<[^>]+>)?\s+)lvt_(\2)_(\3)x_\s*\)/g,
    (match, prefix, a, b, typePrefix) => {
      changes++;
      return `${prefix}catch (${typePrefix}lvt_${a}_${b}x_ex_)`;
    }
  );
  return { text, changes };
}

/** Rename inner lambda params that shadow outer method/lambda params. */
function fixNestedLambdaShadow(source) {
  let changes = 0;
  let text = source;

  text = text.replace(
    /(\.execute\s*\(\s*\()lvt_(\d+)_(\d+)x_([^,]+,\s*)lvt_(\2)_(\3)x_/g,
    (match, prefix, a, b, firstRest) => {
      changes++;
      return `${prefix}lvt_${a}_${b}x_in_${firstRest}lvt_${a}_${b}x_`;
    }
  );

  return { text, changes };
}

/** Add unchecked cast for common ImmutableMap/ImmutableList inference failures. */
function fixImmutableInference(source) {
  let changes = 0;
  const lines = source.split("\n");

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (/ImmutableMap<[^>]+>/.test(line) && /=\s*ImmutableMap\.of\(/.test(line) && !line.includes("(ImmutableMap)")) {
      line = line.replace(/(=\s*)ImmutableMap\.of\(/, "$1(ImmutableMap) ImmutableMap.of(");
      changes++;
    }
    if (/ImmutableList<\? extends/.test(line) && /=\s*ImmutableList\.of\(/.test(line) && !line.includes("(ImmutableList)")) {
      line = line.replace(/(=\s*)ImmutableList\.of\(/, "$1(ImmutableList) ImmutableList.of(");
      changes++;
    }
    if (/ImmutableSet<[^>]+>/.test(line) && /=\s*ImmutableSet\.of\(/.test(line) && !line.includes("(ImmutableSet)")) {
      line = line.replace(/(=\s*)ImmutableSet\.of\(/, "$1(ImmutableSet) ImmutableSet.of(");
      changes++;
    }

    lines[i] = line;
  }

  return { text: lines.join("\n"), changes };
}

export function applyKnownFixups(source, options = {}) {
  let text = source;
  let changes = 0;

  for (const rule of SIMPLE_RULES) {
    const before = text;
    text = text.replace(rule.pattern, rule.replace);
    if (text !== before) changes++;
  }

  if (options.switchMaps) {
    const result = fixUnrepresentableSwitches(text, options.switchMaps);
    text = result.text;
    changes += result.changes;
  }

  for (const fn of [fixLvtWrongMethodArgs, fixCatchLambdaCollision, fixNestedLambdaShadow, fixImmutableInference]) {
    const result = fn(text);
    text = result.text;
    changes += result.changes;
  }

  return { text, changes };
}

export async function fixSourceTree(srcDir, options = {}) {
  let filesFixed = 0;
  let totalChanges = 0;
  let remainingUnrepresentable = 0;

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "resources") continue;
        await walk(full);
      } else if (entry.name.endsWith(".java")) {
        const original = await fs.readFile(full, "utf8");
        const { text, changes } = applyKnownFixups(original, options);
        if (text.includes("<unrepresentable>")) remainingUnrepresentable++;
        if (changes > 0 && text !== original) {
          await fs.writeFile(full, text);
          filesFixed++;
          totalChanges += changes;
        }
      }
    }
  }

  await walk(srcDir);
  return { filesFixed, totalChanges, remainingUnrepresentable };
}

/** Version-aware fix: resolves switch maps from this version's own deobf jar first. */
export async function fixVersionWorkspace(versionDir, { onProgress } = {}) {
  const srcDir = path.join(versionDir, "src");
  const { resolveSwitchMaps } = await import("./switchMapExtractor.js");
  const switchMaps = await resolveSwitchMaps(versionDir, srcDir, { onProgress });
  const result = await fixSourceTree(srcDir, { switchMaps });
  return { ...result, switchMapCount: Object.keys(switchMaps).length };
}
