/**
 * GET /api/listings?area=<id>   (or no area = whole coverage)
 * Active listings from Repliers, assigned to neighbourhood polygons, trimmed for display,
 * honouring each listing's own display permissions from the feed:
 *   - permissions.displayPublic === "N"  → excluded entirely
 *   - displayAddressOnInternet === "N"   → street withheld and no map pin (addressOk: false)
 * Cached in LEADS KV ~30 min (self-expires at 6 h; no history kept).
 * Force refresh: /api/listings?refresh=DIAG_KEY
 */

const REPLIERS = "https://api.repliers.io";
const CITIES = ["Saint John", "Quispamsis", "Rothesay", "Hampton", "Grand Bay-Westfield", "Sussex"];
const CACHE_KEY = "listings:cache";
const FRESH_MS = 30 * 60 * 1000;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const force = env.DIAG_KEY && url.searchParams.get("refresh") === env.DIAG_KEY;
  const area = url.searchParams.get("area") || "";

  let data = null;
  if (!force && env.LEADS) {
    try {
      const c = await env.LEADS.get(CACHE_KEY, "json");
      if (c && Date.now() - new Date(c.updated).getTime() < FRESH_MS) data = c;
    } catch {}
  }
  if (!data) {
    try {
      data = await build(env, url.origin);
      if (env.LEADS) { try { await env.LEADS.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: 21600 }); } catch {} }
    } catch (e) {
      if (env.LEADS) { try { const stale = await env.LEADS.get(CACHE_KEY, "json"); if (stale) data = stale; } catch {} }
      if (!data) return json({ error: "listings unavailable: " + e.message }, 503);
    }
  }
  const out = { updated: data.updated, count: 0, listings: [] };
  out.listings = area ? data.listings.filter(l => l.areaId === area) : data.listings;
  out.count = out.listings.length;
  return json(out);
}

async function build(env, origin) {
  if (!env.REPLIERS_API_KEY) throw new Error("REPLIERS_API_KEY not set");
  const geoR = env.ASSETS ? await env.ASSETS.fetch(origin + "/data/areas.geojson") : await fetch(origin + "/data/areas.geojson");
  if (!geoR.ok) throw new Error("areas.geojson unavailable");
  const geo = await geoR.json();
  const areas = geo.features.map(f => ({ id: f.properties.id, parent: f.properties.parent || null, rings: f.geometry.coordinates }));
  const ordered = areas.slice().sort((a, b) => (a.parent ? 0 : 1) - (b.parent ? 0 : 1));

  const raw = [];
  for (const city of CITIES) {
    for (let page = 1; page <= 5; page++) {
      const qs = new URLSearchParams({ status: "A", city, resultsPerPage: 100, pageNum: page });
      const r = await fetch(`${REPLIERS}/listings?${qs}`, { headers: { "REPLIERS-API-KEY": env.REPLIERS_API_KEY } });
      if (!r.ok) throw new Error(`Repliers ${r.status} (${city})`);
      const j = await r.json();
      const batch = j.listings || [];
      raw.push(...batch);
      if (batch.length < 100) break;
    }
  }

  const now = Date.now();
  const listings = [];
  for (const l of raw) {
    const perm = l.permissions || {};
    if (String(perm.displayPublic || "Y").toUpperCase() === "N") continue;
    if (String(perm.displayInternetEntireListing || "Y").toUpperCase() === "N") continue;
    const addressOk = String(perm.displayAddressOnInternet || "Y").toUpperCase() !== "N";
    const lat = l.map && parseFloat(l.map.latitude), lng = l.map && parseFloat(l.map.longitude);
    const hasPt = !isNaN(lat) && !isNaN(lng);
    let areaId = null;
    if (hasPt) for (const a of ordered) { if (inPoly(lng, lat, a.rings)) { areaId = a.id; break; } }
    const listDate = l.listDate ? new Date(l.listDate).getTime() : null;
    const d = l.details || {};
    listings.push({
      mls: l.mlsNumber || "",
      price: num(l.listPrice),
      original: num(l.originalPrice),
      beds: num(d.numBedrooms), baths: num(d.numBathrooms),
      sqft: num(d.sqft),
      type: d.propertyType || "Home",
      style: d.style || "",
      street: addressOk ? [l.address && l.address.streetNumber, l.address && l.address.streetName, l.address && l.address.streetSuffix].filter(Boolean).join(" ") : "",
      city: (l.address && l.address.city) || "",
      lat: addressOk && hasPt ? lat : null,
      lng: addressOk && hasPt ? lng : null,
      addressOk,
      areaId,
      isNew: listDate ? (now - listDate) <= 7 * 86400000 : false,
      cut: l.originalPrice && l.listPrice && num(l.listPrice) < num(l.originalPrice),
      images: (l.images || []).slice(0, 10),
      office: (l.office && (l.office.brokerageName || l.office.name)) || "",
      desc: String(d.description || "").slice(0, 700)
    });
  }
  listings.sort((a, b) => (b.isNew - a.isNew) || ((a.price || 9e9) - (b.price || 9e9)));
  return { updated: new Date().toISOString(), listings };
}

function inPoly(x, y, rings) {
  if (!ring(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (ring(x, y, rings[i])) return false;
  return true;
}
function ring(x, y, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } }); }
