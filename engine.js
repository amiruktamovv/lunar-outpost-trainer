// =====================================================================
// engine.js — ядро игры "Lunar Outpost Trainer"
// Только логика: никакого интерфейса. Интерфейс (ui.js) вызывает
// функции отсюда и рисует результат.
//
// Все числа собраны в CONFIG. Пометки:
//   [REAL]  — реальное значение из источника
//   [PHYS]  — выведено из физики
//   [GAME]  — упрощение для игры
// =====================================================================

const CONFIG = {
  crew: 4,                    // [GAME] астронавтов
  missionDays: 14,            // [REAL] ~ длительность лунного дня
  sunsetStartDay: 12,         // [GAME] с какого дня начинается закат

  // ---- Энергия: P = S * η * A --------------------------------------
  solarConstant: 1361,        // [REAL] Вт/м², солнечная постоянная
  panelEfficiency: 0.30,      // [REAL] КПД космических солнечных элементов
  panelArea: 6,               // [GAME] м², панели следят за Солнцем
  sunsetFraction: 0.4,        // [GAME] доля выработки при низком Солнце
  energyUnitKWh: 6,           // [GAME] 1 "единица" = 6 кВт·ч

  // ---- Кислород: электролиз 2H2O -> 2H2 + O2 ------------------------
  o2PerPersonKgDay: 0.84,     // [REAL] норма NASA на человека в сутки
  electrolysisMinKWhPerKg: 4.97, // [PHYS] термодинамический минимум
  electrolysisEfficiency: 0.70,  // [GAME] КПД установки (уточнить)
  tankStartKg: 15,            // [GAME] запас в баке на старте
  tankMaxKg: 20,              // [GAME] вместимость бака

  // ---- Радиация -----------------------------------------------------
  backgroundMSvDay: 1.369,    // [REAL] Chang'e-4, фон на поверхности Луны
  eventLimitMSv: 250,         // [REAL] лимит NASA за одно солнечное событие
  careerLimitMSv: 600,        // [REAL] карьерный лимит NASA
  bermCmPerUnit: 2,           // [GAME] см грунта за 1 единицу энергии
  bermTenfoldCm: 50,          // [REAL] 50 см грунта ~ ослабление в 10 раз
  stormDoseMSv: { C: 30, M: 120, X: 300 }, // [GAME] доза бури без защиты
};

// ---------------------------------------------------------------------
// Производные величины — считаются из CONFIG, а не вписываются руками.
// ---------------------------------------------------------------------

// Мощность панелей, кВт: P = S * η * A / 1000
const PANEL_POWER_KW =
  (CONFIG.solarConstant * CONFIG.panelEfficiency * CONFIG.panelArea) / 1000;

// Энергия на 1 кг кислорода с учётом КПД, кВт·ч/кг
const KWH_PER_KG_O2 =
  CONFIG.electrolysisMinKWhPerKg / CONFIG.electrolysisEfficiency;

// Сколько кислорода даёт 1 единица энергии, кг
const O2_PER_UNIT_KG = CONFIG.energyUnitKWh / KWH_PER_KG_O2;

// Сколько кислорода нужно экипажу в сутки, кг
const O2_NEED_KG_DAY = CONFIG.o2PerPersonKgDay * CONFIG.crew;

// Коэффициент ослабления k: e^(-k * 50) = 0.1  =>  k = ln(10) / 50
const K_ATTENUATION = Math.log(10) / CONFIG.bermTenfoldCm;

// ---------------------------------------------------------------------
// Энергия за день (в единицах)
// ---------------------------------------------------------------------
function energyUnitsForDay(day) {
  let kWh = PANEL_POWER_KW * 24;                    // сутки работы
  if (day >= CONFIG.sunsetStartDay) kWh *= CONFIG.sunsetFraction;
  return Math.round(kWh / CONFIG.energyUnitKWh);
}

// Доля дозы, проходящая через насыпь толщиной cm: e^(-k * d)
function shieldFactor(cm) {
  return Math.exp(-K_ATTENUATION * cm);
}

