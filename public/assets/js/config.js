// Ironclad Realty Group — site settings.
// This is the only code file you should need to edit. Change the values in quotes, save, and push.
window.IRONCLAD = {
  phone: "506-608-3333",
  phoneHref: "tel:+15066083333",
  smsHref: "sms:+15066083333",
  email: "jason@ironcladrealty.ca",

  // Paste your Google Calendar appointment page link here (see launch guide, step "Book a Call").
  // Leave empty and the Book a Call buttons will open the callback form instead.
  bookingUrl: "",

  // Map tiles: OpenStreetMap (free, no key; the site greys them via CSS to match the brand).
  // Optional upgrade if traffic ever grows: get a free MapTiler key and swap in
  // "https://api.maptiler.com/maps/dataviz-light/{z}/{x}/{y}.png?key=YOUR_KEY" (then remove the CSS grey filter).
  tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileLabelsUrl: "",
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',

  // Where the map opens (Kennebecasis Valley + Saint John) and how far it can wander.
  mapCenter: [45.36, -66.02],
  mapZoom: 10.6,

  // Where the map data comes from. "/api/pulse" is live MLS® actives, aggregated and cached.
  // If it's ever unreachable, the site falls back to the static sample file automatically.
  pulseUrl: "/api/pulse",
  pulseFallbackUrl: "/data/pulse.json",
  areasUrl: "/data/areas.geojson"
};
