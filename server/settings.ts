// Single source of truth for app config — env-derived values and top-level
// timing constants. Module-local defaults (paths, refresh intervals, MQTT URL,
// Digitransit endpoint, SSE heartbeat) stay in their respective modules.

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid PORT=${JSON.stringify(raw)}: expected integer in 1..65535`);
  }
  return n;
}

export const settings = Object.freeze({
  // From environment
  port: parsePort(process.env.PORT) ?? 3000,
  digitransitApiKey: process.env.DIGITRANSIT_API_KEY,
  // Public origin for canonical URLs, OG tags, hreflang alternates, and
  // JSON-LD. Falls back to the production hostname; override in staging
  // or other deployments so canonicals don't lie.
  siteOrigin: process.env.SITE_ORIGIN ?? "https://raitsikat.rigster.cv",

  // App constants
  evictMs: 60_000,
  evictIntervalMs: 10_000,
  mqttLivenessMs: 60_000,
  sseCoalesceMs: 250,
});
