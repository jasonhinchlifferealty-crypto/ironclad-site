/* Ironclad — heat.js
   Metric-selectable continuous heat field over the Pulse map. Every listing radiates
   Gaussian influence in pixel space; each on-screen sample blends nearby listings into a
   weighted value, and the paint's OPACITY carries confidence: dense data reads solid,
   thin data fades, no data is transparent. No interpolation across true voids — where
   nothing is known, nothing is drawn. Inert unless listingsEnabled. */
(function () {
  "use strict";
  var C = window.IRONCLAD || {};
  var SIGMA = 30;            // kernel radius in px — visual smoothness, zoom-independent
  var STEP = 5;              // sample every N px, canvas-smoothed upscale
  var CONF_FULL = 2.2;       // effective listings for full opacity (value metrics)
  var CONF_MIN = 0.55;       // below this, draw nothing
  var METRICS = {
    price: { label: "Price", legend: ["cheaper", "pricier"], v: function (l) { return l.price; } },
    dom:   { label: "Days listed", legend: ["slower", "faster"], invert: true, v: function (l) { return l.dom; } }, // fast-selling = hot = red
    cuts:  { label: "Price cuts", legend: ["few cuts", "many cuts"], v: function (l) { return l.cut ? 1 : 0; } },
    count: { label: "Homes", legend: ["sparse", "dense"], v: null } // density itself
  };
  var state = { metric: null, map: null, data: null, canvas: null, raf: null };

  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    return [Math.round(0xEC * t + 0x9a * (1 - t)), Math.round(0x30 * t + 0x97 * (1 - t)), Math.round(0x13 * t + 0x94 * (1 - t))];
  }

  function render() {
    var map = state.map; if (!map || !state.metric || !state.data || !state.canvas) return;
    var M = METRICS[state.metric];
    var size = map.getSize();
    var cv = state.canvas;
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    cv.width = size.x; cv.height = size.y;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, size.x, size.y);

    // project listings to container px; coarse-bucket for neighbour lookup
    var pts = [];
    state.data.forEach(function (l) {
      if (l.lat == null || l.lng == null || !l.price) return;
      var v = M.v ? M.v(l) : 1;
      if (M.v && v == null) return;
      var p = map.latLngToContainerPoint([l.lat, l.lng]);
      if (p.x < -SIGMA * 3 || p.y < -SIGMA * 3 || p.x > size.x + SIGMA * 3 || p.y > size.y + SIGMA * 3) return;
      pts.push({ x: p.x, y: p.y, v: v });
    });
    if (!pts.length) return;
    var CELL = SIGMA * 3, buckets = {};
    pts.forEach(function (p) {
      var k = Math.floor(p.x / CELL) + ":" + Math.floor(p.y / CELL);
      (buckets[k] || (buckets[k] = [])).push(p);
    });
    function near(x, y) {
      var bx = Math.floor(x / CELL), by = Math.floor(y / CELL), out = [];
      for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) {
        var b = buckets[(bx + i) + ":" + (by + j)]; if (b) out.push.apply(out, b);
      }
      return out;
    }
    var inv2s2 = 1 / (2 * SIGMA * SIGMA), R2 = 9 * SIGMA * SIGMA;
    var cols = Math.ceil(size.x / STEP), rows = Math.ceil(size.y / STEP);
    var val = new Float32Array(cols * rows), conf = new Float32Array(cols * rows);
    for (var r = 0; r < rows; r++) {
      var y = r * STEP + STEP / 2;
      for (var c = 0; c < cols; c++) {
        var x = c * STEP + STEP / 2, ws = 0, wv = 0, nb = near(x, y);
        for (var n = 0; n < nb.length; n++) {
          var dx = nb[n].x - x, dy = nb[n].y - y, d2 = dx * dx + dy * dy;
          if (d2 > R2) continue;
          var w = Math.exp(-d2 * inv2s2);
          ws += w; wv += w * nb[n].v;
        }
        conf[r * cols + c] = ws;
        val[r * cols + c] = ws > 0 ? wv / ws : 0;
      }
    }
    // normalize: percentile band over confident samples (density normalizes on conf itself)
    var samples = [];
    for (var i2 = 0; i2 < val.length; i2++) if (conf[i2] >= CONF_MIN) samples.push(M.v ? val[i2] : conf[i2]);
    if (!samples.length) return;
    samples.sort(function (a, b) { return a - b; });
    var lo = samples[Math.floor(samples.length * 0.05)], hi = samples[Math.floor(samples.length * 0.95)] || samples[samples.length - 1];
    if (hi === lo) hi = lo + 1;
    var off = document.createElement("canvas"); off.width = cols; off.height = rows;
    var octx = off.getContext("2d"), img = octx.createImageData(cols, rows);
    for (var i3 = 0; i3 < val.length; i3++) {
      var cf = conf[i3];
      if (cf < CONF_MIN) continue;
      var t = ((M.v ? val[i3] : cf) - lo) / (hi - lo);
      if (M.invert) t = 1 - t;
      var rgb = ramp(t);
      var a = Math.min(1, cf / CONF_FULL) * 0.55;
      img.data[i3 * 4] = rgb[0]; img.data[i3 * 4 + 1] = rgb[1]; img.data[i3 * 4 + 2] = rgb[2];
      img.data[i3 * 4 + 3] = Math.round(a * 255);
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, size.x, size.y);
    // clip to the service area: feathered mask from every area polygon — heat never paints beyond the patch
    if (state.rings && state.rings.length) {
      var mk = document.createElement("canvas"); mk.width = size.x; mk.height = size.y;
      var mctx = mk.getContext("2d");
      mctx.filter = "blur(14px)";
      mctx.fillStyle = "#fff";
      mctx.beginPath();
      state.rings.forEach(function (ring) {
        ring.forEach(function (pt, i) {
          var p = map.latLngToContainerPoint([pt[1], pt[0]]);
          if (i === 0) mctx.moveTo(p.x, p.y); else mctx.lineTo(p.x, p.y);
        });
        mctx.closePath();
      });
      mctx.fill();
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(mk, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    var lg = document.getElementById("heatLegend");
    if (lg) { lg.hidden = false; document.getElementById("heatLegendLo").textContent = M.legend[0]; document.getElementById("heatLegendHi").textContent = M.legend[1]; }
    window.__heatDbg = { pts: pts.length, cols: cols, rows: rows, confident: samples.length };
  }
  function scheduleRender() { if (state.raf) cancelAnimationFrame(state.raf); state.raf = requestAnimationFrame(render); }
  function clearField() {
    if (state.canvas) { var ctx = state.canvas.getContext("2d"); ctx.clearRect(0, 0, state.canvas.width, state.canvas.height); }
    var lg = document.getElementById("heatLegend"); if (lg) lg.hidden = true;
  }

  // ---- Always-on listing dots: every cached listing as a small ink square. ----
  var dots = { canvas: null };
  function renderDots() {
    var map = state.map; if (!map || !dots.canvas || !state.data) return;
    var size = map.getSize(), cv = dots.canvas;
    L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0]));
    cv.width = size.x; cv.height = size.y;
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, size.x, size.y);
    ctx.fillStyle = "rgba(32,30,29,0.78)"; // Ironclad ink
    var n = 0;
    state.data.forEach(function (l) {
      if (l.lat == null || l.lng == null) return;
      var p = map.latLngToContainerPoint([l.lat, l.lng]);
      if (p.x < -6 || p.y < -6 || p.x > size.x + 6 || p.y > size.y + 6) return;
      ctx.fillRect(Math.round(p.x) - 1.5, Math.round(p.y) - 1.5, 3, 3);
      n++;
    });
    window.__dotsDbg = { drawn: n };
  }
  window.IroncladHeat = {
    attach: function (map) {
      if (!C.listingsEnabled || !window.L) return;
      state.map = map;
      map.createPane("dotsPane");
      var dp = map.getPane("dotsPane");
      dp.style.zIndex = 450; // above area fills, below markers — dots stay visible everywhere
      dp.style.pointerEvents = "none";
      dots.canvas = document.createElement("canvas");
      dots.canvas.style.position = "absolute";
      dp.appendChild(dots.canvas);
      map.whenReady(function () { ensureData().then(renderDots); });
      map.createPane("heatPane");
      var pane = map.getPane("heatPane");
      pane.style.zIndex = 350;
      pane.style.pointerEvents = "none";
      var cv = document.createElement("canvas");
      cv.style.position = "absolute";
      pane.appendChild(cv);
      state.canvas = cv;
      var ctl = document.createElement("div");
      ctl.className = "heat-ctl";
      ctl.innerHTML = '<span class="heat-ctl-label">Heat</span>' +
        '<button data-hm="" class="on">Off</button>' +
        Object.keys(METRICS).map(function (k) { return '<button data-hm="' + k + '">' + METRICS[k].label + '</button>'; }).join('') +
        '<span class="heat-legend" id="heatLegend" hidden><i style="background:rgb(' + ramp(0.05).join(',') + ')"></i><span id="heatLegendLo"></span> — <span id="heatLegendHi"></span><i style="background:rgb(' + ramp(0.95).join(',') + ')"></i></span>';
      document.querySelector(".pulse-map").appendChild(ctl);
      ctl.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-hm]"); if (!b) return;
        ctl.querySelectorAll("button").forEach(function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        var m = b.getAttribute("data-hm");
        state.metric = m || null;
        if (!m) { clearField(); return; }
        ensureData().then(scheduleRender);
      });
      map.on("moveend zoomend resize", function () { renderDots(); if (state.metric) scheduleRender(); else if (state.canvas) L.DomUtil.setPosition(state.canvas, map.containerPointToLayerPoint([0, 0])); });
      map.on("move", function () { if (dots.canvas) L.DomUtil.setPosition(dots.canvas, map.containerPointToLayerPoint([0, 0])); if (state.metric) L.DomUtil.setPosition(state.canvas, map.containerPointToLayerPoint([0, 0])); });
    }
  };
  function ensureData() {
    if (state.data && state.rings) return Promise.resolve();
    return Promise.all([
      fetch("/api/listings").then(function (r) { return r.json(); }).catch(function () { return { listings: [] }; }),
      fetch("/data/areas.geojson").then(function (r) { return r.json(); }).catch(function () { return { features: [] }; })
    ]).then(function (res) {
      state.data = res[0].listings || [];
      state.rings = [];
      (res[1].features || []).forEach(function (f) {
        var g = f.geometry; if (!g) return;
        var polys = g.type === "Polygon" ? [g.coordinates] : (g.type === "MultiPolygon" ? g.coordinates : []);
        polys.forEach(function (p) { if (p[0]) state.rings.push(p[0]); });
      });
    });
  }
})();
