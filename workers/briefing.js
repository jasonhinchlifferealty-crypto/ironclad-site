/**
 * Ironclad Realty — Daily Market Briefing agent.
 *
 * A standalone Cloudflare Worker on a weekday schedule (cron: 0 10 * * 1-5 = 7:00 a.m. ADT).
 * Each morning it asks Repliers what changed in the service area — new listings, price changes,
 * solds, expireds — and emails Jason a plain-language summary with the notable movers called out.
 * Monday's edition covers the whole weekend. Market data only; no CRM/lead data.
 *
 * Environment variables (Worker > Settings > Variables):
 *   REPLIERS_API_KEY   required
 *   RESEND_API_KEY     required (same Resend account as the snapshot emails)
 *   BRIEFING_TO        default jason@ironcladrealty.ca
 *   BRIEFING_FROM      default "Ironclad Briefing <jason@ironcladrealty.ca>" (domain verified in Resend)
 *   BRIEFING_CITIES    comma list; default "Saint John,Quispamsis,Rothesay,Hampton,Grand Bay-Westfield,Sussex"
 *   BRIEFING_TEST_KEY  any secret word; lets you preview in a browser (see launch guide)
 *   SITE_URL           default https://ironcladrealty.ca
 *
 * Manual test without waiting for 7 a.m.:
 *   https://<worker-url>/?key=YOUR_TEST_KEY          → shows the email in the browser, sends nothing
 *   https://<worker-url>/?key=YOUR_TEST_KEY&send=1   → actually emails it
 */

const REPLIERS = "https://api.repliers.io";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runBriefing(env, { send: true }));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.BRIEFING_TEST_KEY || url.searchParams.get("key") !== env.BRIEFING_TEST_KEY) {
      return new Response("Ironclad briefing agent. Scheduled weekdays. Add ?key=... to preview.", { status: 200 });
    }
    const send = url.searchParams.get("send") === "1";
    const result = await runBriefing(env, { send });
    return new Response(result.html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
};

async function runBriefing(env, { send }) {
  const now = new Date();
  // Monday covers the weekend (72h); other weekdays cover 24h.
  const isMonday = now.getUTCDay() === 1;
  const hours = isMonday ? 72 : 24;
  const since = new Date(now.getTime() - hours * 3600 * 1000);
  const sinceDate = since.toISOString().slice(0, 10);
  const cities = (env.BRIEFING_CITIES || "Saint John,Quispamsis,Rothesay,Hampton,Grand Bay-Westfield,Sussex")
    .split(",").map(s => s.trim()).filter(Boolean);

  const data = { newListings: null, priceChanges: null, solds: null, expireds: null, errors: [] };

  const pull = async (label, params) => {
    try {
      const j = await repliersGet(env, { ...params, city: JSON.stringify(cities) });
      return normalize(j);
    } catch (e) { data.errors.push(`${label}: ${e.message}`); return null; }
  };

  data.newListings  = await pull("new listings",  { status: "A", minListDate: sinceDate, class: "residential", resultsPerPage: 100, sortBy: "listDateDesc" });
  data.priceChanges = await pull("price changes", { status: "A", lastStatus: "Pc", minUpdatedOn: sinceDate, class: "residential", resultsPerPage: 100 });
  data.solds        = await pull("solds",         { status: "U", lastStatus: "Sld", minSoldDate: sinceDate, class: "residential", resultsPerPage: 100, sortBy: "soldDateDesc" });
  data.expireds     = await pull("expireds",      { status: "U", lastStatus: "Exp", minUpdatedOn: sinceDate, class: "residential", resultsPerPage: 100 });

  const brief = buildBrief(data, { now, hours, cities });
  const html = renderHTML(env, brief);
  const text = renderText(brief);

  let delivery = "preview only";
  if (send) {
    if (data.errors.length === 4) {
      // Everything failed — say so rather than emailing an empty shell.
      await sendEmail(env, `Briefing problem — Repliers unreachable`, `<p style="font-family:Arial">All four data pulls failed this morning: ${data.errors.join("; ")}. No market data available.</p>`, `All data pulls failed: ${data.errors.join("; ")}`);
      delivery = "error notice sent";
    } else {
      await sendEmail(env, brief.subject, html, text);
      delivery = "sent";
    }
  }
  return { html, delivery };
}

