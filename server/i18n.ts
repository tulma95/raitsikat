// Localized UI strings. Single source of truth for both the SSR shell
// (`src/layouts/BaseLayout.astro` + `src/lib/seo.ts`) and the runtime
// strings exposed to the browser via `window.__i18n`.

import type { Mode } from "./types.ts";

export type Locale = "fi" | "en";

export const LOCALES: Locale[] = ["fi", "en"];

// Mode-independent strings: shared chrome + the runtime CLIENT_KEYS. These
// don't change between the tram and bus pages of a given locale.
export interface Strings {
  // <head>
  ogLocale: string;
  ogLocaleAlternate: string;
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
  // describe the TARGET locale. The actual href is mode-dependent and lives
  // in `ModeStrings.langSwitchHref`.
  langSwitchTargetLocale: Locale;
  langSwitchText: string;
  langSwitchAria: string;
  // runtime strings shipped to the client via window.__i18n
  vehicleModeTram: string;
  vehicleModeBus: string;
  loading: string;
  noDepartures: string;
  unknownStop: string;
  reconnecting: string;
  offline: string;
}

// Per-(locale × mode) SEO strings. These differ between the tram and bus
// pages, and `langSwitchHref` points at the SAME mode in the other locale.
export interface ModeStrings {
  title: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImageAlt: string;
  twitterTitle: string;
  twitterDescription: string;
  jsonLdDescription: string;
  noscriptH1: string;
  noscriptP1: string;
  noscriptP2: string;
  // Language switch target for THIS mode in the other locale.
  langSwitchHref: string;
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
  ogLocale: "fi_FI",
  ogLocaleAlternate: "en_US",
  tabTrams: "Ratikat",
  tabBuses: "Bussit",
  sheetLines: "Linjat",
  vehicleModeAria: "Kulkuneuvotyyppi",
  lineFilterAria: "Näytä tai piilota linjoja",
  mapAria: "Helsingin joukkoliikenteen live-kartta",
  initialCount: "0 ratikkaa",
  langSwitchTargetLocale: "en",
  langSwitchText: "EN",
  langSwitchAria: "Vaihda kieli englanniksi",
  vehicleModeTram: "ratikkaa",
  vehicleModeBus: "bussia",
  loading: "Ladataan…",
  noDepartures: "Ei lähtöjä",
  unknownStop: "Tuntematon pysäkki",
  reconnecting: "Yhdistetään uudelleen…",
  offline: "Yhteyttä ei ole",
};

const en: Strings = {
  ogLocale: "en_US",
  ogLocaleAlternate: "fi_FI",
  tabTrams: "Trams",
  tabBuses: "Buses",
  sheetLines: "Lines",
  vehicleModeAria: "Vehicle mode",
  lineFilterAria: "Show or hide lines",
  mapAria: "Live map of Helsinki public transport",
  initialCount: "0 trams",
  langSwitchTargetLocale: "fi",
  langSwitchText: "FI",
  langSwitchAria: "Switch language to Finnish",
  vehicleModeTram: "trams",
  vehicleModeBus: "buses",
  loading: "Loading…",
  noDepartures: "No departures",
  unknownStop: "Unknown stop",
  reconnecting: "Reconnecting to live feed…",
  offline: "Offline — waiting for connection",
};

export const translations: Record<Locale, Strings> = { fi, en };

const fiTram: ModeStrings = {
  title: "Raitsikat — Helsingin ratikat kartalla (live)",
  description:
    "Helsingin ratikat eli raitiovaunut kartalla reaaliajassa. Seuraa kaikkia HSL-linjoja, suodata näkyviin haluamasi ja klikkaa vaunua nähdäksesi reitin.",
  ogTitle: "Raitsikat — Helsingin ratikat kartalla reaaliajassa",
  ogDescription:
    "Live-kartta Helsingin raitiovaunuista. Suoraan HSL:n MQTT-syötteestä.",
  ogImageAlt: "Raitsikat — live-kartta Helsingin raitiovaunuista",
  twitterTitle: "Raitsikat — Helsingin ratikat kartalla (live)",
  twitterDescription: "Live-kartta Helsingin raitiovaunuista.",
  jsonLdDescription:
    "Live-kartta Helsingin raitiovaunuista, suoraan HSL:n MQTT-syötteestä.",
  noscriptH1: "Helsingin ratikat kartalla reaaliajassa",
  noscriptP1:
    "Raitsikat näyttää kaikki Helsingin raitiovaunut kartalla reaaliajassa. Datalähteenä on HSL:n julkinen MQTT-syöte (High-Frequency Positioning), joten vaunut liikkuvat kartalla samaan tahtiin kuin oikeasti kadulla.",
  noscriptP2:
    "Voit suodattaa näkymän linjoittain ja klikata raitiovaunua nähdäksesi sen reitin. Sovellus toimii selaimessa ilman rekisteröitymistä, ja sen voi asentaa myös PWA-sovelluksena.",
  langSwitchHref: "/en/trams",
};

