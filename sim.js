// sim.js — прогон разных стратегий через движок, чтобы проверить баланс.
// Запуск: node sim.js
const E = require("./engine.js");

console.log("Derived values:");
console.log("  panel power, kW      :", E.PANEL_POWER_KW.toFixed(2));
console.log("  energy units day/sunset:", E.energyUnitsForDay(1), "/", E.energyUnitsForDay(12));
console.log("  kWh per kg O2        :", E.KWH_PER_KG_O2.toFixed(2));
console.log("  O2 per unit, kg      :", E.O2_PER_UNIT_KG.toFixed(3));
console.log("  O2 need per day, kg  :", E.O2_NEED_KG_DAY.toFixed(2));
console.log("  units for O2 per day :", (E.O2_NEED_KG_DAY / E.O2_PER_UNIT_KG).toFixed(2));
console.log("  shield 25cm / 50cm   :", E.shieldFactor(25).toFixed(2), "/", E.shieldFactor(50).toFixed(2));
console.log();

// Тестовые сценарии бурь (до подключения DONKI)
const scenarios = {
  calm:   [],
  early:  [{ day: 4, type: "CME", flareClass: "X1.0", warnDay: 2 },
           { day: 8, type: "SEP", flareClass: "M5.0" }],
  late:   [{ day: 13, type: "CME", flareClass: "X2.2", warnDay: 11 }],
  brutal: [{ day: 3, type: "SEP", flareClass: "X1.0" },
           { day: 7, type: "CME", flareClass: "X4.5", warnDay: 5 },
           { day: 13, type: "SEP", flareClass: "X1.0" }],
};

// Стратегии: функция (state, available) -> alloc
const strategies = {
  "greedy (all science)": (s, a) => ({ life: Math.min(4, a), berm: 0, science: a - Math.min(4, a) }),
  "steady (2 berm/day)":  (s, a) => a >= 6 ? { life: 4, berm: 2, science: a - 6 } : { life: a, berm: 0, science: 0 },
  "front-load berm":      (s, a) => s.bermCm < 30 && a >= 10 ? { life: 4, berm: 6, science: 0 }
                                    : { life: Math.min(4, a), berm: 0, science: a - Math.min(4, a) },
  "react to warnings":    (s, a) => E.warningsFor(s).length && a >= 10 ? { life: 4, berm: 6, science: 0 }
                                    : { life: Math.min(4, a), berm: 0, science: a - Math.min(4, a) },
  "skimp on O2":          (s, a) => ({ life: Math.min(3, a), berm: 0, science: a - Math.min(3, a) }),
};

for (const [sName, storms] of Object.entries(scenarios)) {
  console.log(`=== Scenario: ${sName}`);
  for (const [name, strat] of Object.entries(strategies)) {
    let st = E.newGame(storms);
    while (st.status === "playing") {
      const a = E.energyUnitsForDay(st.day);
      st = E.playDay(st, strat(st, a)).state;
    }
    const worst = Math.max(0, ...st.history.map(r => r.eventDose));
    console.log(
      `  ${name.padEnd(22)} ${st.status.padEnd(9)} day ${String(st.day).padStart(2)}` +
      `  science ${String(st.science).padStart(3)}  berm ${String(st.bermCm).padStart(2)}cm` +
      `  worst storm ${worst.toFixed(0).padStart(3)} mSv  tank ${st.tankKg.toFixed(1)} kg`
    );
  }
}
