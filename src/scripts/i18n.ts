// Runtime UI strings, injected by the server into `window.__i18n` ahead
// of any module script (see `server/localized-index.ts`).
//
// No fallback dict on purpose — if `window.__i18n` is missing it means
// `index.html` was served raw by something other than the localized
// router, and we want that to fail loud rather than silently render
// stale Finnish strings that drift from `server/i18n.ts`.

const injected = window.__i18n;
if (!injected || typeof injected !== "object" || !injected.strings) {
  throw new Error(
    "i18n: window.__i18n missing — the page must be served via the localized index router",
  );
}

const { locale, strings } = injected;

export const currentLocale = locale;

export function t(key: string): string {
  const value = strings[key];
  if (typeof value !== "string") {
    throw new Error(`i18n: missing translation for key "${key}"`);
  }
  return value;
}

// "X trams" / "X ratikkaa" — no count-based inflection. Matches how HSL
// itself phrases vehicle counts; Finnish uses partitive singular regardless.
export function vehicleCountLabel(mode: string): string {
  return mode === "bus" ? t("vehicleModeBus") : t("vehicleModeTram");
}
