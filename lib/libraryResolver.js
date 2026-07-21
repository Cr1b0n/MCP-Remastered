import fs from "fs-extra";
import path from "path";
import os from "os";
import AdmZip from "adm-zip";
import { downloadIfMissing } from "./downloader.js";

function parseMavenCoord(name) {
  const parts = name.split(":");
  if (parts.length < 3) return null;
  return {
    group: parts[0].replace(/\./g, "/"),
    artifact: parts[1],
    version: parts[2],
  };
}

function evaluateRules(rules) {
  if (!rules || rules.length === 0) return true;

  let allowed = false;
  for (const rule of rules) {
    if (rule.os && rule.os.name) {
      const osName = os.platform();
      const targetOs = rule.os.name.toLowerCase();
      const isMatch =
        (targetOs === "windows" && osName === "win32") ||
        (targetOs === "linux" && osName === "linux") ||
        (targetOs === "osx" && osName === "darwin");

      if (!isMatch && !rule.os.version) continue;
      if (rule.os.version) {
        const versionMatch = new RegExp(rule.os.version).test(os.version());
        if (!versionMatch) continue;
      }
    }

    if (rule.features) {
      if (rule.features.is_demo_user && !process.env.MCP_DEMO) continue;
      if (rule.features.has_custom_resolution && !process.env.MCP_CUSTOM_RES) continue;
    }

    if (rule.action === "allow") allowed = true;
    else if (rule.action === "disallow") allowed = false;
  }

  return allowed;
}

function getNativeClassifier(entry) {
  if (!entry.natives) return null;
  const osName = os.platform();
  let classifier;
  if (osName === "win32") classifier = entry.natives.windows;
  else if (osName === "linux") classifier = entry.natives.linux;
  else if (osName === "darwin") classifier = entry.natives.osx;
  else return null;

  if (!classifier) return null;
  return classifier.replace("${arch}", os.arch().includes("64") ? "64" : "32");
}

function resolveDownloadUrl(entry, classifier) {
  const coords = parseMavenCoord(entry.name);
  if (!coords) return null;

  const baseUrl = entry.url || "https://libraries.minecraft.net/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";

  if (entry.downloads?.artifact?.url && !classifier) {
    return {
      url: entry.downloads.artifact.url,
      jarPath: entry.downloads.artifact.path,
    };
  }

  if (entry.downloads?.classifiers?.[classifier]?.url) {
    return {
      url: entry.downloads.classifiers[classifier].url,
      jarPath: entry.downloads.classifiers[classifier].path,
    };
  }

  const jarFile = classifier
    ? `${coords.artifact}-${coords.version}-${classifier}.jar`
    : `${coords.artifact}-${coords.version}.jar`;
  const jarPath = `${coords.group}/${coords.artifact}/${coords.version}/${jarFile}`;

  return { url: `${normalizedBase}${jarPath}`, jarPath };
}

function isValidZip(filePath) {
  try {
    if (!fs.statSync(filePath)) return false;
    new AdmZip(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadSingleLib(url, jarPath, name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await downloadIfMissing(url, jarPath);
      if (result.skipped) return result;
      if (!isValidZip(jarPath)) {
        await fs.remove(jarPath);
        throw new Error("Corrupt download (not a valid zip)");
      }
      return result;
    } catch (err) {
      await fs.remove(jarPath).catch(() => {});
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      } else {
        throw new Error(`Failed to download ${name}: ${err.message}`);
      }
    }
  }
}

export async function downloadLibraries(versionMeta, libDir, onProgress) {
  const libs = versionMeta.libraries || [];
  let downloaded = 0;
  let failed = 0;
  const total = libs.length;

  await fs.ensureDir(libDir);

  for (let i = 0; i < libs.length; i++) {
    const entry = libs[i];

    if (!evaluateRules(entry.rules)) continue;

    const libName = entry.name || `library-${i}`;

    const mainUrl = resolveDownloadUrl(entry, null);
    if (mainUrl) {
      const jarName = path.basename(mainUrl.jarPath);
      const jarPath = path.join(libDir, jarName);
      try {
        await downloadSingleLib(mainUrl.url, jarPath, libName);
        downloaded++;
      } catch (err) {
        failed++;
      }
    }

    const classifier = getNativeClassifier(entry);
    if (classifier) {
      const nativeUrl = resolveDownloadUrl(entry, classifier);
      if (nativeUrl) {
        const jarName = path.basename(nativeUrl.jarPath);
        const jarPath = path.join(libDir, "natives", jarName);
        try {
          await downloadSingleLib(nativeUrl.url, jarPath, `${libName} (${classifier})`);
          downloaded++;
        } catch (err) {
          failed++;
        }
      }
    }

    const pct = Math.round(((i + 1) / total) * 100);
    if (onProgress) onProgress(pct, `Resolving libraries ${pct}% (${downloaded} ok${failed ? `, ${failed} failed` : ""})`);
  }

  if (failed > 0 && downloaded === 0) {
    throw new Error(`All ${failed} library downloads failed`);
  }

  return { downloaded, failed };
}
