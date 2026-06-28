/* ============================================================
   STELLAR DRIFT — data & config
   All tunable numbers live here. Rates are per real-time second.
   ============================================================ */

const CONFIG = {
  tickMs: 200,          // sim step in ms (dt-based, so this is just resolution)
  saveEveryMs: 4000,

  // ---- Resource caps (base, before upgrades / room levels) ----
  // Groups: Power | Life Support (oxygen, co2) | Storage (food, water, ice, minerals, ore, scrap) | fuel
  baseCaps: { power: 100, oxygen: 100, co2: 100, water: 80, ice: 120, minerals: 200, ore: 150, scrap: 200, food: 100, fuel: 50 },

  // ---- Starting run state ----
  start: {
    resources: { power: 50, oxygen: 85, co2: 5, water: 50, ice: 80, minerals: 35, ore: 0, scrap: 0, food: 60, fuel: 40 },
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
    energyRegen: 4.6,         // sleeping (kept brisk so crew don't look stuck in bed)
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
    messMorale: 2.5,          // morale GAINED/sec while eating in a Mess Hall (× Meal Quality)
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
    reactor:    { powerPassive: 2.0, powerPerStaff: 6.5, co2Out: 0.5 },   // small automated baseline; an operator does the real work; vents CO₂
    // Life Support: melts ice->water, turns water+power->oxygen, scrubs co2
    lifesupport:{ powerCost: 2.0, o2Out: 4.2, waterCost: 0.35, iceMelt: 0.6, co2Scrub: 2.5 },
    // Mining Drone: mines ore AND ice from the sector's finite stock; drilling vents CO₂
    extractor:  { powerCost: 2.0, oreOut: 1.6, iceOut: 0.8, co2Out: 0.45 },
    // Hydroponics: consumes water + oxygen, produces food
    hydroponics:{ powerCost: 2.0, foodOut: 2.2, waterCost: 0.4, o2Cost: 0.3 },
    quarters:   { powerCost: 0.3, beds: 2 },
    medbay:     { powerCost: 1.5 },
    storage:    { powerCost: 0 },
    fuelsynthesis: { powerCost: 1.2, fuelOut: 0.8, waterCost: 0.8 },
    manufactor: { powerCost: 1.0, scrapCost: 2.0, oreCost: 1.0, mineralsOut: 1.0 },
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
    messhall: 55,
    storage: 40,
    fuelsynthesis: 75,
    manufactor: 80,
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

  // ---- Hull expansion: each tier adds a bay column (+2 bays) ----
  hull: { maxTier: 4, cost: (tier) => 120 + (tier - 1) * 120 },   // cost to expand FROM the given tier

  // ---- Manual fuel synthesis (click): very inefficient water -> fuel ----
  synth: { waterPerFuel: 10, fuelPerClick: 1 },

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

  // ---- Space Station trading ----
  station: {
    spawnChance: 0.33,
    resources: {
      minerals: { sell: 2,  buy: 5  },
      ore:      { sell: 0.3, buy: 1 },
      scrap:    { sell: 0.3, buy: 1 },
      ice:      { sell: 1,  buy: 3  },
      water:    { sell: 1,  buy: 3  },
      food:     { sell: 3,  buy: 8  },
      fuel:     { sell: 6,  buy: 15 },
    },
    demandMin: 0.6,
    demandMax: 1.8,
    crewCost: 100,
    crewMax: 6,
  },

  // ---- Blueprint shop ----
  blueprints: {
    storage:        { name: 'Storage Room',      icon: '📦', cost: 200, desc: 'Extra cargo bay. Increases all resource caps.' },
    fuelsynthesis:  { name: 'Fuel Synthesis',    icon: '⚗', cost: 300, desc: 'Automated refinery. Converts water to fuel continuously.' },
    manufactor:     { name: 'Manufactor',        icon: '⚙', cost: 250, desc: 'Industrial processor. Converts scrap & ore into minerals.' },
  },
};

// ------------------------------------------------------------
// Skills — every crew member has a level in each. Anyone can do any job;
// the relevant skill makes them more efficient at it.
// ------------------------------------------------------------
const SKILLS = {
  engineering: { name: 'Engineering', color: '#ffb454' },   // reactor, life support, repairs
  mining:      { name: 'Mining',      color: '#6fd3c7' },   // mining drone
  botany:      { name: 'Botany',      color: '#9ad36f' },   // hydroponics
};
const SKILL_KEYS = ['engineering', 'mining', 'botany'];
// which skill a module's work draws on (modules not listed need no skilled operator)
const ROOM_SKILL = { reactor: 'engineering', lifesupport: 'engineering', extractor: 'mining', hydroponics: 'botany', manufactor: 'engineering' };

// ------------------------------------------------------------
// Room definitions (display + behavior flags)
// ------------------------------------------------------------
const ROOM_DEFS = {
  reactor:     { name: 'Reactor',     icon: '⚛', auto: true,  desc: 'An operator generates power here — the better their Engineering, the more output. Vents CO₂ as it runs.' },
  lifesupport: { name: 'Life Support',icon: '☁', auto: true,  desc: 'An operator makes oxygen from water and scrubs CO₂. Engineering skill improves it. Idle when nobody is aboard it.' },
  extractor:   { name: 'Mining Drone', icon: '⛏', auto: false, desc: 'An operator mines minerals and ice from the sector. Mining skill improves yield. Drilling vents CO₂. Needs power.' },
  hydroponics: { name: 'Hydroponics', icon: '❀', auto: false, desc: 'An operator grows food from water + oxygen. Botany skill improves yield. Needs power.' },
  quarters:    { name: 'Quarters',    icon: '⏾', staffRole: null,       auto: true,  desc: 'Beds where tired crew sleep to restore energy.' },
  medbay:      { name: 'Medbay',      icon: '✚', staffRole: null,       auto: true,  desc: 'Injured or sick crew heal here. Needs power.' },
  engine:      { name: 'Engine',      icon: '🚀', staffRole: null,       auto: true,  desc: 'Stores fuel and drives FTL jumps. Upgrade for a bigger fuel reserve and cheaper jumps.' },
  messhall:    { name: 'Mess Hall',   icon: '🍴', staffRole: null,       auto: true,  desc: 'A proper galley. Crew eat here for a morale boost instead of grazing the Hydroponics bay.' },
  storage:     { name: 'Storage Room', icon: '📦', staffRole: null,      auto: true,  desc: 'Extra cargo bay. Increases all resource storage capacity.' },
  fuelsynthesis: { name: 'Fuel Synthesis', icon: '⚗', staffRole: null,  auto: true,  desc: 'Automated refinery. Converts water into fuel continuously. Needs power.' },
  manufactor:  { name: 'Manufactor',  icon: '⚙', staffRole: null,       auto: false, desc: 'An operator processes scrap and ore into refined minerals. Engineering skill improves yield. Needs power.' },
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
    { key: 'output',     name: 'Ore Yield',       kind: 'mult', base: 30, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.extractor.oreOut * A_MULT(l))}/s ore per miner` },
    { key: 'storage',    name: 'Ore Storage', kind: 'mult', base: 18, max: 10,
      hint: (l) => `ore capacity ${_r(CONFIG.baseCaps.ore * A_MULT(l))}` },
    { key: 'iceyield',   name: 'Ice Yield',        kind: 'mult', base: 26, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.extractor.iceOut * A_MULT(l))}/s ice per miner` },
    { key: 'icestorage', name: 'Ice Storage',     kind: 'mult', base: 18, max: 10,
      hint: (l) => `ice capacity ${_r(CONFIG.baseCaps.ice * A_MULT(l))}` },
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
  messhall: [
    { key: 'quality', name: 'Meal Quality', kind: 'mult', base: 24, max: 10,
      hint: (l) => `+${_f(CONFIG.needs.messMorale * A_MULT(l))}/s morale while eating` },
    { key: 'seats',   name: 'Seats',        kind: 'beds', base: 24, max: 6, baseN: 3,
      hint: (l) => `${A_BEDS(3, l)} seats` },
  ],
  storage: [
    { key: 'capacity', name: 'Capacity Boost', kind: 'mult', base: 20, max: 10,
      hint: (l) => `+${_r((A_MULT(l) - 1) * 100)}% to all resource caps` },
  ],
  fuelsynthesis: [
    { key: 'output',     name: 'Output',      kind: 'mult', base: 28, max: 10,
      hint: (l) => `+${_f(CONFIG.rooms.fuelsynthesis.fuelOut * A_MULT(l))}/s fuel` },
    { key: 'efficiency', name: 'Efficiency',  kind: 'eff',  base: 22, max: 6,
      hint: (l) => `power draw −${_pct(l)}%` },
  ],
  manufactor: [
    { key: 'efficiency', name: 'Processing Rate', kind: 'mult', base: 24, max: 10,
      hint: (l) => `+${_r((A_MULT(l) - 1) * 100)}% conversion speed (base 1.0/tick)` },
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
    id: 'salvage', name: 'Wreck Salvage', weight: 2, minSector: 1, bad: false,
    msg: 'You drift past a wreck and salvage scrap, fuel, and materials.',
    apply: (st, ev) => {
      ev.duration = 1;
      st.resources.scrap = Math.min(cap(st, 'scrap'), st.resources.scrap + 30 + st.sector * 8);
      st.resources.fuel = Math.min(cap(st, 'fuel'), st.resources.fuel + 10 + st.sector * 2);
      st.resources.ice = Math.min(cap(st, 'ice'), st.resources.ice + 20);
    },
    desc: 'A welcome haul of scrap, fuel and ice from derelict vessels.',
  },
  {
    id: 'fuel_shortage', name: 'Stranded Vessel', weight: 2, minSector: 1, bad: false,
    msg: (st, ev) => `A drifting ship hails you — they have ${ev.fuelAvailable} fuel to sell at ${ev.pricePerUnit} minerals each (up to 20 units).`,
    apply: (st, ev) => {
      ev.duration = 1;
      ev.fuelAvailable = 20;
      ev.pricePerUnit = Math.floor(3 + st.sector * 1.5);
      ev.hasChoices = true;
      ev.choices = [
        { id: 'buy_5',  label: `Buy 5 fuel (${Math.floor((3 + st.sector * 1.5) * 5)} minerals)`,  action: 'buyFuel5' },
        { id: 'buy_10', label: `Buy 10 fuel (${Math.floor((3 + st.sector * 1.5) * 10)} minerals)`, action: 'buyFuel10' },
        { id: 'buy_20', label: `Buy 20 fuel (${Math.floor((3 + st.sector * 1.5) * 20)} minerals)`, action: 'buyFuel20' },
        { id: 'ignore', label: 'Ignore',                                                             action: 'ignoreFuel' },
      ];
    },
    desc: 'A stranded vessel offers to sell you fuel at a premium. Handy if you\'re running low.',
  },
  {
    id: 'space_pirate', name: 'Space Pirates', weight: 2, minSector: 2, bad: true,
    msg: (st, ev) => `Space pirates have locked onto your vessel! They demand ${ev.bribeAmount} minerals as tribute.`,
    apply: (st, ev) => {
      ev.duration = 1;
      const bribeAmount = Math.floor(20 + st.sector * 5);
      ev.bribeAmount = bribeAmount;
      ev.hasChoices = true;
      ev.choices = [
        { id: 'pay_bribe', label: `Pay ${bribeAmount} minerals`, action: 'payPirateBribe' },
        { id: 'refuse_bribe', label: 'Refuse & Fight', action: 'fightPirates' }
      ];
    },
    desc: 'Pirates demand a bribe in minerals or they will attack.',
  },
  {
    id: 'distress_signal', name: 'Distress Signal', weight: 2, minSector: 1, bad: false,
    msg: (st, ev) => `A distress signal — ${ev.survivorCount} survivors stranded after an engine failure. They need food and water.`,
    apply: (st, ev) => {
      ev.duration = 1;
      ev.survivorCount = 2 + Math.floor(rngFloat() * 3);
      const foodCost = ev.survivorCount * 8;
      const waterCost = ev.survivorCount * 5;
      ev.foodCost = foodCost; ev.waterCost = waterCost;
      ev.hasChoices = true;
      ev.choices = [
        { id: 'rescue_full', label: `Rescue all (${foodCost} food, ${waterCost} water → +30 morale, +25 minerals)`, action: 'rescueFull' },
        { id: 'rescue_drop', label: `Drop supplies only (${Math.floor(foodCost/2)} food → +10 morale)`, action: 'rescueDrop' },
        { id: 'ignore_signal', label: 'Ignore signal (−20 morale)', action: 'ignoreSignal' },
      ];
    },
    desc: 'Survivors need help. Rescue them for a morale boost; ignoring costs morale.',
  },
  {
    id: 'abandoned_station', name: 'Derelict Station', weight: 2, minSector: 2, bad: false,
    msg: 'Scanners pick up a derelict station — no life signs, but the cargo bays look intact.',
    apply: (st, ev) => {
      ev.duration = 1;
      ev.hasChoices = true;
      ev.choices = [
        { id: 'survey_careful', label: 'Careful survey (+40 minerals, +30 scrap)', action: 'stationSurvey' },
        { id: 'raid_fast',      label: 'Fast raid (+80 minerals, +60 scrap, +20 ore — risk hull breach)', action: 'stationRaid' },
        { id: 'pass_station',   label: 'Pass by', action: 'passStation' },
      ];
    },
    desc: 'A derelict station with loot. Safe survey or risky fast raid.',
  },
  {
    id: 'cargo_pod', name: 'Drifting Cargo Pod', weight: 3, minSector: 1, bad: false,
    msg: (st, ev) => `A sealed cargo pod drifts into sensor range — contents unknown, labelled Sector ${st.sector} freight.`,
    apply: (st, ev) => {
      ev.duration = 1;
      // contents rotate by sector for determinism
      const roll = st.sector % 3;
      ev.podContents = roll === 0 ? { food: 40, label: '40 food' }
                     : roll === 1 ? { minerals: 50, scrap: 20, label: '50 minerals + 20 scrap' }
                     :              { fuel: 15, ice: 30, label: '15 fuel + 30 ice' };
      ev.hasChoices = true;
      ev.choices = [
        { id: 'open_pod',  label: `Recover pod (${ev.podContents.label})`, action: 'openPod' },
        { id: 'ignore_pod', label: 'Leave it', action: 'ignorePod' },
      ];
    },
    desc: 'A mystery cargo pod — open it for free supplies.',
  },
  {
    id: 'smuggler_cache', name: "Smuggler's Cache", weight: 2, minSector: 3, bad: false,
    msg: (st, ev) => `Hidden beacon leads to a smuggler's cache — ${ev.fullLoot} in contraband goods or just take the fuel.`,
    apply: (st, ev) => {
      ev.duration = 1;
      const minerals = 60 + st.sector * 10;
      const scrap = 40 + st.sector * 8;
      ev.fullLoot = `${minerals} minerals + ${scrap} scrap`;
      ev.minerals = minerals; ev.scrap = scrap;
      ev.hasChoices = true;
      ev.choices = [
        { id: 'take_all',  label: `Take everything (${ev.fullLoot}, −15 crew morale)`, action: 'cacheAll' },
        { id: 'take_fuel', label: 'Take only the fuel (+20 fuel, crew stays clean)', action: 'cacheFuel' },
        { id: 'leave_cache', label: 'Leave it untouched', action: 'leaveCache' },
      ];
    },
    desc: "A smuggler's stash. Clean conscience or full hold — your call.",
  },
];

