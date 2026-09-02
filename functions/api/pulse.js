/**
 * GET /api/pulse — live neighbourhood market stats from active listings.
 *
 * Pulls actives from Repliers for the coverage towns, assigns each listing to a
 * neighbourhood polygon (point-in-polygon against /data/areas.geojson), and aggregates:
 * median asking price, inventory count, median days listed, new-in-30-days, share price-reduced.
 * Sold-side numbers are deliberately absent — that's the Street-Level Equity Snapshot's job.
 *
 * Caching: the single current aggregate is cached in the LEADS KV namespace for 6 hours and
 * self-deletes after 24 (no historical data is stored — deliberate, per NB feed rules; the
 * cache only ever holds one recent snapshot of the present). If Repliers is unreachable, the
 * last cache serves for up to a day; beyond that the front end falls back to /data/pulse.json.
 *
 * Force refresh (after checking a fix, etc.):  /api/pulse?refresh=YOUR_DIAG_KEY
 *
 * Activity formula (documented so the label is defensible):
 *   +2 if median days listed <= 20, +1 if <= 35, -1 if > 60
 *   +1 if price-reduced share < 10%, -1 if > 30%
 *   +1 if new-in-30-days >= 40% of inventory
 *   score >= 3 hot · 2 active · 1 steady · 0 moderate · < 0 low
 */

const REPLIERS = "https://api.repliers.io";
const CITIES = ["Saint John", "Quispamsis", "Rothesay", "Hampton", "Grand Bay-Westfield", "Sussex"];
const CACHE_KEY = "pulse:cache";
const CACHE_TTL_S = 6 * 3600;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const force = env.DIAG_KEY && url.searchParams.get("refresh") === env.DIAG_KEY;

  // 1. Fresh cache?
  if (!force && env.LEADS) {
    try {
      const cached = await env.LEADS.get(CACHE_KEY, "json");
      if (cached && (Date.now() - new Date(cached.updated).getTime()) < CACHE_TTL_S * 1000) {
        return json(cached);
      }
    } catch {}
  }

  // 2. Aggregate live
  try {
    const data = await aggregate(env, new URL(request.url).origin, context);
    if (env.LEADS) {
      try { await env.LEADS.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: 86400 }); } catch {}
    }
    return json(data);
  } catch (e) {
    // 3. Recent-but-stale cache (self-expires within 24h) beats nothing
    if (env.LEADS) {
      try {
        const stale = await env.LEADS.get(CACHE_KEY, "json");
        if (stale) { stale.live = false; stale.note = "Live refresh failed; serving last good data."; return json(stale); }
      } catch {}
    }
    return json({ live: false, error: "aggregation failed: " + e.message }, 503);
  }
}

