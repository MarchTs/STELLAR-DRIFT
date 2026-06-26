/* ============================================================
   STELLAR DRIFT — data & config
   All tunable numbers live here. Rates are per real-time second.
   ============================================================ */

const CONFIG = {
  tickMs: 200,          // sim step in ms (dt-based, so this is just resolution)
  saveEveryMs: 4000,

  // ---- Resource caps (base, before upgrades / room levels) ----
  // Groups: Power | Life Support (oxygen, co2) | Storage (food, water, ice, minerals) | fuel
  baseCaps: { power: 100, oxygen: 100, co2: 100, water: 80, ice: 120, minerals: 200, food: 100, fuel: 50 },

  // ---- Starting run state ----
  start: {
    resources: { power: 50, oxygen: 85, co2: 5, water: 50, ice: 80, minerals: 35, food: 60, fuel: 40 },
    crewCount: 3, // one of each base role
  },

  // ---- Crew need drain / regen (per second) ----
  needs: {
    hungerDrain: 0.45,        // while awake
    energyDrainWork: 0.40,
    energyDrainIdle: 0.18,
    o2PerCrew: 0.32,          // ship oxygen consumed per crew per second
    co2PerCrew: 0.26,         // co2 exhaled per crew per second
    // regen while performing the matching task
    energyRegen: 3.2,         // sleeping
    eatRegen: 11,             // hunger refill while eating
    foodPerEat: 2.2,          // food resource consumed per second while eating
    healRegen: 4.0,           // health refill in medbay
    // health damage when a need bottoms out (per second)
    starveDmg: 1.4,
    exhaustDmg: 1.0,
    suffocateDmg: 2.2,
    co2Danger: 0.75,          // co2 >= this fraction of cap starts hurting crew
    co2Dmg: 0.9,              // health drain/sec when co2 is dangerous
    // morale
    moraleRecover: 1.6,       // when all needs healthy
    moraleDecay: 1.2,         // when a need is low
    eatNoMessMorale: 3.0,     // morale lost/sec while eating without a Mess Hall (eating at Hydroponics)
  },

  // thresholds the crew AI uses (defaults; per-crew adjustable)
  ai: {
    restThreshold: 25,   // sleep when energy below this
    wakeAt: 96,
    eatThreshold: 30,    // eat when hunger below this
    fullAt: 96,
    healThreshold: 55,   // seek medbay when health below this
    healedAt: 95,
  },

  // ---- Room production (per second, per staffed room, at level 1) ----
  rooms: {
    reactor:    { powerPassive: 2.0, powerPerStaff: 6.5 },   // small automated baseline; an operator does the real work
    // Life Support: melts ice->water, turns water+power->oxygen, scrubs co2
    lifesupport:{ powerCost: 2.0, o2Out: 4.2, waterCost: 0.35, iceMelt: 0.6, co2Scrub: 2.5 },
    // Mining Drone: mines minerals AND ice from the sector's finite stock; drilling vents CO₂
    extractor:  { powerCost: 2.0, mineralsOut: 1.6, iceOut: 0.8, co2Out: 0.45 },
    // Hydroponics: consumes water + oxygen, produces food
    hydroponics:{ powerCost: 2.0, foodOut: 2.2, waterCost: 0.4, o2Cost: 0.3 },
    quarters:   { powerCost: 0.3, beds: 2 },
    medbay:     { powerCost: 1.5 },
  },

  // level scaling: output & cap multiply by (1 + (level-1)*levelGain)
  levelGain: 0.6,

  // ---- Build / upgrade costs (minerals) ----
  build: {
    medbay: 45,
    extractor: 60,
    hydroponics: 60,
    quarters: 50,
    lifesupport: 65,
    reactor: 80,
    engine: 70,
    upgradeBase: 30,    // upgrade cost = upgradeBase * level * 1.6
    upgradeMult: 1.6,
  },

  // ---- Skills ----
  skill: {
    xpPerSecondWorking: 0.25,
    xpToLevel: 20,           // xp needed *= level
    outputPerLevel: 0.12,    // +12% output per skill level above 1
    maxLevel: 10,
  },

  // ---- Sectors / jump ----
  jump: {
    fuelCost: 18,            // FUEL consumed to jump to the next sector
    mineralBonusPerSector: 0.12,  // +12% extractor yield per sector
    eventRateScale: 0.10,    // events get ~10% more frequent per sector
  },

  // ---- Per-sector finite resource stock (rolled on entering a sector) ----
  sectorStock: {
    mineralsMin: 160, mineralsMax: 320,
    iceMin: 90, iceMax: 220,
  },

  // ---- Events ----
  events: {
    baseIntervalSec: 70,     // avg seconds between events at sector 1
    minIntervalSec: 22,
    firstEventDelaySec: 45,
  },

  // ---- Meta payout on game over ----
  payout: {
    perSector: 6,
    perMinute: 2,
    perRoomBuilt: 1,
    perPeakCrew: 2,
  },
};

