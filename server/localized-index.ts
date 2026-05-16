// Localized variants of index.html. `/` and `/fi` render Finnish; `/en`
// renders English. Single template (`public/index.html`) with `{{key}}`
// placeholders; the locale dict in `i18n.ts` is the source of truth for
// the values substituted in.
//
// Reads the template once at boot — the dev server already restarts on
// file changes via the user's external tooling.
//
// Design note: `/` is unconditionally Finnish — no `Accept-Language`
// content negotiation. This is intentional: Helsinki tram users
// overwhelmingly speak Finnish, and serving locale-varying content from
// `/` interacts badly with CDN caching and Google's canonical signal.
// English users discover `/en` via search results (hreflang) or the
// in-app language switch.

import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { settings } from "./settings.ts";
import {
  type Locale,
  type Strings,
  pickClientStrings,
  translations,
} from "./i18n.ts";

interface RenderInput {
  locale: Locale;
  canonicalPath: string; // path on siteOrigin, e.g. "/" or "/en"
}

interface Substitutions extends Strings {
  htmlLang: Locale;
  canonicalUrl: string;
  hreflangFiUrl: string;
  hreflangEnUrl: string;
  // Bare site origin (no trailing slash) for assets like og:image and the
  // JSON-LD `screenshot` URL. Kept separate from `hreflangFiUrl` so the
  // hreflang URL can change without silently breaking image meta tags.
  assetOriginUrl: string;
  i18nScript: string;
  jsonLd: string;
  // Bilingual SEO line is locale-independent content; the per-page
  // version flips which language appears first so the page's own
  // locale is announced first by screen readers.
  seoHiddenPrimaryLang: Locale;
  seoHiddenPrimaryText: string;
  seoHiddenSecondaryLang: Locale;
  seoHiddenSecondaryText: string;
}

// Locale-independent SEO crumbs. Kept here (not in `i18n.ts`) because
// the values don't translate — both languages appear on every page.
const SEO_HIDDEN_FI = "HSL:n raitiovaunut ja bussit live-kartalla Helsingissä.";
const SEO_HIDDEN_EN = "Helsinki trams and buses live map, HSL realtime data.";

// Shared OG / Twitter card image path (relative to `assetOriginUrl`).
// Same image for both locales; consumed by the meta tags in
// `index.html` and by the JSON-LD `screenshot` field.
const OG_IMAGE_PATH = "/icons/og-image.png";

// Escape just enough for safe insertion into a `<script>` block. The
// strings come from our own dict, but we still close-tag-protect and
// escape U+2028 / U+2029 (legal in JSON, illegal in JS string literals
// before ES2019; harmless to escape regardless).
const SCRIPT_UNSAFE = /[<>\u2028\u2029]/g;
const SCRIPT_UNSAFE_MAP: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, (c) => SCRIPT_UNSAFE_MAP[c]);
}

function buildJsonLd(locale: Locale, strings: Strings, origin: string): string {
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

function buildSubstitutions(
  { locale, canonicalPath }: RenderInput,
  origin: string,
): Substitutions {
  const strings = translations[locale];
  const i18nPayload = pickClientStrings(strings);
  return {
    ...strings,
    htmlLang: locale,
    canonicalUrl: `${origin}${canonicalPath}`,
    hreflangFiUrl: `${origin}/`,
    hreflangEnUrl: `${origin}/en`,
    assetOriginUrl: origin,
    i18nScript: `window.__i18n=${safeJsonForScript({ locale, strings: i18nPayload })};`,
    jsonLd: buildJsonLd(locale, strings, origin),
    seoHiddenPrimaryLang: locale,
    seoHiddenPrimaryText: locale === "fi" ? SEO_HIDDEN_FI : SEO_HIDDEN_EN,
    seoHiddenSecondaryLang: locale === "fi" ? "en" : "fi",
    seoHiddenSecondaryText: locale === "fi" ? SEO_HIDDEN_EN : SEO_HIDDEN_FI,
  };
}

function renderTemplate(template: string, subs: Substitutions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = (subs as unknown as Record<string, unknown>)[key];
    if (typeof value !== "string") {
      throw new Error(`localized-index: missing substitution for {{${key}}}`);
    }
    return value;
  });
}

export interface LocalizedIndexOptions {
  publicDir: string;
}

export function createLocalizedIndex({ publicDir }: LocalizedIndexOptions) {
  const template = readFileSync(join(publicDir, "index.html"), "utf8");
  const origin = settings.siteOrigin;

  // Pre-render each variant once. The output is static per locale.
  const rendered: Record<string, string> = {
    "/": renderTemplate(
      template,
      buildSubstitutions({ locale: "fi", canonicalPath: "/" }, origin),
    ),
    "/en": renderTemplate(
      template,
      buildSubstitutions({ locale: "en", canonicalPath: "/en" }, origin),
    ),
  };

  const router = express.Router();
  const send = (path: "/" | "/en") => (_req: express.Request, res: express.Response) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Language", path === "/en" ? "en" : "fi");
    res.send(rendered[path]);
  };
  router.get("/", send("/"));
  router.get("/en", send("/en"));
  // `/fi` is the explicit Finnish URL; canonical content lives at `/`.
  // 301 consolidates link equity and removes any chance of crawler
  // duplicate-content confusion.
  router.get("/fi", (_req, res) => res.redirect(301, "/"));

  return { router };
}
