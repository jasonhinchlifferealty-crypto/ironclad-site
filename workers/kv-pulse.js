/**
 * The KV Pulse — monthly subscriber email. Standalone Cloudflare Worker.
 *
 * Flow: on the 1st, the cron emails Jason a "ready to review" nudge. Jason opens the private
 * approval page, reads the composed edition (built live from /api/pulse), writes the month's
 * personal note, optionally sends himself a test, then releases it to subscribers.
 * Subscribers = FUB contacts tagged KV-Pulse-Subscriber, minus anyone tagged Pulse-Unsubscribed.
 * Every email carries a signed one-click unsubscribe that adds the Pulse-Unsubscribed tag in FUB.
 *
 * Approval page:  https://<worker-url>/?key=YOUR_PULSE_KEY
 *
 * Variables (Worker > Settings > Variables; mark keys as Secret):
 *   RESEND_API_KEY   required
 *   FUB_API_KEY      required
 *   PULSE_KEY        required — your private word for the approval page
 *   UNSUB_SECRET     required — any long random phrase; signs unsubscribe links
 *   SITE_URL         default https://ironcladrealty.ca
 *   PULSE_FROM       default "Jason Hinchliffe <jason@ironcladrealty.ca>"
 *   PULSE_ADMIN      default jason@ironcladrealty.ca (where nudges/tests go)
 *
 * Cron trigger: 0 11 1 * *   (8:00 a.m. Atlantic on the 1st — sends the review nudge only)
 *
 * Note: Resend's free tier sends 100 emails/day. Fine for now; when the list nears that,
 * upgrade Resend or tell Claude to add day-batching.
 */

const F = "Archivo,'Helvetica Neue',Arial,sans-serif";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendNudge(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/unsub") return handleUnsub(url, env);

    if ((env.PULSE_KEY || "") === "" || url.searchParams.get("key") !== env.PULSE_KEY) {
      return new Response("The KV Pulse worker. Monthly, by approval.", { status: 200 });
    }

    if (request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
      const note = String(body.note || "").trim();
      const edition = await compose(env, note, url.origin, body.expertWatch);
      if (body.action === "test") {
        const r = await sendOne(env, env.PULSE_ADMIN || "jason@ironcladrealty.ca", edition, url.origin, true);
        return json(r.ok ? { ok: true, msg: "Test sent to " + (env.PULSE_ADMIN || "jason@ironcladrealty.ca") } : { error: r.note }, r.ok ? 200 : 502);
      }
      if (body.action === "release") {
        const subs = await subscribers(env);
        if (!subs.length) return json({ error: "No subscribers found (tag KV-Pulse-Subscriber in Follow Up Boss)." }, 400);
        let sent = 0, failed = [];
        for (const s of subs) {
          const r = await sendOne(env, s.email, edition, url.origin, false, s.firstName);
          if (r.ok) sent++; else failed.push(s.email + " (" + r.note + ")");
          if (sent >= 95) { failed.push("STOPPED at 95 — Resend free-tier daily limit; remaining subscribers not sent"); break; }
        }
        return json({ ok: true, sent, failed });
      }
      return json({ error: "unknown action" }, 400);
    }

    // GET: approval page with live preview
    const edition = await compose(env, "", url.origin, "");
    const subs = await subscribers(env).catch(() => []);
    return new Response(approvalPage(edition, subs.length, url.searchParams.get("key")), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
};

/* ---------------- compose the edition ---------------- */
async function compose(env, note, workerOrigin, expertWatch) {
  const site = env.SITE_URL || "https://ironcladrealty.ca";
  const [pulseR, geoR] = await Promise.all([fetch(site + "/api/pulse"), fetch(site + "/data/areas.geojson")]);
  if (!pulseR.ok) throw new Error("pulse data unavailable");
  const pulse = await pulseR.json();
  const geo = geoR.ok ? await geoR.json() : { features: [] };
  const meta = geo.features.map(f => f.properties).sort((a, b) => (a.order || 0) - (b.order || 0));

  const now = new Date();
  const monthName = now.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "America/Moncton" });
  const r = pulse.region || {};

  // Named observations, computed honestly from current data
  const rows = meta.map(m => ({ ...m, s: (pulse.areas || {})[m.id] || {} })).filter(x => x.s.active != null);
  const withDom = rows.filter(x => x.s.dom != null && x.s.active >= 5);
  const fastest = withDom.slice().sort((a, b) => a.s.dom - b.s.dom)[0];
  const mostCut = rows.filter(x => x.s.reducedPct != null && x.s.active >= 5).sort((a, b) => b.s.reducedPct - a.s.reducedPct)[0];
  const tightest = rows.filter(x => x.s.active > 0).sort((a, b) => a.s.active - b.s.active)[0];

  const obs = [];
  if (fastest) obs.push(`${fastest.name} is moving quickest — the typical listing there has been up just ${fastest.s.dom} days.`);
  if (mostCut && mostCut.s.reducedPct >= 0.2) obs.push(`Buyers have the most leverage in ${mostCut.name}, where ${Math.round(mostCut.s.reducedPct * 100)}% of listings have cut their asking price.`);
  if (tightest && tightest.s.active <= 15) obs.push(`Inventory is tightest in ${tightest.name} (${tightest.s.active} homes) — a well-priced listing there has little competition.`);

  return { monthName, note, expertWatch: String(expertWatch || "").trim(), live: !!pulse.live, updated: pulse.updated, region: r, rows, obs, site };
}

