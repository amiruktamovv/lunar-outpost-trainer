// =====================================================================
// storms.js — turns real DONKI events (storms.json) into one mission.
// Picks a random 14-day window from the archive, so every playthrough
// gets a different, real slice of solar history (replayability).
// Works in the browser (global) and in Node (module.exports).
// =====================================================================

const STORM_OPTIONS = {
  missionDays: 14,
  // Slow CMEs (<1000 km/s) are dropped: in DONKI there are ~300 of them and
  // most pose little radiation risk on their own. [GAME] choice, see sources.
  cmeMinStrength: "moderate",
  minEvents: 1,       // re-roll windows until at least this many storms
  maxRerolls: 50,
};

const RANK = { weak: 1, moderate: 2, strong: 3 };
const DAY_MS = 864e5;

// Small seeded RNG so a mission can be replayed / shared by seed.
function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const utcDay = (iso) => {
  const d = new Date(iso.length <= 16 && !iso.endsWith("Z") ? iso + "Z" : iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

// Events that can hit the outpost, with the date they matter on.
function usableEvents(data, opts) {
  const out = [];
  for (const e of data.storms) {
    if (e.type === "CME") {
      if (RANK[e.strength] < RANK[opts.cmeMinStrength]) continue;
      out.push({ ...e, hitDay: utcDay(e.predictedArrival) });
    } else if (e.type === "SEP") {
      out.push({ ...e, hitDay: utcDay(e.start) });
    }
  }
  return out;
}

// Build the mission storm list for a window starting at startMs (UTC midnight).
function eventsInWindow(events, startMs, opts) {
  const byDay = {};
  for (const e of events) {
    const day = Math.round((e.hitDay - startMs) / DAY_MS) + 1;
    if (day < 1 || day > opts.missionDays) continue;
    const storm = {
      day,
      type: e.type,
      strength: e.strength,
      date: new Date(e.hitDay).toISOString().slice(0, 10),
      id: e.id,
      link: e.link,
      speedKms: e.speedKms ?? e.linkedCmeSpeedKms ?? null,
    };
    if (e.type === "CME") {
      // Warning arrives when DONKI knew about the CME (its launch time).
      const daysAhead = Math.max(1, Math.round(e.warningHours / 24));
      storm.warnDay = Math.max(1, day - daysAhead);
      storm.predictedArrival = e.predictedArrival;
    }
    // One storm per day: keep the strongest; on a tie the unwarned SEP wins.
    const cur = byDay[day];
    if (!cur || RANK[storm.strength] > RANK[cur.strength] ||
        (RANK[storm.strength] === RANK[cur.strength] && storm.type === "SEP" && cur.type === "CME")) {
      byDay[day] = storm;
    }
  }
  return Object.values(byDay).sort((a, b) => a.day - b.day);
}

// Main entry: returns { startDate, endDate, seed, storms } for engine.newGame(storms)
function pickMission(data, seed = Date.now(), options = {}) {
  const opts = { ...STORM_OPTIONS, ...options };
  const events = usableEvents(data, opts);
  const rng = makeRng(seed);
  const first = utcDay(data.range.start);
  const last = utcDay(data.range.end) - (opts.missionDays - 1) * DAY_MS;
  const nDays = Math.floor((last - first) / DAY_MS) + 1;

  let startMs, storms;
  for (let i = 0; i <= opts.maxRerolls; i++) {
    startMs = first + Math.floor(rng() * nDays) * DAY_MS;
    storms = eventsInWindow(events, startMs, opts);
    if (storms.length >= opts.minEvents) break;
  }
  return {
    seed,
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date(startMs + (opts.missionDays - 1) * DAY_MS).toISOString().slice(0, 10),
    storms,
  };
}

// Fixed historic scenario, e.g. the May 2024 "Gannon" storms.
function missionFromDate(data, startDate, options = {}) {
  const opts = { ...STORM_OPTIONS, ...options };
  const startMs = utcDay(startDate);
  return {
    seed: null,
    startDate,
    endDate: new Date(startMs + (opts.missionDays - 1) * DAY_MS).toISOString().slice(0, 10),
    storms: eventsInWindow(usableEvents(data, opts), startMs, opts),
  };
}

if (typeof module !== "undefined") {
  module.exports = { STORM_OPTIONS, makeRng, pickMission, missionFromDate };
}
