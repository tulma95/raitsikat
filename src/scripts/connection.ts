// Connection-state toast. EventSource auto-reconnects; this surfaces UI
// only after a grace period so transient blips stay silent.
//
// Returns a dispose function: es.close() fires no events, so when the caller
// replaces the EventSource (mode switch) it must dispose the old tracker or a
// pending grace/escalate timer would later show a toast that nothing can hide.

import { t } from "./i18n.ts";

export function trackConnection(es: EventSource): () => void {
  const el = document.getElementById("conn-toast")!;
  const label = el.querySelector<HTMLElement>(".conn-toast__label")!;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let escalateTimer: ReturnType<typeof setTimeout> | null = null;
  // Once we've shown "offline", stay there until the next successful open —
  // otherwise repeated `error` events would bounce the toast between
  // "reconnecting" and "offline" while still disconnected.
  let escalated = false;

  const clearTimers = () => {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (escalateTimer) { clearTimeout(escalateTimer); escalateTimer = null; }
  };
  const show = (state: string, text: string) => {
    el.setAttribute("data-state", state);
    label.textContent = text;
    el.hidden = false;
  };
  const hide = () => {
    el.hidden = true;
    el.removeAttribute("data-state");
  };

  es.addEventListener("open", () => {
    escalated = false;
    clearTimers();
    hide();
  });
  es.addEventListener("error", () => {
    // EventSource will reconnect automatically. Show UI only after 2s.
    if (escalated || graceTimer || escalateTimer) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      show("reconnecting", t("reconnecting"));
      escalateTimer = setTimeout(() => {
        escalateTimer = null;
        escalated = true;
        show("offline", t("offline"));
      }, 30_000);
    }, 2_000);
  });

  return () => {
    clearTimers();
    hide();
  };
}
