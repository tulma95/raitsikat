# Raitsikat

Realtime map of Helsinki trams, powered by HSL's MQTT High-Frequency Positioning (HFP) feed.

Live: https://raitsikat.rigster.cv

Trams are streamed from HSL over MQTT, kept in memory on the backend, and pushed to the browser via Server-Sent Events. The frontend draws each tram on a Leaflet map, lets you filter by line, click a tram to see its route polyline, and is installable as a PWA.

## Requirements

- Node 24+ (for native TypeScript execution — no build step)

## Run

```
npm install
npm run dev     # auto-reload on file changes
npm start       # one-shot
npm run typecheck
```

Open http://localhost:3000.

## Configuration

- `PORT` — HTTP port (default `3000`)
- `DIGITRANSIT_API_KEY` — Digitransit subscription key; required for route polyline overlays. Without it the app still runs and shows live tram positions, but clicking a tram won't draw its route.

A `.env` file in the project root is loaded automatically.

## Production

`start_production.sh` builds the Docker image and runs it with the port mapped to host `3000`:

```
./start_production.sh
```

## How it works

- Backend (`server/`) subscribes to `mqtts://mqtt.hsl.fi:8883` topic `/hfp/v2/journey/ongoing/vp/tram/#`, keeps an in-memory map of tram positions, evicts stale entries after 60 seconds, and relays snapshots + updates over Server-Sent Events at `/events`. Route geometries are fetched on demand from Digitransit and cached.
- Frontend (`public/`) is plain HTML + vanilla JS + Leaflet. Draws tram markers on an OpenStreetMap base map; line chips toggle visibility, and selection persists in `localStorage`.
