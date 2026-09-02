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

  // Map tiles. Default is CARTO Positron (free, no key). If you ever get a MapTiler key,
  // swap in: "https://api.maptiler.com/maps/dataviz-light/{z}/{x}/{y}.png?key=YOUR_KEY"
  tileUrl: "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
  tileLabelsUrl: "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
  tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',

  // Where the map opens (Kennebecasis Valley + Saint John) and how far it can wander.
  mapCenter: [45.36, -66.02],
  mapZoom: 10.6,

  // Where the map data comes from. "/api/pulse" is live MLS® actives, aggregated and cached.
  // If it's ever unreachable, the site falls back to the static sample file automatically.
  pulseUrl: "/api/pulse",
  pulseFallbackUrl: "/data/pulse.json",
  areasUrl: "/data/areas.geojson"
};
