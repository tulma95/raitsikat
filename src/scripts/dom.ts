// DOM lookups shared across multiple modules.

export const filterEl = document.getElementById("line-filter")!;
export const countEls = document.querySelectorAll<HTMLElement>("[data-vehicle-count]");
export const sheetEl = document.getElementById("sheet")!;
export const modeTabsEl = document.getElementById("mode-tabs")!;
