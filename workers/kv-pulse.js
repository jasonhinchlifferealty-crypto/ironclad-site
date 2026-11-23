/**
 * The Ironclad Market Pulse — subscriber email. Standalone Cloudflare Worker (name: ironclad-pulse).
 *
 * Fully automatic. Each morning the cron reads the edition list on the site
 * (SITE_URL/pulse/editions.json). When the newest edition has not been emailed yet, the worker
 * sends a short announcement to every subscriber and a report to Jason.
 *
 * Safety rules, in order:
 *   - No storage attached (LEADS)            -> nothing is ever sent.
 *   - Edition marked "email": false          -> never sent (Edition 1 is marked this way).
 *   - Edition page or PDF not live yet       -> wait, try again tomorrow, warn Jason once.
 *   - Every address is recorded in storage as it is sent, so no one gets an edition twice,
 *     even if a run is interrupted or the list is larger than one run can send.
 *   - If the email service is down, the run stops and the rest go out at the next check.
 *
 * Subscribers = Follow Up Boss contacts tagged KV-Pulse-Subscriber, minus anyone tagged
 * Pulse-Unsubscribed. (The tag names are unchanged from the old KV Pulse on purpose.)
 * Every email carries a signed one-click unsubscribe that adds Pulse-Unsubscribed in FUB.
 *
 * Status page:  https://<worker-url>/?key=YOUR_PULSE_KEY
 *   Shows the newest edition, whether it has been emailed, and the subscriber count.
 *   "Send test to me" emails the newest edition to Jason only. "Check now" runs the daily check.
 *
 * Variables (Worker > Settings > Variables; mark keys as Secret):
 *   RESEND_API_KEY   required
 *   FUB_API_KEY      required
 *   PULSE_KEY        required — the private word for the status page
 *   UNSUB_SECRET     required — signs unsubscribe links (do not change it: old links would break)
 *   SITE_URL         default https://ironcladrealty.ca
 *   PULSE_FROM       default "Ironclad Realty Group <jason@ironcladrealty.ca>"
 *   PULSE_ADMIN      default jason@ironcladrealty.ca (where reports, warnings and tests go)
 * Binding (Worker > Settings > Bindings):
 *   LEADS            required — KV namespace (the existing ironclad-leads). Records what was sent.
 *
 * Cron trigger: 0 12,13,14 * * *   (three checks each morning: 8, 9 and 10 a.m. Atlantic in
 * winter, an hour later in summer). This is ONE trigger with three times, not three triggers.
 *
 * Limits this is built around: Cloudflare's free plan allows 50 outside requests per run, and
 * Resend's free tier sends 100 emails a day. So each run emails at most 25 subscribers, which
 * is 75 a day; a larger list carries over to the following mornings automatically. When the
 * list passes about 75, tell Claude: the fix is a paid Resend or Cloudflare plan and a higher cap.
 */

const F = "Archivo,'Helvetica Neue',Arial,sans-serif";
const PER_RUN_CAP = 25;
const ADDRESS = "380 Main Street, Sussex, NB E4E 1S2";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).catch(err => console.error("pulse run failed:", err && err.message)));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/unsub") return handleUnsub(url, env);

    if ((env.PULSE_KEY || "") === "" || url.searchParams.get("key") !== env.PULSE_KEY) {
      return new Response("The Ironclad Market Pulse worker. Emails each new edition once.", { status: 200 });
    }

    if (request.method === "POST") {
      let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
      if (body.action === "test") {
        const m = await loadEditions(env);
        if (!m.latest) return json({ error: m.error || "No edition found." }, 502);
        const admin = adminOf(env);
        const r = await sendOne(env, admin, m.latest, url.origin, true, "");
        return json(r.ok ? { ok: true, msg: "Test of Edition " + m.latest.n + " sent to " + admin } : { error: r.note }, r.ok ? 200 : 502);
      }
      if (body.action === "run") {
        try { return json({ ok: true, result: await run(env, url.origin) }); }
        catch (err) { return json({ error: String(err && err.message || err) }, 502); }
      }
      return json({ error: "unknown action" }, 400);
    }

    return new Response(await statusPage(env, url), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
};

/* ---------------- the daily check ---------------- */
function siteOf(env) { return String(env.SITE_URL || "https://ironcladrealty.ca").replace(/\/+$/, ""); }
function adminOf(env) { return env.PULSE_ADMIN || "jason@ironcladrealty.ca"; }
function workerOriginOf(env, origin) { return origin || env.WORKER_URL || "https://ironclad-pulse.jasonhinchlifferealty.workers.dev"; }
const sentKey = n => "pulse-email:sent:" + n;
const warnKey = n => "pulse-email:warned:" + n;

