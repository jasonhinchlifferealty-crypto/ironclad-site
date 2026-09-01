/**
 * POST /api/lead — receives a form submission from the site and creates the lead in Follow Up Boss.
 *
 * Secrets live in Cloudflare Pages > Settings > Environment variables (never in this file):
 *   FUB_API_KEY      required   your Follow Up Boss API key
 *   FUB_SYSTEM       optional   registered system name (X-System header)
 *   FUB_SYSTEM_KEY   optional   registered system key  (X-System-Key header)
 *   SNAPSHOT_ENABLED optional   "true" to queue the Street-Level Equity Snapshot after a seller lead
 *   ALLOWED_ORIGIN   optional   e.g. https://ironcladrealty.ca (defaults to accepting the site's own origin)
 * Optional bindings:
 *   LEADS (KV namespace) — if bound, every submission is also stored as a backup, so nothing is lost if FUB is down.
 */

const COVERAGE_TOWNS = [
  "saint john", "quispamsis", "rothesay", "hampton", "gondola point", "grand bay", "westfield",
  "sussex", "millidgeville", "kv", "kennebecasis"
];
function outsideCoverage(text) {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;                 // nothing to judge
  return !COVERAGE_TOWNS.some(town => t.includes(town));
}

import { runSnapshot } from "./_lib/snapshot.js";

const TIMELINE_TAG = {
  "0-3 months": "Timeline-0-3",
  "3-6 months": "Timeline-3-6",
  "6-12 months": "Timeline-6-12",
  "just curious": "Timeline-Curious"
};

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }

  // Honeypot: real people never fill this field.
  if (body.website) return json({ ok: true });

  // Same-origin check (soft): block obvious cross-site posts.
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  if (origin && origin !== allowed && !origin.endsWith(".pages.dev")) return json({ error: "Origin not allowed." }, 403);

  const type = (body.type || "seller").toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Please enter a valid email address." }, 400);

  const name = String(body.name || "").trim();
  const [firstName, ...rest] = name.split(/\s+/);
  const lastName = rest.join(" ");
  const phone = String(body.phone || "").replace(/[^\d+]/g, "");
  const timeline = String(body.timeline || "").toLowerCase();
  const areaName = String(body.areaName || "").trim();
  const address = String(body.address || "").trim();

  if (type !== "subscriber") {
    if (!firstName) return json({ error: "Please enter your name." }, 400);
    if (phone.replace(/\D/g, "").length < 10) return json({ error: "Please enter a phone number we can reach you at." }, 400);
    if (!body.consent) return json({ error: "Please tick the consent box." }, 400);
    if (type === "seller" && address.length < 6) return json({ error: "Please enter the property address." }, 400);
  }

  // ---- Build the Follow Up Boss event ----
  const tags = ["Ironclad-Website"];
  let fubType, message, source;
  if (type === "seller") {
    fubType = "Seller Inquiry"; source = "Heatmap-Lead";
    tags.push("Seller", "Heatmap-Lead");
    if (areaName) tags.push("Area-" + slug(areaName));
    if (TIMELINE_TAG[timeline]) tags.push(TIMELINE_TAG[timeline]);
    if (timeline === "0-3 months" || timeline === "3-6 months") tags.push("Hot-Seller");
    if (!areaName && outsideCoverage(address)) tags.push("Referral");
    if (env.SNAPSHOT_ENABLED !== "true" || !env.REPLIERS_API_KEY) tags.push("Snapshot-Manual");
    message = `Street-Level Equity Snapshot request.\nAddress: ${address}\nNeighbourhood picked: ${areaName || "(none)"}\nTimeline: ${timeline || "(none)"}${tags.includes("Referral") ? "\nNote: address looks outside core coverage — referral candidate." : ""}\nPage: ${body.page || ""}`;
  } else if (type === "buyer") {
    fubType = "General Inquiry"; source = "Buyer-Lead";
    tags.push("Buyer", "Buyer-Lead");
    if (TIMELINE_TAG[timeline]) tags.push(TIMELINE_TAG[timeline]);
    if (outsideCoverage(body.lookingIn)) tags.push("Referral");
    message = `Buyer match request.\nLooking in: ${body.lookingIn || "(none)"}\nBudget: ${body.budget || "(none)"}\nTimeline: ${timeline || "(none)"}\nPage: ${body.page || ""}`;
  } else {
    fubType = "Registration"; source = "KV-Pulse-Signup";
    tags.push("KV-Pulse-Subscriber");
    message = "Subscribed to the monthly KV Pulse email.";
  }

  const person = { emails: [{ value: email, type: "home" }], tags };
  if (firstName) person.firstName = firstName;
  if (lastName) person.lastName = lastName;
  if (phone) person.phones = [{ value: phone, type: "mobile" }];
  if (type === "seller" && address) person.addresses = [{ type: "home", street: address, state: "NB", country: "Canada" }];

  const event = { source, system: env.FUB_SYSTEM || "Ironclad Website", type: fubType, message, person, pageUrl: body.page || "" };
  if (type === "buyer" && (body.lookingIn || body.budget)) {
    event.property = { city: body.lookingIn || "", price: body.budget || "" };
  }

  // ---- Backup copy (optional KV) ----
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  if (env.LEADS) {
    try { await env.LEADS.put(`lead:${id}`, JSON.stringify({ receivedAt: new Date().toISOString(), type, event }), { expirationTtl: 60 * 60 * 24 * 365 }); } catch {}
  }

  // ---- Send to Follow Up Boss ----
  if (!env.FUB_API_KEY) {
    // Test mode: no key configured. Return success so the form can be tested end-to-end before FUB is wired.
    return json({ ok: true, mode: "test", note: "FUB_API_KEY not set — lead was not sent to Follow Up Boss." });
  }
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Basic " + btoa(env.FUB_API_KEY + ":")
  };
  if (env.FUB_SYSTEM) headers["X-System"] = env.FUB_SYSTEM;
  if (env.FUB_SYSTEM_KEY) headers["X-System-Key"] = env.FUB_SYSTEM_KEY;

  let fubStatus = 0, fubText = "";
  try {
    const r = await fetch("https://api.followupboss.com/v1/events", { method: "POST", headers, body: JSON.stringify(event) });
    fubStatus = r.status; fubText = await r.text();
  } catch (e) { fubText = String(e); }

  if (fubStatus < 200 || fubStatus >= 300) {
    console.error("FUB error", fubStatus, fubText.slice(0, 500));
    if (env.LEADS) { try { await env.LEADS.put(`failed:${id}`, JSON.stringify({ fubStatus, fubText: fubText.slice(0, 2000), event })); } catch {} }
    // Don't strand the visitor: their details are saved (if KV) — but be honest that delivery may be delayed.
    return json({ error: "we couldn't reach the CRM" }, 502);
  }

  // ---- Run the snapshot in the background (seller only). The visitor's response is not delayed. ----
  if (type === "seller" && env.SNAPSHOT_ENABLED === "true" && env.REPLIERS_API_KEY) {
    waitUntil(runSnapshot(env, { id, email, firstName, address, areaName, timeline }));
  }

  return json({ ok: true });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, endpoint: "POST /api/lead" }), { headers: { "Content-Type": "application/json" } });
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }
