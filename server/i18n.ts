// Localized UI strings. Single source of truth for both the SSR shell
// (`src/layouts/BaseLayout.astro` + `src/lib/seo.ts`) and the runtime
// strings exposed to the browser via `window.__i18n`.

export type Locale = "fi" | "en";

export const LOCALES: Locale[] = ["fi", "en"];

export interface Strings {
  // <head>
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogLocale: string;
  ogLocaleAlternate: string;
  ogImageAlt: string;
  twitterTitle: string;
  twitterDescription: string;
  // JSON-LD (locale-specific WebApplication.url + description)
  jsonLdUrl: string;
  jsonLdDescription: string;
  // <body> chrome
  tabTrams: string;
  tabBuses: string;
  sheetLines: string;
  vehicleModeAria: string;
  lineFilterAria: string;
  mapAria: string;
  // initial vehicle count placeholder ("0 trams" / "0 ratikkaa")
  initialCount: string;
  // Language switch (anchor → other locale). `langSwitchAria` is in the
  // CURRENT page's language; the anchor's visible text + `lang`/`hreflang`
  // describe the TARGET locale.
  langSwitchHref: string;
  langSwitchTargetLocale: Locale;
  langSwitchText: string;
  langSwitchAria: string;
  // SEO body
  noscriptH1: string;
  noscriptP1: string;
  noscriptP2: string;
  // runtime strings shipped to the client via window.__i18n
  vehicleModeTram: string;
  vehicleModeBus: string;
  loading: string;
  noDepartures: string;
  unknownStop: string;
  reconnecting: string;
  offline: string;
}

// Keys that need to be exposed to JS at runtime.
export const CLIENT_KEYS = [
  "vehicleModeTram",
  "vehicleModeBus",
  "loading",
  "noDepartures",
  "unknownStop",
  "reconnecting",
  "offline",
] as const satisfies readonly (keyof Strings)[];

export type ClientKey = (typeof CLIENT_KEYS)[number];
export type ClientStrings = { [K in ClientKey]: string };

const fi: Strings = {
  title: "Raitsikat — Helsingin ratikat ja bussit kartalla",
  description:
    "Helsingin ratikat ja bussit kartalla reaaliajassa. HSL:n MQTT-syöte.",
  ogTitle: "Raitsikat — Helsingin ratikat ja bussit kartalla, reaaliajassa",
  ogDescription:
    "Live-kartta Helsingin ratikoista ja busseista. HSL:n MQTT-syötteestä.",
  ogLocale: "fi_FI",
  ogLocaleAlternate: "en_US",
  ogImageAlt: "Raitsikat — live-kartta Helsingin ratikoista ja busseista",
  twitterTitle: "Raitsikat — Helsingin ratikat ja bussit kartalla",
  twitterDescription: "Live-kartta Helsingin ratikoista ja busseista.",
  jsonLdUrl: "/",
  jsonLdDescription:
    "Live-kartta Helsingin ratikoista ja busseista. HSL:n MQTT-syötteestä.",
  tabTrams: "Ratikat",
  tabBuses: "Bussit",
  sheetLines: "Linjat",
  vehicleModeAria: "Kulkuneuvotyyppi",
  lineFilterAria: "Näytä tai piilota linjoja",
  mapAria: "Helsingin joukkoliikenteen live-kartta",
  initialCount: "0 ratikkaa",
  langSwitchHref: "/en",
  langSwitchTargetLocale: "en",
  langSwitchText: "EN",
  langSwitchAria: "Vaihda kieli englanniksi",
  noscriptH1:
    "Raitsikat — Helsingin ratikat ja bussit kartalla, reaaliajassa",
  noscriptP1:
    "Raitsikat näyttää HSL:n raitiovaunut ja bussit Helsingin kartalla reaaliajassa. Datalähteenä on HSL:n julkinen MQTT-syöte (High-Frequency Positioning). Voit suodattaa linjoittain ja klikata vaunua nähdäksesi sen reitin.",
  noscriptP2:
    "Sovellus toimii selaimessa eikä vaadi rekisteröitymistä. Asennettavissa myös PWA:na.",
  vehicleModeTram: "ratikkaa",
  vehicleModeBus: "bussia",
  loading: "Ladataan…",
  noDepartures: "Ei lähtöjä",
  unknownStop: "Tuntematon pysäkki",
  reconnecting: "Yhdistetään uudelleen…",
  offline: "Yhteyttä ei ole",
};

const en: Strings = {
  title: "Raitsikat — HSL Trams & Buses, Live",
  description:
    "Live map of Helsinki trams and buses, streamed from HSL's MQTT feed.",
  ogTitle: "Raitsikat — Helsinki trams and buses on a live map",
  ogDescription:
    "Live map of Helsinki trams and buses, streamed from HSL's MQTT feed.",
  ogLocale: "en_US",
  ogLocaleAlternate: "fi_FI",
  ogImageAlt: "Raitsikat — live map of Helsinki trams and buses",
  twitterTitle: "Raitsikat — Helsinki trams and buses on a live map",
  twitterDescription: "Live map of Helsinki trams and buses.",
  jsonLdUrl: "/en",
  jsonLdDescription:
    "Live map of Helsinki trams and buses, streamed from HSL's MQTT feed.",
  tabTrams: "Trams",
  tabBuses: "Buses",
  sheetLines: "Lines",
  vehicleModeAria: "Vehicle mode",
  lineFilterAria: "Show or hide lines",
  mapAria: "Live map of Helsinki public transport",
  initialCount: "0 trams",
  langSwitchHref: "/",
  langSwitchTargetLocale: "fi",
  langSwitchText: "FI",
  langSwitchAria: "Switch language to Finnish",
  noscriptH1: "Raitsikat — HSL trams and buses on a live map",
  noscriptP1:
    "Raitsikat shows Helsinki's HSL trams and buses on a live map, streamed from HSL's public MQTT feed (High-Frequency Positioning). Filter by line, click a vehicle for its route.",
  noscriptP2:
    "Runs in the browser, no signup. Installable as a PWA.",
  vehicleModeTram: "trams",
  vehicleModeBus: "buses",
  loading: "Loading…",
  noDepartures: "No departures",
  unknownStop: "Unknown stop",
  reconnecting: "Reconnecting to live feed…",
  offline: "Offline — waiting for connection",
};

export const translations: Record<Locale, Strings> = { fi, en };

export function pickClientStrings(s: Strings): ClientStrings {
  const out = {} as Record<ClientKey, string>;
  for (const k of CLIENT_KEYS) out[k] = s[k];
  return out;
}
