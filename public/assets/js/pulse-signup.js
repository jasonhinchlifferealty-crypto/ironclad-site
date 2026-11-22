/* Ironclad — pulse-signup.js
   Subscribe form for the Market Pulse pages (/pulse/). Posts to /api/lead exactly as the
   homepage form does: type "subscriber", source "KV-Pulse-Signup" (the source and CRM tag
   names are unchanged on purpose, so Follow Up Boss automations keep working). */
(function () {
  "use strict";
  var form = document.getElementById("pulseForm");
  if (!form) return;
  var msg = document.getElementById("pulseMsg");
  function show(text, ok) { msg.textContent = text; msg.className = "form-msg span2 show" + (ok ? " ok" : ""); }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var data = {}; new FormData(form).forEach(function (v, k) { data[k] = v; });
    data.type = "subscriber"; data.source = "KV-Pulse-Signup"; data.page = location.href;
    var btn = form.querySelector("button"); btn.disabled = true;
    if (window.ironcladConvert) window.ironcladConvert();
    fetch("/api/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Request failed"); return j; }); })
      .then(function () { form.reset(); show("Subscribed. The next edition will reach you when it is published.", true); btn.disabled = false; })
      .catch(function (err) { show("That didn't go through: " + err.message, false); btn.disabled = false; });
  });
})();
