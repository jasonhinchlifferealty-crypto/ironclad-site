# Ironclad Realty Group — Launch & Maintenance Guide

*Written for a non-technical operator. Every step is click-by-click. Work top to bottom; each part builds on the last. Budget an afternoon for Parts 1–5 (site live on a temporary address), and a second sitting for Parts 6–10 (your domain, email, data, and the briefing agent).*

**One rule above all: API keys and passwords go into Cloudflare's settings screens only. Never paste them into a chat, an email, or a file in the project.**

---

## What you're launching

| Piece | What it does | Where it lives |
|---|---|---|
| The website | The KV Market Pulse map, lead forms, bio | Cloudflare Pages (free) |
| Lead relay | Sends form submissions into Follow Up Boss, tagged | Runs inside the Pages project automatically |
| Snapshot engine | Emails sellers their Street-Level Equity Snapshot | Runs inside the Pages project automatically |
| Briefing agent | Your 7 a.m. weekday market email | A separate Cloudflare Worker (free) |
| Your code | The master copy of every file | GitHub (free) |

**Accounts you need:** GitHub and Cloudflare (you have both), Follow Up Boss (you have it), Repliers (you have a key), **Resend** (new — free email-sending service, Part 7), Google Calendar (optional, Part 10).

---

## Part 1 — Put the files on GitHub

GitHub is where the master copy lives. Cloudflare watches it; every time you change a file here, the live site updates itself within a minute or two.

1. Unzip `ironclad-site-v1.0.zip` on your computer. You'll get a folder called `ironclad`.
2. Go to **github.com** and sign in.
3. Top-right, click the **+** and choose **New repository**.
4. Repository name: `ironclad-site`. Leave it **Public** or set **Private** — either works with Cloudflare. Don't tick any of the "initialize" boxes. Click **Create repository**.
5. On the next screen, click the link **uploading an existing file**.
6. Open the unzipped `ironclad` folder on your computer. Select **everything inside it** (the `public` folder, `functions` folder, `workers` folder, `README.md`, `package.json`) and **drag them onto the GitHub upload box**. Wait for the file list to finish loading — it'll show 70-odd files.
7. At the bottom, in "Commit changes", type `Initial site` and click **Commit changes**.
8. You should now see folders `public`, `functions`, `workers` in your repository. If `public` is missing, the drag didn't include the folder contents — try again with step 6.

---

## Part 2 — Create the Cloudflare Pages project

1. Open this exact link (it skips the screen that sometimes routes you into the wrong "Workers" flow):
   **https://dash.cloudflare.com/?to=/:account/pages/new/provider/github**
2. If asked, click **Connect GitHub** and authorize Cloudflare. Choose **Only select repositories** → pick `ironclad-site` → **Install & Authorize**.
3. Back in Cloudflare, select `ironclad-site` and click **Begin setup**.
4. Fill in:
   - Project name: `ironclad-site`
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: **leave empty**
   - Build output directory: `public`
5. Click **Save and Deploy**. Wait about a minute for the green "Success".
6. Click the link that looks like `https://ironclad-site.pages.dev`. Your site is live on a temporary address. The map should draw with the red neighbourhoods over real streets. The ink bar at the top saying "Sample figures" is expected for now.

If you ever see the project listed under "Workers" instead of "Pages", delete it (Settings → bottom → Delete) and redo this Part from step 1 using the link above.

---

## Part 3 — Create the lead backup store (KV)

This keeps a copy of every lead inside Cloudflare, so nothing is lost even if Follow Up Boss is down.

1. Cloudflare dashboard → left menu **Storage & Databases** → **KV**.
2. Click **Create a namespace**. Name: `ironclad-leads`. Click **Add**.
3. Now go to **Workers & Pages** → click **ironclad-site** → **Settings** → scroll to **Bindings** → **Add** → choose **KV namespace**.
4. Variable name: `LEADS` (all capitals, exactly). KV namespace: `ironclad-leads`. Click **Save**.

---

## Part 4 — Connect Follow Up Boss

