# Ironclad Realty Group — website

Cloudflare Pages site. Build output directory: `public`. Serverless functions live in `functions/`.

- `public/index.html` — the site (single page for now)
- `public/assets/js/config.js` — the ONE file to edit for phone, booking link, map tiles, data URLs
- `public/data/pulse.json` — the monthly market numbers (set `"sample": false` when real)
- `public/data/areas.geojson` — neighbourhood boundaries (edit visually at geojson.io)
- `functions/api/lead.js` — form → Follow Up Boss relay (needs FUB_API_KEY in Cloudflare env vars)
- `functions/api/event.js` — Book-a-Call click counter
- `workers/briefing.js` — daily briefing agent (deploy per guide Part 9)
- `functions/api/_lib/snapshot.js` — Street-Level Equity Snapshot engine

Full launch guide: `LAUNCH-GUIDE.md`.
