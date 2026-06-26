/* ============================================================
   STELLAR DRIFT — game state & simulation
   Pure logic. No DOM here (that lives in ui.js).
   ============================================================ */

// ---- tiny deterministic-ish RNG helper (just Math.random wrapped) ----
function rngFloat() { return Math.random(); }
function randInt(a, b) { return a + Math.floor(rngFloat() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rngFloat() * arr.length)]; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

let GAME = null;   // run state
let META = null;   // persistent meta state

const SAVE_KEY = 'stellardrift.save.v3';
const META_KEY = 'stellardrift.meta.v1';

/* ----------------------------------------------------------
   META (persistent across runs)
   ---------------------------------------------------------- */
const META_UPGRADES = [
  // --- better starting conditions ---
  { id: 'extra_crew', name: 'Cryo Pod', cat: 'Start', max: 3,
    cost: l => 12 + l * 10,
    desc: l => `Begin each run with +${l + 1} crew member${l ? 's' : ''}.`,
    blurb: 'Adds a randomly-skilled crew member to your starting roster.' },
  { id: 'start_minerals', name: 'Cargo Cache', cat: 'Start', max: 4,
    cost: l => 8 + l * 6,
    desc: l => `Start with +${(l + 1) * 25} minerals.`,
    blurb: 'A head start on building and repairs.' },
  { id: 'start_skill', name: 'Veteran Crew', cat: 'Start', max: 4,
    cost: l => 10 + l * 8,
    desc: l => `Starting crew begin at skill level ${l + 1 + 1}.`,
    blurb: 'Trained crew produce more from the first second.' },
  { id: 'prebuilt_medbay', name: 'Standard Medbay', cat: 'Start', max: 1,
    cost: () => 25,
    desc: () => 'Start every run with a Medbay already built.',
    blurb: 'Skip the early scramble to treat your first casualty.' },

  // --- survivability buffers ---
  { id: 'max_health', name: 'Reinforced Suits', cat: 'Survival', max: 4,
    cost: l => 10 + l * 9,
    desc: l => `Crew max health +${(l + 1) * 20}.`,
    blurb: 'Crew endure crises longer before dying.' },
  { id: 'o2_reserve', name: 'O₂ Reserves', cat: 'Survival', max: 3,
    cost: l => 12 + l * 10,
    desc: l => `Oxygen capacity +${(l + 1) * 25} and crew breathe ${5 * (l + 1)}% slower.`,
    blurb: 'A bigger buffer against breaches and life-support faults.' },
  { id: 'illness_resist', name: 'Vaccines', cat: 'Survival', max: 3,
    cost: l => 10 + l * 8,
    desc: l => `Outbreak severity −${(l + 1) * 25}%.`,
    blurb: 'Illness drains health more slowly.' },
  { id: 'revive', name: 'Revive Nanites', cat: 'Survival', max: 2,
    cost: l => 18 + l * 16,
    desc: l => `Auto-revive the first ${l + 1} crew death${l ? 's' : ''} per run.`,
    blurb: 'A dead crew member is restored once (per charge) at low health.' },
];

function metaLevel(id) { return (META && META.upgrades[id]) || 0; }

function defaultMeta() { return { cores: 0, upgrades: {} }; }

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    META = raw ? JSON.parse(raw) : defaultMeta();
  } catch (e) { META = defaultMeta(); }
  if (!META.upgrades) META.upgrades = {};
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch (e) {}
}

function buyUpgrade(id) {
  const def = META_UPGRADES.find(u => u.id === id);
  const lvl = metaLevel(id);
  if (!def || lvl >= def.max) return false;
  const cost = def.cost(lvl);
  if (META.cores < cost) return false;
  META.cores -= cost;
  META.upgrades[id] = lvl + 1;
  saveMeta();
  return true;
}

/* ----------------------------------------------------------
   Resource caps (depend on room levels + meta)
   ---------------------------------------------------------- */