// ------------------------------------------------------------
// Sector environmental conditions — applied while in that sector.
// Modifiers: reactorMult (reactor output), powerDrawMult (all module draw),
// meltMult (ice->water rate), crewDmg (health lost/sec), stockMult (resource stock).
// ------------------------------------------------------------
const CONDITIONS = {
  calm:       { name: 'Calm Space',  icon: '·', tone: 'good',
    desc: 'Quiet space. Nothing unusual.' },
  rich:       { name: 'Ore-Rich',    icon: '◆', tone: 'good', stockMult: 1.7,
    desc: 'Dense ore & ice fields — a far bigger haul, with no hazard.', reward: '+70% sector stock' },
  // high risk / high reward — each hazard pays off in resources
  scorching:  { name: 'Scorching',   icon: '🔥', tone: 'risk', powerDrawMult: 1.6, yieldMult: 1.7, stockMult: 1.3,
    desc: 'Stellar heat — modules draw +60% power.', reward: '+70% mining yield · +30% stock' },
  frozen:     { name: 'Frozen',      icon: '❄', tone: 'risk', meltMult: 0.25, stockMult: 1.9, yieldMult: 1.3,
    desc: 'Deep cold — ice barely melts (water reclaim −75%).', reward: '+90% stock · +30% yield' },
  irradiated: { name: 'Irradiated',  icon: '☢', tone: 'risk', crewDmg: 0.3, stockMult: 1.6, yieldMult: 1.6,
    desc: 'Hard radiation slowly wounds the crew.', reward: '+60% mining yield · +60% stock' },
  nebula:     { name: 'Ion Nebula',  icon: '≈', tone: 'risk', reactorMult: 0.65, stockMult: 1.5, salvageFuel: 25, salvageMinerals: 70,
    desc: 'Ion interference cuts reactor output −35%.', reward: 'salvage on arrival: +25 fuel, +70 ore · +50% stock' },
};
const BAD_CONDITIONS = ['scorching', 'frozen', 'irradiated', 'nebula'];