// ------------------------------------------------------------
// Role definitions
// ------------------------------------------------------------
// `staffs` is an ordered list of room types a role can operate (first = default).
const ROLES = {
  engineer: { name: 'Engineer', staffs: ['reactor', 'lifesupport'], skill: 'Engineering', color: '#ffb454' },
  miner:    { name: 'Miner',    staffs: ['extractor'],   skill: 'Mining',  color: '#6fd3c7' },
  botanist: { name: 'Botanist', staffs: ['hydroponics'], skill: 'Botany',  color: '#9ad36f' },
};

// ------------------------------------------------------------
// Room definitions (display + behavior flags)
// ------------------------------------------------------------
const ROOM_DEFS = {
  reactor:     { name: 'Reactor',     icon: '⚛', staffRole: 'engineer', auto: true,  desc: 'Generates power. An on-duty engineer boosts output.' },
  lifesupport: { name: 'Life Support',icon: '☁', staffRole: 'engineer', auto: true,  desc: 'An engineer operates it to make oxygen from water and scrub CO₂. Idle when nobody is aboard it.' },
  extractor:   { name: 'Mining Drone', icon: '⛏', staffRole: 'miner',    auto: false, desc: 'Mines minerals and ice from the sector when operated by a miner. Drilling vents CO₂ — more when upgraded. Needs power.' },
  hydroponics: { name: 'Hydroponics', icon: '❀', staffRole: 'botanist', auto: false, desc: 'Grows food from water + oxygen when staffed by a botanist. Needs power.' },
  quarters:    { name: 'Quarters',    icon: '⏾', staffRole: null,       auto: true,  desc: 'Beds where tired crew sleep to restore energy.' },
  medbay:      { name: 'Medbay',      icon: '✚', staffRole: null,       auto: true,  desc: 'Injured or sick crew heal here. Needs power.' },
  engine:      { name: 'Engine',      icon: '🚀', staffRole: null,       auto: true,  desc: 'Stores fuel and drives FTL jumps. Upgrade for a bigger fuel reserve and cheaper jumps.' },
};

// random crew names
const CREW_NAMES = [
  'Vega','Cole','Rhea','Juno','Tycho','Lira','Bowen','Mira','Sol','Orin',
  'Kaya','Ferro','Wren','Dax','Nova','Halsey','Pike','Echo','Renn','Sable',
];

