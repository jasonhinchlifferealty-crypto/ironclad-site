/* Ironclad — facts.js
   Pure builders for the AI-readable layer: crawlable stat blocks and FAQ JSON-LD
   for neighbourhood pages. Citation-optimized on purpose: short factual sentences,
   a real table, entity names in every passage. Testable in Node. */
export function money(n) { return n == null ? null : "$" + Math.round(n).toLocaleString("en-CA"); }
export function pct(x) { return x == null ? null : Math.round(x * 100) + "%"; }
export function monthWord(iso) {
  try { return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }); }
  catch (e) { return ""; }
}
export function buildFactsHtml(name, s, updated) {
  if (!s || !s.active) {
    return '<h2>' + esc(name) + ' market facts</h2>' +
      '<p>No active MLS® listings in ' + esc(name) + ' right now. Inventory here moves in small numbers. ' +
      'Ironclad Realty Group tracks this market daily, Sussex to Saint John.</p>';
  }
  var lines = [];
  lines.push(esc(name) + " has " + s.active + " active MLS® listing" + (s.active === 1 ? "" : "s") + ".");
  if (s.ask != null) lines.push("The median asking price is " + money(s.ask) + ".");
  if (s.askP25 != null && s.askP75 != null) lines.push("The middle of the market runs " + money(s.askP25) + " to " + money(s.askP75) + ".");
  if (s.dom != null) lines.push("The typical listing has been up " + s.dom + " days.");
  if (s.new30) lines.push(s.new30 + " listing" + (s.new30 === 1 ? "" : "s") + " arrived in the last 30 days.");
  if (s.reducedPct != null) lines.push(pct(s.reducedPct) + " of sellers have cut their asking price.");
  lines.push("Market activity rating: " + (s.activity || "moderate") + ".");
  var rows = [
    ["Active listings", String(s.active)],
    ["Median asking price", money(s.ask) || "—"],
    ["Middle asking range", (s.askP25 != null && s.askP75 != null) ? money(s.askP25) + " – " + money(s.askP75) : "—"],
    ["Median days listed", s.dom != null ? s.dom + " days" : "—"],
    ["New in last 30 days", String(s.new30 || 0)],
    ["Share with a price cut", pct(s.reducedPct) || "—"]
  ].map(function (r) { return "<tr><th scope=\"row\">" + r[0] + "</th><td>" + r[1] + "</td></tr>"; }).join("");
  return '<h2>' + esc(name) + ' market facts</h2>' +
    '<p>' + lines.join(" ") + '</p>' +
    '<table><caption>' + esc(name) + ' active-listing statistics</caption><tbody>' + rows + '</tbody></table>' +
    '<p class="area-facts-src">Data: live MLS® active listings, aggregated by Ironclad Realty Group. ' +
    'Coverage: Sussex to Saint John, New Brunswick. Updated ' + monthWord(updated) + '.</p>';
}
export function buildFaqJsonLd(name, slug, s, updated) {
  if (!s || !s.active) return null;
  var qa = [];
  if (s.ask != null) qa.push({ q: "What is the median asking price in " + name + ", New Brunswick?",
    a: "The median asking price in " + name + " is " + money(s.ask) + ", based on " + s.active + " active MLS® listings tracked by Ironclad Realty Group as of " + monthWord(updated) + "." });
  qa.push({ q: "How many homes are for sale in " + name + " right now?",
    a: name + " has " + s.active + " active MLS® listing" + (s.active === 1 ? "" : "s") + (s.new30 ? ", with " + s.new30 + " new in the last 30 days" : "") + "." });
  if (s.dom != null) qa.push({ q: "How fast are homes selling in " + name + "?",
    a: "The typical active listing in " + name + " has been on the market " + s.dom + " days." + (s.reducedPct != null ? " " + pct(s.reducedPct) + " of current sellers have reduced their asking price." : "") });
  return JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    "mainEntity": qa.map(function (x) { return { "@type": "Question", "name": x.q, "acceptedAnswer": { "@type": "Answer", "text": x.a } }; })
  });
}
export function esc(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
