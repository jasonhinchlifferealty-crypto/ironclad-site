/* Ironclad Realty Group — pulse.js
   Loads areas.geojson + pulse.json, draws the heatmap, drives the neighbourhood panel and the lead forms. */
(function () {
  "use strict";
  var C = window.IRONCLAD || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- helpers ---------- */
  var money = function (n) { return n == null ? "—" : "$" + Math.round(n).toLocaleString("en-CA"); };
  var moneyK = function (n) { return n == null ? "—" : (n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1000) + "K"); };
  var pct = function (n, signed) { if (n == null) return "—"; var v = (n * 100).toFixed(1); return (signed && n > 0 ? "+" : "") + v + "%"; };
  var LEVELS = ["low", "moderate", "steady", "active", "hot"];
  var LEVEL_LABEL = { low: "Quiet", moderate: "Moderate", steady: "Steady", active: "Active", hot: "Hot" };
  var OPACITY = { low: 0.12, moderate: 0.28, steady: 0.45, active: 0.65, hot: 0.88 };
  var RED = "#EC3013", INK = "#201E1D";

  /* ---------- config-driven contact links ---------- */
  $$("[data-phone]").forEach(function (el) { el.textContent = C.phone || el.textContent; });
  $$("[data-phone-href]").forEach(function (el) { if (C.phoneHref) el.href = C.phoneHref; });
  $$("[data-sms-href]").forEach(function (el) { if (C.smsHref) el.href = C.smsHref; });
  var y = $("#year"); if (y) y.textContent = new Date().getFullYear();

  /* ---------- nav ---------- */
  var navToggle = $("#navToggle"), nav = $("#nav");
  if (navToggle) navToggle.addEventListener("click", function () {
    var open = nav.classList.toggle("open"); navToggle.setAttribute("aria-expanded", String(open));
  });
  if (nav) nav.addEventListener("click", function (e) { if (e.target.tagName === "A") { nav.classList.remove("open"); navToggle.setAttribute("aria-expanded", "false"); } });

  /* ---------- state ---------- */
  var pulse = null, areas = null, layers = {}, selectedId = null, map = null;

  /* ---------- fetch data ---------- */
  Promise.all([
    fetch(C.areasUrl || "/data/areas.geojson").then(function (r) { return r.json(); }),
    fetch(C.pulseUrl || "/data/pulse.json").then(function (r) { return r.json(); })
  ]).then(function (res) {
    areas = res[0]; pulse = res[1];
    if (pulse.sample) $("#sampleNotice").classList.add("show");
    renderRegion(); renderList(); initMap();
  }).catch(function (err) {
    console.error(err);
    var el = $("#areaList"); if (el) el.innerHTML = '<li style="padding:12px 0;color:var(--muted)">The market data didn\'t load. Refresh the page, or call us and we\'ll read you the numbers.</li>';
  });

  function statsFor(id) { return (pulse && pulse.areas && pulse.areas[id]) || null; }
  function featureList() { return areas.features.slice().sort(function (a, b) { return (a.properties.order || 0) - (b.properties.order || 0); }); }

  /* ---------- region strip ---------- */
  function renderRegion() {
    var r = pulse.region || {};
    $("#pulsePeriod").textContent = pulse.period || "";
    $("#rPeriod").textContent = pulse.period || "this period";
    $("#dPeriod").textContent = pulse.period || "this period";
    $("#rMedian").textContent = money(r.median);
    $("#rDom").textContent = r.dom != null ? r.dom + " days" : "—";
    $("#rSales").textContent = r.sales != null ? r.sales.toLocaleString("en-CA") : "—";
    $("#rLts").textContent = pct(r.listToSale);
  }

  /* ---------- neighbourhood list ---------- */
  function renderList() {
    var ul = $("#areaList"); ul.innerHTML = "";
    var lastGroup = null;
    featureList().forEach(function (f) {
      var p = f.properties, s = statsFor(p.id) || {};
      if (p.group !== lastGroup) {
        var gh = document.createElement("li"); gh.className = "group-head"; gh.textContent = p.group; ul.appendChild(gh); lastGroup = p.group;
      }
      var li = document.createElement("li");
      var b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-pressed", "false"); b.dataset.id = p.id;
      b.innerHTML = '<span class="swatch" style="opacity:' + (OPACITY[s.activity] || 0.3) + '"></span>' +
        '<span class="area-name">' + p.name + (p.parent ? '<small>in ' + p.parent + '</small>' : '') + '</span>' +
        '<span class="area-median">' + moneyK(s.median) + '</span>';
      b.addEventListener("click", function () { select(p.id, true); });
      b.addEventListener("mouseenter", function () { highlight(p.id, true); });
      b.addEventListener("mouseleave", function () { highlight(p.id, false); });
      li.appendChild(b); ul.appendChild(li);
    });
  }

  /* ---------- map ---------- */
  function initMap() {
    if (!window.L) return;
    map = L.map("map", { zoomControl: true, scrollWheelZoom: false, zoomSnap: 0.2, attributionControl: true, minZoom: 6.5 });
    map.attributionControl.setPrefix("Leaflet");
    L.tileLayer(C.tileUrl, { attribution: C.tileAttribution, subdomains: "abcd", maxZoom: 18 }).addTo(map);
    if (C.tileLabelsUrl) L.tileLayer(C.tileLabelsUrl, { subdomains: "abcd", maxZoom: 18, pane: "shadowPane" }).addTo(map);
    map.zoomControl.setPosition("topright");

    var geo = L.geoJSON(areas, {
      style: function (f) { return styleFor(f.properties.id, false); },
      onEachFeature: function (f, layer) {
        var id = f.properties.id; layers[id] = layer;
        var s = statsFor(id) || {};
        layer.bindTooltip(f.properties.name + " · " + moneyK(s.median), { sticky: true, direction: "top", opacity: 1 });
        layer.on("mouseover", function () { highlight(id, true); });
        layer.on("mouseout", function () { highlight(id, false); });
        layer.on("click", function () { select(id, false); });
      }
    }).addTo(map);
    var home = geo.getBounds(); map.fitBounds(home, { padding: [24, 24] });
    map.on("click", function (e) { /* clicks on empty map do nothing; back button clears */ });
    map.on("zoomstart movestart", function () { $("#mapHint").classList.add("hidden"); });
    setTimeout(function () { map.invalidateSize(); map.fitBounds(home, { padding: [24, 24] }); }, 250);
    window.addEventListener("resize", function () { map.invalidateSize(); });
  }

  function styleFor(id, hover) {
    var s = statsFor(id) || {}, sel = id === selectedId;
    return { color: INK, weight: sel ? 3 : (hover ? 2 : 1), opacity: sel ? 1 : 0.7, fillColor: RED, fillOpacity: OPACITY[s.activity] || 0.3, dashArray: null };
  }
  function highlight(id, on) {
    var l = layers[id]; if (!l) return;
    l.setStyle(styleFor(id, on)); if (on && l.bringToFront) l.bringToFront();
    var btn = $('.area-list button[data-id="' + id + '"]'); if (btn) btn.classList.toggle("hover", on);
  }

  /* ---------- selection ---------- */
  function select(id, fromList) {
    var f = areas.features.filter(function (x) { return x.properties.id === id; })[0]; if (!f) return;
    var prev = selectedId; selectedId = id;
    if (prev && layers[prev]) layers[prev].setStyle(styleFor(prev, false));
    if (layers[id]) { layers[id].setStyle(styleFor(id, false)); layers[id].bringToFront(); if (map) map.fitBounds(layers[id].getBounds(), { padding: [90, 90], maxZoom: 12.4 }); }
    $$(".area-list button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.id === id)); });
    renderDetail(f); $("#mapHint").classList.add("hidden");
    $("#areaListWrap").classList.add("hide"); $("#areaDetail").classList.add("show");
    if (window.matchMedia("(max-width: 860px)").matches) {
      $("#areaDetail").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (history.replaceState) history.replaceState(null, "", "#" + id);
  }
  function clearSelection() {
    var prev = selectedId; selectedId = null;
    if (prev && layers[prev]) layers[prev].setStyle(styleFor(prev, false));
    $$(".area-list button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
    $("#areaListWrap").classList.remove("hide"); $("#areaDetail").classList.remove("show");
    if (map) map.fitBounds(L.geoJSON(areas).getBounds(), { padding: [24, 24] });
    if (history.replaceState) history.replaceState(null, "", "#pulse");
  }
  $("#backToList").addEventListener("click", clearSelection);

  function renderDetail(f) {
    var p = f.properties, s = statsFor(p.id) || {}, r = pulse.region || {};
    $("#detailGroup").textContent = p.group + (p.parent ? " · " + p.parent : "");
    $("#detailName").textContent = p.name;
    $("#dMedian").textContent = money(s.median);
    $("#dDom").innerHTML = s.dom != null ? s.dom + '<span class="unit">days</span>' : "—";
    $("#dSales").textContent = s.sales != null ? s.sales : "—";
    $("#dActive").textContent = s.active != null ? s.active : "—";
    var yoyEl = $("#dYoy"); yoyEl.textContent = pct(s.yoy, true); yoyEl.classList.toggle("up", (s.yoy || 0) > 0);
    $("#dLts").textContent = pct(s.listToSale);
    $("#dActivity").textContent = (LEVEL_LABEL[s.activity] || "—") + " market";
    var idx = LEVELS.indexOf(s.activity);
    $$("#dMeter i").forEach(function (i, k) { i.classList.toggle("on", k <= idx); });
    $("#dRead").textContent = plainRead(p, s, r);
    $("#leadArea").value = p.id; $("#leadAreaName").value = p.name;
  }

  function plainRead(p, s, r) {
    if (!s.median) return "";
    var parts = [];
    if (s.dom != null && r.dom != null) {
      var d = r.dom - s.dom;
      parts.push("Homes in " + p.name + " are selling in about " + s.dom + " days" + (Math.abs(d) >= 2 ? (d > 0 ? ", " + d + " days faster than the region." : ", " + Math.abs(d) + " days slower than the region.") : ", in line with the region."));
    }
    if (s.listToSale != null) parts.push(s.listToSale >= 1 ? "Sellers are getting list price or better." : "Sellers are getting about " + (s.listToSale * 100).toFixed(1) + "% of list price.");
    if (s.active != null && s.sales != null && s.sales > 0) {
      var months = s.active / s.sales;
      parts.push("At this pace there's roughly " + (months < 1 ? "under a month" : months.toFixed(1) + " months") + " of inventory, which " + (months < 2 ? "favours sellers." : months < 4 ? "is balanced." : "favours buyers."));
    }
    return parts.join(" ");
  }

  /* ---------- deep link ---------- */
  var h = (location.hash || "").replace("#", "");
  var afterLoad = setInterval(function () { if (areas && layers[h]) { clearInterval(afterLoad); select(h, true); } if (areas && !layers[h]) clearInterval(afterLoad); }, 150);

  /* ---------- modal + forms ---------- */
  var modal = $("#leadModal"), leadForm = $("#leadForm"), lastFocus = null;
  function openModal(kind) {
    lastFocus = document.activeElement; modal.hidden = false; modal.classList.add("open"); document.body.style.overflow = "hidden";
    var seller = kind !== "buyer";
    leadForm.type.value = seller ? "seller" : "buyer";
    $("#leadEyebrow").textContent = seller ? "Street-Level Equity Snapshot" : "Buyer matches";
    $("#leadTitle").textContent = seller ? "Where's the house?" : "What are you looking for?";
    $("#leadIntro").textContent = seller ? "Four fields. The snapshot goes to your email; the timeline tells us how to follow up." : "Tell us where and how much. Matches come by email as they list, with the pulse numbers beside each one.";
    $("#addressField").hidden = !seller; $("#lAddress").required = seller;
    $("#areasField").hidden = seller; $("#budgetField").hidden = seller;
    $("#timelineVerb").textContent = seller ? "selling" : "buying";
    $("#leadSubmit").textContent = seller ? "Send my snapshot" : "Send me matches";
    if (seller && !leadForm.areaName.value) { /* no neighbourhood picked yet — fine, address covers it */ }
    $("#leadMsg").className = "form-msg span2"; $("#leadMsg").textContent = "";
    setTimeout(function () { (seller ? $("#lAddress") : $("#lAreas")).focus(); }, 50);
  }
  function closeModal() { modal.classList.remove("open"); modal.hidden = true; document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); }
  $$("[data-snapshot]").forEach(function (b) { b.addEventListener("click", function (e) { e.preventDefault(); openModal("seller"); }); });
  $$("[data-buyer]").forEach(function (b) { b.addEventListener("click", function (e) { e.preventDefault(); openModal("buyer"); }); });
  $$("[data-close]", modal).forEach(function (b) { b.addEventListener("click", closeModal); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal.classList.contains("open")) closeModal(); });

  /* Book a call: Google Calendar page if configured, else the callback form (seller modal without address). */
  $$("[data-book]").forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.preventDefault();
      if (C.bookingUrl) {
        post("/api/event", { type: "booking-click", page: location.pathname }).catch(function () {});
        window.open(C.bookingUrl, "_blank", "noopener");
      } else { openModal("seller"); }
    });
  });

  function post(url, data) {
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); return j; }); });
  }
  function serialize(form) {
    var o = {}; new FormData(form).forEach(function (v, k) { o[k] = v; }); return o;
  }
  function showMsg(el, text, ok) { el.textContent = text; el.className = "form-msg span2 show" + (ok ? " ok" : ""); }

  leadForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!leadForm.checkValidity()) { leadForm.reportValidity(); return; }
    var btn = $("#leadSubmit"), msg = $("#leadMsg"), data = serialize(leadForm);
    data.source = data.type === "seller" ? "Heatmap-Lead" : "Buyer-Lead"; data.page = location.href;
    btn.disabled = true; btn.textContent = "Sending…";
    post("/api/lead", data).then(function () {
      leadForm.reset();
      showMsg(msg, data.type === "seller"
        ? "Received. Your snapshot is on its way to " + data.email + ". If we need to check anything about the address, we'll call."
        : "Received. First matches go out within one business day to " + data.email + ".", true);
      btn.textContent = "Sent";
    }).catch(function (err) {
      showMsg(msg, "That didn't go through: " + err.message + ". Call or text " + (C.phone || "506-608-3333") + " and we'll take it by hand.", false);
      btn.disabled = false; btn.textContent = data.type === "seller" ? "Send my snapshot" : "Send me matches";
    });
  });

  // Regional photo band: reveal once real files are added to /assets/img/photos/
  (function () {
    var section = $("#regionPhotos"); if (!section) return;
    var imgs = $$("[data-region-photo]", section), loaded = 0;
    imgs.forEach(function (img) {
      var probe = new Image();
      probe.onload = function () { loaded++; section.hidden = false; img.style.display = ""; };
      probe.onerror = function () { img.style.display = "none"; };
      probe.src = img.src;
    });
  })();

  var pulseForm = $("#pulseForm");
  pulseForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!pulseForm.checkValidity()) { pulseForm.reportValidity(); return; }
    var msg = $("#pulseMsg"), data = serialize(pulseForm); data.type = "subscriber"; data.source = "KV-Pulse-Signup"; data.page = location.href;
    var btn = pulseForm.querySelector("button"); btn.disabled = true;
    post("/api/lead", data).then(function () { pulseForm.reset(); showMsg(msg, "Subscribed. First Pulse arrives on the 1st.", true); })
      .catch(function (err) { showMsg(msg, "That didn't go through: " + err.message, false); btn.disabled = false; });
  });
})();
