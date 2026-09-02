/**
 * Street-Level Equity Snapshot engine.
 * Runs in the background after a seller lead is accepted (see api/lead.js).
 *
 * Pipeline: geocode address → pull sold comps + active competition from Repliers
 * → compute an evidence-based range → send a branded email → log the outcome to FUB.
 * Any failure at any step tags the lead "Snapshot-Manual" in FUB so Jason sends one by hand.
 *
 * Environment variables (Cloudflare Pages > Settings > Environment variables):
 *   REPLIERS_API_KEY     required for live data
 *   RESEND_API_KEY       required to send email (resend.com — free tier is plenty)
 *   SNAPSHOT_ENABLED     "true" to run this pipeline at all
 *   SNAPSHOT_FROM        e.g.  Jason Hinchliffe <jason@ironcladrealty.ca>   (domain must be verified in Resend)
 *   COMP_DISPLAY         What the consumer email shows about comparables. One of:
 *                          "none"       — the value range and aggregate stats only; no individual comps (safest)
 *                          "anonymized" — comps by type/distance/price, no addresses (default)
 *                          "full"       — comps with street names (only with written board/broker approval)
 *                        Whatever this is set to, the full comp list always goes to YOU in the FUB note.
 *   (SHOW_COMP_DETAILS   legacy: "true" behaves like COMP_DISPLAY=full)
 *   SITE_URL             defaults to https://ironcladrealty.ca
 */

const REPLIERS = "https://api.repliers.io";

/* ---------------- public entry ---------------- */
export { computeRange, renderEmailHTML, renderEmailText, sendEmail, fubNote, money };

export async function runSnapshot(env, lead) {
  // lead: { id, email, firstName, address, areaName, timeline }
  const log = (k, v) => env.LEADS?.put(`snapshot-${k}:${lead.id}`, JSON.stringify(v)).catch(() => {});
  try {
    const geo = await geocode(env, lead.address);
    if (!geo) throw new Error("Address could not be located on the map");

    const comps = await fetchComps(env, geo);
    if (!comps || comps.list.length < 3) throw new Error("Fewer than 3 comparable sales found");

    const actives = await fetchActives(env, geo).catch(() => null);
    const range = computeRange(comps.list);

    const html = renderEmailHTML(env, lead, geo, comps, actives, range);
    const text = renderEmailText(lead, comps, actives, range);
    const subject = `Your Street-Level Equity Snapshot — ${shortAddress(lead.address)}`;

    const sent = await sendEmail(env, lead, subject, html, text);
    if (!sent.ok) {
      await log("preview", { html, note: sent.note });
      throw new Error(sent.note || "Email could not be sent");
    }

    const compLines = comps.list.slice(0, 10).map(c =>
      `  ${c.street ? c.street + (c.city ? ", " + c.city : "") : (c.distKm != null ? c.distKm + " km away" : "nearby")} — ${money(c.price)}${c.dom != null ? ", " + c.dom + " DOM" : ""}${c.beds ? ", " + c.beds + "bd" : ""}`).join("\n");
    await fubNote(env, lead, ["Snapshot-Sent"],
      `Snapshot emailed automatically.\nRange: ${money(range.low)}–${money(range.high)} (midpoint ${money(range.mid)})\nBased on ${comps.list.length} sales within ${comps.radiusKm} km over ${comps.months} months.` +
      (actives ? `\nActive competition: ${actives.count} listings nearby.` : "") +
      `\n\nComps (internal — for your call):\n${compLines}`);
    await log("done", { range, comps: comps.list.length });
  } catch (err) {
    await fubNote(env, lead, ["Snapshot-Manual"],
      `Automatic snapshot FAILED — please send one manually.\nReason: ${err.message}\nAddress: ${lead.address}`);
    await log("failed", { error: err.message });
  }
}

/* ---------------- geocoding (OpenStreetMap Nominatim, free) ---------------- */
async function geocode(env, address) {
  const q = encodeURIComponent(`${address}, New Brunswick, Canada`);
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${q}`, {
    headers: { "User-Agent": "IroncladRealtySnapshot/1.0 (jason@ironcladrealty.ca)" }
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j || !j[0]) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), display: j[0].display_name };
}

/* ---------------- Repliers ---------------- */
async function repliersGet(env, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${REPLIERS}/listings?${qs}`, {
    headers: { "REPLIERS-API-KEY": env.REPLIERS_API_KEY, "Content-Type": "application/json" }
  });
  if (!r.ok) throw new Error(`Repliers ${r.status}`);
  return r.json();
}

