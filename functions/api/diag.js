/**
 * TEMPORARY diagnostic v2 — /api/diag
 * Discovers the feed's own vocabulary for sold listings instead of assuming standard labels.
 * Protected by DIAG_KEY. DELETE THIS FILE once the feed is confirmed working.
 * Usage: https://YOUR-SITE/api/diag?key=YOUR_DIAG_KEY&address=123+Real+St,+Quispamsis
 */

const REPLIERS = "https://api.repliers.io";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.DIAG_KEY || url.searchParams.get("key") !== env.DIAG_KEY) {
    return new Response("Not found", { status: 404 });
  }
  const address = url.searchParams.get("address") || "18 Pine Glen Rd, Quispamsis";
  const out = { version: 2, address, hasRepliersKey: !!env.REPLIERS_API_KEY, steps: [] };

  let geo = null;
  try {
    const q = encodeURIComponent(`${address}, New Brunswick, Canada`);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${q}`,
      { headers: { "User-Agent": "IroncladRealtyDiag/1.0 (jason@ironcladrealty.ca)" } });
    const j = await r.json();
    geo = j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), display: j[0].display_name } : null;
    out.steps.push({ step: "geocode", ok: !!geo, result: geo, note: geo ? undefined : "No match — check spelling, or use a well-known address to test" });
  } catch (e) { out.steps.push({ step: "geocode", ok: false, error: String(e) }); }

  const trim = (l) => ({
    status: l.status, lastStatus: l.lastStatus, type: l.type, class: l.class,
    listPrice: l.listPrice, soldPrice: l.soldPrice, soldDate: l.soldDate,
    daysOnMarket: l.daysOnMarket, listDate: l.listDate,
    city: l.address && l.address.city,
    propertyType: l.details && l.details.propertyType,
    permissions: l.permissions
  });

  const call = async (label, params) => {
    const entry = { step: label, params };
    try {
      const qs = new URLSearchParams(params).toString();
      const r = await fetch(`${REPLIERS}/listings?${qs}`, { headers: { "REPLIERS-API-KEY": env.REPLIERS_API_KEY || "" } });
      entry.httpStatus = r.status;
      const text = await r.text();
      try {
        const j = JSON.parse(text);
        entry.count = j.count != null ? j.count : (j.listings ? j.listings.length : null);
        entry.pageResults = j.listings ? j.listings.length : 0;
        if (j.listings && j.listings[0]) {
          entry.firstListing = trim(j.listings[0]);
          entry.allLastStatusesOnPage = [...new Set(j.listings.map(l => l.lastStatus))];
          entry.allCitiesOnPage = [...new Set(j.listings.map(l => l.address && l.address.city))];
        }
        if (!j.listings) entry.rawSnippet = text.slice(0, 400);
      } catch { entry.rawSnippet = text.slice(0, 400); }
    } catch (e) { entry.error = String(e); }
    out.steps.push(entry);
  };

  // Discovery battery
  await call("A-city-control", { status: "A", city: "Quispamsis", resultsPerPage: 3 });
  await call("A-city-class-filter", { status: "A", city: "Quispamsis", class: "residential", resultsPerPage: 3 });
  await call("U-city", { status: "U", city: "Quispamsis", resultsPerPage: 3 });
  await call("U-province-wide", { status: "U", resultsPerPage: 5, sortBy: "updatedOnDesc" });
  await call("U-province-soldPrice-floor", { status: "U", minSoldPrice: 1, resultsPerPage: 5 });
  const since6 = new Date(); since6.setMonth(since6.getMonth() - 6);
  await call("U-province-minSoldDate", { status: "U", minSoldDate: since6.toISOString().slice(0, 10), resultsPerPage: 5 });
  if (geo) await call("U-radius-from-geocode", { status: "U", lat: geo.lat, long: geo.lng, radius: 10, resultsPerPage: 5 });

  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
