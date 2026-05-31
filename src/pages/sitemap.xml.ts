// Sitemap generated from the same LOCALIZED_PATHS table the renderer uses,
// so canonicals stay in sync with the routes.
import { renderSitemap } from "../lib/seo.ts";
import { settings } from "../../server/settings.ts";

export const prerender = false;

export const GET = () =>
  new Response(renderSitemap(settings.siteOrigin), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