// Класс вспышки "X1.0" -> "X"
function stormLetter(flareClass) {
  const letter = (flareClass || "C")[0].toUpperCase();
  return CONFIG.stormDoseMSv[letter] ? letter : "C";
}

// ---------------------------------------------------------------------
// Новая игра. storms — список бурь на эту миссию:
//   { day, type: "CME" | "SEP", flareClass: "X1.0", warnDay, date, link }
// ---------------------------------------------------------------------
function newGame(storms = []) {
  return {
    day: 1,
    tankKg: CONFIG.tankStartKg,
    bermCm: 0,
    missionDoseMSv: 0,
    science: 0,
    storms,
    status: "playing",   // "playing" | "win" | "fail_o2" | "fail_rad"
    history: [],
  };
}

// Предупреждения на сегодня: CME, о которых уже известно, но которые ещё не пришли
function warningsFor(state) {
  return state.storms
    .filter(s => s.type === "CME" && s.warnDay <= state.day && s.day >= state.day)
    .map(s => ({ ...s, daysLeft: s.day - state.day }));
}

// ---------------------------------------------------------------------
// Главная функция: прожить один день.
// alloc = { life, berm, science } — сколько единиц энергии куда.
// Возвращает { state, report } — новое состояние и отчёт о дне.
// ---------------------------------------------------------------------
function playDay(state, alloc) {
  if (state.status !== "playing") throw new Error("Game is over");

  const available = energyUnitsForDay(state.day);
  const { life = 0, berm = 0, science = 0 } = alloc;
  if ([life, berm, science].some(n => !Number.isInteger(n) || n < 0))
    throw new Error("Allocation must be whole, non-negative numbers");
  if (life + berm + science > available)
    throw new Error(`Only ${available} energy units today`);

  const s = { ...state, history: [...state.history] };

  // 1. Кислород: сделали электролизом минус потратил экипаж
  const o2Made = life * O2_PER_UNIT_KG;
  s.tankKg = Math.min(CONFIG.tankMaxKg, s.tankKg + o2Made - O2_NEED_KG_DAY);

  // 2. Насыпь растёт (постоянно, не разряжается)
  s.bermCm += berm * CONFIG.bermCmPerUnit;

  // 3. Радиация: фон + буря, если она сегодня
  const storm = s.storms.find(st => st.day === s.day);
  let eventDose = 0;
  let scienceDone = science;

  if (storm) {
    const d0 = CONFIG.stormDoseMSv[stormLetter(storm.flareClass)];
    const f = shieldFactor(s.bermCm);
    if (storm.type === "CME") {
      // Было предупреждение: экипаж весь день в убежище, наука стоит
      eventDose = d0 * f;
      scienceDone = 0;
    } else {
      // SEP без предупреждения: половину дозы получили снаружи
      eventDose = d0 * (0.5 + 0.5 * f);
      scienceDone = Math.floor(science / 2);
    }
  }

  const dayDose = CONFIG.backgroundMSvDay + eventDose;
  s.missionDoseMSv += dayDose;
  s.science += scienceDone;

  // 4. Проверка исхода
  if (s.tankKg < 0) s.status = "fail_o2";
  else if (eventDose > CONFIG.eventLimitMSv) s.status = "fail_rad";
  else if (s.day >= CONFIG.missionDays) s.status = "win";

  const report = {
    day: s.day, available, alloc: { life, berm, science },
    o2Made, tankKg: s.tankKg, bermCm: s.bermCm,
    storm: storm || null, eventDose, dayDose,
    scienceDone, status: s.status,
  };
  s.history.push(report);
  if (s.status === "playing") s.day += 1;
  return { state: s, report };
}

// Экспорт: в браузере всё глобально, в Node — через module.exports
if (typeof module !== "undefined") {
  module.exports = {
    CONFIG, PANEL_POWER_KW, KWH_PER_KG_O2, O2_PER_UNIT_KG, O2_NEED_KG_DAY,
    K_ATTENUATION, energyUnitsForDay, shieldFactor, newGame, warningsFor, playDay,
  };
}