async function fetchComps(env, geo) {
  // Widen the net until we have enough evidence: 1.5 km/6 mo → 3 km/6 mo → 3 km/12 mo → 5 km/12 mo
  const attempts = [
    { radiusKm: 1.5, months: 6 }, { radiusKm: 3, months: 6 },
    { radiusKm: 3, months: 12 }, { radiusKm: 5, months: 12 }
  ];
  for (const a of attempts) {
    const since = new Date(); since.setMonth(since.getMonth() - a.months);
    let j;
    try {
      j = await repliersGet(env, {
        lat: geo.lat, long: geo.lng, radius: a.radiusKm,
        status: "U", lastStatus: "Sld",
        minSoldDate: since.toISOString().slice(0, 10),
        class: "residential", resultsPerPage: 50, sortBy: "soldDateDesc"
      });
    } catch { continue; }
    const list = (j.listings || []).map(l => ({
      price: num(l.soldPrice),
      listPrice: num(l.listPrice),
      dom: num(l.daysOnMarket),
      beds: l.details && l.details.numBedrooms,
      type: (l.details && l.details.propertyType) || "home",
      street: l.address && [l.address.streetNumber, l.address.streetName, l.address.streetSuffix].filter(Boolean).join(" "),
      city: l.address && l.address.city,
      distKm: l.distance != null ? +(l.distance).toFixed(1) : null,
      soldDate: l.soldDate
    })).filter(c => c.price > 0);
    if (list.length >= 3) return { list, ...a };
  }
  return { list: [], radiusKm: 5, months: 12 };
}

async function fetchActives(env, geo) {
  const j = await repliersGet(env, {
    lat: geo.lat, long: geo.lng, radius: 2,
    status: "A", class: "residential", resultsPerPage: 25
  });
  const list = (j.listings || []).map(l => ({ listPrice: num(l.listPrice), dom: num(l.daysOnMarket) })).filter(a => a.listPrice > 0);
  return { count: j.count != null ? j.count : list.length, medianList: median(list.map(a => a.listPrice)), list };
}

/* ---------------- the range ---------------- */
function computeRange(comps) {
  const prices = comps.map(c => c.price).sort((a, b) => a - b);
  const n = prices.length;
  let low, high;
  if (n >= 5) { low = quantile(prices, 0.25); high = quantile(prices, 0.75); }
  else { low = prices[0]; high = prices[n - 1]; }
  return { low: round5k(low), high: round5k(high), mid: round5k(median(prices)), n };
}

