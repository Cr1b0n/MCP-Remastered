import os from "os";
import path from "path";

// Root folder for everything MCP-Remastered creates: ~/MCP-Remastered
export const ROOT = path.join(os.homedir(), "MCP-Remastered");

// Shared cache for tool jars (ForgeAutoRenamingTool, Vineflower) so we don't
// re-download them for every single version.
export const TOOLS_DIR = path.join(ROOT, ".tools");

// Shared library scripts copied from the npm package (fixups, build helpers).
export const SHARED_LIB_DIR = path.join(ROOT, "lib");

export function versionDir(versionId) {
  return path.join(ROOT, versionId);
}

export function versionSubdirs(versionId) {
  const base = versionDir(versionId);
  return {
    base,
    raw: path.join(base, "raw"), // original downloaded jars/mappings
    src: path.join(base, "src"), // decompiled source
    resources: path.join(base, "src", "resources"), // extracted non-class assets
    build: path.join(base, "build"), // recompiled output
    libraries: path.join(base, "libraries"), // resolved library jars for classpath
    logs: path.join(base, "logs"),
  };
}