// ------------------------------------------------------------
// Per-room upgradeable attributes
// ------------------------------------------------------------
// Each attribute upgrades independently. `kind` drives the math:
//   mult -> multiplier 1+(l-1)*levelGain  (output / storage / comfort / treatment)
//   eff  -> power-draw factor 1-(l-1)*0.12 (floored 0.3)
//   beds -> capacity baseN+(l-1)
// `hint(l)` returns the human-readable effect AT level l (used by sim & UI).
const A_MULT = (l) => 1 + (l - 1) * CONFIG.levelGain;
const A_EFF  = (l) => Math.max(0.3, 1 - (l - 1) * 0.12);
const A_BEDS = (baseN, l) => baseN + (l - 1);
const _f = (v) => v.toFixed(1);
const _r = (v) => Math.round(v);
const _pct = (l) => _r((1 - A_EFF(l)) * 100);

const ROOM_ATTRS = {
  reactor: [
    { key: 'output',  name: 'Power Output',  kind: 'mult', base: 30, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.reactor.powerPassive * A_MULT(l))}/s power, +${_f(CONFIG.rooms.reactor.powerPerStaff * A_MULT(l))}/s per engineer` },
    { key: 'storage', name: 'Power Storage', kind: 'mult', base: 18, max: 10,
      hint: (l) => `battery capacity ${_r(CONFIG.baseCaps.power * A_MULT(l))}` },
  ],
  lifesupport: [
    { key: 'output',       name: 'O₂ Output',  kind: 'mult', base: 28, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.lifesupport.o2Out * A_MULT(l))}/s oxygen` },
    { key: 'storage',      name: 'O₂ Reserve', kind: 'mult', base: 18, max: 10,
      hint: (l) => `oxygen capacity ${_r(CONFIG.baseCaps.oxygen * A_MULT(l))}` },
    { key: 'co2scrub',     name: 'CO₂ Scrubber', kind: 'mult', base: 24, max: 10,
      hint: (l) => `scrubs ${_f(CONFIG.rooms.lifesupport.co2Scrub * A_MULT(l))}/s CO₂` },
    { key: 'co2storage',   name: 'CO₂ Reserve', kind: 'mult', base: 18, max: 8,
      hint: (l) => `CO₂ buffer before danger ${_r(CONFIG.baseCaps.co2 * A_MULT(l))}` },
    { key: 'water',        name: 'Water Reclaimer', kind: 'mult', base: 22, max: 10,
      hint: (l) => `melts ${_f(CONFIG.rooms.lifesupport.iceMelt * A_MULT(l))}/s ice into water` },
    { key: 'waterstorage', name: 'Water Reserve', kind: 'mult', base: 18, max: 8,
      hint: (l) => `water capacity ${_r(CONFIG.baseCaps.water * A_MULT(l))}` },
    { key: 'efficiency',   name: 'Efficiency',  kind: 'eff',  base: 22, max: 6,
      hint: (l) => `power draw −${_pct(l)}%` },
  ],
  extractor: [
    { key: 'output',     name: 'Yield',          kind: 'mult', base: 30, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.extractor.mineralsOut * A_MULT(l))}/s minerals per miner` },
    { key: 'storage',    name: 'Mineral Storage', kind: 'mult', base: 18, max: 10,
      hint: (l) => `mineral capacity ${_r(CONFIG.baseCaps.minerals * A_MULT(l))}` },
    { key: 'efficiency', name: 'Efficiency',      kind: 'eff',  base: 22, max: 6,
      hint: (l) => `power draw −${_pct(l)}%` },
  ],
  hydroponics: [
    { key: 'output',     name: 'Yield',         kind: 'mult', base: 28, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.hydroponics.foodOut * A_MULT(l))}/s food per botanist` },
    { key: 'storage',    name: 'Food Storage',  kind: 'mult', base: 18, max: 10,
      hint: (l) => `food capacity ${_r(CONFIG.baseCaps.food * A_MULT(l))}` },
    { key: 'efficiency', name: 'Efficiency',    kind: 'eff',  base: 22, max: 6,
      hint: (l) => `power draw −${_pct(l)}%` },
  ],
  quarters: [
    { key: 'comfort', name: 'Comfort', kind: 'mult', base: 24, max: 10,
      hint: (l) => `+${_f(CONFIG.needs.energyRegen * A_MULT(l))}/s rest while sleeping` },
    { key: 'beds',    name: 'Berths',  kind: 'beds', base: 26, max: 6, baseN: 2,
      hint: (l) => `${A_BEDS(2, l)} sleeping berths` },
  ],
  medbay: [
    { key: 'treatment', name: 'Treatment', kind: 'mult', base: 24, max: 10,
      hint: (l) => `+${_f(CONFIG.needs.healRegen * A_MULT(l))}/s healing` },
    { key: 'beds',      name: 'Med Beds',  kind: 'beds', base: 26, max: 6, baseN: 1,
      hint: (l) => `${A_BEDS(1, l)} med beds` },
  ],
  engine: [
    { key: 'fuelstorage',    name: 'Fuel Reserve',    kind: 'mult', base: 20, max: 8,
      hint: (l) => `fuel capacity ${_r(CONFIG.baseCaps.fuel * A_MULT(l))}` },
    { key: 'fuelefficiency', name: 'Fuel Efficiency', kind: 'eff',  base: 26, max: 6,
      hint: (l) => `jump fuel cost −${_pct(l)}%` },
  ],
};

