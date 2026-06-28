/* STELLAR DRIFT — random events (hull breaches, fires, illness, salvage) */
/* ----------------------------------------------------------
   Events
   ---------------------------------------------------------- */
const REPAIR_RATE = 1.0;   // base repair work/sec; scaled by the repairer's Engineering
function isHazard(ev) { return ev.id === 'hull_breach' || ev.id === 'power_failure'; }
function tickEvents(dt) {
  GAME.events.forEach(ev => {
    ev.duration -= dt;        // duration is a safety cap; hazards normally end via repair
    // located hazards: repair only advances while the assigned crew stands on it,
    // and faster the better their Engineering skill. (ev.beingRepaired set by the ship view.)
    if (ev.needsRepair) {
      if (ev.beingRepaired) {
        const c = GAME.crew.find(x => x.id === ev.assignedTo);
        const eng = c ? 1 + (crewSkillLevel(c, 'engineering') - 1) * CONFIG.skill.outputPerLevel : 1;
        ev.repairProg = (ev.repairProg || 0) + REPAIR_RATE * eng * dt;
        if (c) gainSkill(c, 'engineering', dt);   // repairing trains Engineering
      }
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
  const logExtra = { eventId: chosen.id };
  if (ev.hasChoices) {
    logExtra.hasChoices = ev.hasChoices;
    logExtra.choices = ev.choices;
    logExtra.spawnedAt = GAME.time;   // for 60-second response timer
    // persist data needed to resolve the choice after the event object is gone
    if (ev.pricePerUnit  !== undefined) logExtra.pricePerUnit  = ev.pricePerUnit;
    if (ev.bribeAmount   !== undefined) logExtra.bribeAmount   = ev.bribeAmount;
    if (ev.foodCost      !== undefined) logExtra.foodCost      = ev.foodCost;
    if (ev.waterCost     !== undefined) logExtra.waterCost     = ev.waterCost;
    if (ev.survivorCount !== undefined) logExtra.survivorCount = ev.survivorCount;
    if (ev.podContents   !== undefined) logExtra.podContents   = ev.podContents;
    if (ev.minerals      !== undefined) logExtra.cacheMineral  = ev.minerals;
    if (ev.scrap         !== undefined) logExtra.cacheScrap    = ev.scrap;
    if (ev.fullLoot      !== undefined) logExtra.fullLoot      = ev.fullLoot;
  }
  logMsg(msg, chosen.bad === false ? 'good' : 'bad', logExtra);

  // schedule next, scaled by sector depth and the run's challenge
  const scale = 1 / (1 + (GAME.sector - 1) * CONFIG.jump.eventRateScale) / chMod('eventRateMult', 1);
  const base = CONFIG.events.baseIntervalSec * scale;
  const interval = Math.max(CONFIG.events.minIntervalSec, base * (0.6 + rngFloat() * 0.8));
  GAME.nextEventIn = interval;
}