// ------------------------------------------------------------
// Run challenges — pick one when starting a run (replaces meta progression).
// Modifiers: crew (starting count), startSkill (specialty level), resourceMult
// (starting supplies), eventRateMult (disaster frequency), revives.
// ------------------------------------------------------------
const CHALLENGES = {
  standard:   { name: 'Standard',      tone: 'good', desc: 'A balanced run — 3 skilled crew and a calm starting sector.' },
  shakedown:  { name: 'Shakedown',     tone: 'good', crew: 4, resourceMult: 1.4, desc: 'A gentle cruise — 4 crew and a well-stocked hold.' },
  skeleton:   { name: 'Skeleton Crew', tone: 'bad',  crew: 2, desc: 'Just 2 crew to cover every job. Tight.' },
  lone_wolf:  { name: 'Lone Wolf',     tone: 'bad',  crew: 1, desc: 'One crew member runs the whole ship. Brutal.' },
  greenhorns: { name: 'Greenhorns',    tone: 'bad',  startSkill: 1, desc: 'Crew start unskilled — everything is slow until they learn.' },
  scarcity:   { name: 'Scarcity',      tone: 'bad',  resourceMult: 0.5, desc: 'Begin with half the usual supplies and minerals.' },
  ion_storms: { name: 'Ion Storms',    tone: 'bad',  eventRateMult: 2, desc: 'Disasters strike twice as often.' },
};
const CHALLENGE_ORDER = ['standard', 'shakedown', 'skeleton', 'lone_wolf', 'greenhorns', 'scarcity', 'ion_storms'];
