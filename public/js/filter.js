// Line selection + chip UI.
//
// Single source of truth for which lines are visible. `allLinesEnabledByDefault`
// is the "show everything" state — when true, `enabledLines` is ignored and
// every chip is shown as on. When false, only lines in `enabledLines` are
// visible.

import { filterEl, countEls } from "./dom.js";
import { clearRoute, showRoute } from "./route-overlay.js";
import { escapeAttr } from "./pure.js";
import { vehiclesById, refreshVisibility } from "./vehicles.js";

export const enabledLines = new Set();
export let allLinesEnabledByDefault = true;

const SELECTION_STORAGE_KEY = "raitsikat.lineSelection";

(function restoreSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.allOn !== "boolean" || !Array.isArray(parsed.lines)) return;
    allLinesEnabledByDefault = parsed.allOn;
    if (!parsed.allOn) for (const l of parsed.lines) if (typeof l === "string") enabledLines.add(l);
  } catch {}
})();

function saveSelection() {
  try {
    // Intersect with the chips actually rendered so retired HSL lines don't
    // accumulate forever in localStorage.
    const rendered = new Set(
      Array.from(filterEl.querySelectorAll(".chip")).map((c) =>
        c.getAttribute("data-line"),
      ),
    );
    const lines = [...enabledLines].filter((l) => rendered.has(l));
    localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({ allOn: allLinesEnabledByDefault, lines }),
    );
  } catch {}
}

export function isVisible(line) {
  return allLinesEnabledByDefault || enabledLines.has(line);
}

export function updateCount() {
  const total = vehiclesById.size;
  const shown = [...vehiclesById.values()].filter((v) => isVisible(v.line)).length;
  const text = allLinesEnabledByDefault ? `${total} trams` : `${shown} / ${total} trams`;
  for (const el of countEls) el.textContent = text;
}

// Click a tram → show only that line and draw its route. Click a tram of the
// same (already isolated) line → reset to show everything and clear the route.
export function isolateLine(vehicle) {
  const line = vehicle.line;
  const alreadyIsolated =
    !allLinesEnabledByDefault &&
    enabledLines.size === 1 &&
    enabledLines.has(line);

  if (alreadyIsolated) {
    allLinesEnabledByDefault = true;
    for (const chip of filterEl.querySelectorAll(".chip")) {
      const l = chip.getAttribute("data-line");
      chip.setAttribute("data-on", "true");
      chip.querySelector("input").checked = true;
      enabledLines.add(l);
    }
    clearRoute();
  } else {
    allLinesEnabledByDefault = false;
    enabledLines.clear();
    enabledLines.add(line);
    for (const chip of filterEl.querySelectorAll(".chip")) {
      const on = chip.getAttribute("data-line") === line;
      chip.setAttribute("data-on", String(on));
      chip.querySelector("input").checked = on;
    }
    showRoute(vehicle.routeId, vehicle.directionId);
  }
  refreshVisibility();
  updateCount();
  saveSelection();
}

export function ensureLineChip(line) {
  if (filterEl.querySelector(`.chip[data-line="${CSS.escape(line)}"]`)) return;

  const on = allLinesEnabledByDefault || enabledLines.has(line);
  const chip = document.createElement("label");
  chip.className = "chip";
  chip.setAttribute("data-line", line);
  chip.setAttribute("data-on", String(on));
  chip.innerHTML = `
    <span class="chip__swatch" aria-hidden="true"></span>
    <input type="checkbox" value="${escapeAttr(line)}" ${on ? "checked" : ""} />
    <span>${escapeAttr(line)}</span>
  `;
  const cb = chip.querySelector("input");
  cb.addEventListener("change", () => {
    const chips = filterEl.querySelectorAll(".chip");
    // Clicking any chip while every line is shown isolates that one line,
    // matching the tram-marker click behavior in isolateLine().
    const everyChipOn =
      allLinesEnabledByDefault ||
      Array.from(chips).every((c) => c.getAttribute("data-on") === "true");

    const onlyThisOn =
      !allLinesEnabledByDefault &&
      enabledLines.size === 1 &&
      enabledLines.has(line);

    // Default: any chip change clears the route. The isolation branch below
    // re-draws it so the chip path matches the tram-marker click behavior.
    clearRoute();
    if (everyChipOn) {
      allLinesEnabledByDefault = false;
      enabledLines.clear();
      enabledLines.add(line);
      for (const c of chips) {
        const isThis = c.getAttribute("data-line") === line;
        c.setAttribute("data-on", String(isThis));
        c.querySelector("input").checked = isThis;
      }
      // Match tram-marker click: draw the isolated line's route if we have
      // a vehicle currently on it. If not, leave the route cleared.
      const sample = [...vehiclesById.values()].find((v) => v.line === line);
      if (sample) showRoute(sample.routeId, sample.directionId);
    } else if (!cb.checked && onlyThisOn) {
      // Deselecting the only isolated line returns to "all selected".
      allLinesEnabledByDefault = true;
      for (const c of chips) {
        c.setAttribute("data-on", "true");
        c.querySelector("input").checked = true;
        enabledLines.add(c.getAttribute("data-line"));
      }
    } else {
      allLinesEnabledByDefault = false;
      if (cb.checked) enabledLines.add(line);
      else enabledLines.delete(line);
      chip.setAttribute("data-on", String(cb.checked));
    }
    refreshVisibility();
    updateCount();
    saveSelection();
  });
  filterEl.appendChild(chip);

  // Numeric-aware sort so "1, 2, 10" not "1, 10, 2".
  const chips = Array.from(filterEl.querySelectorAll(".chip"));
  chips.sort((a, b) =>
    a.getAttribute("data-line").localeCompare(
      b.getAttribute("data-line"),
      undefined,
      { numeric: true },
    ),
  );
  chips.forEach((c) => filterEl.appendChild(c));
}