/* ---------------- Repliers ---------------- */
async function repliersGet(env, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${REPLIERS}/listings?${qs}`, { headers: { "REPLIERS-API-KEY": env.REPLIERS_API_KEY } });
  if (!r.ok) throw new Error(`Repliers ${r.status}`);
  return r.json();
}
function normalize(j) {
  return (j.listings || []).map(l => ({
    street: l.address ? [l.address.streetNumber, l.address.streetName, l.address.streetSuffix].filter(Boolean).join(" ") : "",
    city: (l.address && l.address.city) || "",
    price: num(l.listPrice),
    original: num(l.originalPrice),
    sold: num(l.soldPrice),
    dom: num(l.daysOnMarket),
    beds: l.details && l.details.numBedrooms,
    type: (l.details && l.details.propertyType) || "home"
  }));
}

/* ---------------- the brief itself ---------------- */
function buildBrief(data, { now, hours, cities }) {
  const day = now.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Moncton" });
  const windowLabel = hours === 72 ? "since Friday morning" : "in the last 24 hours";

  const nl = data.newListings || [], pc = data.priceChanges || [], sl = data.solds || [], ex = data.expireds || [];

  // Notable movers
  const drops = pc.filter(p => p.original && p.price && p.price < p.original)
    .map(p => ({ ...p, cut: p.original - p.price, pct: (p.original - p.price) / p.original }))
    .sort((a, b) => b.pct - a.pct).slice(0, 3);
  const hotSolds = sl.filter(s => s.sold && s.price)
    .map(s => ({ ...s, ratio: s.sold / s.price }))
    .sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  const fastest = sl.filter(s => s.dom != null).sort((a, b) => a.dom - b.dom)[0] || null;

  // Per-town counts of new listings
  const byTown = {};
  nl.forEach(l => { const c = l.city || "Other"; byTown[c] = (byTown[c] || 0) + 1; });
  const towns = Object.entries(byTown).sort((a, b) => b[1] - a[1]);

  // Plain-language opening read
  const bits = [];
  bits.push(`${nl.length} new listing${nl.length === 1 ? "" : "s"}${towns.length ? ` — ${towns.slice(0, 2).map((t, i) => i === 0 ? `${t[0]} leads with ${t[1]}` : `then ${t[0]} with ${t[1]}`).join(", ")}` : ""}.`);
  if (pc.length) bits.push(`${pc.length} price change${pc.length === 1 ? "" : "s"}${drops.length ? `, the sharpest ${pctFmt(drops[0].pct)} off in ${drops[0].city}` : ""}.`);
  else bits.push("No price changes.");
  if (sl.length) {
    const overAsk = sl.filter(s => s.sold && s.price && s.sold >= s.price).length;
    bits.push(`${sl.length} sold${overAsk ? `, ${overAsk} at or over asking` : ""}${fastest && fastest.dom != null ? `; fastest went in ${fastest.dom} day${fastest.dom === 1 ? "" : "s"}` : ""}.`);
  } else bits.push("Nothing closed.");
  if (ex.length) bits.push(`${ex.length} expired — potential listing conversations.`);
  const read = bits.join(" ");

  const quiet = !nl.length && !pc.length && !sl.length && !ex.length;

  return {
    subject: `Morning briefing — ${day}: ${nl.length} new, ${pc.length} price ${pc.length === 1 ? "change" : "changes"}, ${sl.length} sold`,
    day, windowLabel, read, quiet,
    counts: { newListings: nl.length, priceChanges: pc.length, solds: sl.length, expireds: ex.length },
    towns, drops, hotSolds, fastest,
    newListings: nl.slice(0, 5), moreNew: Math.max(0, nl.length - 5),
    solds: sl.slice(0, 5), moreSolds: Math.max(0, sl.length - 5),
    expireds: ex.slice(0, 5), moreExpireds: Math.max(0, ex.length - 5),
    errors: data.errors
  };
}

/* ---------------- rendering ---------------- */
const F = "Archivo,'Helvetica Neue',Arial,sans-serif";
function line(l, right, sub) {
  return `<tr><td style="padding:9px 0;border-bottom:1px solid #e2e0df;font:400 14px/1.4 ${F};color:#201E1D">${esc(l)}${sub ? `<span style="color:#6b6867;font-size:12px"> &middot; ${esc(sub)}</span>` : ""}</td><td align="right" style="padding:9px 0 9px 12px;border-bottom:1px solid #e2e0df;font:800 14px/1.4 ${F};color:#201E1D;white-space:nowrap">${right}</td></tr>`;
}
function section(title, rowsHtml, extra) {
  if (!rowsHtml) return "";
  return `<div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#6b6867;margin-top:26px;border-top:3px solid #201E1D;padding-top:13px">${title}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>${extra ? `<p style="font:400 12px/1.5 ${F};color:#6b6867;margin:8px 0 0">${extra}</p>` : ""}`;
}
function what(l) { return [l.beds ? l.beds + "-bed" : null, String(l.type || "home").toLowerCase()].filter(Boolean).join(" "); }
function where(l) { return [l.street, l.city].filter(Boolean).join(", "); }