/* ---------------- email ---------------- */
function renderEmailHTML(env, lead, geo, comps, actives, range) {
  const site = env.SITE_URL || "https://ironcladrealty.ca";
  const mode = (env.COMP_DISPLAY || (env.SHOW_COMP_DETAILS === "true" ? "full" : "anonymized")).toLowerCase();
  const showDetails = mode === "full";
  const name = lead.firstName || "there";
  const rows = comps.list.slice(0, 8).map(c => {
    const what = [c.beds ? c.beds + "-bed" : null, (c.type || "home").toLowerCase()].filter(Boolean).join(" ");
    const where = showDetails && c.street ? c.street + (c.city ? ", " + c.city : "") : (c.distKm != null ? c.distKm + " km away" : "nearby");
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #e2e0df;font:400 14px/1.4 Archivo,'Helvetica Neue',Arial,sans-serif;color:#201E1D">${esc(what)} &mdash; ${esc(where)}</td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #e2e0df;font:800 14px/1.4 Archivo,'Helvetica Neue',Arial,sans-serif;color:#201E1D">${money(c.price)}</td>
      <td align="right" style="padding:10px 0 10px 14px;border-bottom:1px solid #e2e0df;font:400 13px/1.4 Archivo,'Helvetica Neue',Arial,sans-serif;color:#6b6867;white-space:nowrap">${c.dom != null ? c.dom + " days" : ""}</td>
    </tr>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F2F2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F2F2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <tr><td style="background:#201E1D;padding:18px 28px">
    <img src="${site}/assets/img/lockup-white.png" alt="Ironclad Realty Group" height="34" style="height:34px;width:auto;display:block">
  </td></tr>

  <tr><td style="background:#EC3013;padding:32px 28px">
    <div style="font:600 11px/1 Archivo,'Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#ffffff;opacity:.85">Street-Level Equity Snapshot</div>
    <div style="font:800 26px/1.15 Archivo,'Helvetica Neue',Arial,sans-serif;color:#ffffff;margin-top:10px">${esc(shortAddress(lead.address))}</div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:32px 28px">
    <p style="font:400 15px/1.55 Archivo,'Helvetica Neue',Arial,sans-serif;color:#201E1D;margin:0 0 18px">Hi ${esc(name)} &mdash; here's what the sales evidence around your address says today.</p>
    <div style="font:600 11px/1 Archivo,'Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#6b6867">Evidence-based value range</div>
    <div style="font:800 34px/1.1 Archivo,'Helvetica Neue',Arial,sans-serif;color:#201E1D;margin:10px 0 4px">${money(range.low)} &ndash; ${money(range.high)}</div>
    <div style="font:400 13px/1.5 Archivo,'Helvetica Neue',Arial,sans-serif;color:#6b6867">Midpoint ${money(range.mid)} &middot; built from ${comps.list.length} sales within ${comps.radiusKm} km over the last ${comps.months} months. This is a data range, not an appraisal &mdash; condition, finishes, and timing move it.</div>

    ${mode === "none" ? "" : `<div style="font:600 11px/1 Archivo,'Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin-top:28px;border-top:3px solid #201E1D;padding-top:14px">The comparable sales</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px">${rows}</table>`}

    ${actives ? `<div style="font:600 11px/1 Archivo,'Helvetica Neue',Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin-top:28px;border-top:3px solid #201E1D;padding-top:14px">Your competition today</div>
    <p style="font:400 14px/1.55 Archivo,'Helvetica Neue',Arial,sans-serif;color:#201E1D;margin:8px 0 0">${actives.count} homes are currently for sale within 2 km${actives.medianList ? ", median asking " + money(actives.medianList) : ""}. Where you price against them decides your days on market.</p>` : ""}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr>
      <td style="background:#EC3013"><a href="tel:+15066083333" style="display:inline-block;padding:14px 22px;font:600 13px/1 Archivo,'Helvetica Neue',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#ffffff;text-decoration:none">Call 506-608-3333</a></td>
      <td width="10"></td>
      <td style="border:2px solid #201E1D"><a href="mailto:jason@ironcladrealty.ca" style="display:inline-block;padding:12px 22px;font:600 13px/1 Archivo,'Helvetica Neue',Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#201E1D;text-decoration:none">Reply to this email</a></td>
    </tr></table>
    <p style="font:400 13px/1.55 Archivo,'Helvetica Neue',Arial,sans-serif;color:#6b6867;margin:16px 0 0">Want the walkthrough? Call before noon &mdash; you'll hear back today, or we deduct $250 from our closing commission.</p>
  </td></tr>

  <tr><td style="background:#201E1D;padding:22px 28px">
    <p style="font:400 12px/1.7 Archivo,'Helvetica Neue',Arial,sans-serif;color:#ffffff;margin:0"><strong style="font-weight:800">Jason Hinchliffe</strong> &mdash; REALTOR&reg;<br>
    Ironclad Realty Group &middot; Brokered by eXp Realty Canada &mdash; New Brunswick<br>
    Serving Sussex to Saint John, NB &middot; 506-608-3333 &middot; ironcladrealty.ca</p>
    <p style="font:400 11px/1.6 Archivo,'Helvetica Neue',Arial,sans-serif;color:#8f8c8b;margin:12px 0 0">You received this because you requested a Street-Level Equity Snapshot at ironcladrealty.ca. Sold data sourced from MLS&reg;. If you'd rather not hear from us again, reply "stop" and that's the end of it.</p>
  </td></tr>

</table></td></tr></table></body></html>`;
}

function renderEmailText(lead, comps, actives, range) {
  return [
    `Street-Level Equity Snapshot — ${shortAddress(lead.address)}`,
    ``,
    `Evidence-based value range: ${money(range.low)} – ${money(range.high)} (midpoint ${money(range.mid)})`,
    `Built from ${comps.list.length} sales within ${comps.radiusKm} km over the last ${comps.months} months.`,
    actives ? `Competition: ${actives.count} homes for sale within 2 km${actives.medianList ? ", median asking " + money(actives.medianList) : ""}.` : ``,
    ``,
    `Want the walkthrough? Call 506-608-3333 before noon — you'll hear back today, or we deduct $250 from our closing commission.`,
    ``,
    `Jason Hinchliffe — REALTOR® · Ironclad Realty Group · Brokered by eXp Realty Canada — New Brunswick`
  ].filter(Boolean).join("\n");
}

/* ---------------- delivery + FUB logging ---------------- */
async function sendEmail(env, lead, subject, html, text) {
  if (!env.RESEND_API_KEY) return { ok: false, note: "RESEND_API_KEY not set — email sending not configured yet" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.SNAPSHOT_FROM || "Jason Hinchliffe <jason@ironcladrealty.ca>",
      to: [lead.email], reply_to: "jason@ironcladrealty.ca",
      subject, html, text
    })
  });
  if (!r.ok) return { ok: false, note: `Email provider error ${r.status}: ${(await r.text()).slice(0, 300)}` };
  return { ok: true };
}

async function fubNote(env, lead, tags, message) {
  if (!env.FUB_API_KEY) return;
  const headers = { "Content-Type": "application/json", "Authorization": "Basic " + btoa(env.FUB_API_KEY + ":") };
  if (env.FUB_SYSTEM) headers["X-System"] = env.FUB_SYSTEM;
  if (env.FUB_SYSTEM_KEY) headers["X-System-Key"] = env.FUB_SYSTEM_KEY;
  await fetch("https://api.followupboss.com/v1/events", {
    method: "POST", headers,
    body: JSON.stringify({
      source: "Heatmap-Lead", system: env.FUB_SYSTEM || "Ironclad Website", type: "Note", message,
      person: { emails: [{ value: lead.email }], tags: ["Ironclad-Website"].concat(tags) }
    })
  }).catch(() => {});
}

/* ---------------- utils ---------------- */
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function money(n) { return n == null ? "—" : "$" + Math.round(n).toLocaleString("en-CA"); }
function median(a) { if (!a || !a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(sorted, q) { const pos = (sorted.length - 1) * q; const lo = Math.floor(pos); const hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }
function round5k(n) { return Math.round(n / 5000) * 5000; }
function shortAddress(a) { return String(a || "").split(",")[0].trim() || "your home"; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