async function aggregate(env, origin, context) {
  if (!env.REPLIERS_API_KEY) throw new Error("REPLIERS_API_KEY not set");

  // Load neighbourhood polygons from the site's own static file.
  // Must go through the ASSETS binding: Cloudflare blocks a function fetching its own domain directly.
  const assetUrl = origin + "/data/areas.geojson";
  const geoR = env.ASSETS ? await env.ASSETS.fetch(assetUrl) : await fetch(assetUrl);
  if (!geoR.ok) throw new Error("areas.geojson unavailable (" + geoR.status + ")");
  const geo = await geoR.json();
  const areas = geo.features.map(f => ({
    id: f.properties.id, name: f.properties.name, group: f.properties.group,
    order: f.properties.order || 0, parent: f.properties.parent || null,
    rings: f.geometry.coordinates
  }));

  // Pull all actives for the coverage towns (paginated, defensively capped)
  const listings = [];
  for (const city of CITIES) {
    for (let page = 1; page <= 5; page++) {
      const qs = new URLSearchParams({ status: "A", city, resultsPerPage: 100, pageNum: page });
      const r = await fetch(`${REPLIERS}/listings?${qs}`, { headers: { "REPLIERS-API-KEY": env.REPLIERS_API_KEY } });
      if (!r.ok) throw new Error(`Repliers ${r.status} for ${city}`);
      const j = await r.json();
      const batch = j.listings || [];
      listings.push(...batch);
      if (batch.length < 100) break;
    }
  }

  const now = Date.now();
  const parsed = listings.map(l => {
    const lat = l.map && parseFloat(l.map.latitude);
    const lng = l.map && parseFloat(l.map.longitude);
    const listDate = l.listDate ? new Date(l.listDate).getTime() : null;
    let dom = num(l.daysOnMarket);
    if (dom == null && listDate) dom = Math.max(0, Math.round((now - listDate) / 86400000));
    return {
      lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng,
      ask: num(l.listPrice), original: num(l.originalPrice),
      dom, isNew30: listDate ? (now - listDate) <= 30 * 86400000 : false,
      city: (l.address && l.address.city) || ""
    };
  }).filter(l => l.ask > 0);

  // Assign to neighbourhoods. Sub-areas (e.g. Gondola Point inside Quispamsis) claim first.
  const ordered = areas.slice().sort((a, b) => (a.parent ? 0 : 1) - (b.parent ? 0 : 1));
  const buckets = {}; areas.forEach(a => buckets[a.id] = []);
  let regionAll = [];
  for (const l of parsed) {
    regionAll.push(l);
    if (l.lat == null || l.lng == null) continue;
    for (const a of ordered) {
      if (pointInFeature(l.lng, l.lat, a.rings)) { buckets[a.id].push(l); break; }
    }
  }

  const areasOut = {};
  for (const a of areas) areasOut[a.id] = stats(buckets[a.id]);
  // Parent areas also include their sub-areas' listings for their own stats
  for (const a of areas.filter(x => x.parent)) {
    const parent = areas.find(p => p.name === a.parent);
    if (parent) areasOut[parent.id] = stats(buckets[parent.id].concat(buckets[a.id]));
  }

  return {
    live: true,
    updated: new Date().toISOString(),
    source: "Active listings via MLS® (Repliers)",
    region: stats(regionAll),
    areas: areasOut
  };
}

function stats(list) {
  const n = list.length;
  if (!n) return { active: 0, ask: null, askP25: null, askP75: null, dom: null, new30: 0, reducedPct: null, activity: "low" };
  const asks = list.map(l => l.ask).sort((a, b) => a - b);
  const doms = list.map(l => l.dom).filter(d => d != null).sort((a, b) => a - b);
  const new30 = list.filter(l => l.isNew30).length;
  const withOrig = list.filter(l => l.original != null && l.original > 0);
  const reduced = withOrig.filter(l => l.ask < l.original).length;
  const reducedPct = withOrig.length ? reduced / withOrig.length : null;
  const dom = doms.length ? med(doms) : null;

  let score = 0;
  if (dom != null) { if (dom <= 20) score += 2; else if (dom <= 35) score += 1; else if (dom > 60) score -= 1; }
  if (reducedPct != null) { if (reducedPct < 0.10) score += 1; else if (reducedPct > 0.30) score -= 1; }
  if (n > 0 && new30 / n >= 0.4) score += 1;
  const activity = score >= 3 ? "hot" : score === 2 ? "active" : score === 1 ? "steady" : score === 0 ? "moderate" : "low";

  return {
    active: n,
    ask: med(asks),
    askP25: quant(asks, 0.25), askP75: quant(asks, 0.75),
    dom, new30,
    reducedPct,
    activity
  };
}

/* ---- geometry: ray-cast point in polygon (handles Polygon rings incl. holes) ---- */
function pointInFeature(x, y, rings) {
  // rings: [ [ [lng,lat], ... ] , holes... ]
  if (!pointInRing(x, y, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(x, y, rings[i])) return false;
  return true;
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function med(sorted) { const m = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; }
function quant(sorted, q) { const pos = (sorted.length - 1) * q; const lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } }); }
