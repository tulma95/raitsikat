# Raitsikat

Realtime map of Helsinki trams, powered by HSL's MQTT High-Frequency Positioning (HFP) feed.

## Requirements

- Node 24+ (for native TypeScript execution — no build step)

## Install

```
npm install
```

## Run

```
npm run dev     # auto-reload on file changes
npm start       # one-shot
```

Open http://localhost:3000.

## Type check

```
npm run typecheck
```

## How it works

- Backend (`server/`) subscribes to `mqtts://mqtt.hsl.fi:8883` topic `/hfp/v2/journey/ongoing/vp/tram/#`, keeps an in-memory map of tram positions, evicts stale entries after 60 seconds, and relays snapshots + updates over Server-Sent Events at `/events`.
- Frontend (`public/`) is plain HTML + vanilla JS + Leaflet via CDN. Draws tram markers on an OpenStreetMap base map; sidebar checkboxes filter by line.

