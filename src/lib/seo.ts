// SEO helpers ported verbatim from server/localized-index.ts. The locale
// dict in server/i18n.ts remains the single source of truth; this module
// only owns the escape treatment, JSON-LD shape, and sitemap rendering.

import type { Locale, Strings } from "../../server/i18n.ts";

// Locale-independent SEO crumbs. Both languages appear on every page.
export const SEO_HIDDEN_FI =
  "HSL:n raitiovaunut ja bussit live-kartalla Helsingissä.";
export const SEO_HIDDEN_EN =
  "Helsinki trams and buses live map, HSL realtime data.";

// Shared OG / Twitter card image path (relative to the site origin). Same
// image for both locales; consumed by the meta tags and the JSON-LD
// `screenshot` field.
export const OG_IMAGE_PATH = "/icons/og-image.png";

// Escape just enough for safe insertion into a `<script>` block. The
// strings come from our own dict, but we still close-tag-protect and
// escape U+2028 / U+2029 (legal in JSON, illegal in JS string literals
// before ES2019; harmless to escape regardless).
const SCRIPT_UNSAFE = /[<>\u2028\u2029]/g;
const SCRIPT_UNSAFE_MAP: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  " ": "\\u2028",
  " ": "\\u2029",
};

export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE,
    (c) => SCRIPT_UNSAFE_MAP[c],
  );
}

export function buildJsonLd(
  locale: Locale,
  strings: Strings,
  origin: string,
): string {
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Raitsikat",
    url: `${origin}${strings.jsonLdUrl}`,
    description: strings.jsonLdDescription,
    applicationCategory: "TravelApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    inLanguage: locale,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    screenshot: `${origin}${OG_IMAGE_PATH}`,
  };
  // JSON-LD lives inside <script type="application/ld+json">; same XSS
  // surface as the i18n script block, same escape treatment.
  return JSON.stringify(ld, null, 2).replace(
    SCRIPT_UNSAFE,
    (c) => SCRIPT_UNSAFE_MAP[c],
  );
}

// Canonical paths served as localized pages. Single source of truth for
// the generated sitemap so canonicals stay in sync with the routes.
export const LOCALIZED_PATHS: ReadonlyArray<{
  path: "/" | "/en";
  locale: Locale;
}> = [
  { path: "/", locale: "fi" },
  { path: "/en", locale: "en" },
];

export function renderSitemap(origin: string): string {
  // hreflang block is identical for every <url> entry (Google requires
  // each localized page to list all alternates including itself), so
  // build it once.
  const hreflangBlock = [
    `    <xhtml:link rel="alternate" hreflang="fi" href="${origin}/"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${origin}/en"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>`,
  ].join("\n");
  const urls = LOCALIZED_PATHS.map(({ path }) =>
    [
      `  <url>`,
      `    <loc>${origin}${path}</loc>`,
      hreflangBlock,
      `  </url>`,
    ].join("\n"),
  ).join("\n");
  // No <changefreq>/<priority>: Google ignores both. No <lastmod>: the
  // server has no honest signal for it (boot time would lie).
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"`,
    `        xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    urls,
    `</urlset>`,
    ``,
  ].join("\n");
}
