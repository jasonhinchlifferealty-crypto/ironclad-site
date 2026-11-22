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

Not yet built: the email that tells subscribers a new edition is out. `workers/kv-pulse.js` still
composes the old neighbourhood email and is parked.
