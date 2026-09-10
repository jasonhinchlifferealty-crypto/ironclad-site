/**
 * /api/quiz-match — the reveal + alert subscription.
 * POST: profile + email (checkbox = express consent to recurring alerts) → best current listing
 *       scored from the shared listings cache → branded reveal email → KV subscribe → FUB relay.
 * GET ?e=<email>&t=<sig>: one-click unsubscribe (signed with UNSUB_SECRET).
 * Reads the same LEADS-KV listings cache the map uses (a Pages Function cannot fetch its own
 * /api/listings — same-zone rule — so it reads the cache directly; graceful if cold).
 */

export async function onRequestPost(context) {
  const { request, env } = context;
  let b; try { b = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (b.website) return json({ ok: true });

  const email = String(b.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Valid email required" }, 400);
  const profile = {
    firstName: String(b.firstName || "").trim().slice(0, 60),
    areaId: String(b.areaId || ""), top3: Array.isArray(b.top3) ? b.top3.slice(0, 3).map(String) : [],
    budget: clampN(b.budget, 100000, 2000000, 380000), beds: clampN(b.beds, 1, 6, 2),
    prefs: { water: clampN(b.prefs && b.prefs.water, 0, 4, 1.5), space: clampN(b.prefs && b.prefs.space, 0, 4, 2), heritage: clampN(b.prefs && b.prefs.heritage, 0, 4, 2) },
    persona: String(b.persona || "").slice(0, 80)
  };

  const listings = await cachedListings(env);
  const best = pickBest(listings, profile);
  let dream = null;
  const d0 = pickBest(listings, profile, { ignoreBudget: true });
  if (d0 && d0.price > profile.budget * 1.2 && (!best || d0._score > best._score + 10)) dream = d0;
  const origin = new URL(request.url).origin;
  const unsub = await unsubLink(env, origin, email);
  const html = renderMatchEmail(profile, best, origin, unsub, dream);
  const strong = best && best._score >= 88;
  const subject = dream && best ? "Your match — and, honestly, your dream"
    : dream && !best ? "Your dream home exists. The budget disagrees — for now"
    : best ? (strong ? "Your match: " : "Your best available match: ") + (best.street ? best.street + ", " + best.city : "a " + (best.type || "home").toLowerCase() + " in " + best.city)
    : "Your match search is live";
  const sent = await sendEmail(env, email, subject, html);
  if (!sent.ok) return json({ error: "Couldn't send just now — try again in a minute." }, 502);

  if (env.LEADS) {
    try { await env.LEADS.put("quizsub:" + email, JSON.stringify({ email, profile, consented: new Date().toISOString(), lastMls: best ? best.mls : null, lastScore: best ? best._score : null, lastSent: new Date().toISOString() })); } catch {}
  }
  if (env.FUB_API_KEY) {
    const tags = ["Ironclad-Website", "Quiz-Lead", "Buyer", "Match-Alerts"];
    if (profile.areaId) tags.push("Area-" + profile.areaId);
    const msg = "KV Personality Test lead.\nResult: " + profile.areaId + (profile.persona ? " (" + profile.persona + ")" : "") +
      "\nTop 3: " + profile.top3.join(", ") + "\nBudget: ~$" + profile.budget.toLocaleString("en-CA") + " · Beds: " + profile.beds + "+" +
      (best ? "\nFirst match sent: " + best.street + ", " + best.city + " (MLS® " + best.mls + ") $" + Math.round(best.price).toLocaleString("en-CA") : "\nNo in-profile match at signup — subscribed for alerts.") +
      "\nExpress consent to recurring match alerts recorded.";
    context.waitUntil(fetch("https://api.followupboss.com/v1/events", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Basic " + btoa(env.FUB_API_KEY + ":") },
      body: JSON.stringify({ source: "KV-Personality-Test", system: "Ironclad Website", type: "Registration", message: msg,
        person: { firstName: profile.firstName || undefined, emails: [{ value: email }], tags } })
    }).catch(() => {}));
  }
  return json({ ok: true });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get("e") || "").toLowerCase();
  const t = url.searchParams.get("t") || "";
  const good = email && t && (await sign(env, email)) === t;
  if (good) {
    if (env.LEADS) { try { await env.LEADS.delete("quizsub:" + email); } catch {} }
    if (env.FUB_API_KEY) {
      await fetch("https://api.followupboss.com/v1/events", {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Basic " + btoa(env.FUB_API_KEY + ":") },
        body: JSON.stringify({ source: "KV-Personality-Test", system: "Ironclad Website", type: "Note", message: "Unsubscribed from match alerts.", person: { emails: [{ value: email }], tags: ["Match-Unsubscribed"] } })
      }).catch(() => {});
    }
  }
  const body = good ? "<h1>Done.</h1><p>No more match alerts. If a home hunt ever restarts, the test is at ironcladrealty.ca/quiz/.</p>"
    : "<h1>That link didn't check out.</h1><p>Reply to any match email with the word unsubscribe and it's handled by hand.</p>";
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Archivo,Arial,sans-serif;color:#201E1D;background:#F3F2F2;display:grid;place-items:center;min-height:100svh;margin:0"><div style="max-width:420px;padding:24px">' + body + "</div></body>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* ---------- shared with workers/match-alerts.js (keep in sync) ---------- */
export async function cachedListings(env) {
  if (!env.LEADS) return [];
  try { const c = await env.LEADS.get("listings:cache", "json"); return (c && c.listings) || []; } catch { return []; }
}
export function pickBest(listings, p, opts) {
  opts = opts || {};
  const prefs = p.prefs || {};
  const W_STRONG = /waterfront|water\s?front|riverfront|river\s?front|lakefront|lake\s?front|oceanfront|deeded (?:water|beach)|water access|own(?:ed)? shoreline|on the (?:river|lake|water)|steps? (?:to|from) the (?:river|lake|beach|water)/i;
  const W_WEAK = /river|lake|water|beach|ocean/i;
  const S_STRONG = /\b\d+(?:\.\d+)?\s*acres?\b|acreage/i;
  const S_WEAK = /large lot|private lot|big yard|double lot|oversized lot/i;
  const NEG = /\bas[- ]is\b|handyman|needs (?:work|tlc)|\btlc\b|fixer|sold where is|estate sale/i;
  const TURNKEY = /renovated|updated|move[- ]in ready|turnkey|new (?:roof|windows|kitchen)/i;
  const ranked = (listings || []).map(l => {
    if (!l.price) return null;
    if (!opts.ignoreBudget && l.price > p.budget * 1.2) return null;
    if (l.beds != null && p.beds >= 3 && l.beds < p.beds - 1) return null;
    let s = 100;
    const ai = p.top3.indexOf(l.areaId);
    s -= ai === -1 ? 30 : ai * 8;
    if (!opts.ignoreBudget) {
      if (l.price > p.budget) s -= (l.price - p.budget) / p.budget * 80;       // over budget bleeds fast
      else if (l.price < p.budget * 0.7) s -= (p.budget * 0.7 - l.price) / p.budget * 12; // deep-discount caution
    }
    const d = (l.desc || "") + " " + (l.style || "");
    const w = prefs.water || 0, sp = prefs.space || 0, h = prefs.heritage || 0;
    if (w >= 3.5) { if (W_STRONG.test(d)) s += 12; else if (W_WEAK.test(d)) s += 3; else s -= 14; }
    else if (w >= 2) { if (W_STRONG.test(d)) s += 6; else if (W_WEAK.test(d)) s += 2; }
    if (sp >= 3.5) { if (S_STRONG.test(d)) s += 10; else if (S_WEAK.test(d)) s += 2; else s -= 10; }
    else if (sp >= 2.5) { if (S_STRONG.test(d)) s += 5; else if (S_WEAK.test(d)) s += 2; }
    if (h >= 3) { if (/century|character|heritage|original (?:wood|trim|floors)/i.test(d)) s += 5; }
    if (h <= 1 && /new construction|newly built|brand new/i.test(d)) s += 3;
    const reno = prefs.reno == null ? 2 : prefs.reno;
    if (reno <= 1) { if (NEG.test(d)) s -= 12; if (TURNKEY.test(d)) s += 5; }
    else if (reno >= 3) { if (NEG.test(d)) s += 6; }
    const g = prefs.garage || 0;
    const hasGarage = l.garage === true || /garage/i.test(d);
    if (g >= 2) { s += hasGarage ? 5 : -6; }
    else if (g === 1 && hasGarage) s += 2;
    const tp = prefs.typePref || "";
    if (tp) {
      const st = ((l.style || "") + " " + (l.type || "")).toLowerCase();
      const isBung = /bungalow|ranch|one[- ](?:storey|story|level)/.test(st);
      const isTwo = /two[- ](?:storey|story)|2[- ]storey|storey and a half|1\.5/.test(st);
      if (tp === "bungalow") s += isBung ? 5 : (isTwo ? -4 : 0);
      if (tp === "two-storey") s += isTwo ? 5 : (isBung ? -4 : 0);
    }
    if (l.isNew) s += 3;
    if (!l.addressOk) s -= 5;
    return { ...l, _score: Math.round(s * 10) / 10 };
  }).filter(Boolean).sort((a, b) => b._score - a._score || a.price - b.price);
  return ranked[0] || null;
}
export function renderMatchEmail(p, best, site, unsubUrl, dream) {
  const strong = best && best._score >= 88;
  const F = "Archivo,'Helvetica Neue',Arial,sans-serif";
  const name = p.firstName || "there";
  const money = n => "$" + Math.round(n).toLocaleString("en-CA");
  const CREA = "The trademarks MLS®, Multiple Listing Service® and the associated logos are owned by The Canadian Real Estate Association (CREA) and identify the quality of services provided by real estate professionals who are members of CREA. Information is deemed reliable but is not guaranteed accurate.";
  let core;
  if (best) {
    const img = best.images && best.images.length ? '<img src="https://cdn.repliers.io/' + best.images[0] + '?class=large" alt="" style="width:100%;display:block">' : "";
    const why = [];
    const ai = p.top3.indexOf(best.areaId);
    why.push(ai === 0 ? "It sits in your matched neighbourhood." : ai > 0 ? "It sits in your #" + (ai + 1) + " neighbourhood match." : "Your matched areas had nothing in range this week — this is the strongest fit nearby, and your alert is set for the moment that changes.");
    why.push("At " + money(best.price) + " it fits the budget you gave" + (best.cut ? " — and it has already cut its price once." : "."));
    if (best.beds != null) why.push(best.beds + " bedrooms against your " + p.beds + "+ requirement.");
    if (p.prefs.water >= 3 && /water|river|lake|beach/i.test(best.desc || "")) why.push("The listing itself talks about the water — which you said matters.");
    core =
      '<div style="border:1px solid #e2e0df">' + img +
      '<div style="padding:20px 22px;background:#fff">' +
      '<div style="font:800 24px/1.1 ' + F + '">' + money(best.price) + '</div>' +
      '<div style="font:600 15px/1.3 ' + F + ';margin-top:4px">' + esc(best.addressOk && best.street ? best.street + ", " + best.city : (best.type || "Home") + " in " + best.city + " — address on request") + '</div>' +
      '<div style="font:400 13px/1.4 ' + F + ';color:#6b6867;margin-top:2px">' + [best.beds != null ? best.beds + " bed" : null, best.baths != null ? best.baths + " bath" : null, best.sqft ? Math.round(best.sqft).toLocaleString("en-CA") + " sq ft" : null, best.type].filter(Boolean).join(" · ") + '</div>' +
      (best.desc ? '<p style="font:400 13px/1.55 ' + F + ';margin:12px 0 0;color:#201E1D">' + esc(best.desc.slice(0, 320)) + '…</p>' : "") +
      '<div style="font:600 11px/1 ' + F + ';letter-spacing:.12em;text-transform:uppercase;color:#6b6867;margin-top:18px;border-top:3px solid #201E1D;padding-top:12px">Why it matched your answers</div>' +
      why.map(w => '<p style="font:400 13px/1.5 ' + F + ';margin:8px 0 0">' + esc(w) + '</p>').join("") +
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>' +
      '<td style="background:#EC3013"><a href="tel:+15066083333" style="display:inline-block;padding:13px 20px;font:600 12px/1 ' + F + ';letter-spacing:.1em;text-transform:uppercase;color:#fff;text-decoration:none">See it — 506-608-3333</a></td><td width="10"></td>' +
      '<td style="border:2px solid #201E1D"><a href="' + site + '/homes-for-sale/' + (best.areaId || "") + '/" style="display:inline-block;padding:11px 20px;font:600 12px/1 ' + F + ';letter-spacing:.1em;text-transform:uppercase;color:#201E1D;text-decoration:none">More in this area</a></td></tr></table>' +
      '<p style="font:400 11px/1.5 ' + F + ';color:#6b6867;margin:16px 0 0">Listed by ' + esc(best.office || "the listing brokerage") + (best.mls ? ' · MLS® ' + best.mls : "") + '. We represent you, the buyer.</p>' +
      '</div></div>';
  } else {
    core = '<p style="font:400 15px/1.6 ' + F + '">Nothing on the market right now fits your profile inside your matched neighbourhoods — and that is worth knowing, because it means the right listing will move fast when it appears. Your alert is live: the moment a home fits your answers, it lands in this inbox with the full breakdown, usually before most buyers have noticed it.</p>';
  }
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F2F2">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F2F2"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">' +
    '<tr><td style="background:#201E1D;padding:16px 28px"><img src="' + site + '/assets/img/lockup-white.png" alt="Ironclad Realty Group" height="30" style="height:30px;width:auto;display:block"></td></tr>' +
    '<tr><td style="background:#EC3013;padding:26px 28px"><div style="font:600 11px/1 ' + F + ';letter-spacing:.14em;text-transform:uppercase;color:#fff;opacity:.85">The KV Personality Test</div>' +
    '<div style="font:800 24px/1.15 ' + F + ';color:#fff;margin-top:8px">' + (dream ? (best ? "Your match — and your dream." : "Your dream exists. The budget disagrees.") : best ? (strong ? "Your match." : "Your best available match.") : "Your search is live.") + '</div></td></tr>' +
    '<tr><td style="background:#fff;padding:26px 28px 30px">' +
    '<p style="font:400 15px/1.55 ' + F + ';margin:0 0 16px">Hi ' + esc(name) + ' — matched from your answers against every current listing, Sussex to Saint John.</p>' +
    (dream ? '<div style="font:600 11px/1 ' + F + ';letter-spacing:.14em;text-transform:uppercase;color:#EC3013;margin:0 0 10px">The one that fulfils every answer</div>' + miniCard(dream, site, F, "Above your stated range at " + money2(dream.price) + " — shown because it is what your answers actually describe. Budgets are strategies, not cages; if this is the life you meant, that is a conversation worth having.") + (best ? '<div style="font:600 11px/1 ' + F + ';letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin:22px 0 10px">The strongest fit inside your range</div>' : "") : "") +
    (best && !strong ? '<p style="font:400 13px/1.55 ' + F + ';margin:0 0 16px;padding:10px 14px;border-left:3px solid #EC3013;background:#F3F2F2">Straight answer first: nothing on the market today nails your profile — a match is only ever as good as current inventory. This is the strongest fit from what is actually for sale right now. Inventory turns over weekly, your alert is live, and the moment something closer to your answers lists, it lands here first.</p>' : "") +
    core +
    '<p style="font:400 13px/1.55 ' + F + ';color:#6b6867;margin:18px 0 0">You will hear from us again only when a better match appears or this one sells — at most once a week. Retake the test any time your tastes shift: ' + site + '/quiz/</p>' +
    '</td></tr>' +
    '<tr><td style="background:#201E1D;padding:20px 28px"><p style="font:400 12px/1.7 ' + F + ';color:#fff;margin:0"><strong style="font-weight:800">Jason Hinchliffe</strong> — REALTOR®<br>Ironclad Realty Group · Brokered by eXp Realty Canada — New Brunswick<br>506-608-3333 · ironcladrealty.ca</p>' +
    '<p style="font:400 10px/1.6 ' + F + ';color:#8f8c8b;margin:12px 0 0">' + CREA + ' You subscribed to match alerts via the KV Personality Test. <a href="' + unsubUrl + '" style="color:#8f8c8b">Unsubscribe</a> — one click, no questions.</p></td></tr>' +
    '</table></td></tr></table></body></html>';
}
export async function sign(env, email) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.UNSUB_SECRET || "set-a-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function unsubLink(env, origin, email) { return origin + "/api/quiz-match?e=" + encodeURIComponent(email) + "&t=" + (await sign(env, email)); }
async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return { ok: false };
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.SNAPSHOT_FROM || "Jason Hinchliffe <jason@ironcladrealty.ca>", to: [to], reply_to: "jason@ironcladrealty.ca", subject, html }) });
  return { ok: r.ok };
}
export function miniCard(l, site, F, note) {
  const img = l.images && l.images.length ? '<img src="https://cdn.repliers.io/' + l.images[0] + '?class=large" alt="" style="width:100%;display:block">' : "";
  return '<div style="border:1px solid #e2e0df">' + img + '<div style="padding:16px 18px;background:#fff">' +
    '<div style="font:800 20px/1.1 ' + F + '">' + money2(l.price) + '</div>' +
    '<div style="font:600 14px/1.3 ' + F + ';margin-top:3px">' + esc(l.addressOk && l.street ? l.street + ", " + l.city : (l.type || "Home") + " in " + l.city + " — address on request") + '</div>' +
    '<div style="font:400 12px/1.4 ' + F + ';color:#6b6867;margin-top:2px">' + [l.beds != null ? l.beds + " bed" : null, l.baths != null ? l.baths + " bath" : null, l.sqft ? Math.round(l.sqft).toLocaleString("en-CA") + " sq ft" : null, l.type].filter(Boolean).join(" · ") + '</div>' +
    (note ? '<p style="font:400 12px/1.5 ' + F + ';color:#201E1D;margin:10px 0 0;border-left:3px solid #EC3013;padding-left:10px">' + esc(note) + '</p>' : "") +
    '<p style="font:400 10px/1.5 ' + F + ';color:#6b6867;margin:12px 0 0">Listed by ' + esc(l.office || "the listing brokerage") + (l.mls ? " · MLS® " + l.mls : "") + '</p>' +
    '</div></div>';
}
export function money2(n) { return "$" + Math.round(n).toLocaleString("en-CA"); }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function clampN(v, lo, hi, d) { const n = parseFloat(v); return isNaN(n) ? d : Math.min(hi, Math.max(lo, n)); }
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }
