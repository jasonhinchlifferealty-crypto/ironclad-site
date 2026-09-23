/* Ironclad — track.js
   Google Ads tag, config-driven. Reads window.IRONCLAD.adsId / .adsLabel (config.js is
   Jason's file). With adsId set, the base Google tag loads on every page. Conversions
   fire through ironcladConvert(), called at the three lead moments (snapshot form,
   Pulse subscribe, quiz gate) — a guarded no-op until adsLabel is pasted in, so the
   site never breaks while the label is pending. */
(function () {
  "use strict";
  var C = window.IRONCLAD || {};
  if (!C.adsId) { window.ironcladConvert = function () {}; return; }
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(C.adsId);
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag("js", new Date());
  gtag("config", C.adsId);
  window.ironcladConvert = function () {
    if (!C.adsLabel) return; // label pending — no-op, never an error
    try { window.gtag("event", "conversion", { send_to: C.adsId + "/" + C.adsLabel }); } catch (e) {}
  };
})();
