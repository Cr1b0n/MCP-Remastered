import fs from "fs-extra";
import path from "path";
import { TOOLS_DIR } from "./paths.js";
import { fetchVersionMeta, hasOfficialMappings } from "./manifest.js";

const INDEX_PATH = path.join(TOOLS_DIR, "mappings-index.json");
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // refresh once a day
const CONCURRENCY = 8;

// Mojang didn't start publishing official mappings until 19w36a
// (2019-09-04), and only ever backfilled them for one earlier release,
// 1.14.4 (2019-05-27). Nothing before that will ever have mappings, so
// there's no point spending requests checking it - this bound is just an
// efficiency cutoff, not a guess about which versions "work".
const CANDIDATE_CUTOFF = new Date("2019-05-01T00:00:00Z");

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

/**
 * Returns { versions: Set<string>, builtAt: string, stale: boolean }.
 *
 * "versions" is the real, live-verified list of version ids that currently
 * have an official Mojang mappings file - checked by actually fetching each
 * candidate version's own JSON and looking for `downloads.client_mappings`,
 * not by guessing from a hardcoded version range. That's what makes this
 * self-updating: a brand new Mojang release just shows up as another
 * candidate next time the cache goes stale, no code changes needed. It also
 * naturally excludes future versions if Mojang ever stops shipping
 * obfuscated jars entirely (no mappings published -> not in the list).
 *
 * Cached to disk under .tools/mappings-index.json for 24h so repeat runs of
 * create.js don't re-check hundreds of versions every time.
 */
export async function getDecompilableVersions(manifest, { forceRefresh = false, onProgress } = {}) {
  await fs.ensureDir(TOOLS_DIR);

  if (!forceRefresh && (await fs.pathExists(INDEX_PATH))) {
    try {
      const cached = await fs.readJson(INDEX_PATH);
      const age = Date.now() - new Date(cached.builtAt).getTime();
      if (age < MAX_AGE_MS && Array.isArray(cached.versions)) {
        return { versions: new Set(cached.versions), builtAt: cached.builtAt, stale: false };
      }
    } catch {
      // Corrupt cache - fall through and rebuild.
    }
  }

  const candidates = manifest.versions.filter(
    (v) => new Date(v.releaseTime) >= CANDIDATE_CUTOFF
  );

  let done = 0;
  const results = await mapWithConcurrency(candidates, CONCURRENCY, async (v) => {
    let ok = false;
    try {
      const meta = await fetchVersionMeta(v);
      ok = hasOfficialMappings(meta);
    } catch {
      ok = false;
    }
    done++;
    onProgress?.(done, candidates.length, v.id);
    return ok ? v.id : null;
  });

  const versions = results.filter(Boolean);
  const index = { versions, builtAt: new Date().toISOString() };
  await fs.writeJson(INDEX_PATH, index, { spaces: 2 });
  return { versions: new Set(versions), builtAt: index.builtAt, stale: false };
}