1. In Follow Up Boss: click your name (bottom-left) → **Admin** → **API**.
2. Click **Create API Key**. Name it `Ironclad Website`. Copy the key it shows you.
3. In Cloudflare: **Workers & Pages** → **ironclad-site** → **Settings** → **Environment variables** → **Add variable**.
4. Variable name: `FUB_API_KEY`. Value: paste the key. Tick **Encrypt**. Make sure **Production** is selected. Click **Save**.
5. **Redeploy** so the key takes effect: **Deployments** tab → on the top deployment click the **⋯** menu → **Retry deployment**. Wait for Success. *(Every time you add or change a variable, do this redeploy step. Cloudflare doesn't apply new settings to the running site until you do.)*

---

## Part 5 — Test a lead end-to-end

1. Open your `pages.dev` site. Click any neighbourhood, then **Get my street-level snapshot**.
2. Fill in the form with your own details and a real address. Pick a timeline. Tick consent. Submit.
3. You should see "Received. Your snapshot is on its way…"
4. In Follow Up Boss, look for a new person with your details. Open them: the tags should include `Ironclad-Website`, `Seller`, `Heatmap-Lead`, the neighbourhood (e.g. `Area-Quispamsis`), a timeline tag, `Hot-Seller` if you picked 0–6 months, and `Snapshot-Manual` (because the snapshot engine isn't switched on yet — Part 8).
5. Test the buyer form (Buy section → **Send me matches**) and the Pulse signup (red band). Each should appear in FUB with `Buyer` / `KV-Pulse-Subscriber` tags.

If nothing appears in FUB: check the key was pasted correctly with no spaces, and that you did the redeploy in Part 4 step 5.

---

## Part 6 — Point your domains at Cloudflare

**⚠ Before you touch nameservers, protect your email.** If `jason@ironcladrealty.ca` is hosted with GoDaddy, Google Workspace, or Microsoft, its mail settings (called MX records) currently live at GoDaddy. Cloudflare will try to copy them across automatically, but you must verify they came over before switching, or your email stops working.

### 6a. Add ironcladrealty.ca to Cloudflare
1. Cloudflare dashboard → **Add a domain** (or **Websites** → **Add a domain**). Type `ironcladrealty.ca`. Choose the **Free** plan.
2. Cloudflare scans your existing DNS records and shows a list. **Look for records of type MX** (your email). If you see them, good. If you don't and you use that email, click **Add record** and copy them from GoDaddy's DNS page first (GoDaddy → My Products → your domain → DNS).
3. Click **Continue**. Cloudflare shows you **two nameservers** (they look like `anna.ns.cloudflare.com` and `rob.ns.cloudflare.com`). Keep this page open.

### 6b. Change nameservers at GoDaddy
1. GoDaddy → **My Products** → next to `ironcladrealty.ca` click **DNS** (or **Manage DNS**).
2. Find **Nameservers** → **Change**. Choose **Enter my own nameservers (advanced)**.
3. Delete what's there and paste Cloudflare's two nameservers, one per box. Save. Confirm any warning.
4. Back in Cloudflare click **Done, check nameservers**. It can take from 10 minutes to 24 hours. You'll get an email from Cloudflare when it's active.

### 6c. Attach the domain to the site
1. Once Cloudflare says the domain is active: **Workers & Pages** → **ironclad-site** → **Custom domains** → **Set up a custom domain**.
2. Enter `ironcladrealty.ca` → **Continue** → **Activate domain**.
3. Repeat for `www.ironcladrealty.ca`.
4. Within a few minutes, `https://ironcladrealty.ca` shows your site with a padlock. Send yourself a test email to confirm mail still works.

### 6d. Make ironcladrealty.com redirect
1. Repeat 6a and 6b for `ironcladrealty.com` (add domain to Cloudflare, change GoDaddy nameservers).
2. Once active, in **ironclad-site** → **Custom domains**, add `ironcladrealty.com` and `www.ironcladrealty.com` as well. The site already contains a rule that bounces `.com` visitors to `.ca`.
3. Test: type `ironcladrealty.com` into a browser; you should land on `ironcladrealty.ca`.
   *If it shows the site without redirecting, use the fallback:* Cloudflare → `ironcladrealty.com` → **Rules** → **Redirect Rules** → **Create rule** → name `to-ca` → "When incoming requests match: All incoming requests" → Then: Type **Dynamic**, expression `concat("https://ironcladrealty.ca", http.request.uri.path)`, status **301** → **Deploy**.

---

## Part 7 — Set up email sending (Resend)

Snapshots and briefings are sent through Resend. Free tier covers thousands of emails a month.

1. Go to **resend.com** → sign up with `jason@ironcladrealty.ca`.
2. Left menu **Domains** → **Add Domain** → enter `ironcladrealty.ca` → region: pick the North American option → **Add**.
3. Resend shows **3 DNS records** to add (one MX, two TXT). For each one: open a second tab at Cloudflare → `ironcladrealty.ca` → **DNS** → **Records** → **Add record**, and copy the **Type**, **Name**, and **Content/Value** exactly as Resend shows. Where Cloudflare asks about **Proxy status**, set it to **DNS only** (grey cloud).
4. Back in Resend click **Verify DNS Records**. Usually verifies within a few minutes.
5. Resend → **API Keys** → **Create API Key** → name `Ironclad`, permission **Sending access** → **Add**. Copy the key (it's only shown once).
6. Cloudflare → **ironclad-site** → **Settings** → **Environment variables** → add:
   - `RESEND_API_KEY` = the key (tick Encrypt)
   - `SNAPSHOT_FROM` = `Jason Hinchliffe <jason@ironcladrealty.ca>`
7. **Retry deployment** (Deployments → ⋯ → Retry).

---

## Part 8 — Switch on live data and the Snapshot engine (Repliers)

1. Log in to your **Repliers** dashboard and copy your API key.
2. While there, check two things and note the answers: **which NB boards/feeds your key is approved for**, and **whether sold listings are included**. (If solds aren't included, the snapshot engine will still run but will report "fewer than 3 comparable sales" and tag leads `Snapshot-Manual` — call Repliers to get sold data enabled.)
3. Cloudflare → **ironclad-site** → **Settings** → **Environment variables** → add:
   - `REPLIERS_API_KEY` = your key (tick Encrypt)
   - `SNAPSHOT_ENABLED` = `true`
   - `SHOW_COMP_DETAILS` = `false` *(leave off until your board confirms sold-price display rules for direct email; then set `true` to include street names on comps)*
4. **Retry deployment**.
5. **Test:** submit the snapshot form with your own address and email. Within a minute or two you should receive the branded snapshot email. In FUB, your record gets a note with the range quoted and the tag `Snapshot-Sent`. If instead you get `Snapshot-Manual`, open FUB → the note explains why (address not found, too few comps, email not configured).

---

## Part 9 — Deploy the morning briefing agent

1. Cloudflare → **Workers & Pages** → **Create** → **Workers** tab → **Create Worker** (sometimes "Start with Hello World").
2. Name: `ironclad-briefing` → **Deploy**.
3. Click **Edit code**. Delete everything in the editor. Open `workers/briefing.js` from the unzipped folder in a text editor (Notepad/TextEdit), select all, copy, paste into the Cloudflare editor. Click **Deploy** (top-right).
4. Go back to the worker → **Settings** → **Variables and Secrets** → add (choose "Secret" for the two keys):
   - `REPLIERS_API_KEY` = your Repliers key
   - `RESEND_API_KEY` = your Resend key
   - `BRIEFING_TO` = `jason@ironcladrealty.ca`
   - `BRIEFING_FROM` = `Ironclad Briefing <jason@ironcladrealty.ca>`
   - `BRIEFING_TEST_KEY` = any private word you'll remember, e.g. `maple-2026`
   - `SITE_URL` = `https://ironcladrealty.ca`
5. **Settings** → **Triggers** → **Cron Triggers** → **Add Cron Trigger** → paste `0 10 * * 1-5` → **Add**. (That's 7:00 a.m. Atlantic daylight time, Monday–Friday.)
6. **Test right now:** the worker has an address like `https://ironclad-briefing.YOURNAME.workers.dev`. Open it in a browser with your test key added: `https://ironclad-briefing.YOURNAME.workers.dev/?key=maple-2026`. You'll see this morning's briefing on screen. Add `&send=1` to the end to actually email it to yourself.
   If the on-screen version shows "Data gaps" or empty sections, the Repliers field names for your board may differ slightly — send me a screenshot and it's a quick adjustment.

---

## Part 10 — Finishing touches

### FUB Pixel (returning-visitor tracking)
1. FUB → **Admin** → **Pixel** → copy the tracking snippet.
2. GitHub → `ironclad-site` → `public` → `index.html` → click the **pencil** (Edit).
3. Scroll to the very bottom. Paste the snippet on its own lines **just above** `</body>`.
4. **Commit changes**. Cloudflare redeploys automatically.

### Book a Call button
1. Google Calendar (on a computer) → **Create** → **Appointment schedule** → name it `Call with Ironclad Realty`, set your available hours and 20-minute slots → **Save**.
2. Open the schedule → **Share** → copy the **booking page link**.
3. GitHub → `public/assets/js/config.js` → pencil → find `bookingUrl: ""` and paste the link between the quotes → **Commit changes**.
Until you do this, Book a Call opens the snapshot form, which is fine.

### Photos (whenever ready)
Drop `region-1.jpg`, `region-2.jpg`, `region-3.jpg` into `public/assets/img/photos/` on GitHub (open the folder → **Add file** → **Upload files**). The photo band appears by itself.

### Go-live checklist
- [ ] `https://ironcladrealty.ca` loads with padlock; map draws over real streets
- [ ] Test seller lead lands in FUB with correct tags
- [ ] Snapshot email received; FUB note shows the range
- [ ] Email to/from `jason@ironcladrealty.ca` still works after nameserver change
- [ ] `ironcladrealty.com` redirects to `.ca`
- [ ] Briefing test URL shows a briefing; `&send=1` delivers it
- [ ] FUB Pixel pasted in
- [ ] Neighbourhood boundaries reviewed on the live map (see Maintenance → Boundaries)

---

## Maintenance

### Monthly data update (until Repliers feeds the map live)
1. GitHub → `public/data/pulse.json` → pencil.
2. Change `"period"` (e.g. `"August 2026"`) and `"updated"` (e.g. `"2026-09-01"`).
3. For each neighbourhood, update `median`, `dom`, `sales`, `active`, `yoy`, `listToSale`, and `activity` (one of `low`, `moderate`, `steady`, `active`, `hot`). Update the `region` block the same way.
4. **The first time you enter real figures, change `"sample": true` to `"sample": false`.** That removes the "Sample figures" bar.
5. **Commit changes.** Live within two minutes. Numbers must be numbers with no `$` or commas: `462000`, not `$462,000`. Percentages are decimals: `0.061` means +6.1%.

### Neighbourhood boundaries
The polygons were drafted from geography, not surveyed. To adjust:
1. Go to **geojson.io** → **Open** → **File** → choose `public/data/areas.geojson` from your unzipped folder.
2. Click a shape, drag its corner points. Right-click a point to delete; click a line to add one.
3. **Save** → **GeoJSON**. It downloads a file — rename it `areas.geojson`.
4. GitHub → `public/data/` → **Add file** → **Upload files** → drop the new file (it replaces the old one) → **Commit**.

### Editing words on the site
GitHub → `public/index.html` → pencil → find the sentence (Ctrl/Cmd+F) → change it → **Commit**. Stay inside the quotation marks and don't delete the angle-bracket tags around text.

### What the FUB tags mean
| Tag | Meaning |
|---|---|
| `Seller` / `Buyer` / `KV-Pulse-Subscriber` | Which form they used |
| `Heatmap-Lead` | Came through the map's snapshot form |
| `Area-…` | Neighbourhood they clicked |
| `Timeline-0-3`, `-3-6`, `-6-12`, `-Curious` | Their stated timeline |
| `Hot-Seller` | Timeline within 6 months — call today |
| `Referral` | Address/area outside Sussex–Saint John — refer it out |
| `Snapshot-Sent` | Engine emailed the snapshot; FUB note has the range |
| `Snapshot-Manual` | Engine couldn't — send one by hand; note says why |

### If something breaks
- **Site looks wrong after an edit:** Cloudflare → **ironclad-site** → **Deployments** → find the last good one → **⋯** → **Rollback to this deployment**. Instant.
- **Leads not reaching FUB:** the copies are in Cloudflare → **Storage & Databases** → **KV** → `ironclad-leads` → look for keys starting `failed:`. Each contains the lead and the error.
- **Snapshot emails not arriving:** check Resend → **Emails** for delivery status; check spam.
- **Briefing didn't arrive:** open the test URL from Part 9 step 6 — the on-screen version shows any data errors in red at the bottom.

### Environment variables — full reference
| Where | Name | Purpose |
|---|---|---|
| Pages | `FUB_API_KEY` | Follow Up Boss key (required) |
| Pages | `REPLIERS_API_KEY` | Repliers key (for snapshots) |
| Pages | `RESEND_API_KEY` | Email sending (for snapshots) |
| Pages | `SNAPSHOT_ENABLED` | `true` to run the engine |
| Pages | `SNAPSHOT_FROM` | Sender name/address for snapshots |
| Pages | `SHOW_COMP_DETAILS` | `true` to show street names on comps |
| Pages | `ALLOWED_ORIGIN` | Optional; `https://ironcladrealty.ca` to lock the form to your domain |
| Pages binding | `LEADS` | KV namespace for lead backups |
| Worker | `REPLIERS_API_KEY`, `RESEND_API_KEY`, `BRIEFING_TO`, `BRIEFING_FROM`, `BRIEFING_TEST_KEY`, `SITE_URL` | Briefing agent settings |

---

*Ironclad Realty Group site v1.0 — September 2026.*