// each resource's cap scales with a storage-type attribute on a particular room
const RES_CAP_SRC = {
  power:    { type: 'reactor',     attr: 'storage' },
  oxygen:   { type: 'lifesupport', attr: 'storage' },
  co2:      { type: 'lifesupport', attr: 'co2storage' },
  water:    { type: 'lifesupport', attr: 'waterstorage' },
  minerals: { type: 'extractor',   attr: 'storage' },
  food:     { type: 'hydroponics', attr: 'storage' },
};
function cap(st, res) {
  let c = CONFIG.baseCaps[res];
  const m = RES_CAP_SRC[res];
  if (m) { const r = st.rooms.find(x => x.type === m.type); if (r && attrDef(r.type, m.attr)) c *= A_MULT(attrLvl(r, m.attr)); }
  if (res === 'oxygen') c += metaLevel('o2_reserve') * 25;   // meta reserve stacks additively
  return Math.round(c);
}

function crewMaxHealth() { return 100 + metaLevel('max_health') * 20; }

/* ----------------------------------------------------------
   New run — applies meta upgrades to the starting state
   ---------------------------------------------------------- */
function makeCrew(role, skillLvl) {
  return {
    id: 'c' + Math.floor(rngFloat() * 1e9).toString(36),
    name: pick(CREW_NAMES),
    role,
    skillLevel: skillLvl,
    xp: 0,
    needs: { hunger: 80, energy: 90, health: crewMaxHealth(), morale: 80 },
    state: 'idle',       // working | sleeping | eating | healing | idle | dead
    roomId: null,
    restThreshold: CONFIG.ai.restThreshold,
    eatThreshold: CONFIG.ai.eatThreshold,
  };
}

function makeRoom(type) {
  const attrs = {};
  (ROOM_ATTRS[type] || []).forEach(a => { attrs[a.key] = 1; });
  return { id: 'r' + Math.floor(rngFloat() * 1e9).toString(36), type, attrs };
}

function newRun() {
  const baseSkill = metaLevel('start_skill') ? 1 + metaLevel('start_skill') : 1;

  const roles = ['engineer', 'miner', 'botanist'];
  const crew = roles.map(r => makeCrew(r, baseSkill));

  // extra crew from meta (random roles)
  for (let i = 0; i < metaLevel('extra_crew'); i++) {
    crew.push(makeCrew(pick(roles), baseSkill));
  }

  const rooms = [
    makeRoom('reactor'), makeRoom('lifesupport'), makeRoom('extractor'),
    makeRoom('hydroponics'), makeRoom('quarters'),
  ];
  if (metaLevel('prebuilt_medbay')) rooms.push(makeRoom('medbay'));

  GAME = {
    sector: 1,
    time: 0,
    resources: Object.assign({}, CONFIG.start.resources),
    crew,
    rooms,
    events: [],
    log: [],
    nextEventIn: CONFIG.events.firstEventDelaySec,
    revivesLeft: metaLevel('revive'),
    peakCrew: crew.length,
    roomsBuilt: 0,
    gameOver: false,
    paused: false,
    stock: rollSectorStock(1),
  };
  GAME.resources.minerals += metaLevel('start_minerals') * 25;
  clampResources();
  logMsg('Systems online. Keep your crew alive.', 'good');
  saveGame();
}

/* ----------------------------------------------------------
   Save / load run
   ---------------------------------------------------------- */
