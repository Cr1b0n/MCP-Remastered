// Talks to Mojang's public version manifest to list every Minecraft version
// and to pull the per-version metadata (client jar URL, official mappings URL, etc).

const MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

/**
 * Returns { latest: {release, snapshot}, versions: [{id, type, url, time, releaseTime}] }
 * versions is already in Mojang's newest-first order.
 */
export async function fetchVersionManifest() {
  const res = await fetch(MANIFEST_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch version manifest: ${res.status} ${res.statusText}`
    );
  }
  return res.json();
}

/**
 * Fetches the per-version JSON (the one pointed to by manifest entry .url).
 * Contains downloads.client / downloads.client_mappings / downloads.server /
 * downloads.server_mappings, plus javaVersion.majorVersion and the library list.
 */
export async function fetchVersionMeta(versionEntry) {
  const res = await fetch(versionEntry.url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch metadata for ${versionEntry.id}: ${res.status} ${res.statusText}`
    );
  }
  return res.json();
}

/**
 * Mojang only started shipping official (client_mappings) mappings from
 * 19w36a / 1.14.4 onward. Anything older has no official mappings, so we
 * can't deobfuscate it with this pipeline.
 */
export function hasOfficialMappings(versionMeta, side = "client") {
  const key = side === "server" ? "server_mappings" : "client_mappings";
  return Boolean(versionMeta?.downloads?.[key]?.url);
}
