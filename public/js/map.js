// Leaflet map singleton. The map is built once at module load; everything
// downstream (markers, layers, panes) shares this instance.

const HELSINKI_CENTER = [60.170, 24.940];
const ZOOM = 13;
const HELSINKI_BOUNDS = L.latLngBounds([60.10, 24.78], [60.30, 25.25]);

export const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
  maxBounds: HELSINKI_BOUNDS,
  maxBoundsViscosity: 1.0,
  minZoom: 11,
}).setView(HELSINKI_CENTER, ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  minZoom: 11,
  bounds: HELSINKI_BOUNDS,
  attribution:
    'Data: <a href="https://hsl.fi/en/hsl/open-data" target="_blank" rel="noopener">HSL HFP</a>' +
    ' · Tiles: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
}).addTo(map);

map.zoomControl.setPosition("bottomright");

// Stops live in their own pane between tiles (200) and the route polyline
// (overlayPane, 400) so they read as map furniture, not interactive markers.
map.createPane("stopsPane");
map.getPane("stopsPane").style.zIndex = 350;

export const stopsLayer = L.layerGroup();