/* ---------------- render ---------------- */
function money(n) { return n == null ? "—" : "$" + Math.round(n).toLocaleString("en-CA"); }
function moneyK(n) { return n == null ? "—" : (n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : "$" + Math.round(n / 1000) + "K"); }
function pctS(x) { return x == null ? "—" : Math.round(x * 100) + "%"; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderEmail(ed, unsubUrl, firstName) {
  const groups = {};
  ed.rows.forEach(x => { (groups[x.group] = groups[x.group] || []).push(x); });
  const tableRows = Object.entries(groups).map(([g, list]) =>
    `<tr><td colspan="5" style="padding:14px 0 4px;font:600 10px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:#6b6867">${esc(g)}</td></tr>` +
    list.map(x => `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #e2e0df;font:600 13px/1.3 ${F};color:#201E1D">${esc(x.name)}</td>
      <td align="right" style="padding:8px 0 8px 10px;border-bottom:1px solid #e2e0df;font:800 13px/1.3 ${F};color:#201E1D;white-space:nowrap">${moneyK(x.s.ask)}</td>
      <td align="right" style="padding:8px 0 8px 10px;border-bottom:1px solid #e2e0df;font:400 12px/1.3 ${F};color:#6b6867;white-space:nowrap">${x.s.active} for sale</td>
      <td align="right" style="padding:8px 0 8px 10px;border-bottom:1px solid #e2e0df;font:400 12px/1.3 ${F};color:#6b6867;white-space:nowrap">${x.s.dom != null ? x.s.dom + " days" : "—"}</td>
      <td align="right" style="padding:8px 0 8px 10px;border-bottom:1px solid #e2e0df;font:400 12px/1.3 ${F};color:#6b6867;white-space:nowrap">${pctS(x.s.reducedPct)} cut</td>
    </tr>`).join("")).join("");

  const obsHtml = ed.obs.length ? `<div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin-top:26px;border-top:3px solid #201E1D;padding-top:13px">Three things worth knowing</div>` +
    ed.obs.map(o => `<p style="font:400 14px/1.55 ${F};color:#201E1D;margin:10px 0 0">${esc(o)}</p>`).join("") : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F2F2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F2F2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#201E1D;padding:16px 28px"><img src="${ed.site}/assets/img/lockup-white.png" alt="Ironclad Realty Group" height="30" style="height:30px;width:auto;display:block"></td></tr>
  <tr><td style="background:#EC3013;padding:28px 28px">
    <div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#ffffff;opacity:.85">The KV Pulse</div>
    <div style="font:800 26px/1.1 ${F};color:#ffffff;margin-top:8px">${esc(ed.monthName)}</div>
    <div style="font:400 12px/1 ${F};color:#ffffff;opacity:.8;margin-top:6px">Sussex to Saint John &middot; live MLS&reg; data, the day this was sent</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:28px 28px 32px">
    ${firstName ? `<p style="font:400 15px/1.55 ${F};color:#201E1D;margin:0 0 14px">Hi ${esc(firstName)},</p>` : ""}
    ${ed.note ? `<div style="border-left:3px solid #EC3013;padding:2px 0 2px 14px;margin:0 0 22px"><p style="font:400 15px/1.6 ${F};color:#201E1D;margin:0;white-space:pre-line">${esc(ed.note)}</p><p style="font:600 12px/1 ${F};color:#6b6867;margin:10px 0 0">— Jason</p></div>` : ""}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${[["Median asking", money(ed.region.ask)], ["Homes for sale", ed.region.active != null ? ed.region.active : "—"], ["New in 30 days", ed.region.new30 != null ? ed.region.new30 : "—"], ["Share with a cut", pctS(ed.region.reducedPct)]].map(([k, v]) => `
      <td width="25%" style="border-top:3px solid #201E1D;padding:10px 8px 0 0"><div style="font:800 20px/1 ${F};color:#201E1D">${v}</div><div style="font:600 9px/1.3 ${F};letter-spacing:.1em;text-transform:uppercase;color:#6b6867;margin-top:5px">${k}</div></td>`).join("")}
    </tr></table>

    <div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin-top:26px;border-top:3px solid #201E1D;padding-top:13px">Every neighbourhood, right now</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>

    ${obsHtml}
    ${ed.expertWatch ? `<div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#EC3013;margin-top:26px;border-top:3px solid #EC3013;padding-top:13px">Expert Watch</div>` + ed.expertWatch.split(/\n\s*\n/).map(par => {
      const p2 = esc(par.trim());
      return par.trim().toLowerCase().startsWith("sources:")
        ? `<p style="font:400 11px/1.6 ${F};color:#6b6867;margin:10px 0 0">${p2}</p>`
        : `<p style="font:400 14px/1.6 ${F};color:#201E1D;margin:10px 0 0;white-space:pre-line">${p2}</p>`;
    }).join("") : ""}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td style="background:#201E1D;padding:20px 22px">
      <div style="font:800 17px/1.25 ${F};color:#ffffff">Thinking of selling this season?</div>
      <p style="font:400 13px/1.5 ${F};color:rgba(255,255,255,.72);margin:8px 0 14px">These are asking prices. What homes actually sell for on your street comes in a Street-Level Equity Snapshot — prepared for your address, free.</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#EC3013"><a href="${ed.site}/#pulse" style="display:inline-block;padding:12px 18px;font:600 12px/1 ${F};letter-spacing:.1em;text-transform:uppercase;color:#ffffff;text-decoration:none">Get my snapshot</a></td>
        <td width="10"></td>
        <td style="border:2px solid #ffffff"><a href="tel:+15066083333" style="display:inline-block;padding:10px 18px;font:600 12px/1 ${F};letter-spacing:.1em;text-transform:uppercase;color:#ffffff;text-decoration:none">506-608-3333</a></td>
      </tr></table>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#201E1D;padding:20px 28px">
    <p style="font:400 12px/1.7 ${F};color:#ffffff;margin:0"><strong style="font-weight:800">Jason Hinchliffe</strong> &mdash; REALTOR&reg;<br>Ironclad Realty Group &middot; Brokered by eXp Realty Canada &mdash; New Brunswick<br>Sussex to Saint John &middot; ironcladrealty.ca</p>
    <p style="font:400 11px/1.6 ${F};color:#8f8c8b;margin:12px 0 0">You're receiving the KV Pulse because you subscribed at ironcladrealty.ca. Market figures are aggregate asking-side statistics from MLS&reg; active listings, current as of send time. <a href="${unsubUrl}" style="color:#8f8c8b;text-decoration:underline">Unsubscribe</a> any time — one click, no questions.</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

/* ---------------- subscribers & delivery ---------------- */
async function fubHeaders(env) {
  return { "Content-Type": "application/json", "Authorization": "Basic " + btoa(env.FUB_API_KEY + ":") };
}
async function subscribers(env) {
  const out = []; let offset = 0;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`https://api.followupboss.com/v1/people?tags=KV-Pulse-Subscriber&limit=100&offset=${offset}&fields=id,firstName,emails,tags`, { headers: await fubHeaders(env) });
    if (!r.ok) throw new Error("FUB " + r.status);
    const j = await r.json();
    const people = j.people || [];
    for (const p of people) {
      const email = p.emails && p.emails[0] && p.emails[0].value;
      const tags = p.tags || [];
      if (email && !tags.includes("Pulse-Unsubscribed")) out.push({ email: email.toLowerCase(), firstName: p.firstName || "" });
    }
    if (people.length < 100) break;
    offset += 100;
  }
  // de-dupe
  const seen = {}; return out.filter(s => (seen[s.email] ? false : (seen[s.email] = true)));
}

