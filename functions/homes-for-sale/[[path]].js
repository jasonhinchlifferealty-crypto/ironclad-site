/* Ironclad — AI-readable layer for neighbourhood pages.
   Edge-injects the CURRENT cached market stats into each area page's HTML before it
   leaves the server, so crawlers and AI answer engines (which mostly do not run
   JavaScript) see real numbers. Falls through untouched on any error: the layer can
   only add, never break. */
import { buildFactsHtml, buildFaqJsonLd } from "../facts.js";
export async function onRequest(ctx) {
  const { request, env } = ctx;
  const resp = await env.ASSETS.fetch(request);
  try {
    if (request.method !== "GET") return resp;
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return resp;
    const m = new URL(request.url).pathname.match(/^\/homes-for-sale\/([a-z0-9-]+)\/?/);
    if (!m) return resp; // hub page: untouched
    const slug = m[1];
    let pulse = null;
    try { pulse = await env.LEADS.get("pulse:cache", "json"); } catch (e) {}
    if (!pulse || !pulse.areas || !pulse.areas[slug]) return resp;
    let name = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    try {
      const geoR = await env.ASSETS.fetch(new URL("/data/areas.geojson", request.url));
      if (geoR.ok) {
        const geo = await geoR.json();
        const f = (geo.features || []).find(f => f.properties && f.properties.id === slug);
        if (f) name = f.properties.name;
      }
    } catch (e) {}
    const stats = pulse.areas[slug];
    const facts = buildFactsHtml(name, stats, pulse.updated);
    const faq = buildFaqJsonLd(name, slug, stats, pulse.updated);
    return new HTMLRewriter()
      .on("#area-facts", { element(el) { el.setInnerContent(facts, { html: true }); } })
      .on("head", { element(el) { if (faq) el.append('<script type="application/ld+json">' + faq + "</script>", { html: true }); } })
      .transform(resp);
  } catch (e) {
    return resp; // any failure: original page, unharmed
  }
}
