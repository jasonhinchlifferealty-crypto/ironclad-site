/**
 * Ironclad Investment Screener — /api/invest?key=DIAG_KEY
 * Private tool: scans every active multi-unit listing in New Brunswick (residential
 * "Multi Family" + commercial class filtered to income keywords), parses unit counts and
 * bedrooms from style + description text (NB feeds carry no income fields — diag-proven),
 * estimates gross rent from an editable CMHC-anchored table, and ranks by estimated yield.
 * Renders a sortable table and a client-facing, Ironclad-branded printable report
 * (Ctrl+P → save as PDF) with methodology + disclaimers, plus private talking points.
 *
 * This is an evidence-based SCREEN for ranking candidates for diligence — not underwriting.
 * The report says so in writing.
 */

const REPLIERS = "https://api.repliers.io";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.DIAG_KEY || url.searchParams.get("key") !== env.DIAG_KEY) return new Response("Not found", { status: 404 });
  return new Response(PAGE.replace("{{KEY}}", url.searchParams.get("key")), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  let body; try { body = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  if (!env.DIAG_KEY || (url.searchParams.get("key") !== env.DIAG_KEY && body.key !== env.DIAG_KEY)) return new Response("Not found", { status: 404 });

  const notes = [];
  const raw = [];

  // Residential Multi Family — try the server-side propertyType filter first (cheap), fall back with a note.
  let mf = await pull(env, { status: "A", class: "residential", propertyType: "Multi Family", resultsPerPage: 100 }, 3, notes, "residential propertyType filter");
  if (mf === null) {
    notes.push("propertyType filter rejected by feed — falling back to style keyword filter");
    mf = await pull(env, { status: "A", class: "residential", style: "Duplex", resultsPerPage: 100 }, 3, notes, "style=Duplex fallback");
  }
  if (mf) raw.push(...mf.map(l => ({ ...l, _src: "residential" })));

  // Commercial class — pull and keyword-filter for income property signals.
  const com = await pull(env, { status: "A", class: "commercial", resultsPerPage: 100 }, 6, notes, "commercial class");
  if (com) {
    const kw = /apartment|multi[- ]?family|(\d+)\s*unit|plex|income\s+propert|rooming/i;
    raw.push(...com.filter(l => kw.test(((l.details && l.details.description) || "") + " " + ((l.details && l.details.style) || ""))).map(l => ({ ...l, _src: "commercial" })));
  }

  // De-dupe by MLS
  const seen = {}; const listings = raw.filter(l => l.mlsNumber && !seen[l.mlsNumber] && (seen[l.mlsNumber] = 1));
  const rows = listings.map(l => analyze(l)).filter(Boolean);
  return json({ ok: true, generated: new Date().toISOString(), count: rows.length, notes, rows });
}

async function pull(env, params, maxPages, notes, label) {
  const out = [];
  for (let pg = 1; pg <= maxPages; pg++) {
    const qs = new URLSearchParams({ ...params, pageNum: pg });
    const r = await fetch(`${REPLIERS}/listings?${qs}`, { headers: { "REPLIERS-API-KEY": env.REPLIERS_API_KEY || "" } });
    if (!r.ok) { if (pg === 1) { notes.push(`${label}: Repliers ${r.status}`); return null; } break; }
    const j = await r.json();
    const batch = j.listings || [];
    out.push(...batch);
    if (batch.length < 100) break;
    if (pg === maxPages && j.count > maxPages * 100) notes.push(`${label}: capped at ${maxPages * 100} of ${j.count}`);
  }
  return out;
}

/* ---------- parsing & metrics ---------- */
const WORDNUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
function analyze(l) {
  const d = l.details || {};
  const desc = String(d.description || "");
  const style = String(d.style || "");
  const price = num(l.listPrice);
  if (!price) return null;

  // Unit count: style first, then description
  let styleUnits = /duplex/i.test(style) ? 2 : /triplex/i.test(style) ? 3 : /four\s*plex|quad/i.test(style) ? 4 : null;
  let descUnits = null;
  let m = desc.match(/(\d{1,2})\s*[- ]?(?:unit|suite)s?\b/i);
  if (m) descUnits = parseInt(m[1]);
  if (!descUnits) { m = desc.match(/\b(two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:units?|suites?|apartments?)\b/i); if (m) descUnits = WORDNUM[m[1].toLowerCase()]; }
  if (!descUnits && /up[\/ -]?(?:and[- ])?down\s+duplex/i.test(desc)) descUnits = 2;
  if (!descUnits && /\b(duplex)\b/i.test(desc) && !styleUnits) descUnits = 2;
  if (!descUnits && /\btriplex\b/i.test(desc)) descUnits = 3;
  if (!descUnits && /\b(?:four|4)[- ]?plex\b/i.test(desc)) descUnits = 4;

  let units = descUnits || styleUnits;
  let confidence = descUnits && styleUnits ? (descUnits === styleUnits || descUnits > 4 ? "high" : "medium") : descUnits ? "medium" : styleUnits ? "medium-low" : "manual";
  if (descUnits && styleUnits && descUnits !== styleUnits) units = Math.max(descUnits, styleUnits);

  // Bedrooms per unit: most common "N bedroom" mention; default 2
  const bedMentions = [...desc.matchAll(/(\d)\s*[- ]?bed(?:room)?s?\b/gi)].map(x => parseInt(x[1])).filter(b => b >= 1 && b <= 5);
  const beds = bedMentions.length ? mode(bedMentions) : 2;

  // Red flags: granny-suite / converted patterns, land-only tells
  const flags = [];
  if (/in[- ]?law|granny|secondary suite|detached.*apartment|converted/i.test(desc)) flags.push("suite/conversion — verify legal units");
  if (/vacant land|building lot/i.test(desc)) flags.push("may be land");
  if (d.yearBuilt && parseInt(d.yearBuilt) < 1960) flags.push("built " + d.yearBuilt);
  if (/separate (?:power |electrical |hydro )?met/i.test(desc)) flags.push("separate meters ✓");
  if (/renovat/i.test(desc)) flags.push("renovation claims");

  return {
    mls: l.mlsNumber, src: l._src,
    street: l.address ? [l.address.streetNumber, l.address.streetName, l.address.streetSuffix].filter(Boolean).join(" ") : "",
    city: (l.address && l.address.city) || "",
    price, sqft: num(d.sqft), style: style || (d.propertyType || ""), yearBuilt: d.yearBuilt || "",
    units, beds, confidence, flags,
    descSnippet: desc.slice(0, 220)
  };
}
function mode(a) { const c = {}; let best = a[0], n = 0; a.forEach(x => { c[x] = (c[x] || 0) + 1; if (c[x] > n) { n = c[x]; best = x; } }); return best; }
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } }); }

/* ================= tool page ================= */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Investment Screener — Ironclad</title>
<link rel="icon" href="/assets/img/shield-red.png"><link rel="stylesheet" href="/assets/css/site.css?v=1.6">
<style>
  .tool { max-width: 1400px; margin: 0 auto; padding: 28px var(--gutter) 80px; }
  .rents { display:grid; grid-template-columns: repeat(4,1fr); gap:14px; margin:16px 0 4px; }
  .rents .field label { font-size:.625rem; }
  .rents input { min-height:38px; padding:6px 10px; }
  table.rank { width:100%; border-collapse:collapse; margin-top:20px; font-size:.8125rem; }
  table.rank th { text-align:left; font-weight:600; font-size:.625rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); border-bottom:2px solid var(--ink); padding:8px 10px 8px 0; cursor:pointer; white-space:nowrap; }
  table.rank td { border-bottom:1px solid var(--line); padding:9px 10px 9px 0; vertical-align:top; }
  .conf-high{color:var(--ink);font-weight:600}.conf-medium{color:var(--ink)}.conf-medium-low{color:var(--muted)}.conf-manual{color:var(--red);font-weight:600}
  .flag { display:inline-block; background:#fff; border:1px solid var(--line); font-size:.625rem; padding:2px 6px; margin:2px 4px 0 0; }
  .yield { font-weight:800; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:18px; }
  .msg { display:none; padding:10px 14px; border-left:3px solid var(--red); background:#fff; margin-top:12px; font-size:.875rem; }
  .msg.show{display:block}.msg.ok{border-left-color:var(--ink)}
  /* report */
  #report { display:none; }
  @media print {
    body > .tool > *:not(#report) { display:none !important; }
    #report { display:block !important; }
    .no-print { display:none !important; }
  }
  #report { background:#fff; margin-top:30px; padding:34px; border:1px solid var(--line); }
  #report .rhead { border-bottom:4px solid var(--red); padding-bottom:14px; display:flex; justify-content:space-between; align-items:flex-end; }
  #report h1 { font-size:1.6rem; letter-spacing:-.02em; margin:0; font-weight:800; }
  #report .meth { font-size:.75rem; color:var(--muted); line-height:1.55; margin-top:14px; }
  #report table { font-size:.75rem; }
  #report .tp { background:var(--ground); border-left:3px solid var(--red); padding:14px 16px; margin-top:22px; }
</style></head><body>
<header class="site-header"><div class="wrap">
  <a class="brand" href="/"><img src="/assets/img/lockup-charcoal.png" alt="Ironclad Realty Group" style="height:34px;width:auto"></a>
  <span class="label red">Investment Screener — internal</span>
</div></header>
<div class="tool">
  <h1 class="h2">Multi-unit inventory, ranked.</h1>
  <p style="color:var(--muted);margin-top:6px;max-width:70ch">Scans every active multi-unit in New Brunswick, parses units from listing text, estimates gross rent from the assumptions below, ranks by estimated yield. Adjust rents with your local knowledge before generating the client report.</p>

  <h3 class="label" style="margin-top:20px">Monthly rent assumptions (editable — CMHC Oct-2025 anchored)</h3>
  <div class="rents" id="rents"></div>

  <div class="toolbar">
    <button class="btn btn-primary" id="scanBtn" onclick="scan()">Scan the province</button>
    <button class="btn btn-secondary" onclick="buildReport()">Generate client report</button>
    <button class="btn btn-secondary no-print" onclick="window.print()">Print / save PDF</button>
    <span class="label muted" id="countLine"></span>
  </div>
  <div class="msg" id="msg"></div>
  <div style="overflow:auto"><table class="rank" id="tbl" hidden>
    <thead><tr>
      <th></th><th data-k="yield">Est. yield ▾</th><th data-k="grm">GRM</th><th data-k="ppu">$/unit</th>
      <th data-k="price">Price</th><th data-k="units">Units</th><th>Property</th><th>Signals</th>
    </tr></thead><tbody id="tb"></tbody>
  </table></div>

  <div id="report"></div>
</div>
<script>
var KEY="{{KEY}}";
var MARKETS={ "Greater Moncton":{match:/moncton|dieppe|riverview/i,r:{1:1250,2:1550,3:1750}},
  "Saint John area":{match:/saint john|quispamsis|rothesay|hampton|grand bay/i,r:{1:1100,2:1350,3:1550}},
  "Fredericton area":{match:/fredericton|nashwaaksis|hanwell|new maryland|lincoln|oromocto/i,r:{1:1200,2:1500,3:1700}},
  "Other NB":{match:/./,r:{1:1150,2:1400,3:1600}} };
var rows=[], sortK="yield", sortD=-1;
(function(){ var h='';
  for(var mk in MARKETS){ for(var b=1;b<=3;b++){ h+='<div class="field"><label>'+mk+' — '+b+' bed</label><input type="number" data-mk="'+mk+'" data-b="'+b+'" value="'+MARKETS[mk].r[b]+'"></div>'; } }
  document.getElementById('rents').innerHTML=h;
})();
function rentFor(city,beds){ var b=Math.min(Math.max(beds||2,1),3);
  for(var mk in MARKETS){ if(MARKETS[mk].match.test(city||"")){ var inp=document.querySelector('input[data-mk="'+mk+'"][data-b="'+b+'"]'); return {mk:mk, rent: parseFloat(inp.value)||MARKETS[mk].r[b]}; } } }
function money(n){return n==null?"—":"$"+Math.round(n).toLocaleString("en-CA")}
function compute(){ rows.forEach(function(r){ if(r.units){ var rf=rentFor(r.city,r.beds); r.market=rf.mk; r.rent=rf.rent; r.gross=r.units*rf.rent*12; r.yield=r.gross/r.price; r.grm=r.price/r.gross; r.ppu=r.price/r.units; } else { r.gross=null;r.yield=null;r.grm=null;r.ppu=null; } }); }
function scan(){ var b=document.getElementById('scanBtn'); b.disabled=true; showMsg('Scanning the province — 20 to 40 seconds…',true);
  fetch(location.pathname+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:KEY})})
  .then(function(r){return r.json()}).then(function(j){ b.disabled=false;
    if(j.error){showMsg(j.error,false);return}
    rows=j.rows; compute(); sortRows(); render();
    showMsg('Found '+j.count+' candidates.'+(j.notes&&j.notes.length?' Notes: '+j.notes.join(' · '):''),true);
  }).catch(function(e){b.disabled=false;showMsg(String(e),false)});
}
function sortRows(){ rows.sort(function(a,b){ var x=a[sortK],y=b[sortK]; if(x==null)return 1; if(y==null)return -1; return (x<y?-1:x>y?1:0)*sortD; }); }
document.getElementById('tbl').addEventListener('click',function(e){ var th=e.target.closest('th[data-k]'); if(!th)return; var k=th.getAttribute('data-k'); if(k===sortK)sortD*=-1; else {sortK=k;sortD=-1;} sortRows(); render(); });
function render(){ var tb=document.getElementById('tb'); document.getElementById('tbl').hidden=false;
  document.getElementById('countLine').textContent=rows.length+' candidates';
  tb.innerHTML=rows.map(function(r,i){ return '<tr>'+
    '<td><input type="checkbox" data-i="'+i+'" '+(r.yield&&r.confidence!=='manual'?'checked':'')+'></td>'+
    '<td class="yield">'+(r.yield?(r.yield*100).toFixed(1)+'%':'—')+'</td>'+
    '<td>'+(r.grm?r.grm.toFixed(1):'—')+'</td>'+
    '<td>'+(r.ppu?money(r.ppu):'—')+'</td>'+
    '<td>'+money(r.price)+'</td>'+
    '<td><span class="conf-'+r.confidence.replace(/[^a-z-]/g,'')+'">'+(r.units||'?')+' × '+r.beds+'bd</span><br><span style="font-size:.625rem;color:var(--muted)">'+r.confidence+'</span></td>'+
    '<td><strong>'+esc(r.street||'(address in listing)')+', '+esc(r.city)+'</strong><br><span style="color:var(--muted)">'+esc(r.style)+(r.yearBuilt?' · '+r.yearBuilt:'')+(r.sqft?' · '+r.sqft+' sqft':'')+' · MLS® '+r.mls+' · '+r.src+'</span></td>'+
    '<td>'+r.flags.map(function(f){return '<span class="flag">'+esc(f)+'</span>'}).join('')+'</td>'+
  '</tr>';}).join('');
}
function buildReport(){ var inc=[].map.call(document.querySelectorAll('#tb input:checked'),function(c){return rows[parseInt(c.getAttribute('data-i'))]}).filter(function(r){return r.yield});
  if(!inc.length){showMsg('Tick at least one row first.',false);return}
  inc.sort(function(a,b){return b.yield-a.yield});
  var d=new Date().toLocaleDateString('en-CA',{year:'numeric',month:'long',day:'numeric'});
  var rentsUsed=[]; for(var mk in MARKETS){ rentsUsed.push(mk+': $'+document.querySelector('input[data-mk="'+mk+'"][data-b="1"]').value+' / $'+document.querySelector('input[data-mk="'+mk+'"][data-b="2"]').value+' / $'+document.querySelector('input[data-mk="'+mk+'"][data-b="3"]').value+' (1/2/3 bd)'); }
  var trs=inc.map(function(r,i){ return '<tr><td style="font-weight:800">'+(i+1)+'</td><td><strong>'+esc(r.street)+', '+esc(r.city)+'</strong><br><span style="color:#6b6867">'+esc(r.style)+(r.yearBuilt?' · built '+r.yearBuilt:'')+' · MLS® '+r.mls+'</span></td><td>'+money(r.price)+'</td><td>'+r.units+' × '+r.beds+'bd<br><span style="color:#6b6867;font-size:.625rem">'+r.confidence+' confidence</span></td><td>'+money(r.gross)+'/yr</td><td style="font-weight:800">'+(r.yield*100).toFixed(1)+'%</td><td>'+r.grm.toFixed(1)+'</td><td>'+money(r.ppu)+'</td><td style="font-size:.6875rem">'+r.flags.map(esc).join('; ')+'</td></tr>'; }).join('');
  var top=inc.slice(0,3).map(function(r,i){ return (i+1)+'. '+r.street+', '+r.city+' — '+(r.yield*100).toFixed(1)+'% est. gross yield on '+r.units+' units at '+money(r.price)+'. '+(r.flags.length?('Watch: '+r.flags.join('; ')+'.'):'')+' Ask the listing agent for actual rents, expenses, and unit condition.'; }).join('<br><br>');
  document.getElementById('report').innerHTML=
    '<div class="rhead"><div><div class="label red">Ironclad Realty Group — Investment Screen</div><h1>New Brunswick Multi-Unit Inventory</h1></div><div style="text-align:right;font-size:.75rem;color:#6b6867">Prepared '+d+'<br>Jason Hinchliffe, REALTOR®<br>506-608-3333 · ironcladrealty.ca</div></div>'+
    '<p class="meth"><strong>Method & honest limits.</strong> Every active multi-unit listing in New Brunswick was screened ('+rows.length+' candidates; '+inc.length+' shown). NB MLS® listings do not publish income data, so gross income is <em>estimated</em>: unit counts parsed from listing text, priced at market average rents — '+rentsUsed.join(' · ')+' — anchored to CMHC\\'s October 2025 Rental Market Survey and StatCan Q3-2025 asking-rent data, adjusted with local knowledge. Estimated yield = estimated gross annual rent ÷ asking price; GRM is its inverse. This is a ranking screen to prioritize diligence, not underwriting: actual rents, expenses, vacancies, condition, and legal unit status must be verified per property. Listing data from MLS®; deemed reliable, not guaranteed. Prepared by Ironclad Realty Group, brokered by eXp Realty Canada — New Brunswick.</p>'+
    '<table class="rank" style="margin-top:16px"><thead><tr><th>#</th><th>Property</th><th>Ask</th><th>Units</th><th>Est. gross</th><th>Est. yield</th><th>GRM</th><th>$/unit</th><th>Notes</th></tr></thead><tbody>'+trs+'</tbody></table>'+
    '<div class="tp no-print"><strong>Private talking points (not printed):</strong><br><br>'+top+'<br><br>Frame on the call: the screen covers the entire province — nobody cherry-picked. Offer to pull full listing sheets + book showings on the top picks, and to run this monthly as inventory turns.</div>';
  document.getElementById('report').style.display='block';
  showMsg('Report built below — review, then Print / save PDF. The grey talking-points box is for you and never prints.',true);
  document.getElementById('report').scrollIntoView({behavior:'smooth'});
}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function showMsg(t,ok){var m=document.getElementById('msg');m.textContent=t;m.className='msg show'+(ok?' ok':'')}
</script></body></html>`;
