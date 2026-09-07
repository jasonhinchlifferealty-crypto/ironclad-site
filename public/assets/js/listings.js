/* Ironclad — listings.js
   Shared engine for displaying active listings: map pins, compact card, full gallery overlay,
   grid rendering for neighbourhood pages, DDF attribution, and lead-form hookup.
   Entirely inert unless window.IRONCLAD.listingsEnabled is true. */
(function () {
  "use strict";
  var C = window.IRONCLAD || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var CREA_LINE = 'The trademarks MLS®, Multiple Listing Service® and the associated logos are owned by The Canadian Real Estate Association (CREA) and identify the quality of services provided by real estate professionals who are members of CREA. Information is deemed reliable but is not guaranteed accurate.';

  function money(n) { return n == null ? "—" : "$" + Math.round(n).toLocaleString("en-CA"); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function img(l, i, size) {
    if (!l.images || !l.images.length) return "";
    var f = l.images[Math.min(i || 0, l.images.length - 1)];
    return (C.listingImageBase || "https://cdn.repliers.io/") + f + "?class=" + (size || "medium");
  }
  function title(l) { return l.addressOk && l.street ? l.street + ", " + l.city : (l.type + " in " + l.city + " — address on request"); }
  function facts(l) {
    var f = [];
    if (l.beds != null) f.push(l.beds + " bed");
    if (l.baths != null) f.push(l.baths + " bath");
    if (l.sqft) f.push(Math.round(l.sqft).toLocaleString("en-CA") + " sq ft");
    f.push(l.type);
    return f.join(" · ");
  }

  /* ---------- data ---------- */
  var cache = {};
  function fetchArea(areaId) {
    if (cache[areaId]) return Promise.resolve(cache[areaId]);
    return fetch("/api/listings" + (areaId ? "?area=" + encodeURIComponent(areaId) : ""))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { cache[areaId] = j; return j; });
  }

  /* ---------- badges ---------- */
  function badges(l) {
    var b = "";
    if (l.isNew) b += '<span class="lb lb-new">Just listed</span>';
    else if (l.cut) b += '<span class="lb lb-cut">Price cut</span>';
    return b;
  }

  /* ---------- compact card (map + grid share the markup) ---------- */
  function cardHTML(l, forGrid) {
    return '<article class="lcard' + (forGrid ? ' grid' : '') + '" data-mls="' + esc(l.mls) + '">' +
      '<div class="lcard-photo">' + (img(l, 0, "medium") ? '<img loading="lazy" src="' + img(l, 0, "medium") + '" alt="' + esc(title(l)) + '">' : '<div class="noimg">No photo provided</div>') + badges(l) + '</div>' +
      '<div class="lcard-body">' +
        '<div class="lcard-price">' + money(l.price) + (l.cut && l.original ? ' <s>' + money(l.original) + '</s>' : '') + '</div>' +
        '<div class="lcard-title">' + esc(title(l)) + '</div>' +
        '<div class="lcard-facts">' + esc(facts(l)) + '</div>' +
        '<div class="lcard-office">Listed by ' + esc(l.office || "the listing brokerage") + '</div>' +
        '<div class="lcard-btns"><button class="btn btn-secondary" data-open="' + esc(l.mls) + '">Details</button>' +
        '<button class="btn btn-primary" data-rep="' + esc(l.mls) + '">Get representation</button></div>' +
      '</div></article>';
  }

  /* ---------- full overlay ---------- */
  var ovl = null, ovlList = [], ovlIdx = 0, imgIdx = 0;
  function ensureOverlay() {
    if (ovl) return;
    ovl = document.createElement("div");
    ovl.className = "lovl"; ovl.hidden = true;
    ovl.innerHTML =
      '<div class="lovl-bg" data-lclose></div>' +
      '<div class="lovl-card">' +
        '<button class="lovl-x" data-lclose aria-label="Close">×</button>' +
        '<div class="lovl-gal"><img id="lovlImg" alt=""><button class="lovl-nav prev" data-gprev aria-label="Previous photo">‹</button><button class="lovl-nav next" data-gnext aria-label="Next photo">›</button><div class="lovl-count" id="lovlCount"></div></div>' +
        '<div class="lovl-body">' +
          '<div class="lovl-badges" id="lovlBadges"></div>' +
          '<div class="lovl-price" id="lovlPrice"></div>' +
          '<h2 class="lovl-title" id="lovlTitle"></h2>' +
          '<div class="lovl-facts" id="lovlFacts"></div>' +
          '<p class="lovl-desc" id="lovlDesc"></p>' +
          '<div class="lovl-cta"><button class="btn btn-primary btn-lg btn-block" id="lovlRep">Get representation on this home</button>' +
          '<p class="lovl-note">We represent you, the buyer — evidence-based offer strategy, showings on your schedule. The listing brokerage represents the seller.</p></div>' +
          '<div class="lovl-attr"><strong id="lovlOffice"></strong><span id="lovlMls"></span><p>' + CREA_LINE + '</p></div>' +
        '</div></div>';
    document.body.appendChild(ovl);
    ovl.addEventListener("click", function (e) {
      if (e.target.closest("[data-lclose]")) closeOverlay();
      if (e.target.closest("[data-gprev]")) gal(-1);
      if (e.target.closest("[data-gnext]")) gal(1);
    });
    document.addEventListener("keydown", function (e) {
      if (ovl.hidden) return;
      if (e.key === "Escape") closeOverlay();
      if (e.key === "ArrowLeft") gal(-1);
      if (e.key === "ArrowRight") gal(1);
    });
    $("#lovlRep").addEventListener("click", function () { openLead(ovlList[ovlIdx]); });
  }
  function gal(d) {
    var l = ovlList[ovlIdx]; if (!l || !l.images.length) return;
    imgIdx = (imgIdx + d + l.images.length) % l.images.length;
    $("#lovlImg").src = img(l, imgIdx, "large");
    $("#lovlCount").textContent = (imgIdx + 1) + " / " + l.images.length;
  }
  function openOverlay(list, idx) {
    ensureOverlay();
    ovlList = list; ovlIdx = idx; imgIdx = 0;
    var l = list[idx];
    $("#lovlBadges").innerHTML = badges(l);
    $("#lovlPrice").innerHTML = money(l.price) + (l.cut && l.original ? ' <s>' + money(l.original) + '</s>' : '');
    $("#lovlTitle").textContent = title(l);
    $("#lovlFacts").textContent = facts(l);
    $("#lovlDesc").textContent = l.desc || "";
    $("#lovlOffice").textContent = "Listed by " + (l.office || "the listing brokerage");
    $("#lovlMls").textContent = l.mls ? " · MLS® " + l.mls : "";
    var im = $("#lovlImg");
    if (l.images.length) { im.src = img(l, 0, "large"); im.style.display = ""; $("#lovlCount").textContent = "1 / " + l.images.length; }
    else { im.style.display = "none"; $("#lovlCount").textContent = ""; }
    ovl.hidden = false; document.body.style.overflow = "hidden";
  }
  function closeOverlay() { if (ovl) { ovl.hidden = true; document.body.style.overflow = ""; } }

  /* ---------- lead hookup (reuses the existing buyer modal) ---------- */
  function openLead(l) {
    closeOverlay();
    var form = $("#leadForm");
    if (form) {
      $("#leadListingMls") && ($("#leadListingMls").value = l.mls || "");
      $("#leadListingAddr") && ($("#leadListingAddr").value = title(l));
    }
    if (window.IroncladOpenBuyer) window.IroncladOpenBuyer(l);
    var la = $("#lAreas"); if (la && !la.value) la.value = l.city || "";
  }

  /* ---------- click delegation for cards ---------- */
  document.addEventListener("click", function (e) {
    var o = e.target.closest("[data-open]");
    if (o) { var i = ovlCtx.findIndex(function (x) { return x.mls === o.getAttribute("data-open"); }); if (i > -1) openOverlay(ovlCtx, i); }
    var r = e.target.closest("[data-rep]");
    if (r) { var l = ovlCtx.find(function (x) { return x.mls === r.getAttribute("data-rep"); }); if (l) openLead(l); }
  });
  var ovlCtx = [];

  /* ---------- public: map integration ---------- */
  var layerGroup = null, mapCard = null;
  window.IroncladListings = {
    enabled: function () { return !!C.listingsEnabled; },
    showForArea: function (map, areaId) {
      if (!C.listingsEnabled || !window.L) return;
      this.clear(map);
      fetchArea(areaId).then(function (j) {
        ovlCtx = j.listings;
        layerGroup = L.layerGroup();
        j.listings.forEach(function (l, idx) {
          if (l.lat == null) return;
          var icon = L.divIcon({ className: "lpin-wrap", html: '<span class="lpin' + (l.isNew ? ' new' : '') + '"></span>', iconSize: [14, 14], iconAnchor: [7, 7] });
          var m = L.marker([l.lat, l.lng], { icon: icon });
          m.bindTooltip(money(l.price), { direction: "top", opacity: 1, offset: [0, -6] });
          m.on("click", function () { showMapCard(map, l); });
          layerGroup.addLayer(m);
        });
        layerGroup.addTo(map);
        var withheld = j.listings.filter(function (l) { return !l.addressOk; }).length;
        var hint = $("#listingsHint");
        if (hint) hint.textContent = j.count + " active listing" + (j.count === 1 ? "" : "s") + (withheld ? " · " + withheld + " with address withheld (tap the neighbourhood page to see them)" : "");
      }).catch(function () {});
    },
    clear: function (map) {
      if (layerGroup && map) { map.removeLayer(layerGroup); layerGroup = null; }
      hideMapCard();
      var hint = $("#listingsHint"); if (hint) hint.textContent = "";
    },
    renderGrid: function (el, areaId, emptyMsg) {
      if (!C.listingsEnabled) return Promise.resolve(0);
      return fetchArea(areaId).then(function (j) {
        ovlCtx = j.listings;
        el.innerHTML = j.listings.length ? j.listings.map(function (l) { return cardHTML(l, true); }).join("")
          : '<p class="lempty">' + esc(emptyMsg || "No active listings here right now — which often means pent-up demand for the next one.") + '</p>';
        return j.listings.length;
      });
    }
  };

  function showMapCard(map, l) {
    hideMapCard();
    mapCard = document.createElement("div");
    mapCard.className = "lmapcard";
    mapCard.innerHTML = cardHTML(l, false) + '<button class="lmapcard-x" aria-label="Close">×</button>';
    $(".pulse-map").appendChild(mapCard);
    mapCard.querySelector(".lmapcard-x").addEventListener("click", hideMapCard);
  }
  function hideMapCard() { if (mapCard) { mapCard.remove(); mapCard = null; } }
})();