async function loadEditions(env) {
  const site = siteOf(env);
  let r;
  try { r = await fetch(site + "/pulse/editions.json?t=" + Date.now(), { headers: { "Cache-Control": "no-cache" } }); }
  catch (e) { return { error: "Could not reach " + site + "/pulse/editions.json" }; }
  if (!r.ok) return { error: "Edition list not found on the site (HTTP " + r.status + ")." };
  let j; try { j = await r.json(); } catch { return { error: "Edition list on the site is not valid JSON." }; }
  const list = (j.editions || []).filter(e => e && Number.isInteger(e.n));
  if (!list.length) return { error: "Edition list is empty." };
  const latest = list.slice().sort((a, b) => b.n - a.n)[0];
  const abs = p => /^https?:\/\//.test(p) ? p : site + p;
  latest.pageUrl = abs(String(latest.url || ""));
  latest.pdfUrl = abs(String(latest.pdf || ""));
  latest.site = site;
  return { latest, count: list.length };
}

function missingFields(ed) {
  const need = ["headline", "key", "keyLine", "url", "pdf", "dataTo"];
  const miss = need.filter(k => !String(ed[k] || "").trim());
  if (!Array.isArray(ed.points) || ed.points.length < 1) miss.push("points");
  return miss;
}

async function run(env, origin) {
  if (!env.LEADS) return { status: "blocked", reason: "No storage attached (LEADS binding). Nothing sent." };
  const m = await loadEditions(env);
  if (!m.latest) return { status: "no-edition-list", reason: m.error };
  const ed = m.latest;
  if (ed.email === false) return { status: "skip", edition: ed.n, reason: "Edition " + ed.n + " is marked not for email." };

  let rec = await env.LEADS.get(sentKey(ed.n), "json");
  if (rec && rec.status === "sent") return { status: "already-sent", edition: ed.n, sent: rec.done.length };

  // Never announce an edition whose page or PDF is not live.
  const problems = [];
  const miss = missingFields(ed);
  if (miss.length) problems.push("the edition list entry is missing: " + miss.join(", "));
  else {
    for (const [label, u] of [["summary page", ed.pageUrl], ["PDF", ed.pdfUrl]]) {
      try { const r = await fetch(u, { method: "GET", redirect: "follow" }); if (!r.ok) problems.push("the " + label + " returned HTTP " + r.status); }
      catch { problems.push("the " + label + " could not be reached"); }
    }
  }
  if (problems.length) {
    if (!(await env.LEADS.get(warnKey(ed.n)))) {
      await env.LEADS.put(warnKey(ed.n), new Date().toISOString(), { expirationTtl: 60 * 60 * 24 * 60 });
      await sendAdmin(env, "Market Pulse Edition " + ed.n + " was NOT emailed", "<p>Edition " + ed.n + " is in the edition list, but " + esc(problems.join("; ")) + ".</p><p>Nothing was sent to subscribers. The worker checks again each morning and sends once this is fixed. You will not get this warning again for this edition.</p>");
    }
    return { status: "waiting", edition: ed.n, reason: problems.join("; ") };
  }

  const subs = await subscribers(env);           // throws if Follow Up Boss is unreachable: nothing recorded, retry tomorrow
  if (!rec) rec = { status: "sending", startedAt: new Date().toISOString(), done: [], failed: [] };
  const done = new Set(rec.done);
  const todo = subs.filter(s => !done.has(s.email));
  const workerOrigin = workerOriginOf(env, origin);

  let sentToday = 0, attempts = 0, stoppedEarly = ""; const failedToday = [];
  for (const s of todo) {
    if (attempts >= PER_RUN_CAP) break;
    attempts++;
    // Record first, then send: an interrupted run can skip one person, but can never email anyone twice.
    rec.done.push(s.email);
    await env.LEADS.put(sentKey(ed.n), JSON.stringify(rec));
    const r = await sendOne(env, s.email, ed, workerOrigin, false, s.firstName);
    if (r.ok) { sentToday++; continue; }
    if (r.transient) {            // email service unavailable: un-record this address, stop, resume at the next check
      rec.done.pop(); stoppedEarly = r.note;
      break;
    }
    failedToday.push(s.email + " (" + r.note + ")"); rec.failed.push(s.email);   // rejected address: do not retry
  }
  const remaining = subs.filter(s => !rec.done.includes(s.email)).length;
  rec.status = remaining ? "partial" : "sent";
  rec.updatedAt = new Date().toISOString();
  await env.LEADS.put(sentKey(ed.n), JSON.stringify(rec));

  const lines = ["<p><strong>Edition " + ed.n + ": " + esc(ed.headline) + "</strong></p>",
    "<p>Emailed to " + sentToday + " subscriber" + (sentToday === 1 ? "" : "s") + " in this run. Total so far: " + (rec.done.length - rec.failed.length) + " of " + subs.length + ".</p>"];
  if (stoppedEarly) lines.push("<p>Sending stopped early because the email service was unavailable (" + esc(stoppedEarly) + "). The rest go out at the next check.</p>");
  else if (remaining) lines.push("<p>" + remaining + " still to send. They go out at the next checks.</p>");
  if (failedToday.length) lines.push("<p>Could not be sent (they will not be retried automatically):<br>" + failedToday.map(esc).join("<br>") + "</p>");
  lines.push('<p><a href="' + ed.pageUrl + '">' + esc(ed.pageUrl) + "</a></p>");
  if (sentToday || failedToday.length || rec.status === "sent") {
    await sendAdmin(env, "Market Pulse Edition " + ed.n + " emailed to " + sentToday + " subscriber" + (sentToday === 1 ? "" : "s"), lines.join(""));
  }

  return { status: rec.status, edition: ed.n, sentToday, failed: failedToday, remaining, subscribers: subs.length, stoppedEarly };
}