async function sendOne(env, email, edition, workerOrigin, isTest, firstName) {
  const token = await sign(env, email);
  const unsubUrl = `${workerOrigin}/unsub?e=${encodeURIComponent(email)}&t=${token}`;
  const html = renderEmail(edition, unsubUrl, firstName || "");
  const subject = (isTest ? "[TEST] " : "") + `The KV Pulse — ${edition.monthName}`;
  if (!env.RESEND_API_KEY) return { ok: false, note: "RESEND_API_KEY not set" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.PULSE_FROM || "Jason Hinchliffe <jason@ironcladrealty.ca>", to: [email], reply_to: "jason@ironcladrealty.ca", subject, html })
  });
  if (!r.ok) return { ok: false, note: "Resend " + r.status };
  return { ok: true };
}

async function sendNudge(env) {
  if (!env.RESEND_API_KEY) return;
  const month = new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "America/Moncton" });
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.PULSE_FROM || "Jason Hinchliffe <jason@ironcladrealty.ca>",
      to: [env.PULSE_ADMIN || "jason@ironcladrealty.ca"],
      subject: `KV Pulse ${month} is ready to review`,
      html: `<p style="font-family:Arial">Your ${month} edition is composed from this morning's live data. Open the approval page, add your note, and release it:</p><p style="font-family:Arial"><b>Bookmark:</b> your KV Pulse approval page (the worker URL with ?key=...)</p><p style="font-family:Arial;color:#888">Nothing sends to subscribers until you press Release.</p>`
    })
  }).catch(() => {});
}

