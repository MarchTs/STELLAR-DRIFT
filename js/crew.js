/* STELLAR DRIFT — crew: creation, demand-driven AI, staffing, death */
/* ----------------------------------------------------------
   New run — applies meta upgrades to the starting state
   ---------------------------------------------------------- */
// specialty = the skill this crew starts strong in (sets their colour & a head start)
function makeCrew(specialty, specialtyLevel) {
  const skills = {};
  SKILL_KEYS.forEach(k => { skills[k] = { level: 1, xp: 0 }; });
  if (specialty) skills[specialty].level = Math.max(1, specialtyLevel || 1);
  return {
    id: 'c' + Math.floor(rngFloat() * 1e9).toString(36),
    name: pick(CREW_NAMES),
    specialty: specialty || pick(SKILL_KEYS),
    color: SKILLS[specialty || 'engineering'].color,
    skills,
    needs: { hunger: 80, energy: 90, health: crewMaxHealth(), morale: 80 },
    state: 'idle',       // working | sleeping | eating | healing | repairing | idle | dead
    roomId: null,
    restThreshold: CONFIG.ai.restThreshold,
    eatThreshold: CONFIG.ai.eatThreshold,
  };
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
  // 1b. EMERGENCY: drop everything to run to an active hazard and repair it
  if (n.health > 12) {
    const job = claimRepairJob(c);
    if (job) { c.state = 'repairing'; c.roomId = null; return; }
  }
  // 2. FINISH the current rest/meal before starting anything else, so a sleeper
  //    isn't yanked out to eat (and vice-versa) — that caused bed<->galley shuttling.
  if (c.state === 'sleeping' && n.energy < CONFIG.ai.wakeAt) return;
  if (c.state === 'eating' && n.hunger < CONFIG.ai.fullAt && GAME.resources.food > 1) return;
  if (c.state === 'healing' && n.health < CONFIG.ai.healedAt / 100 * maxH && canHeal) return;
  // 3. sleep if exhausted and a berth is free
  const bedForSleep = c.state === 'sleeping' || countState('sleeping') < totalBeds();
  if (n.energy < c.restThreshold && bedForSleep) { setState(c, 'sleeping'); return; }
  // 4. eat if hungry and food available (Mess Hall seats are limited; Hydroponics grazing isn't)
  const seatFree = roomsOfType('messhall').length === 0 || c.state === 'eating' || countState('eating') < totalSeats();
  if (n.hunger < c.eatThreshold && GAME.resources.food > 1 && seatFree) { setState(c, 'eating'); return; }

  // 5. otherwise operate a module that needs them — or idle if nothing does
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

// each producing module's output resource, and how life-critical it is
const ROOM_OUTPUT = { reactor: 'power', lifesupport: 'oxygen', extractor: 'minerals', hydroponics: 'food' };
const JOB_WEIGHT = { lifesupport: 4, reactor: 3, hydroponics: 2, extractor: 1 };

// How badly room `r` needs an operator right now, from crew c's point of view.
// 0 = not needed. Higher = more urgent. Hysteresis (via `here`) keeps the current
// operator working until the store is full, while others only join when it dips.
function jobNeed(c, r) {
  if (!ROOM_OUTPUT[r.type]) return 0;
  const here = c.roomId === r.id;
  if (r.type === 'lifesupport') {
    if (!hasPower(GAME)) return 0;                       // can't run life support unpowered
    const o2F = GAME.resources.oxygen / cap(GAME, 'oxygen');
    const co2F = GAME.resources.co2 / cap(GAME, 'co2');
    const o2Need = here ? o2F < 0.999 : o2F < 0.9;
    const co2Need = here ? co2F > 0.1 : co2F >= 0.45;
    if (!o2Need && !co2Need) return 0;
    return JOB_WEIGHT.lifesupport * Math.max(1 - o2F, co2F);
  }
  const frac = GAME.resources[ROOM_OUTPUT[r.type]] / cap(GAME, ROOM_OUTPUT[r.type]);
  if (frac >= (here ? 0.999 : 0.92)) return 0;           // full enough — not needed
  return (JOB_WEIGHT[r.type] || 1) * (1 - frac);
}

const MULTI_CREW_ROOMS = new Set(['quarters', 'messhall']);

// Role-less, demand-driven: a crew operates whichever module most needs a body.
// Production rooms are single-operator; only quarters and mess hall accept many.
function pickWorkRoom(c) {
  let best = null, bestScore = 0;
  GAME.rooms.forEach(r => {
    const need = jobNeed(c, r);
    if (need <= 0) return;
    const here = c.roomId === r.id;
    const others = assignedOn(r.id) - (here ? 1 : 0);
    if (!MULTI_CREW_ROOMS.has(r.type) && others >= 1) return;  // room full
    let score = need / (others + 1);
    if (here) score *= 1.6;                  // stickiness: don't abandon a job that still needs work
    if (score > bestScore) { bestScore = score; best = r; }
  });
  return best;
}

function staffOn(roomId) {
  const room = GAME.rooms.find(r => r.id === roomId);
  if (!room) return 0;
  let s = 0;
  aliveCrew().forEach(c => {
    if (c.state === 'working' && c.roomId === roomId && c.atStation) {
      const moraleMult = 0.6 + c.needs.morale / 250; // 0.6 .. 1.0
      s += roomSkillMult(c, room) * moraleMult;
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