// ------------------------------------------------------------
// Event definitions
// ------------------------------------------------------------
const EVENT_DEFS = [
  {
    id: 'hull_breach', name: 'Hull Breach', weight: 3, minSector: 1, bad: true,
    msg: 'A micrometeor punched the hull — oxygen is venting!',
    apply: (st, ev) => { ev.duration = 70; ev.o2Drain = 2.8; ev.needsRepair = true; ev.repairNeeded = 4; },
    desc: 'Oxygen vents from the breach until an engineer walks over and patches it.',
  },
  {
    id: 'illness', name: 'Outbreak', weight: 3, minSector: 1, bad: true,
    msg: (st, ev) => `${ev.targetName} has fallen ill.`,
    apply: (st, ev) => {
      const alive = st.crew.filter(c => c.state !== 'dead');
      const t = alive[Math.floor(rngFloat() * alive.length)];
      ev.target = t ? t.id : null;
      ev.targetName = t ? t.name : 'A crew member';
      ev.duration = 20; ev.healthDrain = 1.6;
    },
    desc: 'Drains a crew member’s health. A powered Medbay cures it faster.',
  },
  {
    id: 'power_failure', name: 'Electrical Fire', weight: 2, minSector: 1, bad: true,
    msg: 'An electrical fire broke out — power is cut and smoke floods the deck!',
    apply: (st, ev) => { ev.duration = 55; ev.reactorMult = 0.45; ev.co2Out = 1.8; ev.needsRepair = true; ev.repairNeeded = 5; },
    desc: 'A wrecked module: reactor output drops and CO₂ pours out until an engineer reaches it and puts it out.',
  },
  {
    id: 'raiders', name: 'Scavengers', weight: 2, minSector: 2, bad: true,
    msg: 'Scavengers boarded and stripped the cargo hold.',
    apply: (st, ev) => {
      ev.duration = 1;
      st.resources.minerals = Math.max(0, st.resources.minerals - (15 + st.sector * 5));
    },
    desc: 'Lose a chunk of minerals immediately.',
  },
  {
    id: 'salvage', name: 'Salvage Find', weight: 2, minSector: 1, bad: false,
    msg: 'You drift past a wreck and salvage fuel and materials.',
    apply: (st, ev) => {
      ev.duration = 1;
      st.resources.minerals = Math.min(cap(st, 'minerals'), st.resources.minerals + 18 + st.sector * 5);
      st.resources.fuel = Math.min(cap(st, 'fuel'), st.resources.fuel + 10 + st.sector * 2);
      st.resources.ice = Math.min(cap(st, 'ice'), st.resources.ice + 20);
    },
    desc: 'A welcome haul of fuel, ice and minerals.',
  },
];
