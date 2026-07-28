import fs from "fs-extra";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadFileInner(url, destPath, onProgress, attempt) {
  await fs.ensureDir(path.dirname(destPath));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  }

  const totalHeader = res.headers.get("content-length");
  const total = totalHeader ? parseInt(totalHeader, 10) : null;
  let downloaded = 0;

  const nodeStream = Readable.fromWeb(res.body);
  nodeStream.on("data", (chunk) => {
    downloaded += chunk.length;
    const percent = total ? (downloaded / total) * 100 : null;
    onProgress(percent, downloaded, total);
  });

  const writeStream = fs.createWriteStream(destPath);
  await pipeline(nodeStream, writeStream);
  return { destPath, bytes: downloaded };
}

export async function downloadFile(url, destPath, onProgress = () => {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await downloadFileInner(url, destPath, onProgress, attempt);
      const stat = await fs.stat(destPath);
      if (stat.size < 22) {
        throw new Error("Downloaded file is empty or truncated");
      }
      return result;
    } catch (err) {
      lastErr = err;
      await fs.remove(destPath).catch(() => {});
      if (attempt < 3) {
        const delay = Math.min(1000 * attempt, 5000);
        await sleep(delay);
      }
    }
  }
  throw new Error(`Download failed after 3 retries: ${lastErr.message}`);
}

export async function downloadIfMissing(url, destPath, onProgress = () => {}) {
  if (await fs.pathExists(destPath)) {
    const stat = await fs.stat(destPath);
    if (stat.size > 0) {
      onProgress(100, stat.size, stat.size);
      return { destPath, bytes: stat.size, skipped: true };
    }
  }
  return downloadFile(url, destPath, onProgress);
}