const fiBus: ModeStrings = {
  title: "Raitsikat — Helsingin bussit kartalla (live)",
  description:
    "Helsingin bussit kartalla reaaliajassa. Seuraa HSL:n bussilinjoja, suodata näkyviin haluamasi linjat ja klikkaa bussia nähdäksesi sen reitin.",
  ogTitle: "Raitsikat — Helsingin bussit kartalla reaaliajassa",
  ogDescription:
    "Live-kartta Helsingin busseista. Suoraan HSL:n MQTT-syötteestä.",
  ogImageAlt: "Raitsikat — live-kartta Helsingin busseista",
  twitterTitle: "Raitsikat — Helsingin bussit kartalla (live)",
  twitterDescription: "Live-kartta Helsingin busseista.",
  jsonLdDescription:
    "Live-kartta Helsingin busseista, suoraan HSL:n MQTT-syötteestä.",
  noscriptH1: "Helsingin bussit kartalla reaaliajassa",
  noscriptP1:
    "Raitsikat näyttää Helsingin seudun bussit kartalla reaaliajassa. Datalähteenä on HSL:n julkinen MQTT-syöte (High-Frequency Positioning), joten bussit liikkuvat kartalla samaan tahtiin kuin oikeasti liikenteessä.",
  noscriptP2:
    "Voit suodattaa näkymän linjoittain ja klikata bussia nähdäksesi sen reitin. Sovellus toimii selaimessa ilman rekisteröitymistä, ja sen voi asentaa myös PWA-sovelluksena.",
  langSwitchHref: "/en/buses",
};

const enTram: ModeStrings = {
  title: "Raitsikat — Helsinki Trams Live Map",
  description:
    "Live map of Helsinki trams in real time. Track every HSL tram line, filter the ones you want, and click a tram to see its route.",
  ogTitle: "Raitsikat — Helsinki trams on a live map",
  ogDescription: "Live map of Helsinki trams, streamed from HSL's MQTT feed.",
  ogImageAlt: "Raitsikat — live map of Helsinki trams",
  twitterTitle: "Raitsikat — Helsinki Trams Live Map",
  twitterDescription: "Live map of Helsinki trams.",
  jsonLdDescription: "Live map of Helsinki trams, streamed from HSL's MQTT feed.",
  noscriptH1: "Helsinki trams on a live map",
  noscriptP1:
    "Raitsikat shows every Helsinki tram on a live map in real time. The data comes from HSL's public MQTT feed (High-Frequency Positioning), so trams move on the map exactly as they move on the street.",
  noscriptP2:
    "Filter the view by line and click a tram to see its route. Runs in the browser with no signup, and installs as a PWA.",
  langSwitchHref: "/ratikat",
};

const enBus: ModeStrings = {
  title: "Raitsikat — Helsinki Buses Live Map",
  description:
    "Live map of Helsinki buses in real time. Track HSL bus lines, filter the routes you want, and click a bus to see where it's heading.",
  ogTitle: "Raitsikat — Helsinki buses on a live map",
  ogDescription: "Live map of Helsinki buses, streamed from HSL's MQTT feed.",
  ogImageAlt: "Raitsikat — live map of Helsinki buses",
  twitterTitle: "Raitsikat — Helsinki Buses Live Map",
  twitterDescription: "Live map of Helsinki buses.",
  jsonLdDescription: "Live map of Helsinki buses, streamed from HSL's MQTT feed.",
  noscriptH1: "Helsinki buses on a live map",
  noscriptP1:
    "Raitsikat shows Helsinki-region buses on a live map in real time. The data comes from HSL's public MQTT feed (High-Frequency Positioning), so buses move on the map exactly as they move in traffic.",
  noscriptP2:
    "Filter the view by line and click a bus to see its route. Runs in the browser with no signup, and installs as a PWA.",
  langSwitchHref: "/bussit",
};

export const modeStrings: Record<Locale, Record<Mode, ModeStrings>> = {
  fi: { tram: fiTram, bus: fiBus },
  en: { tram: enTram, bus: enBus },
};

// Typed accessor for the per-(locale × mode) SEO strings.
export function getModeStrings(locale: Locale, mode: Mode): ModeStrings {
  return modeStrings[locale][mode];
}

export function pickClientStrings(s: Strings): ClientStrings {
  // Explicit so the compiler enforces every ClientKey is present — a missing
  // or extra key is a type error, not a silent gap. Keep in sync with
  // CLIENT_KEYS (which derives ClientKey / ClientStrings).
  return {
    vehicleModeTram: s.vehicleModeTram,
    vehicleModeBus: s.vehicleModeBus,
    loading: s.loading,
    noDepartures: s.noDepartures,
    unknownStop: s.unknownStop,
    reconnecting: s.reconnecting,
    offline: s.offline,
  };
}
