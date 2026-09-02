/**
 * Snapshot Composer — /api/composer
 * Private tool for preparing a Street-Level Equity Snapshot by hand:
 * paste comps from your board system, see the range and a live preview, send the branded
 * email through Resend, and log it all to Follow Up Boss — same output as the automated engine.
 *
 * Gated by the same key as the diagnostic: env DIAG_KEY (or TOOL_KEY if you set one later).
 * Open:  https://YOUR-SITE/api/composer?key=YOURWORD
 */

import { computeRange, renderEmailHTML, renderEmailText, sendEmail, fubNote, money } from "./_lib/snapshot.js";

function authed(env, url, body) {
  const k = env.TOOL_KEY || env.DIAG_KEY;
  return k && (url.searchParams.get("key") === k || (body && body.key === k));
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!authed(env, url)) return new Response("Not found", { status: 404 });
  return new Response(PAGE.replace("{{KEY}}", url.searchParams.get("key")), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  let body; try { body = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (!authed(env, url, body)) return new Response("Not found", { status: 404 });

  const lead = {
    id: "manual-" + Date.now(),
    firstName: String(body.firstName || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    address: String(body.address || "").trim(),
    areaName: "", timeline: ""
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return json({ error: "Valid client email required" }, 400);
  if (lead.address.length < 6) return json({ error: "Property address required" }, 400);

  const comps = { list: (body.comps || []).map(c => ({
      price: num(c.price), dom: num(c.dom), beds: num(c.beds),
      type: String(c.type || "home"), street: String(c.street || ""), city: "",
      distKm: num(c.distKm)
    })).filter(c => c.price > 0),
    radiusKm: num(body.radiusKm) || 2, months: num(body.months) || 6 };
  if (comps.list.length < 3) return json({ error: "At least 3 comps with prices" }, 400);

  const actives = (num(body.activeCount) != null) ? { count: num(body.activeCount), medianList: num(body.activeMedian) } : null;
  const range = computeRange(comps.list);

  // Per-send display override (falls back to the site-wide COMP_DISPLAY setting)
  const envForRender = Object.create(env);
  if (body.compDisplay) envForRender.COMP_DISPLAY = String(body.compDisplay);

  const html = renderEmailHTML(envForRender, lead, {}, comps, actives, range);
  const text = renderEmailText(lead, comps, actives, range);

  if (body.previewOnly) return json({ ok: true, preview: html, range });

  const subject = `Your Street-Level Equity Snapshot — ${lead.address.split(",")[0].trim()}`;
  const sent = await sendEmail(env, lead, subject, html, text);
  if (!sent.ok) return json({ error: sent.note || "Email failed" }, 502);

  const compLines = comps.list.slice(0, 10).map(c => `  ${c.street || (c.distKm != null ? c.distKm + " km away" : "nearby")} — ${money(c.price)}${c.dom != null ? ", " + c.dom + " DOM" : ""}`).join("\n");
  await fubNote(env, lead, ["Snapshot-Sent", "Snapshot-Composed"],
    `Snapshot prepared MANUALLY via composer and emailed.\nRange: ${money(range.low)}–${money(range.high)} (midpoint ${money(range.mid)})\nBased on ${comps.list.length} comps within ${comps.radiusKm} km over ${comps.months} months.` +
    (actives ? `\nActive competition noted: ${actives.count}${actives.medianList ? ", median ask " + money(actives.medianList) : ""}.` : "") +
    `\n\nComps used (internal):\n${compLines}`);

  return json({ ok: true, range });
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

/* ------------------------------------------------------------------ */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Snapshot Composer — Ironclad</title>
<link rel="icon" href="/assets/img/shield-red.png"><link rel="stylesheet" href="/assets/css/site.css?v=1.1">
<style>
  .composer { max-width: 1200px; margin: 0 auto; padding: 32px var(--gutter) 80px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
  @media (max-width: 980px) { .cols { grid-template-columns: 1fr; } }
  .comp-row { display: grid; grid-template-columns: 1.2fr .9fr .5fr .9fr .6fr auto; gap: 8px; margin-bottom: 8px; }
  .comp-row input, .comp-row select { min-height: 42px; padding: 8px 10px; }
  .comp-head { display: grid; grid-template-columns: 1.2fr .9fr .5fr .9fr .6fr auto; gap: 8px; font-weight: 600; font-size: .6875rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
  .del { border: 2px solid var(--ink); background: none; width: 42px; cursor: pointer; font-size: 18px; }
  .del:hover { background: var(--ink); color: #fff; }
  .rangebox { border-top: 3px solid var(--ink); padding-top: 14px; margin-top: 8px; }
  .rangebox .num { font-size: 1.9rem; }
  iframe { width: 100%; height: 720px; border: 1px solid var(--line); background: #fff; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .msg { display:none; padding: 12px 14px; border-left: 3px solid var(--red); background: #fff; margin-top: 12px; }
  .msg.show { display:block; } .msg.ok { border-left-color: var(--ink); }
</style></head><body>
<header class="site-header"><div class="wrap">
  <a class="brand" href="/"><img src="/assets/img/lockup-charcoal.png" alt="Ironclad Realty Group" style="height:34px;width:auto"></a>
  <span class="label red">Snapshot Composer — internal</span>
</div></header>
<div class="composer">
<div class="cols">
  <div>
    <h1 class="h2">Compose a snapshot.</h1>
    <p style="color:var(--muted);margin-top:8px">Pull comps from the board system, enter them below. Range updates live. Preview, then send. Everything logs to Follow Up Boss.</p>

    <h3 class="label" style="margin:22px 0 10px">Client & property</h3>
    <div class="row2">
      <div class="field"><label>First name</label><input id="cFirst" placeholder="Sarah"></div>
      <div class="field"><label>Email</label><input id="cEmail" type="email" placeholder="client@example.com"></div>
    </div>
    <div class="field" style="margin-top:12px"><label>Property address</label><input id="cAddress" placeholder="380 Main St, Sussex"></div>

    <h3 class="label" style="margin:22px 0 10px">Comparable sales (3+)</h3>
    <div class="comp-head"><span>Street (optional)</span><span>Sold price</span><span>Beds</span><span>Type</span><span>DOM</span><span></span></div>
    <div id="rows"></div>
    <button class="btn btn-secondary" type="button" onclick="addRow()">+ Add comp</button>

    <h3 class="label" style="margin:22px 0 10px">Context</h3>
    <div class="row2">
      <div class="field"><label>Search radius used (km)</label><input id="cRadius" type="number" value="2" step="0.5"></div>
      <div class="field"><label>Months of sales</label><input id="cMonths" type="number" value="6"></div>
      <div class="field"><label>Active competition (count, optional)</label><input id="cActN" type="number" placeholder="7"></div>
      <div class="field"><label>Median asking (optional)</label><input id="cActM" type="number" placeholder="499900"></div>
    </div>
    <div class="field" style="margin-top:12px"><label>What the client email shows</label>
      <select id="cMode"><option value="">Site default (COMP_DISPLAY)</option><option value="none">Range only — no comps</option><option value="anonymized">Comps without addresses</option><option value="full">Comps with street names</option></select>
    </div>

    <div class="rangebox"><div class="label muted">Evidence-based range (live)</div><div class="num" id="liveRange">—</div><div style="font-size:.8125rem;color:var(--muted)" id="liveNote"></div></div>

    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-secondary" type="button" onclick="preview()">Preview</button>
      <button class="btn btn-primary" type="button" id="sendBtn" onclick="send()">Send snapshot</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
  <div>
    <h3 class="label" style="margin:0 0 10px">Client sees</h3>
    <iframe id="pv" title="Email preview"></iframe>
  </div>
</div></div>
<script>
var KEY = "{{KEY}}";
function addRow(){var d=document.createElement('div');d.className='comp-row';d.innerHTML='<input placeholder="12 Oak St"><input type="number" placeholder="472000"><input type="number" placeholder="3"><select><option>Bungalow</option><option>Two-storey</option><option>Split-level</option><option>Ranch</option><option>Townhouse</option><option>Condo</option><option>Home</option></select><input type="number" placeholder="14"><button class="del" onclick="this.parentNode.remove();calc()">×</button>';[].forEach.call(d.querySelectorAll('input,select'),function(i){i.addEventListener('input',calc)});document.getElementById('rows').appendChild(d)}
for(var i=0;i<3;i++)addRow();
function comps(){return [].map.call(document.querySelectorAll('.comp-row'),function(r){var f=r.querySelectorAll('input,select');return{street:f[0].value,price:f[1].value,beds:f[2].value,type:f[3].value,dom:f[4].value}}).filter(function(c){return parseFloat(c.price)>0})}
function q(v){return Math.round(v/5000)*5000}
function calc(){var p=comps().map(function(c){return parseFloat(c.price)}).sort(function(a,b){return a-b});var el=document.getElementById('liveRange'),n=document.getElementById('liveNote');if(p.length<3){el.textContent='—';n.textContent='Need at least 3 comps';return}
function qu(s,f){var pos=(s.length-1)*f,lo=Math.floor(pos),hi=Math.ceil(pos);return s[lo]+(s[hi]-s[lo])*(pos-lo)}
var lo=p.length>=5?qu(p,.25):p[0],hi=p.length>=5?qu(p,.75):p[p.length-1],m=p.length%2?p[(p.length-1)/2]:(p[p.length/2-1]+p[p.length/2])/2;
el.textContent='$'+q(lo).toLocaleString()+' – $'+q(hi).toLocaleString();n.textContent='Midpoint $'+q(m).toLocaleString()+' · '+p.length+' comps'}
function payload(previewOnly){return{key:KEY,previewOnly:previewOnly,firstName:v('cFirst'),email:v('cEmail'),address:v('cAddress'),radiusKm:v('cRadius'),months:v('cMonths'),activeCount:v('cActN'),activeMedian:v('cActM'),compDisplay:v('cMode'),comps:comps()}}
function v(id){return document.getElementById(id).value}
function showMsg(t,ok){var m=document.getElementById('msg');m.textContent=t;m.className='msg show'+(ok?' ok':'')}
function preview(){fetch(location.pathname+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(true))}).then(function(r){return r.json()}).then(function(j){if(j.error){showMsg(j.error,false);return}document.getElementById('pv').srcdoc=j.preview;showMsg('Preview updated. Range: $'+j.range.low.toLocaleString()+' – $'+j.range.high.toLocaleString(),true)}).catch(function(e){showMsg(String(e),false)})}
function send(){if(!confirm('Send this snapshot to '+v('cEmail')+'?'))return;var b=document.getElementById('sendBtn');b.disabled=true;fetch(location.pathname+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(false))}).then(function(r){return r.json()}).then(function(j){b.disabled=false;if(j.error){showMsg(j.error,false);return}showMsg('Sent to '+v('cEmail')+' and logged to Follow Up Boss.',true)}).catch(function(e){b.disabled=false;showMsg(String(e),false)})}
</script></body></html>`;