function saveGame() {
  if (!GAME) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(GAME)); } catch (e) {}
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    GAME = JSON.parse(raw);
    // migrate any pre-attribute rooms (single `level`) -> attrs
    if (GAME && GAME.rooms) GAME.rooms.forEach(r => {
      if (!r.attrs) {
        r.attrs = {};
        (ROOM_ATTRS[r.type] || []).forEach(a => { r.attrs[a.key] = 1; });
        if (r.level) r.attrs.output = r.level;
        delete r.level;
      }
    });
    // backfill any resources / sector stock added in later versions
    if (GAME && GAME.resources) {
      Object.keys(CONFIG.baseCaps).forEach(res => {
        if (GAME.resources[res] === undefined) GAME.resources[res] = CONFIG.start.resources[res] || 0;
      });
      if (!GAME.stock) GAME.stock = rollSectorStock(GAME.sector || 1);
    }
    return !!GAME && !GAME.gameOver;
  } catch (e) { return false; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

/* ----------------------------------------------------------
   Logging
   ---------------------------------------------------------- */
function logMsg(text, kind) {
  GAME.log.unshift({ t: GAME.time, text, kind: kind || 'info' });
  if (GAME.log.length > 40) GAME.log.length = 40;
}

/* ----------------------------------------------------------
   Helpers for rooms / staffing
   ---------------------------------------------------------- */
function roomsOfType(type) { return GAME.rooms.filter(r => r.type === type); }

/* per-attribute helpers */
function attrDef(type, key) { return (ROOM_ATTRS[type] || []).find(a => a.key === key); }
function attrLvl(room, key) { return (room.attrs && room.attrs[key]) || 1; }
function attrMult(room, key) { return A_MULT(attrLvl(room, key)); }     // output / storage / comfort / treatment
function attrEff(room, key) { return A_EFF(attrLvl(room, key)); }       // efficiency power-draw factor
function bedCount(room) { const d = attrDef(room.type, 'beds'); return d ? A_BEDS(d.baseN, attrLvl(room, 'beds')) : 0; }
function primaryMult(room) { const list = ROOM_ATTRS[room.type]; return (list && list[0]) ? attrMult(room, list[0].key) : 1; }
// power a module currently draws: base × primary-upgrade level × efficiency.
// Staffed production rooms only draw while worked; others draw whenever powered.
function roomPowerDraw(room) {
  const def = CONFIG.rooms[room.type];
  if (!def || !def.powerCost) return 0;
  if ((room.type === 'extractor' || room.type === 'hydroponics') && staffOn(room.id) <= 0) return 0;
  let cost = def.powerCost * primaryMult(room);
  if (attrDef(room.type, 'efficiency')) cost *= attrEff(room, 'efficiency');
  return cost;
}
function totalBeds() { return roomsOfType('quarters').reduce((s, r) => s + bedCount(r), 0); }
function totalMedBeds() { return roomsOfType('medbay').reduce((s, r) => s + bedCount(r), 0); }
function countState(s) { return GAME.crew.filter(c => c.state === s).length; }
function skillMult(crew) { return 1 + (crew.skillLevel - 1) * CONFIG.skill.outputPerLevel; }
function aliveCrew() { return GAME.crew.filter(c => c.state !== 'dead'); }
function hasPower(st) { return st.resources.power > 0.5; }

function activeEvent(id) { return GAME.events.find(e => e.id === id); }

// engineer claims a located hazard to repair (keeps its current claim if still valid)
function claimRepairJob(c) {
  let ev = GAME.events.find(e => e.needsRepair && e.assignedTo === c.id);
  if (ev) return ev;
  ev = GAME.events.find(e => e.needsRepair &&
    (!e.assignedTo || !GAME.crew.some(x => x.id === e.assignedTo && x.state === 'repairing')));
  if (ev) { ev.assignedTo = c.id; return ev; }
  return null;
}

function reactorMultiplier() {
  const fault = activeEvent('power_failure');
  return fault ? fault.reactorMult : 1;
}

/* ----------------------------------------------------------
   Crew AI — pick a state each tick (survival auto-overrides)
   ---------------------------------------------------------- */
function updateCrewState(c) {
  if (c.state === 'dead') return;
  const n = c.needs;
  const maxH = crewMaxHealth();

  // finish-condition transitions out of a need task
  if (c.state === 'sleeping' && n.energy >= CONFIG.ai.wakeAt) c.state = 'idle';
  if (c.state === 'eating' && n.hunger >= CONFIG.ai.fullAt) c.state = 'idle';
  if (c.state === 'healing' && n.health >= Math.min(maxH, CONFIG.ai.healedAt / 100 * maxH)) c.state = 'idle';

  // survival priorities (highest first). Sleeping/healing are bed-limited:
  // a crew can only claim a slot if one is free (or it already holds one).
  // 1. heal if hurt and a powered medbay with a free bed exists
  const medbay = roomsOfType('medbay')[0];
  const canHeal = medbay && hasPower(GAME);
  const bedForHeal = c.state === 'healing' || countState('healing') < totalMedBeds();
  if (n.health < CONFIG.ai.healThreshold && canHeal && bedForHeal) { setState(c, 'healing'); return; }
  // 1b. EMERGENCY: an engineer drops everything to run to an active hazard and repair it
  if (c.role === 'engineer' && n.health > 12) {
    const job = claimRepairJob(c);
    if (job) { c.state = 'repairing'; c.roomId = null; return; }
  }
  // 2. sleep if exhausted and a berth is free
  const bedForSleep = c.state === 'sleeping' || countState('sleeping') < totalBeds();
  if (n.energy < c.restThreshold && bedForSleep) { setState(c, 'sleeping'); return; }
  // 3. eat if hungry and food available
  if (n.hunger < c.eatThreshold && GAME.resources.food > 1) { setState(c, 'eating'); return; }

  // if currently mid need-task and not yet at finish threshold, keep going
  if (c.state === 'sleeping' && n.energy < CONFIG.ai.wakeAt) return;
  if (c.state === 'eating' && n.hunger < CONFIG.ai.fullAt && GAME.resources.food > 1) return;
  if (c.state === 'healing' && n.health < CONFIG.ai.healedAt / 100 * maxH && canHeal) return;

  // 4. otherwise operate a module that needs them — or idle if nothing does
  const room = pickWorkRoom(c);
  if (room) { c.state = 'working'; c.roomId = room.id; }
  else { c.state = 'idle'; c.roomId = null; }
}

function setState(c, s) {
  c.state = s;
  if (s === 'working') {
    const room = pickWorkRoom(c);
    c.roomId = room ? room.id : null;
  } else {
    c.roomId = null;
  }
}

// among the rooms this crew can operate, pick the one that most needs them
function leastStaffed(rooms) {
  let best = rooms[0], bestN = Infinity;
  rooms.forEach(r => {
    const n = GAME.crew.filter(c => c.state === 'working' && c.roomId === r.id).length;
    if (n < bestN) { bestN = n; best = r; }
  });
  return best;
}
// a producer module is "locked" (needs no operator) when its output resource is full
const ROOM_OUTPUT = { reactor: 'power', lifesupport: 'oxygen', extractor: 'minerals', hydroponics: 'food' };
function roomLocked(r) {
  const res = ROOM_OUTPUT[r.type];
  return res ? GAME.resources[res] >= cap(GAME, res) * 0.999 : false;
}
// crew are demand-driven: they operate a module only while its output is needed,
// and leave (idle) once it's full. Returns the room to work, or null to idle.
function pickWorkRoom(c) {
  // LIFE-OR-DEATH: if air is failing and nobody is on Life Support, ANY crew covers it
  // (so a sleeping/dead/busy engineer can't doom the ship).
  const lsRooms = roomsOfType('lifesupport');
  if (lsRooms[0] && assignedOn(lsRooms[0].id) <= 0) {
    const o2F = GAME.resources.oxygen / cap(GAME, 'oxygen');
    const co2F = GAME.resources.co2 / cap(GAME, 'co2');
    if ((o2F < 0.5 || co2F >= 0.6) && hasPower(GAME)) return leastStaffed(lsRooms);
  }
  if (c.role === 'engineer') {
    const ls = roomsOfType('lifesupport'), reactor = roomsOfType('reactor');
    const powerF = GAME.resources.power / cap(GAME, 'power');
    const o2F = GAME.resources.oxygen / cap(GAME, 'oxygen');
    const co2F = GAME.resources.co2 / cap(GAME, 'co2');
    const inLS = c.roomId && ls.some(r => r.id === c.roomId);
    const inReactor = c.roomId && reactor.some(r => r.id === c.roomId);
    // hysteresis so the engineer doesn't flap between rooms
    const lsDemand = inLS ? (o2F < 0.97 || co2F > 0.12) : (o2F < 0.70 || co2F >= 0.45);
    const powerDemand = inReactor ? (powerF < 0.99) : (powerF < 0.60);
    if (o2F < 0.35 && ls.length) return leastStaffed(ls);        // air emergency
    if (powerF < 0.12 && reactor.length) return leastStaffed(reactor); // power emergency
    if (lsDemand && ls.length) return leastStaffed(ls);          // air/CO₂ before topping power
    if (powerDemand && reactor.length) return leastStaffed(reactor);
    return null;                                                 // everything's fine -> idle
  }
  // miners / botanists: operate their module while its output isn't full.
  // Hysteresis: start when the store dips below 92%, keep going until it's full.
  let rooms = [];
  ROLES[c.role].staffs.forEach(t => roomsOfType(t).forEach(r => {
    const res = ROOM_OUTPUT[r.type];
    const frac = res ? GAME.resources[res] / cap(GAME, res) : 0;
    const here = c.roomId === r.id;
    if (here ? frac < 0.999 : frac < 0.92) rooms.push(r);
  }));
  return rooms.length ? leastStaffed(rooms) : null;
}

/* ----------------------------------------------------------
   Main simulation step (dt in seconds)
   ---------------------------------------------------------- */
function step(dt) {
  if (!GAME || GAME.gameOver || GAME.paused) return;
  GAME.time += dt;

  const N = CONFIG.needs;
  const o2SlowMult = 1 - metaLevel('o2_reserve') * 0.05;

  // 1. decide each crew's state
  aliveCrew().forEach(updateCrewState);

  // 2. POWER: reactor produces, consumers draw
  let powerProd = 0, powerDraw = 0;
  roomsOfType('reactor').forEach(r => {
    const staff = staffOn(r.id);
    powerProd += (CONFIG.rooms.reactor.powerPassive
      + CONFIG.rooms.reactor.powerPerStaff * staff) * attrMult(r, 'output') * reactorMultiplier();
  });
  // consumers: production rooms only draw power when actually staffed/working;
  // draw scales UP with the module's primary upgrade level (better = hungrier),
  // and an Efficiency attribute reduces it.
  const consumerTypes = ['lifesupport', 'extractor', 'hydroponics', 'quarters', 'medbay'];
  consumerTypes.forEach(t => {
    roomsOfType(t).forEach(r => {
      powerDraw += roomPowerDraw(r);
    });
  });
  GAME.resources.power = clamp(GAME.resources.power + (powerProd - powerDraw) * dt, 0, cap(GAME, 'power'));
  const powered = hasPower(GAME);

  const R = GAME.resources;
  const LS = CONFIG.rooms.lifesupport, EX = CONFIG.rooms.extractor, HY = CONFIG.rooms.hydroponics;
  if (!GAME.stock) GAME.stock = rollSectorStock(GAME.sector);   // safety for migrated saves

  // 4. LIFE SUPPORT (if powered): ice -> water, water + power -> oxygen, scrub co2
  if (powered) {
    roomsOfType('lifesupport').forEach(r => {
      if (staffOn(r.id) <= 0) return;                          // needs an engineer to do anything
      const m = attrMult(r, 'output');
      const melt = Math.min(LS.iceMelt * attrMult(r, 'water') * dt, R.ice);   // melt ice into water
      R.ice -= melt; R.water += melt;
      const wantW = LS.waterCost * m * dt;                     // oxygen output gated by water
      const useW = Math.min(wantW, R.water);
      const frac = wantW > 0 ? useW / wantW : 0;
      R.water -= useW;
      R.oxygen += LS.o2Out * m * frac * dt;
      R.co2 -= LS.co2Scrub * attrMult(r, 'co2scrub') * dt;     // scrub CO₂
    });
  }

  // crew breathing: consume O2, exhale CO2
  const headcount = aliveCrew().length;
  R.oxygen -= headcount * N.o2PerCrew * o2SlowMult * dt;
  R.co2 += headcount * N.co2PerCrew * dt;
  // wrecked / burning modules leak CO2 while their event is active
  GAME.events.forEach(ev => { if (ev.co2Out) R.co2 += ev.co2Out * dt; });
  const breach = activeEvent('hull_breach');
  if (breach) R.oxygen -= breach.o2Drain * dt;

  // 5. MINING (minerals + ice from finite sector stock) & FOOD (water+O2 -> food)
  if (powered) {
    const mineMult = 1 + (GAME.sector - 1) * CONFIG.jump.mineralBonusPerSector;
    roomsOfType('extractor').forEach(r => {
      const staff = staffOn(r.id);
      if (staff <= 0) return;
      const m = attrMult(r, 'output') * staff * mineMult * dt;
      const dMin = Math.min(EX.mineralsOut * m, GAME.stock.minerals);
      const dIce = Math.min(EX.iceOut * m, GAME.stock.ice);
      GAME.stock.minerals -= dMin; R.minerals += dMin;
      GAME.stock.ice -= dIce; R.ice += dIce;
      R.co2 += EX.co2Out * attrMult(r, 'output') * dt;   // drilling vents CO₂; more with Yield
    });
    roomsOfType('hydroponics').forEach(r => {
      const staff = staffOn(r.id);
      if (staff <= 0) return;
      const m = attrMult(r, 'output') * staff;
      const wantW = HY.waterCost * m * dt, wantO = HY.o2Cost * m * dt;   // needs water + oxygen
      const f = Math.min(wantW > 0 ? R.water / wantW : 1, wantO > 0 ? R.oxygen / wantO : 1, 1);
      R.water -= wantW * f; R.oxygen -= wantO * f;
      R.food += HY.foodOut * m * f * dt;
    });
  }

  // clamp all ship resources & stock
  ['power', 'oxygen', 'co2', 'water', 'ice', 'minerals', 'food', 'fuel'].forEach(res => {
    R[res] = clamp(R[res], 0, cap(GAME, res));
  });
  GAME.stock.minerals = Math.max(0, GAME.stock.minerals);
  GAME.stock.ice = Math.max(0, GAME.stock.ice);

  // 6. CREW NEEDS
  const o2Low = GAME.resources.oxygen <= 0.5;
  const co2Bad = GAME.resources.co2 >= cap(GAME, 'co2') * N.co2Danger;   // CO₂ buildup hurts crew
  const hasMessHall = roomsOfType('messhall').length > 0;                // crew eat at Hydroponics without one
  const qRoom = roomsOfType('quarters')[0], mRoom = roomsOfType('medbay')[0];
  const qMult = qRoom ? attrMult(qRoom, 'comfort') : 1;    // better Quarters -> faster rest
  const mMult = mRoom ? attrMult(mRoom, 'treatment') : 1;  // better Medbay   -> faster healing
  aliveCrew().forEach(c => {
    const n = c.needs;
    const maxH = crewMaxHealth();

    // hunger / energy drains depend on activity
    if (c.state !== 'sleeping') n.energy -= (c.state === 'working' ? N.energyDrainWork : N.energyDrainIdle) * dt;
    n.hunger -= N.hungerDrain * dt;

    // task regen — only once the crew has physically reached the bed / galley / medbay
    if (c.state === 'sleeping' && c.atStation) n.energy += N.energyRegen * qMult * dt;
    if (c.state === 'eating' && c.atStation) {
      n.hunger += N.eatRegen * dt;
      GAME.resources.food -= N.foodPerEat * dt;
    }
    if (c.state === 'healing' && c.atStation) n.health += N.healRegen * mMult * dt;

    // illness event
    const ill = GAME.events.find(e => e.id === 'illness' && e.target === c.id);
    if (ill) {
      const resist = 1 - metaLevel('illness_resist') * 0.25;
      n.health -= ill.healthDrain * resist * dt;
    }

    // bottomed-out needs damage health
    if (n.hunger <= 0) n.health -= N.starveDmg * dt;
    if (n.energy <= 0) n.health -= N.exhaustDmg * dt;
    if (o2Low) n.health -= N.suffocateDmg * dt;
    if (co2Bad) n.health -= N.co2Dmg * dt;

    // morale: recovers when fed+rested, decays otherwise
    const needsOk = n.hunger > 40 && n.energy > 40 && !o2Low;
    n.morale += (needsOk ? N.moraleRecover : -N.moraleDecay) * dt;
    // eating at the Hydroponics bay (no proper Mess Hall) is grim — it costs morale
    if (c.state === 'eating' && c.atStation && !hasMessHall) n.morale -= N.eatNoMessMorale * dt;

    // clamp
    n.hunger = clamp(n.hunger, 0, 100);
    n.energy = clamp(n.energy, 0, 100);
    n.morale = clamp(n.morale, 0, 100);
    n.health = clamp(n.health, 0, maxH);

    // skill XP while working
    if (c.state === 'working' && c.roomId) {
      c.xp += CONFIG.skill.xpPerSecondWorking * dt;
      const need = CONFIG.skill.xpToLevel * c.skillLevel;
      if (c.skillLevel < CONFIG.skill.maxLevel && c.xp >= need) {
        c.xp -= need; c.skillLevel++;
        logMsg(`${c.name} reached ${ROLES[c.role].skill} level ${c.skillLevel}.`, 'good');
      }
    }

    // death
    if (n.health <= 0) handleDeath(c);
  });

  // 7. EVENTS
  tickEvents(dt);

  // 8. game over check
  if (aliveCrew().length === 0 && !GAME.gameOver) endRun();
}

// morale affects work output a touch — fold into staffOn
// effective operators ON a module — only crew physically present produce/consume
function staffOn(roomId) {
  let s = 0;
  aliveCrew().forEach(c => {
    if (c.state === 'working' && c.roomId === roomId && c.atStation) {
      const moraleMult = 0.6 + c.needs.morale / 250; // 0.6 .. 1.0
      s += skillMult(c) * moraleMult;
    }
  });
  return s;
}
// crew ASSIGNED to a module (heading there or on it) — used for AI coverage decisions
function assignedOn(roomId) {
  return aliveCrew().filter(c => c.state === 'working' && c.roomId === roomId).length;
}

function handleDeath(c) {
  if (GAME.revivesLeft > 0) {
    GAME.revivesLeft--;
    c.needs.health = crewMaxHealth() * 0.5;
    c.needs.hunger = Math.max(c.needs.hunger, 50);
    c.needs.energy = Math.max(c.needs.energy, 50);
    logMsg(`${c.name} flatlined — revive nanites kicked in. (${GAME.revivesLeft} left)`, 'warn');
    return;
  }
  c.state = 'dead';
  c.roomId = null;
  logMsg(`${c.name} has died.`, 'bad');
  // clear illness targeting them
  GAME.events = GAME.events.filter(e => !(e.id === 'illness' && e.target === c.id));
}

/* ----------------------------------------------------------
   Events
   ---------------------------------------------------------- */
const REPAIR_RATE = 1.0;   // repair work done per second by an engineer at the hazard
function isHazard(ev) { return ev.id === 'hull_breach' || ev.id === 'power_failure'; }
function tickEvents(dt) {
  GAME.events.forEach(ev => {
    ev.duration -= dt;        // duration is a safety cap; hazards normally end via repair
    // located hazards: repair only advances while an assigned engineer stands on it
    // (ev.beingRepaired is set by the ship view each frame). Completing the work seals it.
    if (ev.needsRepair) {
      if (ev.beingRepaired) ev.repairProg = (ev.repairProg || 0) + REPAIR_RATE * dt;
      if ((ev.repairProg || 0) >= ev.repairNeeded) ev.duration = 0;
    }
  });
  const ending = GAME.events.filter(e => e.duration <= 0);
  ending.forEach(ev => {
    if (ev.id === 'hull_breach') logMsg('Hull breach sealed.', 'good');
    if (ev.id === 'illness') logMsg(`${ev.targetName} recovered.`, 'good');
    if (ev.id === 'power_failure') logMsg('Electrical fire extinguished.', 'good');
  });
  GAME.events = GAME.events.filter(e => e.duration > 0);

  // spawn new events
  GAME.nextEventIn -= dt;
  if (GAME.nextEventIn <= 0) spawnEvent();
}

function spawnEvent() {
  const pool = EVENT_DEFS.filter(e => GAME.sector >= e.minSector);
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = rngFloat() * total, chosen = pool[0];
  for (const e of pool) { r -= e.weight; if (r <= 0) { chosen = e; break; } }

  const ev = { id: chosen.id, name: chosen.name, duration: 1 };
  chosen.apply(GAME, ev);
  if (ev.duration > 1 || chosen.bad === false || chosen.id === 'raiders' || chosen.id === 'salvage') {
    GAME.events.push(ev);
  }
  const msg = typeof chosen.msg === 'function' ? chosen.msg(GAME, ev) : chosen.msg;
  logMsg(msg, chosen.bad === false ? 'good' : 'bad');

  // schedule next, scaled by sector
  const scale = 1 / (1 + (GAME.sector - 1) * CONFIG.jump.eventRateScale);
  const base = CONFIG.events.baseIntervalSec * scale;
  const interval = Math.max(CONFIG.events.minIntervalSec, base * (0.6 + rngFloat() * 0.8));
  GAME.nextEventIn = interval;
}

/* ----------------------------------------------------------
   Jump to next sector
   ---------------------------------------------------------- */
function canJump() { return GAME && !GAME.gameOver && GAME.resources.fuel >= CONFIG.jump.fuelCost; }
function doJump() {
  if (!canJump()) return false;
  GAME.resources.fuel -= CONFIG.jump.fuelCost;
  GAME.sector++;
  GAME.stock = rollSectorStock(GAME.sector);   // fresh, finite resources in the new sector
  GAME.nextEventIn = Math.min(GAME.nextEventIn, 12);
  logMsg(`Jumped to Sector ${GAME.sector}. Fresh ore fields, deadlier space.`, 'warn');
  saveGame();
  return true;
}

/* ----------------------------------------------------------
   Build / upgrade rooms
   ---------------------------------------------------------- */
const MAX_ROOMS = 8;   // the ship has 8 bays (see js/ship.js)
function shipFull() { return GAME.rooms.length >= MAX_ROOMS; }
function buildableTypes() {
  if (shipFull()) return [];   // no empty bays left — don't offer (or charge for) builds
  // medbay only if not present (unless you want multiples — keep single)
  const list = [];
  if (roomsOfType('medbay').length === 0) list.push('medbay');
  list.push('extractor', 'hydroponics', 'quarters');
  return list;
}
function buildCost(type) { return CONFIG.build[type] || 50; }
function canBuild(type) { return !shipFull() && GAME.resources.minerals >= buildCost(type); }
function buildRoom(type) {
  if (!canBuild(type)) return false;
  GAME.resources.minerals -= buildCost(type);
  GAME.rooms.push(makeRoom(type));
  GAME.roomsBuilt++;
  logMsg(`Built a new ${ROOM_DEFS[type].name}.`, 'good');
  saveGame();
  return true;
}

// salvage value of a room ~ half its build cost (starting rooms use the default)
function removeRefund(type) { return Math.round((CONFIG.build[type] || 50) * 0.5); }
function removeRoom(roomId) {
  const idx = GAME.rooms.findIndex(r => r.id === roomId);
  if (idx < 0) return false;
  const room = GAME.rooms[idx];
  const refund = removeRefund(room.type);
  GAME.rooms.splice(idx, 1);
  GAME.resources.minerals = clamp(GAME.resources.minerals + refund, 0, cap(GAME, 'minerals'));
  // release any crew assigned to it; they re-task next tick
  GAME.crew.forEach(c => { if (c.roomId === roomId) { c.roomId = null; if (c.state === 'working') c.state = 'idle'; } });
  logMsg(`Demolished ${ROOM_DEFS[room.type].name} (+${refund} minerals).`, 'warn');
  saveGame();
  return true;
}

/* per-attribute upgrades */
function attrUpgradeCost(room, key) {
  const def = attrDef(room.type, key), l = attrLvl(room, key);
  return Math.round(def.base * l * Math.pow(CONFIG.build.upgradeMult, l - 1));
}
function attrMaxed(room, key) { const def = attrDef(room.type, key); return attrLvl(room, key) >= def.max; }
function canUpgradeAttr(room, key) { return !attrMaxed(room, key) && GAME.resources.minerals >= attrUpgradeCost(room, key); }
function upgradeAttr(roomId, key) {
  const room = GAME.rooms.find(r => r.id === roomId);
  if (!room || !canUpgradeAttr(room, key)) return false;
  GAME.resources.minerals -= attrUpgradeCost(room, key);
  room.attrs[key] = attrLvl(room, key) + 1;
  logMsg(`${ROOM_DEFS[room.type].name}: ${attrDef(room.type, key).name} → L${room.attrs[key]}.`, 'good');
  saveGame();
  return true;
}

function clampResources() {
  Object.keys(GAME.resources).forEach(res => {
    GAME.resources[res] = clamp(GAME.resources[res], 0, cap(GAME, res));
  });
}

// roll a sector's finite resource stock; deeper sectors are a touch richer
function rollSectorStock(sector) {
  const s = CONFIG.sectorStock, bonus = 1 + (sector - 1) * 0.1;
  return {
    minerals: Math.round((s.mineralsMin + rngFloat() * (s.mineralsMax - s.mineralsMin)) * bonus),
    ice: Math.round((s.iceMin + rngFloat() * (s.iceMax - s.iceMin)) * bonus),
  };
}

/* ----------------------------------------------------------
   End run -> bank cores
   ---------------------------------------------------------- */
function computePayout() {
  const p = CONFIG.payout;
  const mins = Math.floor(GAME.time / 60);
  return Math.round(
    GAME.sector * p.perSector +
    mins * p.perMinute +
    GAME.roomsBuilt * p.perRoomBuilt +
    GAME.peakCrew * p.perPeakCrew
  );
}
function endRun() {
  GAME.gameOver = true;
  const earned = computePayout();
  GAME.coresEarned = earned;
  META.cores += earned;
  saveMeta();
  clearSave();
  logMsg(`All crew lost. Banked ${earned} salvage cores.`, 'bad');
}
