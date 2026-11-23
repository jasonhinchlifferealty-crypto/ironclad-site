# The Ironclad Market Pulse — adding an edition

The report archive lives at `/pulse/`. Each edition is a folder named for its report month.

```
public/pulse/index.html                      archive: "Latest" card + "All editions" list
public/pulse/2026-11/index.html              Edition 1 summary page
public/pulse/2026-11/Ironclad-Market-Pulse-Edition-1.pdf
public/assets/img/pulse/edition-1.png        1200x630 link-preview image (Facebook, LinkedIn)
```

## Each month

1. Use only the PUBLIC version of the PDF (no "Review draft" line on the cover).
2. Copy the newest edition folder to `public/pulse/YYYY-MM/`. Put the new PDF in it as
   `Ironclad-Market-Pulse-Edition-N.pdf`.
3. Rewrite the copied `index.html` from the new PDF's executive summary: title, description,
   `og:` tags, both dates in the JSON-LD, headline, key number, the four stat tiles, every
   section. Numbers must match the PDF exactly.
4. Make a new link-preview image at `public/assets/img/pulse/edition-N.png` (1200x630, same
   layout as Edition 1) and point the page's `og:image` at it.
5. In `public/pulse/index.html`: replace the "Latest" card, add a new `<li>` at the top of
   "All editions", update the "Next edition" line, add the edition to `hasPart` in the JSON-LD,
   and point `og:image` at the newest image.
6. Add the new page to `public/sitemap.xml`.
7. Add the edition to `public/pulse/editions.json` (see "Subscriber email" below). Do this LAST,
   in the same upload as the page and PDF: the email worker announces whatever is newest in
   that file.

## Rules carried over from the report

- Write MLS® and REALTOR® with the ® mark every time.
- Never name, grade or critique another brokerage or REALTOR®.
- Forecast grades for a year are provisional until that year's December data is published. Say so.
- Keep both closing disclaimer lines word for word.
- `public/assets/js/config.js` is Jason's file. Do not edit or overwrite it.

## Signup form

The form on the Pulse pages posts to `/api/lead` with type `subscriber`, source `KV-Pulse-Signup`.
The CRM tag is still `KV-Pulse-Subscriber`. The old names are kept on purpose so Follow Up Boss
automations keep working.

## Subscriber email (automatic)

`workers/kv-pulse.js` is the source of the Cloudflare Worker named `ironclad-pulse`. It is not
deployed from GitHub: after changing it, paste it into the Worker in the Cloudflare dashboard.

Each morning (cron `0 12,13,14 * * *`, UTC) the worker reads `/pulse/editions.json` on the live
site. If the edition with the highest `n` has not been emailed, it emails every subscriber once
and sends Jason a report. Nothing else triggers a send, so publishing the edition is the approval.

An entry in `editions.json`:

```json
{
  "n": 2,
  "date": "2026-12-18",
  "dataTo": "November 2026",
  "headline": "The cover headline, as on the summary page",
  "key": "−8.1%",
  "keyLine": "One sentence explaining the key number.",
  "points": ["Three or four one-sentence findings.", "...", "..."],
  "url": "/pulse/2026-12/",
  "pdf": "/pulse/2026-12/Ironclad-Market-Pulse-Edition-2.pdf"
}
```

- Add `"email": false` to an entry that must never be emailed (Edition 1 has it).
- The worker will not send if the page or PDF does not load, or if a field is missing. It warns
  Jason once and tries again the next morning.
- Sends are recorded in the `LEADS` KV namespace under `pulse-email:sent:<n>`. To stop an edition
  from being sent, add `"email": false` before the next morning check.
- Status page and test send: the worker URL with `?key=` and the PULSE_KEY value.
- At most 25 subscribers per run, three runs a morning (Cloudflare free plan: 50 outside requests
  per run; Resend free tier: 100 emails a day).
