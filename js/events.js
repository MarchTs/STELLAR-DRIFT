/* STELLAR DRIFT — random events (hull breaches, fires, illness, salvage) */
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

