/**
 * TEMPORARY diagnostic — /api/diag
 * Runs the exact queries the snapshot engine runs and shows the raw outcome in the browser.
 * Protected by a DIAG_KEY environment variable. DELETE THIS FILE once the feed is confirmed working.
 *
 * Usage:  https://YOUR-SITE/api/diag?key=YOUR_DIAG_KEY&address=18 Pine Glen Rd, Quispamsis
 * Never shows the API key. Shows counts, HTTP statuses, and trimmed sample listings only.
 */

const REPLIERS = "https://api.repliers.io";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.DIAG_KEY || url.searchParams.get("key") !== env.DIAG_KEY) {
    return new Response("Not found", { status: 404 });
  }
  const address = url.searchParams.get("address") || "18 Pine Glen Rd, Quispamsis";
  const out = { address, hasRepliersKey: !!env.REPLIERS_API_KEY, steps: [] };

  // Step 0 — geocode, same as the engine
  let geo = null;
  try {
    const q = encodeURIComponent(`${address}, New Brunswick, Canada`);
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ca&q=${q}`,
      { headers: { "User-Agent": "IroncladRealtyDiag/1.0 (jason@ironcladrealty.ca)" } });
    const j = await r.json();
    geo = j && j[0] ? { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), display: j[0].display_name } : null;
    out.steps.push({ step: "geocode", ok: !!geo, result: geo });
  } catch (e) { out.steps.push({ step: "geocode", ok: false, error: String(e) }); }

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
        const first = j.listings && j.listings[0];
        if (first) {
          entry.firstListing = {
            status: first.status, lastStatus: first.lastStatus, type: first.type, class: first.class,
            listPrice: first.listPrice, soldPrice: first.soldPrice, soldDate: first.soldDate,
            daysOnMarket: first.daysOnMarket, listDate: first.listDate,
            city: first.address && first.address.city,
            propertyType: first.details && first.details.propertyType,
            distance: first.distance,
            topLevelFields: Object.keys(first).slice(0, 25)
          };
        }
        if (!j.listings) entry.rawSnippet = text.slice(0, 400);
      } catch { entry.rawSnippet = text.slice(0, 400); }
    } catch (e) { entry.error = String(e); }
    out.steps.push(entry);
  };

  // Step 1 — bare sold query by city
  await call("1-solds-by-city", { status: "U", lastStatus: "Sld", city: "Quispamsis", resultsPerPage: 5 });
  // Step 2 — add residential class
  await call("2-plus-class", { status: "U", lastStatus: "Sld", city: "Quispamsis", class: "residential", resultsPerPage: 5 });
  // Step 3 — add date floor (6 months back)
  const since = new Date(); since.setMonth(since.getMonth() - 6);
  await call("3-plus-minSoldDate", { status: "U", lastStatus: "Sld", city: "Quispamsis", class: "residential", minSoldDate: since.toISOString().slice(0, 10), resultsPerPage: 5 });
  // Step 4 — geography instead of city (the engine's actual shape)
  if (geo) await call("4-radius-search", { status: "U", lastStatus: "Sld", class: "residential", lat: geo.lat, long: geo.lng, radius: 5, minSoldDate: since.toISOString().slice(0, 10), resultsPerPage: 5 });
  // Step 5 — actives for comparison (proves key works at all)
  await call("5-actives-by-city", { status: "A", city: "Quispamsis", resultsPerPage: 5 });

  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
