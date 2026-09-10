/* Ironclad — quiz-data.js
   The KV Personality Test: questions, neighbourhood attribute matrix, personas.
   Dimensions (0–4 scales): pace (0 city → 4 deep rural), space (0 compact → 4 acreage),
   water (0 indifferent → 4 on-the-water), heritage (0 new-build → 4 century character),
   family (0 quiet/adult → 4 kid-central). commute = minutes-ish to uptown Saint John.
   Jason: edit personas and attributes freely — this file is content, not machinery. */
window.QUIZ = {
  questions: [
    { q: "It's Saturday, 9 a.m. Where are you?",
      a: [
        { t: "Espresso in hand, walking somewhere with sidewalks and strangers", s: { pace: 0, space: 0 } },
        { t: "Kids' practice, then the good bakery", s: { family: 4, pace: 2 } },
        { t: "On a trail before the phone finds me", s: { pace: 3, space: 3 } },
        { t: "Deck. Coffee. Watching the water do its thing", s: { water: 4, pace: 2 } }
      ]},
    { q: "Your honest relationship with lawn care:",
      a: [
        { t: "What lawn? I have plans", s: { space: 0, pace: 0 } },
        { t: "A tidy yard is a small joy", s: { space: 2 } },
        { t: "Give me land. The mower is my throne", s: { space: 4, pace: 3 } }
      ]},
    { q: "The drive to Saint John should be…",
      a: [
        { t: "A rumour — I want to live in it", s: { commutePref: 5, pace: 0 } },
        { t: "Fifteen minutes, tops", s: { commutePref: 18 } },
        { t: "Under half an hour is fine", s: { commutePref: 30 } },
        { t: "Irrelevant. I work from my kitchen", s: { commutePref: 60, pace: 3 } }
      ]},
    { q: "Perfect background noise:",
      a: [
        { t: "The city doing city things", s: { pace: 0 } },
        { t: "Kids on bikes, a dog two doors down", s: { family: 3, pace: 2 } },
        { t: "Wind, birds, the occasional tractor", s: { pace: 4, space: 3 } },
        { t: "Waves or river current, ideally", s: { water: 3, pace: 2 } }
      ]},
    { q: "Pick a house's soul:",
      a: [
        { t: "Century character — creaky floors are a feature", s: { heritage: 4 } },
        { t: "Nineties-solid — boring and bulletproof", s: { heritage: 2 } },
        { t: "New-build smell and straight walls", s: { heritage: 0 } }
      ]},
    { q: "Who's moving in?",
      a: [
        { t: "Just me / the two of us", s: { family: 0, beds: 2 } },
        { t: "A growing crew — schools matter", s: { family: 4, beds: 3 } },
        { t: "Downsizing — less house, more life", s: { family: 1, beds: 2, space: 1 } },
        { t: "Us plus guests, hobbies, maybe a home office empire", s: { beds: 4, space: 2 } }
      ]},
    { q: "A house that needs work is…",
      a: [
        { t: "A fresh canvas — hand me the sledgehammer", s: { reno: 4 } },
        { t: "Fine, if it's paint-and-lighting work", s: { reno: 2 } },
        { t: "Absolutely not. Turnkey or nothing", s: { reno: 0 } }
      ]},
    { q: "Pick a shape:",
      a: [
        { t: "One floor, no stairs, bungalow life", s: { typePref: "bungalow" } },
        { t: "Two storeys — bedrooms live upstairs", s: { typePref: "two-storey" } },
        { t: "The right house picks its own shape", s: { typePref: "" } }
      ]},
    { q: "The garage question:",
      a: [
        { t: "Non-negotiable. Preferably heated", s: { garage: 2 } },
        { t: "Nice to have", s: { garage: 1 } },
        { t: "Cars live outside. It's fine", s: { garage: 0 } }
      ]},
    { q: "Water, honestly:",
      a: [
        { t: "I need to see it daily", s: { water: 4 } },
        { t: "A nice bonus, not a requirement", s: { water: 2 } },
        { t: "I'm a trees person", s: { water: 0, space: 2, pace: 2 } }
      ]},
    { q: "Last one. The budget — don't worry, we won't tell the seller:",
      a: [
        { t: "Under $300K", s: { budget: 280000 } },
        { t: "$300K – $450K", s: { budget: 380000 } },
        { t: "$450K – $600K", s: { budget: 520000 } },
        { t: "$600K and up", s: { budget: 700000 } }
      ]}
  ],

  /* Attribute matrix — 19 areas. Jason's local knowledge outranks mine: tune freely. */
  areas: {
    "sussex":              { pace: 3, space: 3, water: 1, heritage: 3, family: 3, commute: 55 },
    "sussex-corner":       { pace: 3, space: 3, water: 1, heritage: 2, family: 3, commute: 58 },
    "penobsquis":          { pace: 4, space: 4, water: 1, heritage: 2, family: 2, commute: 62 },
    "apohaqui":            { pace: 4, space: 4, water: 2, heritage: 3, family: 2, commute: 50 },
    "roachville":          { pace: 4, space: 4, water: 1, heritage: 2, family: 2, commute: 57 },
    "norton":              { pace: 4, space: 4, water: 2, heritage: 2, family: 2, commute: 42 },
    "bloomfield":          { pace: 4, space: 3, water: 2, heritage: 3, family: 2, commute: 35 },
    "passekeag":           { pace: 4, space: 4, water: 1, heritage: 2, family: 2, commute: 37 },
    "nauwigewauk":         { pace: 3, space: 3, water: 3, heritage: 2, family: 2, commute: 28 },
    "hampton":             { pace: 2, space: 2, water: 3, heritage: 3, family: 4, commute: 30 },
    "quispamsis":          { pace: 2, space: 2, water: 2, heritage: 1, family: 4, commute: 20 },
    "gondola-point":       { pace: 2, space: 2, water: 4, heritage: 2, family: 3, commute: 22 },
    "rothesay":            { pace: 1, space: 2, water: 3, heritage: 4, family: 3, commute: 15 },
    "grand-bay-westfield": { pace: 3, space: 3, water: 4, heritage: 2, family: 3, commute: 25 },
    "millidgeville":       { pace: 1, space: 1, water: 3, heritage: 1, family: 3, commute: 10 },
    "north-end":           { pace: 1, space: 1, water: 2, heritage: 3, family: 2, commute: 6 },
    "uptown":              { pace: 0, space: 0, water: 2, heritage: 4, family: 1, commute: 0 },
    "east-side":           { pace: 1, space: 1, water: 1, heritage: 1, family: 3, commute: 8 },
    "west-side":           { pace: 1, space: 1, water: 2, heritage: 3, family: 2, commute: 8 }
  },

  personas: {
    "sussex": { title: "The Dairy-Town Realist", body: "You want a real town, not a suburb pretending: main street, mountain views, and enough land that nobody hears your opinions. Sussex gives you agricultural honesty with an actual community attached — and prices that make city people quietly furious." },
    "sussex-corner": { title: "The Edge-of-Town Original", body: "Close enough to Sussex for the essentials, far enough that the stars still work. You like your neighbours at a wave's distance and your evenings unscheduled." },
    "penobsquis": { title: "The Space Maximalist", body: "Your dream has outbuildings. Penobsquis is where land stops being a lot and starts being property — for people whose hobbies need square footage and whose ideal traffic jam is one tractor." },
    "apohaqui": { title: "The River-Road Quiet", body: "A village where the Kennebecasis is young, the pace is honest, and your money buys acreage with history on it. You didn't want convenient. You wanted yours." },
    "roachville": { title: "The Understated Homesteader", body: "No pretensions, no traffic, no HOA opinions. Roachville is for people who measure wealth in privacy and firewood." },
    "norton": { title: "The Corridor Pragmatist", body: "Halfway between Sussex and the Valley, Norton is the reasonable answer nobody brags about and everybody's glad they chose: land, quiet, and a commute that's a podcast, not a punishment." },
    "bloomfield": { title: "The Pastoral Commuter", body: "Rolling farmland with Hampton's services ten minutes off. You want the view from a century farmhouse and the option of civilization on demand." },
    "passekeag": { title: "The Gravel-Road Purist", body: "You know exactly how you want to live, and it involves trees, sky, and a firepit with regulars. Passekeag doesn't advertise. That's the point." },
    "nauwigewauk": { title: "The Best-Kept-Secret Keeper", body: "Tucked between Hampton and the Valley with water close and prices kinder than the postal codes around it. You like value other people haven't noticed yet." },
    "hampton": { title: "The Riverside Classic", body: "A proper town on the Kennebecasis: schools people move for, a main street with a pulse, and heritage homes that got maintained instead of flipped. You want community that predates you and outlasts trends." },
    "quispamsis": { title: "The Family Operations Director", body: "You run a household like a small logistics firm, and Quispamsis is the depot: schools, rinks, trails, groceries, all within the sound of children thriving. The Valley's engine room, and proudly so." },
    "gondola-point": { title: "The Water-Line Local", body: "Same Valley conveniences, but with the river actually in your life — the ferry, the coves, the light off the water at supper. You'd trade twenty square feet of kitchen for that view without blinking." },
    "rothesay": { title: "The Established-Avenue Type", body: "Mature trees, mature architecture, mature opinions about both. Rothesay is heritage streets, waterfront estates, and a fifteen-minute run to town — the Valley's old-money postal code, worn comfortably." },
    "grand-bay-westfield": { title: "The Riverfront Independent", body: "West of the crowd, on the wide part of the river, where lots are generous and the sunsets do overtime. You want water and elbow room more than you want to be on the way to anything." },
    "millidgeville": { title: "The Ten-Minutes-From-Everything Strategist", body: "City address, water views, university and hospital in arm's reach — Millidgeville is Saint John for people who optimized. You want urban without the compromise clichés." },
    "north-end": { title: "The Value Hunter", body: "You see what the North End is becoming, not just what it's been: character housing, real prices, and a position minutes from everything. Buying here is a thesis, and you like your theses early." },
    "uptown": { title: "The Brick-and-Fog Romantic", body: "Century brick, harbour fog, restaurants you walk to and neighbours with stories. Uptown Saint John is the region's only true urban life, and you wouldn't trade a heated garage for it." },
    "east-side": { title: "The Sensible-Money Manager", body: "Solid streets, every amenity in ten minutes, and mortgages that leave room for a life. The East Side is where practicality lives — and you've done the math." },
    "west-side": { title: "The Harbour-View Contrarian", body: "Views the fancy postal codes would kill for, at prices they don't understand. The West Side rewards people who judge a neighbourhood by walking it, not by hearsay — and you've always trusted your own eyes." }
  }
};