function renderHTML(env, b) {
  const site = env.SITE_URL || "https://ironcladrealty.ca";

  const newRows = b.newListings.map(l => line(where(l) || "(address pending)", money(l.price), what(l))).join("");
  const dropRows = b.drops.map(d => line(where(d), `${money(d.price)} <span style="font-weight:400;color:#AE1800">&darr;${pctFmt(d.pct)}</span>`, `was ${money(d.original)}`)).join("");
  const soldRows = b.solds.map(s => line(where(s), `${money(s.sold)}${s.price ? ` <span style="font-weight:400;color:${s.sold >= s.price ? "#201E1D" : "#6b6867"}">(${s.sold >= s.price ? "+" : "&minus;"}${pctFmt(s.sold / s.price - 1)} vs ask)</span>` : ""}`, s.dom != null ? `${s.dom} days on market` : "")).join("");
  const expRows = b.expireds.map(l => line(where(l) || "(address withheld)", money(l.price), what(l))).join("");
  const townRow = b.towns.length ? `<p style="font:400 13px/1.6 ${F};color:#6b6867;margin:8px 0 0">New by town: ${b.towns.map(t => `${esc(t[0])} ${t[1]}`).join(" &middot; ")}</p>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F2F2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F2F2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
  <tr><td style="background:#201E1D;padding:16px 28px"><img src="${site}/assets/img/lockup-white.png" alt="Ironclad Realty Group" height="30" style="height:30px;width:auto;display:block"></td></tr>
  <tr><td style="background:#EC3013;padding:26px 28px">
    <div style="font:600 11px/1 ${F};letter-spacing:.14em;text-transform:uppercase;color:#ffffff;opacity:.85">Morning market briefing</div>
    <div style="font:800 24px/1.15 ${F};color:#ffffff;margin-top:8px">${esc(b.day)}</div>
    <div style="font:400 12px/1 ${F};color:#ffffff;opacity:.8;margin-top:6px">Sussex to Saint John &middot; ${esc(b.windowLabel)}</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:28px 28px 32px">
    ${b.quiet
      ? `<p style="font:400 15px/1.55 ${F};color:#201E1D;margin:0">Quiet ${b.windowLabel === "since Friday morning" ? "weekend" : "day"} — no new listings, price changes, sales, or expiries recorded in the service area.</p>`
      : `<p style="font:400 15px/1.6 ${F};color:#201E1D;margin:0">${esc(b.read)}</p>`}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px"><tr>
      ${[["New", b.counts.newListings], ["Price chg", b.counts.priceChanges], ["Sold", b.counts.solds], ["Expired", b.counts.expireds]].map(([k, v]) => `
      <td width="25%" style="border-top:3px solid #201E1D;padding:10px 8px 0 0">
        <div style="font:800 24px/1 ${F};color:#201E1D">${v}</div>
        <div style="font:600 10px/1 ${F};letter-spacing:.12em;text-transform:uppercase;color:#6b6867;margin-top:5px">${k}</div>
      </td>`).join("")}
    </tr></table>

    ${section("New listings", newRows, b.moreNew ? `+ ${b.moreNew} more` : "")}${newRows ? townRow : ""}
    ${section("Notable price cuts", dropRows, "")}
    ${section("Sold", soldRows, b.moreSolds ? `+ ${b.moreSolds} more` : "")}
    ${section("Expired — worth a call", expRows, b.moreExpireds ? `+ ${b.moreExpireds} more` : "")}
    ${b.errors.length ? `<p style="font:400 12px/1.5 ${F};color:#AE1800;margin:22px 0 0">Data gaps this morning: ${esc(b.errors.join("; "))}.</p>` : ""}
  </td></tr>
  <tr><td style="background:#201E1D;padding:18px 28px">
    <p style="font:400 11px/1.6 ${F};color:#8f8c8b;margin:0">Internal briefing for Ironclad Realty Group. Data from MLS&reg; via Repliers; verify before quoting. ironcladrealty.ca</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function renderText(b) {
  const out = [`Morning briefing — ${b.day} (${b.windowLabel})`, "", b.read, ""];
  out.push(`New: ${b.counts.newListings} · Price changes: ${b.counts.priceChanges} · Sold: ${b.counts.solds} · Expired: ${b.counts.expireds}`);
  if (b.errors.length) out.push(`Data gaps: ${b.errors.join("; ")}`);
  return out.join("\n");
}

/* ---------------- delivery ---------------- */
async function sendEmail(env, subject, html, text) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not set");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.BRIEFING_FROM || "Ironclad Briefing <jason@ironcladrealty.ca>",
      to: [env.BRIEFING_TO || "jason@ironcladrealty.ca"],
      subject, html, text
    })
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

/* ---------------- utils ---------------- */
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function money(n) { return n == null ? "—" : "$" + Math.round(n).toLocaleString("en-CA"); }
function pctFmt(x) { return (Math.abs(x) * 100).toFixed(1) + "%"; }
function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