/* ---------------- unsubscribe (CASL) ---------------- */
async function sign(env, email) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.UNSUB_SECRET || "set-a-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.toLowerCase()));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function handleUnsub(url, env) {
  const email = String(url.searchParams.get("e") || "").toLowerCase();
  const t = url.searchParams.get("t") || "";
  const good = email && t && (await sign(env, email)) === t;
  if (good && env.FUB_API_KEY) {
    await fetch("https://api.followupboss.com/v1/events", {
      method: "POST", headers: await fubHeaders(env),
      body: JSON.stringify({ source: "KV-Pulse", system: "Ironclad Website", type: "Note", message: "Unsubscribed from the KV Pulse via email link.", person: { emails: [{ value: email }], tags: ["Pulse-Unsubscribed"] } })
    }).catch(() => {});
  }
  const body = good
    ? `<h1 style="font-weight:800">Done.</h1><p>You won't receive the KV Pulse again. If this was a mistake, just reply to any past edition and we'll put you back on.</p>`
    : `<h1 style="font-weight:800">That link didn't check out.</h1><p>Reply to any KV Pulse email with the word "unsubscribe" and it'll be handled by hand.</p>`;
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:${F};color:#201E1D;background:#F3F2F2;display:grid;place-items:center;min-height:100svh;margin:0"><div style="max-width:420px;padding:24px">${body}</div></body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ---------------- approval page ---------------- */
function approvalPage(edition, subCount, key) {
  const preview = renderEmail(edition, "#unsubscribe-preview", "");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>KV Pulse — ${esc(edition.monthName)} — review</title>
<style>
  body { margin:0; font-family:${F}; background:#F3F2F2; color:#201E1D; }
  header { background:#201E1D; color:#fff; padding:14px 24px; display:flex; justify-content:space-between; align-items:center; }
  header b { font-weight:800; }
  .wrap { max-width:1200px; margin:0 auto; padding:24px; display:grid; grid-template-columns: 420px 1fr; gap:28px; }
  @media (max-width:900px){ .wrap { grid-template-columns:1fr; } }
  h1 { font-weight:800; font-size:26px; margin:0 0 6px; letter-spacing:-.02em; }
  .muted { color:#6b6867; font-size:13px; }
  textarea { width:100%; min-height:150px; border:2px solid #201E1D; padding:12px; font:inherit; font-size:15px; margin-top:14px; box-sizing:border-box; }
  .btn { display:inline-block; border:2px solid; padding:12px 20px; font-weight:600; font-size:13px; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; background:none; }
  .primary { background:#EC3013; border-color:#EC3013; color:#fff; } .primary:hover { background:#AE1800; border-color:#AE1800; }
  .ghost { border-color:#201E1D; color:#201E1D; } .ghost:hover { background:#201E1D; color:#fff; }
  .btns { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
  iframe { width:100%; height:80vh; border:1px solid #d8d6d5; background:#fff; }
  .msg { display:none; margin-top:14px; padding:12px 14px; border-left:3px solid #EC3013; background:#fff; font-size:14px; }
  .msg.show { display:block; } .msg.ok { border-left-color:#201E1D; }
  .count { background:#fff; border-left:3px solid #EC3013; padding:10px 14px; margin-top:16px; font-size:14px; }
</style></head><body>
<header><b>THE KV PULSE — ${esc(edition.monthName).toUpperCase()}</b><span>${edition.live ? "Live data" : "⚠ FALLBACK DATA — do not release"}</span></header>
<div class="wrap">
  <div>
    <h1>Review &amp; release.</h1>
    <div class="muted">Composed just now from live listings. Write this month's note, test it on yourself, then release. Nothing sends until you press the red button.</div>
    <div class="count"><b>${subCount}</b> subscriber${subCount === 1 ? "" : "s"} will receive this.</div>
    <textarea id="note" placeholder="Your note for the top of this edition. Two to four sentences in your voice — what you're actually seeing out there this month."></textarea>
    <textarea id="expert" style="min-height:130px" placeholder="Expert Watch — optional. Forecast vs. reality, receipts included. Separate paragraphs with a blank line; a final paragraph starting with 'Sources:' renders small. Leave empty to omit the section."></textarea>
    <div class="btns">
      <button class="btn ghost" onclick="act('test')">Send test to me</button>
      <button class="btn ghost" onclick="refresh()">Update preview</button>
      <button class="btn primary" onclick="release()">Release to subscribers</button>
    </div>
    <div class="msg" id="msg"></div>
  </div>
  <div><iframe id="pv"></iframe></div>
</div>
<script>
var KEY=${JSON.stringify(key)};
var FS=${JSON.stringify(F)};
var BASE=${JSON.stringify(preview)};
function refresh(){
  fetchPreviewLocal(document.getElementById('note').value, document.getElementById('expert').value);
}
function fetchPreviewLocal(n, ew){
  var html=BASE;
  if(n&&n.trim()){
    var block='<div style="border-left:3px solid #EC3013;padding:2px 0 2px 14px;margin:0 0 22px"><p style="font:400 15px/1.6 '+FS+';color:#201E1D;margin:0;white-space:pre-line">'+escapeHtml(n)+'</p><p style="font:600 12px/1 '+FS+';color:#6b6867;margin:10px 0 0">— Jason</p></div>';
    html=html.replace('<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>', block+'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>');
  }
  if(ew&&ew.trim()){
    var ews='<div style="font:600 11px/1 '+FS+';letter-spacing:.14em;text-transform:uppercase;color:#EC3013;margin-top:26px;border-top:3px solid #EC3013;padding-top:13px">Expert Watch</div>';
    var pars=ew.split(/\\n\\s*\\n/);
    for(var i=0;i<pars.length;i++){
      var t=pars[i].trim(); if(!t)continue;
      ews += t.toLowerCase().indexOf('sources:')===0
        ? '<p style="font:400 11px/1.6 '+FS+';color:#6b6867;margin:10px 0 0">'+escapeHtml(t)+'</p>'
        : '<p style="font:400 14px/1.6 '+FS+';color:#201E1D;margin:10px 0 0;white-space:pre-line">'+escapeHtml(t)+'</p>';
    }
    var anchor='<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td style="background:#201E1D';
    html=html.replace(anchor, ews+anchor);
  }
  document.getElementById('pv').srcdoc=html;
}
function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function act(a){
  post({action:a,note:document.getElementById('note').value,expertWatch:document.getElementById('expert').value},'Sending test…');
}
function release(){
  var n=document.getElementById('note').value;
  if(!n.trim()&&!confirm('No personal note this month — release anyway?'))return;
  if(!confirm('Release to ${subCount} subscriber${subCount === 1 ? "" : "s"}? This cannot be unsent.'))return;
  post({action:'release',note:n,expertWatch:document.getElementById('expert').value},'Releasing…');
}
function post(body,busy){
  var m=document.getElementById('msg');m.className='msg show';m.textContent=busy;
  body.key=KEY;
  fetch(location.pathname+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  .then(function(r){return r.json()}).then(function(j){
    if(j.error){m.textContent=j.error;return}
    m.className='msg show ok';
    m.textContent=j.msg||('Released. Sent: '+j.sent+(j.failed&&j.failed.length?' · Issues: '+j.failed.join('; '):''));
  }).catch(function(e){m.textContent=String(e)});
}
fetchPreviewLocal('');
</script></body></html>`;
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }
