/**
 * Match Alerts worker — the "NEW best match" engine behind the KV Personality Test.
 * Daily cron scans subscribers (KV quizsub:*) against the shared listings cache and emails
 * a new match only when: the last match sold/delisted OR a new listing beats it by a real
 * margin — and never more than once per subscriber per 6 days. Resend-limit safe (max 50/run).
 *
 * Setup: create worker "ironclad-alerts" → paste this → Settings:
 *   Variables: RESEND_API_KEY (secret), FUB_API_KEY (secret), UNSUB_SECRET (secret — SAME value
 *              as the Pages project's UNSUB_SECRET), SITE_URL = https://ironcladrealty.ca
 *   Bindings: KV namespace binding, variable name LEADS → namespace ironclad-leads
 *   Trigger:  cron 0 13 * * *   (daily ~10 a.m. Atlantic)
 * Test: worker-url/?key=<UNSUB_SECRET>          → dry run report (no emails)
 *       worker-url/?key=<UNSUB_SECRET>&send=1   → real run
 */
const MARGIN = 8, MIN_DAYS = 6, MAX_SENDS = 50;

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(run(env, true)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.UNSUB_SECRET || url.searchParams.get("key") !== env.UNSUB_SECRET) return new Response("Ironclad match-alerts worker.", { status: 200 });
    const report = await run(env, url.searchParams.get("send") === "1");
    return new Response(JSON.stringify(report, null, 2), { headers: { "Content-Type": "application/json" } });
  }
};

async function run(env, send) {
  const report = { checked: 0, sent: 0, skipped: [], errors: [] };
  if (!env.LEADS) { report.errors.push("no LEADS KV binding"); return report; }
  let cache; try { cache = await env.LEADS.get("listings:cache", "json"); } catch {}
  const listings = (cache && cache.listings) || [];
  if (!listings.length) { report.errors.push("listings cache empty — visit the site or /api/listings first"); return report; }
  const activeMls = new Set(listings.map(l => l.mls));

  let cursor;
  const subs = [];
  for (let i = 0; i < 20; i++) {
    const page = await env.LEADS.list({ prefix: "quizsub:", cursor });
    subs.push(...page.keys.map(k => k.name));
    if (page.list_complete) break; cursor = page.cursor;
  }

  for (const key of subs) {
    if (report.sent >= MAX_SENDS) { report.errors.push("hit per-run send cap"); break; }
    report.checked++;
    let sub; try { sub = await env.LEADS.get(key, "json"); } catch { continue; }
    if (!sub || !sub.profile) continue;
    const days = sub.lastSent ? (Date.now() - new Date(sub.lastSent).getTime()) / 86400000 : 99;
    const best = pickBest(listings, sub.profile);
    if (!best) { report.skipped.push(sub.email + ": no match"); continue; }
    const lastGone = sub.lastMls && !activeMls.has(sub.lastMls);
    const beats = sub.lastScore == null || best._score > sub.lastScore + MARGIN;
    const isNewMls = best.mls !== sub.lastMls;
    if (!isNewMls) { report.skipped.push(sub.email + ": same match holds"); continue; }
    if (!(lastGone || beats)) { report.skipped.push(sub.email + ": no trigger"); continue; }
    if (days < MIN_DAYS) { report.skipped.push(sub.email + ": cooldown"); continue; }

    if (send) {
      const unsub = (env.SITE_URL || "https://ironcladrealty.ca") + "/api/quiz-match?e=" + encodeURIComponent(sub.email) + "&t=" + (await sign(env, sub.email));
      const html = renderAlert(sub.profile, best, env.SITE_URL || "https://ironcladrealty.ca", unsub, lastGone);
      const subject = (lastGone ? "Your match sold — here's the new one: " : "New best match: ") + (best.street ? best.street + ", " + best.city : best.city);
      const ok = await sendEmail(env, sub.email, subject, html);
      if (ok) {
        report.sent++;
        sub.lastMls = best.mls; sub.lastScore = best._score; sub.lastSent = new Date().toISOString();
        try { await env.LEADS.put(key, JSON.stringify(sub)); } catch {}
      } else report.errors.push(sub.email + ": send failed");
    } else { report.sent++; report.skipped.push(sub.email + ": WOULD send " + best.mls + " (dry run)"); }
  }
  return report;
}

/* ---- mirrored from functions/api/quiz-match.js — keep in sync ---- */
function pickBest(listings, p) {
  const ranked = (listings || []).map(l => {
    if (!l.price) return null;
    if (l.price > p.budget * 1.2) return null;
    if (l.beds != null && p.beds >= 3 && l.beds < p.beds - 1) return null;
    let s = 100;
    const ai = p.top3.indexOf(l.areaId);
    s -= ai === -1 ? 30 : ai * 8;
    s -= Math.abs(l.price - p.budget * 0.95) / p.budget * 40;
    const d = (l.desc || "") + " " + (l.style || "");
    if (p.prefs.water >= 3 && /water|river|lake|ocean|beach|kennebecasis/i.test(d)) s += 6;
    if (p.prefs.space >= 3 && (/acre|acreage|private lot|large lot/i.test(d) || (l.sqft && l.sqft > 2200))) s += 4;
    if (p.prefs.heritage >= 3 && /century|character|heritage|original (?:wood|trim|floors)/i.test(d)) s += 4;
    if (p.prefs.heritage <= 1 && /new construction|newly built|brand new/i.test(d)) s += 3;
    if (l.isNew) s += 3;
    if (!l.addressOk) s -= 5;
    return { ...l, _score: Math.round(s * 10) / 10 };
  }).filter(Boolean).sort((a, b) => b._score - a._score || a.price - b.price);
  return ranked[0] || null;
}
function renderAlert(p, best, site, unsubUrl, soldOut) {
  const F = "Archivo,'Helvetica Neue',Arial,sans-serif";
  const money = n => "$" + Math.round(n).toLocaleString("en-CA");
  const img = best.images && best.images.length ? '<img src="https://cdn.repliers.io/' + best.images[0] + '?class=large" alt="" style="width:100%;display:block">' : "";
  return '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#F3F2F2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" style="max-width:600px;width:100%">' +
    '<tr><td style="background:#201E1D;padding:16px 28px"><img src="' + site + '/assets/img/lockup-white.png" height="30" alt="Ironclad Realty Group" style="height:30px;width:auto;display:block"></td></tr>' +
    '<tr><td style="background:#EC3013;padding:24px 28px"><div style="font:600 11px/1 ' + F + ';letter-spacing:.14em;text-transform:uppercase;color:#fff;opacity:.85">Match alert</div>' +
    '<div style="font:800 22px/1.15 ' + F + ';color:#fff;margin-top:8px">' + (soldOut ? "Your match is gone. Meet the new one." : "A better match just hit the market.") + '</div></td></tr>' +
    '<tr><td style="background:#fff;padding:24px 28px 28px"><div style="border:1px solid #e2e0df">' + img +
    '<div style="padding:18px 20px"><div style="font:800 22px/1.1 ' + F + '">' + money(best.price) + '</div>' +
    '<div style="font:600 14px/1.3 ' + F + ';margin-top:4px">' + esc(best.addressOk && best.street ? best.street + ", " + best.city : (best.type || "Home") + " in " + best.city + " — address on request") + '</div>' +
    '<div style="font:400 12px/1.4 ' + F + ';color:#6b6867;margin-top:2px">' + [best.beds != null ? best.beds + " bed" : null, best.baths != null ? best.baths + " bath" : null, best.sqft ? Math.round(best.sqft).toLocaleString("en-CA") + " sq ft" : null].filter(Boolean).join(" · ") + '</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr><td style="background:#EC3013"><a href="tel:+15066083333" style="display:inline-block;padding:12px 18px;font:600 12px/1 ' + F + ';letter-spacing:.1em;text-transform:uppercase;color:#fff;text-decoration:none">See it — 506-608-3333</a></td></tr></table>' +
    '<p style="font:400 10px/1.5 ' + F + ';color:#6b6867;margin:14px 0 0">Listed by ' + esc(best.office || "the listing brokerage") + (best.mls ? ' · MLS® ' + best.mls : "") + '</p></div></div>' +
    '<p style="font:400 12px/1.5 ' + F + ';color:#6b6867;margin:14px 0 0">Matched to your KV Personality Test answers. At most one of these a week. Tastes changed? Retake: ' + site + '/quiz/</p></td></tr>' +
    '<tr><td style="background:#201E1D;padding:16px 28px"><p style="font:400 10px/1.6 ' + F + ';color:#8f8c8b;margin:0">Jason Hinchliffe — REALTOR® · Ironclad Realty Group · Brokered by eXp Realty Canada — NB. MLS® marks owned by CREA; information deemed reliable, not guaranteed. <a style="color:#8f8c8b" href="' + unsubUrl + '">Unsubscribe</a></p></td></tr>' +
    '</table></td></tr></table></body></html>';
}
async function sign(env, email) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.UNSUB_SECRET || "set-a-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY) return false;
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.SNAPSHOT_FROM || "Jason Hinchliffe <jason@ironcladrealty.ca>", to: [to], reply_to: "jason@ironcladrealty.ca", subject, html }) });
  return r.ok;
}
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
