// Connection-state toast. EventSource auto-reconnects; this surfaces UI
// only after a grace period so transient blips stay silent.

import { t } from "./i18n.js";

export function trackConnection(es) {
  const el = document.getElementById("conn-toast");
  const label = el.querySelector(".conn-toast__label");
  let graceTimer = null;
  let escalateTimer = null;
  // Once we've shown "offline", stay there until the next successful open —
  // otherwise repeated `error` events would bounce the toast between
  // "reconnecting" and "offline" while still disconnected.
  let escalated = false;

  const clearTimers = () => {
    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }
    if (escalateTimer) { clearTimeout(escalateTimer); escalateTimer = null; }
  };
  const show = (state, text) => {
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
}
