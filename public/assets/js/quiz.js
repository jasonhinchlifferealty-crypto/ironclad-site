/* Ironclad — quiz.js : The KV Personality Test engine */
(function () {
  "use strict";
  var Q = window.QUIZ, C = window.IRONCLAD || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var state = { i: 0, dims: { pace: [], space: [], water: [], heritage: [], family: [] }, commutePref: 30, beds: 2, budget: 380000, answers: [] };

  function start() { state.i = 0; render(); }

  function render() {
    var wrap = $("#quizCard");
    if (state.i >= Q.questions.length) return finish();
    var q = Q.questions[state.i];
    wrap.innerHTML =
      '<div class="q-progress"><i style="width:' + Math.round(state.i / Q.questions.length * 100) + '%"></i></div>' +
      '<div class="label red">Question ' + (state.i + 1) + ' of ' + Q.questions.length + '</div>' +
      '<h2 class="q-title">' + q.q + '</h2>' +
      '<div class="q-answers">' + q.a.map(function (a, j) {
        return '<button class="q-a" data-j="' + j + '">' + a.t + '</button>';
      }).join('') + '</div>' +
      (state.i > 0 ? '<button class="q-back" data-back>&larr; Back</button>' : '');
    wrap.querySelectorAll('.q-a').forEach(function (b) {
      b.addEventListener('click', function () { answer(parseInt(b.getAttribute('data-j'))); });
    });
    var back = wrap.querySelector('[data-back]');
    if (back) back.addEventListener('click', function () { state.i--; state.answers.pop(); rebuild(); render(); });
  }

  function answer(j) {
    state.answers.push(j); state.i++; rebuild(); render();
  }
  function rebuild() {
    state.dims = { pace: [], space: [], water: [], heritage: [], family: [] };
    state.commutePref = 30; state.beds = 2; state.budget = 380000;
    state.answers.forEach(function (j, qi) {
      var s = Q.questions[qi].a[j].s || {};
      for (var k in s) {
        if (state.dims[k]) state.dims[k].push(s[k]);
        else if (k === "commutePref") state.commutePref = s[k];
        else if (k === "beds") state.beds = s[k];
        else if (k === "budget") state.budget = s[k];
      }
    });
  }

  function avg(a, fallback) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : fallback; }

  function scoreAreas(pulse) {
    var prof = { pace: avg(state.dims.pace, 2), space: avg(state.dims.space, 2), water: avg(state.dims.water, 1.5), heritage: avg(state.dims.heritage, 2), family: avg(state.dims.family, 2) };
    var out = [];
    for (var id in Q.areas) {
      var a = Q.areas[id], d = 0;
      d += Math.abs(a.pace - prof.pace) * 1.2;
      d += Math.abs(a.space - prof.space);
      d += Math.abs(a.water - prof.water) * (prof.water >= 3 ? 1.5 : 0.7);
      d += Math.abs(a.heritage - prof.heritage) * 0.6;
      d += Math.abs(a.family - prof.family) * 0.9;
      d += Math.max(0, a.commute - state.commutePref) / 12;               // over-commute hurts
      var med = pulse && pulse.areas && pulse.areas[id] && pulse.areas[id].ask;
      if (med && med > state.budget * 1.35) d += 2.5;                      // priced far out of reach
      else if (med && med > state.budget * 1.15) d += 1;
      out.push({ id: id, d: d });
    }
    out.sort(function (x, y) { return x.d - y.d || (x.id < y.id ? -1 : 1); });
    return out;
  }

  function finish() {
    fetch(C.pulseUrl || "/api/pulse").then(function (r) { return r.json(); }).catch(function () { return null; })
      .then(function (pulse) {
        var ranked = scoreAreas(pulse);
        state.result = ranked[0].id; state.top3 = ranked.slice(0, 3).map(function (r) { return r.id; });
        showResult(pulse);
      });
  }

  function showResult(pulse) {
    var id = state.result, p = Q.personas[id] || { title: "", body: "" };
    var meta = (window.QUIZ_META && window.QUIZ_META[id]) || {};
    var name = areaName(id);
    var s = (pulse && pulse.areas && pulse.areas[id]) || {};
    var stats = [];
    if (s.ask) stats.push("median asking " + moneyK(s.ask));
    if (s.active != null) stats.push(s.active + " homes for sale right now");
    if (s.dom != null) stats.push("typical listing up " + s.dom + " days");
    $("#quizCard").innerHTML =
      '<div class="label red">Your result</div>' +
      '<h2 class="q-result-name">' + name + '</h2>' +
      '<div class="q-result-title">' + p.title + '</div>' +
      '<p class="q-result-body">' + p.body + '</p>' +
      (stats.length ? '<p class="q-result-stats">The evidence, live from the MLS&reg;: ' + stats.join(" · ") + '. <a href="/homes-for-sale/' + id + '/">See what\'s for sale in ' + name + '</a>.</p>' : '') +
      '<div class="q-tease">' +
        '<div class="label" style="color:#fff;opacity:.85">One more thing</div>' +
        '<h3>We found your match.</h3>' +
        '<p id="teaseLine">Scanning current ' + name + ' listings against your answers…</p>' +
        '<form id="teaseForm" novalidate>' +
          '<div class="q-fields"><input type="text" id="qName" placeholder="First name" autocomplete="given-name"><input type="email" id="qEmail" placeholder="Email" autocomplete="email" required></div>' +
          '<label class="q-consent"><input type="checkbox" id="qConsent" required><span>Email me my match — and alert me when a new best match hits the market. Unsubscribe any time, one click.</span></label>' +
          '<button class="btn btn-primary btn-lg btn-block" id="qSubmit" type="submit">Reveal my match</button>' +
          '<div class="form-msg" id="qMsg" role="status"></div>' +
        '</form>' +
      '</div>' +
      '<button class="q-back" onclick="location.reload()">Retake the test</button>';
    // tease specificity without revealing the listing
    fetch("/api/listings?area=" + id).then(function (r) { return r.json(); }).then(function (j) {
      var fit = (j.listings || []).filter(function (l) { return l.price && l.price <= state.budget * 1.15 && (l.beds == null || l.beds >= Math.min(state.beds, 3) - 1); });
      var pool = fit.length ? fit : (j.listings || []);
      var line;
      if (pool.length) { var t = pool[0]; line = "There's a " + (t.beds ? t.beds + "-bedroom " : "") + (t.type || "home").toLowerCase() + " in " + name + " that fits your answers. Address, photos, and the full breakdown arrive by email."; }
      else line = "Nothing in " + name + " fits your profile this week — which is exactly when knowing about the next one first matters. We'll email your best current match nearby, and alert you the moment " + name + " produces one.";
      $("#teaseLine").textContent = line;
    }).catch(function () { $("#teaseLine").textContent = "Your best current match arrives by email, with the full breakdown."; });

    $("#teaseForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var email = $("#qEmail").value.trim(), consent = $("#qConsent").checked;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg("A real email gets a real match.", false);
      if (!consent) return msg("The checkbox is how we're allowed to email you — Canadian law, good law.", false);
      var btn = $("#qSubmit"); btn.disabled = true;
      fetch("/api/quiz-match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: email, firstName: $("#qName").value.trim(),
        areaId: state.result, top3: state.top3, budget: state.budget, beds: state.beds,
        prefs: { water: avg(state.dims.water, 1.5), space: avg(state.dims.space, 2), heritage: avg(state.dims.heritage, 2) },
        persona: (Q.personas[state.result] || {}).title || "", page: location.href, website: ""
      }) }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) { msg("Sent. Check your inbox — and maybe the promotions tab, email being email.", true); btn.textContent = "Sent"; }
        else { btn.disabled = false; msg(j.error || "Something hiccuped — try once more.", false); }
      }).catch(function () { btn.disabled = false; msg("Something hiccuped — try once more.", false); });
    });
    function msg(t, ok) { var m = $("#qMsg"); m.textContent = t; m.className = "form-msg show" + (ok ? " ok" : ""); }
  }

  function areaName(id) { return id.split("-").map(function (w) { return w === "nb" ? "NB" : w.charAt(0).toUpperCase() + w.slice(1); }).join(" ").replace("Grand Bay Westfield", "Grand Bay-Westfield"); }
  function moneyK(n) { return n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1000) + "K"; }

  document.addEventListener("DOMContentLoaded", start);
})();
