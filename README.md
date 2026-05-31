# Raitsikat

Realtime map of Helsinki trams and buses, powered by HSL's MQTT High-Frequency Positioning (HFP) feed.

Live: https://raitsikat.rigster.cv

Trams and buses are streamed from HSL over MQTT, kept in memory on the backend, and pushed to the browser via Server-Sent Events. The frontend draws each vehicle on a Leaflet map, lets you filter by line, click a vehicle to see its route polyline, and is installable as a PWA. Switch modes from the topbar. The HTML shell is server-rendered by Astro for SEO as four mode-specific pages — `/ratikat` (fi trams), `/bussit` (fi buses), `/en/trams`, `/en/buses` — and `/`, `/en`, `/fi` 301-redirect into them. The realtime layer is plain vanilla JS.

## Requirements

- Node 24+ — the server runs TypeScript natively (no transpile step). The Astro frontend shell is the one thing that's built ahead of time, via `npm run build`.

## Run

```
npm install
npm run build   # build the Astro shell — required before the server starts
npm start       # serve on :3000
npm run typecheck
```

Open http://localhost:3000.

For active development, run the Astro build watcher and the server watcher in
two panes (the server imports the build output, so `dist/` must stay fresh):

```
npm run dev:astro   # astro build --watch  (rebuilds the shell on src/ changes)
npm run dev         # node --watch         (restarts the server on server/ changes)
```

## Configuration

- `PORT` — HTTP port (default `3000`)
- `DIGITRANSIT_API_KEY` — Digitransit subscription key. Enables the basemap
  tile proxy, route polyline overlays, and stop/departure lookups. Without it
  the app still boots and streams live vehicle positions over MQTT, but the map
  tiles, route overlays, and stops are all disabled.
- `SITE_ORIGIN` — public origin used for canonical URLs, hreflang alternates,
  OG tags, and the sitemap (default `https://raitsikat.rigster.cv`). Override in
  staging so canonicals don't point at production.
- `LOG_LEVEL` (default `info`) / `LOG_FORMAT` (`json` | `pretty`; auto by TTY) —
  see `server/logger.ts`.

A `.env` file in the project root is loaded automatically.

## Production

`start_production.sh` builds the Docker image and runs it with the port mapped to host `3000`:

```
./start_production.sh
```

## How it works

- Backend (`server/`) runs two independent pipelines, one per mode. Each subscribes to `mqtts://mqtt.hsl.fi:8883` — tram (`/hfp/v2/journey/ongoing/vp/tram/#`) and bus (`/hfp/v2/journey/ongoing/vp/bus/#`) — keeps an in-memory map of vehicle positions, evicts stale entries after 60 seconds, and relays snapshots + updates over Server-Sent Events at `/{mode}/events` (`/tram/events`, `/bus/events`). Route geometries and stops/departures are fetched on demand from Digitransit and cached. Map tiles are proxied (and transcoded to WebP) through `/tiles/...` so the Digitransit subscription key never reaches the browser.
- Frontend (`src/scripts/`) is TypeScript, bundled by Astro (Vite) — Leaflet is imported as a module and bundled in. Draws vehicle markers over the Digitransit `hsl-map` basemap (data © OpenStreetMap); the mode switcher (two `<a>` links in the topbar) deep-links and full-navigates without JS, or does an instant in-place switch + `pushState` with JS; line chips toggle visibility, and selection persists in `localStorage`.
- The page shell (`src/`) is server-rendered by Astro in `@astrojs/node` middleware mode, mounted inside the Express app. Astro owns four mode-specific pages — `/ratikat`, `/bussit`, `/en/trams`, `/en/buses` — plus the redirects `/` → `/ratikat`, `/en` → `/en/trams`, `/fi` → `/ratikat`, and `/sitemap.xml`; everything else is the Express backend. `server/i18n.ts` is the shared i18n source of truth. See `docs/ARCHITECTURE.md`.