/* ---------------- render ---------------- */
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function renderEmail(ed, unsubUrl, firstName) {
  const points = (ed.points || []).slice(0, 4).map(p =>
    `<tr><td valign="top" style="padding:9px 10px 0 0;font:800 14px/1.5 ${F};color:#EC3013">&bull;</td><td style="padding:9px 0 0;font:400 15px/1.55 ${F};color:#201E1D">${esc(p)}</td></tr>`).join("");

  return `<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(ed.headline)}</title></head><body style="margin:0;padding:0;background:#F3F2F2">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(ed.key)} ${esc(ed.keyLine)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F2F2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#201E1D;padding:16px 28px"><img src="${ed.site}/assets/img/lockup-white.png" alt="Ironclad Realty Group" height="30" style="height:30px;width:auto;display:block"></td></tr>
  <tr><td style="background:#EC3013;padding:26px 28px 28px">
    <div style="font:600 11px/1.4 ${F};letter-spacing:.14em;text-transform:uppercase;color:#ffffff;opacity:.85">The Ironclad Market Pulse &middot; Edition ${esc(ed.n)}</div>
    <div style="font:800 26px/1.12 ${F};color:#ffffff;margin-top:10px">${esc(ed.headline)}</div>
    <div style="font:400 12px/1.4 ${F};color:#ffffff;opacity:.85;margin-top:10px">New Brunswick housing market &middot; MLS&reg; and public data to ${esc(ed.dataTo)}</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:28px 28px 32px">
    ${firstName ? `<p style="font:400 15px/1.55 ${F};color:#201E1D;margin:0 0 18px">Hi ${esc(firstName)},</p>` : ""}
    <p style="font:400 15px/1.55 ${F};color:#201E1D;margin:0 0 18px">This month's edition is out.</p>
    <div style="font:800 54px/1 ${F};letter-spacing:-.02em;color:#EC3013">${esc(ed.key)}</div>
    <p style="font:600 16px/1.4 ${F};color:#201E1D;margin:10px 0 0">${esc(ed.keyLine)}</p>

    <div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin-top:26px;border-top:3px solid #201E1D;padding-top:13px">In this edition</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${points}</table>

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr>
      <td style="background:#EC3013"><a href="${ed.pageUrl}" style="display:inline-block;padding:14px 22px;font:600 12px/1 ${F};letter-spacing:.1em;text-transform:uppercase;color:#ffffff;text-decoration:none;white-space:nowrap">Read the summary</a></td>
    </tr></table>
    <p style="font:400 14px/1.5 ${F};color:#201E1D;margin:14px 0 0">Or open the <a href="${ed.pdfUrl}" style="color:#201E1D;text-decoration:underline;font-weight:600">full report (PDF)</a>.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px"><tr><td style="background:#201E1D;padding:20px 22px">
      <div style="font:800 17px/1.25 ${F};color:#ffffff">The provincial number is not your street's number.</div>
      <p style="font:400 13px/1.5 ${F};color:#c9c7c6;margin:8px 0 14px">The live market map shows asking prices, inventory and activity for every neighbourhood from Sussex to Saint John. Pick yours, then ask for a street-level equity snapshot for your address.</p>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:#EC3013"><a href="${ed.site}/#pulse" style="display:inline-block;padding:12px 18px;font:600 12px/1 ${F};letter-spacing:.1em;text-transform:uppercase;color:#ffffff;text-decoration:none;white-space:nowrap">Open the map</a></td>
      </tr></table>
      <p style="font:400 13px/1.5 ${F};color:#c9c7c6;margin:12px 0 0">Or call or text <a href="tel:+15066083333" style="color:#ffffff;text-decoration:underline;font-weight:600;white-space:nowrap">506-608-3333</a>.</p>
    </td></tr></table>
  </td></tr>
  <tr><td style="background:#201E1D;padding:20px 28px">
    <p style="font:400 12px/1.7 ${F};color:#ffffff;margin:0"><strong style="font-weight:800">Jason Hinchliffe</strong> &mdash; REALTOR&reg;<br>Ironclad Realty Group &middot; Brokered by eXp Realty Canada &mdash; New Brunswick<br>${ADDRESS}<br>506-608-3333 &middot; jason@ironcladrealty.ca &middot; ironcladrealty.ca</p>
    <p style="font:400 11px/1.6 ${F};color:#8f8c8b;margin:12px 0 0">You are receiving the Ironclad Market Pulse because you subscribed at ironcladrealty.ca. <a href="${unsubUrl}" style="color:#8f8c8b;text-decoration:underline">Unsubscribe</a> any time: one click, no questions.</p>
    <p style="font:400 11px/1.6 ${F};color:#8f8c8b;margin:10px 0 0">Figures are derived from MLS&reg; and listing data as of the report date, are not appraisals, and should be verified before any financial decision. Forecasts are estimates with stated ranges and are not guarantees. These opinions are those of Ironclad and do not necessarily represent the opinions of eXp.</p>
    <p style="font:400 11px/1.6 ${F};color:#8f8c8b;margin:10px 0 0">The trademarks MLS&reg;, Multiple Listing Service&reg; and the associated logos are owned by The Canadian Real Estate Association (CREA) and identify the quality of services provided by real estate professionals who are members of CREA. The trademarks REALTOR&reg;, REALTORS&reg; and the REALTOR&reg; logo are controlled by CREA and identify real estate professionals who are members of CREA.</p>
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
    if (!r.ok) throw new Error("Follow Up Boss returned " + r.status + " when listing subscribers");
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
  const seen = {}; return out.filter(s => (seen[s.email] ? false : (seen[s.email] = true)));
}

async function sendOne(env, email, ed, workerOrigin, isTest, firstName) {
  if (!env.RESEND_API_KEY) return { ok: false, note: "RESEND_API_KEY not set" };
  const token = await sign(env, email);
  const unsubUrl = `${workerOrigin}/unsub?e=${encodeURIComponent(email)}&t=${token}`;
  const subject = (isTest ? "[TEST] " : "") + `${ed.headline} (Ironclad Market Pulse, Edition ${ed.n})`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.PULSE_FROM || "Ironclad Realty Group <jason@ironcladrealty.ca>", to: [email], reply_to: "jason@ironcladrealty.ca",
        subject, html: renderEmail(ed, unsubUrl, firstName || ""),
        headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
      })
    });
    if (!r.ok) return { ok: false, note: "Resend " + r.status, transient: r.status === 429 || r.status >= 500 };
    return { ok: true };
  } catch (e) { return { ok: false, note: "Resend unreachable", transient: true }; }
}

async function sendAdmin(env, subject, html) {
  if (!env.RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.PULSE_FROM || "Ironclad Realty Group <jason@ironcladrealty.ca>", to: [adminOf(env)], subject, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#201E1D">${html}</div>` })
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
      body: JSON.stringify({ source: "KV-Pulse", system: "Ironclad Website", type: "Note", message: "Unsubscribed from the Ironclad Market Pulse via email link.", person: { emails: [{ value: email }], tags: ["Pulse-Unsubscribed"] } })
    }).catch(() => {});
  }
  const body = good
    ? `<h1 style="font-weight:800">Done.</h1><p>You won't receive the Ironclad Market Pulse again. If this was a mistake, reply to any past edition and we'll put you back on.</p>`
    : `<h1 style="font-weight:800">That link didn't check out.</h1><p>Reply to any Ironclad Market Pulse email with the word "unsubscribe" and it will be handled by hand.</p>`;
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:${F};color:#201E1D;background:#F3F2F2;display:grid;place-items:center;min-height:100svh;margin:0"><div style="max-width:420px;padding:24px">${body}</div></body>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ---------------- status page ---------------- */
async function statusPage(env, url) {
  const m = await loadEditions(env);
  const ed = m.latest;
  let state = "", subCount = "unknown", preview = "";
  if (!env.LEADS) state = "<b>Storage is not attached.</b> Nothing will be sent until the LEADS binding is added.";
  else if (!ed) state = "<b>No edition list.</b> " + esc(m.error || "");
  else if (ed.email === false) state = "Edition " + ed.n + " is marked not for email. Nothing will be sent for it.";
  else {
    const rec = await env.LEADS.get(sentKey(ed.n), "json");
    if (!rec) state = "Edition " + ed.n + " has not been emailed yet. It goes out at the next morning check.";
    else if (rec.status === "sent") state = "Edition " + ed.n + " was emailed to " + (rec.done.length - rec.failed.length) + " subscribers. Finished " + esc(rec.updatedAt || "") + ".";
    else state = "Edition " + ed.n + " is part-way sent (" + rec.done.length + " so far). The rest go out at the next check.";
  }
  try { subCount = (await subscribers(env)).length; } catch (e) { subCount = "could not read Follow Up Boss"; }
  if (ed && !missingFields(ed).length) preview = renderEmail(ed, "#unsubscribe-preview", "");
  const key = url.searchParams.get("key");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ironclad Market Pulse — email status</title>
<style>
  body { margin:0; font-family:${F}; background:#F3F2F2; color:#201E1D; }
  header { background:#201E1D; color:#fff; padding:14px 24px; font-weight:800; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px; display:grid; grid-template-columns:380px 1fr; gap:28px; }
  @media (max-width:900px){ .wrap { grid-template-columns:1fr; } }
  h1 { font-weight:800; font-size:24px; margin:0 0 10px; letter-spacing:-.02em; }
  .box { background:#fff; border-left:3px solid #EC3013; padding:12px 14px; margin-top:14px; font-size:14px; line-height:1.5; }
  .btn { display:inline-block; border:2px solid #201E1D; padding:12px 18px; font-weight:600; font-size:12px; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; background:none; color:#201E1D; }
  .btn:hover { background:#201E1D; color:#fff; }
  .btns { display:flex; gap:10px; margin-top:16px; flex-wrap:wrap; }
  iframe { width:100%; height:82vh; border:1px solid #d8d6d5; background:#fff; }
  .muted { color:#6b6867; font-size:13px; line-height:1.5; }
  #msg { display:none; } #msg.show { display:block; }
</style></head><body>
<header>THE IRONCLAD MARKET PULSE — EMAIL STATUS</header>
<div class="wrap"><div>
  <h1>${ed ? "Edition " + esc(ed.n) : "No edition found"}</h1>
  <div class="muted">${ed ? esc(ed.headline) : ""}</div>
  <div class="box">${state}</div>
  <div class="box">Subscribers: <b>${esc(subCount)}</b></div>
  <div class="btns">
    <button class="btn" onclick="act('test')">Send test to me</button>
    <button class="btn" onclick="act('run')">Check now (sends if due)</button>
  </div>
  <div class="box" id="msg"></div>
  <p class="muted" style="margin-top:18px">"Send test to me" emails this edition to you only. "Check now" does what the morning check does: if the newest edition has not been emailed, it is sent to subscribers.</p>
</div><div><iframe title="Email preview" srcdoc="${esc(preview)}"></iframe></div></div>
<script>
function act(a){
  var m=document.getElementById('msg'); m.className='box show'; m.textContent='Working…';
  fetch(location.pathname+'?key=${encodeURIComponent(key)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:a})})
    .then(function(r){return r.json()}).then(function(j){ m.textContent = j.error ? ('Problem: '+j.error) : (j.msg || JSON.stringify(j.result)); })
    .catch(function(){ m.textContent='Could not reach the worker.'; });
}
</script></body></html>`;
}

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }
