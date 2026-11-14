const fs = require("fs");
const KEY = process.env.NASA_API_KEY;
if (!KEY) { console.error("Set NASA_API_KEY first."); process.exit(1); }
const START = process.argv[2] || "2023-01-01";
const END = process.argv[3] || "2025-06-30";
const BASE = "https://api.nasa.gov/DONKI";

function monthChunks(start, end) {
  const out = []; let s = new Date(start + "T00:00:00Z"); const e = new Date(end + "T00:00:00Z");
  while (s <= e) {
    const n = new Date(s); n.setUTCDate(n.getUTCDate() + 29); const stop = n > e ? e : n;
    out.push([s.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)]);
    s = new Date(stop); s.setUTCDate(s.getUTCDate() + 1);
  }
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(endpoint, s, e) {
  const url = `${BASE}/${endpoint}?startDate=${s}&endDate=${e}&api_key=${KEY}`;
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url);
      if (res.ok) { const t = await res.text(); return t.trim() ? JSON.parse(t) : []; }
      console.warn(`${endpoint} ${s}: HTTP ${res.status}, retry ${a}`);
    } catch (err) { console.warn(`${endpoint} ${s}: ${err.message}, retry ${a}`); }
    await sleep(2000 * a);
  }
  return [];
}
async function getAll(endpoint) {
  const all = [];
  for (const [s, e] of monthChunks(START, END)) {
    all.push(...(await get(endpoint, s, e)));
    process.stdout.write(`\r${endpoint}: ${all.length} events (to ${e})   `);
    await sleep(300);
  }
  console.log(); return all;
}
// CCMC CME speed classes: S <500, C 500-999, O 1000-1999, R 2000-2999, ER >=3000 km/s
const speedClass = (v) => v == null ? null : v < 500 ? "S" : v < 1000 ? "C" : v < 2000 ? "O" : v < 3000 ? "R" : "ER";
const strengthOf = (v) => v == null ? null : v < 1000 ? "weak" : v < 2000 ? "moderate" : "strong";
const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3.6e6;
const bestAnalysis = (c) => (c.cmeAnalyses || []).find((a) => a.isMostAccurate) || (c.cmeAnalyses || [])[0];

(async () => {
  const cmes = await getAll("CME"), seps = await getAll("SEP");
  const cmeSpeed = {};
  for (const c of cmes) { const an = bestAnalysis(c); if (an && an.speed != null) cmeSpeed[c.activityID] = an.speed; }

  const storms = [];
  for (const c of cmes) {
    const an = bestAnalysis(c);
    const en = an && (an.enlilList || []).find((x) => x.estimatedShockArrivalTime);
    if (!en) continue;
    const v = an.speed ?? null;
    storms.push({ id: c.activityID, type: "CME", start: c.startTime,
      predictedArrival: en.estimatedShockArrivalTime,
      warningHours: Math.round(hoursBetween(c.startTime, en.estimatedShockArrivalTime)),
      speedKms: v, speedClass: speedClass(v), strength: strengthOf(v) || "weak", link: c.link });
  }
  for (const s of seps) {
    const linked = (s.linkedEvents || []).map((x) => x.activityID).filter((id) => cmeSpeed[id] != null);
    const v = linked.length ? Math.max(...linked.map((id) => cmeSpeed[id])) : null;
    storms.push({ id: s.sepID, type: "SEP", start: s.eventTime,
      linkedCmeSpeedKms: v, speedClass: speedClass(v), strength: strengthOf(v) || "moderate", link: s.link });
  }
  storms.sort((a, b) => new Date(a.start) - new Date(b.start));
  const count = (t, st) => storms.filter((x) => x.type === t && x.strength === st).length;
  const out = { source: "NASA DONKI (api.nasa.gov) - archived snapshot, not live data",
    strengthMethod: "CME speed, CCMC classes: weak <1000 km/s (S,C), moderate 1000-1999 (O), strong >=2000 (R,ER)",
    downloaded: new Date().toISOString(), range: { start: START, end: END },
    counts: { CME: { weak: count("CME","weak"), moderate: count("CME","moderate"), strong: count("CME","strong") },
              SEP: { weak: count("SEP","weak"), moderate: count("SEP","moderate"), strong: count("SEP","strong") } },
    storms };
  fs.writeFileSync("storms.json", JSON.stringify(out, null, 1));
  console.log("Wrote storms.json:", JSON.stringify(out.counts));
})();
