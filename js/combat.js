/* ============================================================
   STELLAR DRIFT — combat: FTL-style ship fights

   `GAME.combat` holds the whole fight and is plain JSON so it survives a save
   and reload mid-battle. All timers are seconds counted UP toward a threshold —
   never wall-clock timestamps, which would not survive serialisation.

   While a fight is active the idle economy is suspended: main.js calls
   combatStep() instead of step(), so resources and crew needs hold still.
   ============================================================ */

/* ---------------- power pips ---------------- */
// Total pips available to spend across weapons / shields / engines.
function combatPipsTotal() {
  const C = CONFIG.combat;
  const r = roomsOfType('reactor')[0];
  const lvl = r ? attrLvl(r, 'output') : 1;
  return Math.min(C.pipsMax, C.pipsBase + (lvl - 1) * C.pipsPerReactorLvl);
}
function pipsSpent() {
  const p = GAME.combat.pips;
  return p.weapons + p.shields + p.engines;
}
function pipsFree() { return GAME.combat.pipsTotal - pipsSpent(); }

// Move a pip in/out of a system. Returns true if the allocation changed.
function setPips(sys, delta) {
  const c = GAME.combat;
  if (!c || c.outcome) return false;
  const cur = c.pips[sys];
  const next = cur + delta;
  if (next < 0) return false;
  if (delta > 0 && pipsFree() <= 0) return false;
  // shields can't hold more pips than the generator has layers to power
  if (sys === 'shields' && next > shieldLayersMax()) return false;
  c.pips[sys] = next;
  return true;
}

/* ---------------- our ship's combat stats ---------------- */
// A combat room only works if it exists, is powered, is crewed, and isn't wrecked.
function combatRoomReady(type) {
  const r = roomsOfType(type)[0];
  if (!r || r.disabled) return null;
  if (staffOn(r.id) <= 0) return null;
  if (GAME.combat.pips[type === 'weapons' ? 'weapons' : 'shields'] < 1) return null;
  return r;
}
// Seconds between our shots, faster with Charge Rate upgrades and extra pips.
function ourChargeSec(room) {
  const C = CONFIG.combat;
  const base = CONFIG.rooms.weapons.chargeSec * attrEff(room, 'chargerate');
  const extra = Math.max(0, GAME.combat.pips.weapons - 1);
  return Math.max(1.2, base * (1 - extra * C.weaponPipSpeedup));
}
// Damage per shot, scaled by the Weapon Damage attribute and the gunner's Gunnery.
function ourShotDamage(room) {
  const gunner = GAME.crew.find(c => c.state === 'working' && c.roomId === room.id && c.atStation);
  const skill = gunner ? roomSkillMult(gunner, room) : 1;   // ROOM_SKILL.weapons === 'gunnery'
  return CONFIG.rooms.weapons.damage * attrMult(room, 'damage') * skill;
}
// Our total dodge chance: Engine upgrades + pips assigned to engines.
function ourEvasion() {
  const C = CONFIG.combat;
  const fromPips = GAME.combat.pips.engines * C.evasionPerPip;
  return Math.min(C.evasionMax, evasionChance() + fromPips);
}
// Shield layers we can currently hold — limited by the generator AND by pips.
function ourShieldCap() {
  const r = roomsOfType('shields')[0];
  if (!r || r.disabled || staffOn(r.id) <= 0) return 0;
  return Math.min(shieldLayersMax(), GAME.combat.pips.shields);
}

/* ---------------- starting / ending a fight ---------------- */
function pickEnemyType() {
  const pool = Object.keys(ENEMY_SHIP_DEFS).filter(k => GAME.sector >= ENEMY_SHIP_DEFS[k].minSector);
  return pool.length ? pick(pool) : 'scout';
}

// Enemy stats grow with sector depth so late fights stay threatening.
function scaleEnemy(def) {
  const s = Math.max(0, GAME.sector - 1);
  return {
    integrity:    Math.round(def.integrity * (1 + s * 0.10)),
    damage:       +(def.damage * (1 + s * 0.08)).toFixed(2),
    shieldLayers: def.shieldLayers,
  };
}

function startCombat(type) {
  if (!GAME || GAME.gameOver || GAME.combat) return false;
  const key = type && ENEMY_SHIP_DEFS[type] ? type : pickEnemyType();
  const def = ENEMY_SHIP_DEFS[key];
  const sc = scaleEnemy(def);

  GAME.combat = {
    enemyType: key,
    enemy: {
      name: def.name,
      integrity: sc.integrity,
      integrityMax: sc.integrity,
      shieldLayers: sc.shieldLayers,
      shieldLayersMax: sc.shieldLayers,
      shieldTimer: 0,
      damage: sc.damage,
      chargeSec: def.chargeSec,
      weaponTimer: 0,
      evasion: def.evasion,
      // targetable systems, each independently disable-able
      systems: def.systems.map(sys => ({ sys, disabled: false, repairTimer: 0 })),
    },
    targetSys: null,        // which enemy system we're firing at (null = hull only)
    weaponTimer: 0,         // our weapon charge, seconds
    shieldLayers: 0,        // starts down; charges up once pips are assigned
    shieldTimer: 0,
    pips: { weapons: 0, shields: 0, engines: 0 },
    pipsTotal: combatPipsTotal(),
    jumpCharge: 0,          // 0..1, fills while fleeing
    fleeing: false,
    threat: {},             // roomId -> accumulated damage we've dealt from it (adaptive AI)
    outcome: null,          // null | 'win' | 'lose' | 'fled'
    log: [],                // short combat-only feed, newest first
  };

  // combat suspends the economy AI; drop everyone off their jobs so the player places them
  GAME.crew.forEach(c => { if (c.state === 'working') { c.state = 'idle'; c.roomId = null; } });

  combatLog(`${def.name} closes to firing range.`, 'bad');
  logMsg(`Combat! ${def.name} engages.`, 'bad');
  saveGame();
  return true;
}

function combatLog(text, kind) {
  if (!GAME.combat) return;
  GAME.combat.log.unshift({ t: GAME.time, text, kind: kind || 'info' });
  if (GAME.combat.log.length > 40) GAME.combat.log.length = 40;
}

function endCombat(outcome) {
  const c = GAME.combat;
  if (!c) return;
  c.outcome = outcome;

  if (outcome === 'win') {
    const diff = ENEMY_SHIP_DEFS[c.enemyType].difficulty;
    const L = CONFIG.combat.lootPerDifficulty;
    const minerals = Math.round(L * diff * (0.8 + rngFloat() * 0.6));
    const scrap    = Math.round(L * diff * 0.6 * (0.8 + rngFloat() * 0.6));
    const fuel     = Math.round(2 * diff);
    GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + minerals);
    GAME.resources.scrap    = Math.min(cap(GAME, 'scrap'),    GAME.resources.scrap + scrap);
    GAME.resources.fuel     = Math.min(cap(GAME, 'fuel'),     GAME.resources.fuel + fuel);
    logMsg(`${c.enemy.name} destroyed — salvaged ${minerals} minerals, ${scrap} scrap, ${fuel} fuel.`, 'good');
    // crew who manned a combat station learn from the fight
    ['weapons', 'shields'].forEach(t => {
      const room = roomsOfType(t)[0];
      if (!room) return;
      const sk = ROOM_SKILL[t];
      GAME.crew.forEach(cr => {
        if (cr.state !== 'dead' && cr.roomId === room.id) gainSkill(cr, sk, CONFIG.combat.xpSecondsPerWin);
      });
    });
  } else if (outcome === 'fled') {
    GAME.resources.fuel = Math.max(0, GAME.resources.fuel - CONFIG.combat.fleeFuelCost);
    logMsg(`Escaped the ${c.enemy.name} — burned ${CONFIG.combat.fleeFuelCost} fuel jumping clear.`, 'warn');
  } else if (outcome === 'lose') {
    logMsg(`The ${c.enemy.name} tore the ship apart.`, 'bad');
    GAME.gameOver = true;
  }

  // battle damage to rooms is patched up once the shooting stops
  GAME.rooms.forEach(r => { r.disabled = false; r.repairTimer = 0; });
  GAME.combat = null;
  saveGame();
}

/* ---------------- damage resolution ---------------- */
// Enemy fires at one of our rooms. Evasion, then shields, then integrity + side effects.
function damagePlayer(amount, roomId) {
  const c = GAME.combat;
  if (rngFloat() < ourEvasion()) { combatLog('Their shot goes wide — evaded.', 'good'); return; }
  if (c.shieldLayers > 0) {
    c.shieldLayers--;
    c.shieldTimer = 0;
    combatLog('Shields absorbed the hit.', 'info');
    return;
  }
  GAME.integrity = Math.max(0, GAME.integrity - amount);

  const room = GAME.rooms.find(r => r.id === roomId);
  if (room) {
    room.disabled = true;
    room.repairTimer = 0;
    combatLog(`${ROOM_DEFS[room.type].name} knocked out!`, 'bad');
    // anyone standing in it is hurt
    GAME.crew.forEach(cr => {
      if (cr.state === 'dead' || cr.roomId !== room.id) return;
      cr.needs.health = Math.max(0, cr.needs.health - CONFIG.combat.crewDamagePerHit);
      if (cr.needs.health <= 0) handleDeath(cr);
    });
    // sometimes the hit breaches the hull
    if (rngFloat() < CONFIG.combat.fireChance) {
      GAME.events.push({ id: 'hull_breach', name: 'Hull Breach', duration: 60, o2Drain: 2.2, needsRepair: true, repairNeeded: 3 });
      combatLog('Hull breached — oxygen venting!', 'bad');
    }
  } else {
    combatLog(`Hull takes ${amount.toFixed(1)} damage.`, 'bad');
  }
  if (GAME.integrity <= 0) endCombat('lose');
}

// We fire at the enemy. Their evasion, then their shields, then their integrity.
function damageEnemy(amount, fromRoomId) {
  const c = GAME.combat, e = c.enemy;
  if (rngFloat() < e.evasion) { combatLog('They dodged our shot.', 'warn'); return; }
  if (e.shieldLayers > 0) {
    e.shieldLayers--;
    e.shieldTimer = 0;
    combatLog('Their shields held.', 'warn');
    return;
  }
  e.integrity = Math.max(0, e.integrity - amount);
  // remember which of our rooms is hurting them — drives their targeting
  if (fromRoomId) c.threat[fromRoomId] = (c.threat[fromRoomId] || 0) + amount;

  // a targeted system goes down for a while
  if (c.targetSys) {
    const sysObj = e.systems.find(s => s.sys === c.targetSys);
    if (sysObj && !sysObj.disabled) {
      sysObj.disabled = true;
      sysObj.repairTimer = 0;
      combatLog(`Their ${ENEMY_SYS_NAME[c.targetSys]} is offline.`, 'good');
    }
  }
  combatLog(`Hit for ${amount.toFixed(1)}.`, 'good');
  if (e.integrity <= 0) endCombat('win');
}

/* ---------------- enemy AI ---------------- */
// Adaptive: favour whatever is hurting us most — but as a WEIGHTED ROLL, not a strict
// argmax. Always picking the top-scoring room produces a degenerate lock: it wrecks the
// Weapons Bay, we repair it, it wrecks it again, and the player never gets a shot off.
// Weighting keeps the AI threatening while letting fire spread across the ship.
function enemyPickTarget() {
  const c = GAME.combat;
  const live = GAME.rooms.filter(r => !r.disabled);
  if (!live.length) return null;

  const weight = (r) => {
    let w = 1;                                              // every live room is a candidate
    w += Math.min(2, (c.threat[r.id] || 0) * 0.15);         // capped, so long fights don't tunnel
    if (r.type === 'weapons') w += 3;
    if (r.type === 'shields' && ourShieldCap() > 0) w += 2;
    if (r.type === 'engine'  && c.pips.engines > 0) w += 1.5;
    if (staffOn(r.id) > 0) w += 0.5;                        // crewed rooms are doing the work
    return w;
  };
  const scored = live.map(r => ({ r, w: weight(r) }));
  const total = scored.reduce((s, x) => s + x.w, 0);
  let roll = rngFloat() * total;
  for (const x of scored) { roll -= x.w; if (roll <= 0) return x.r; }
  return scored[scored.length - 1].r;
}

/* ---------------- the tick ---------------- */
function combatStep(dt) {
  const c = GAME.combat;
  if (!c || c.outcome || GAME.gameOver) return;
  GAME.time += dt;
  const e = c.enemy;

  // --- our shields recharge toward the cap our pips can hold ---
  const sCap = ourShieldCap();
  if (c.shieldLayers > sCap) c.shieldLayers = sCap;    // pips pulled away drop layers
  if (c.shieldLayers < sCap) {
    const sr = roomsOfType('shields')[0];
    const per = CONFIG.rooms.shields.rechargeSec * (sr ? attrEff(sr, 'recharge') : 1);
    c.shieldTimer += dt;
    if (c.shieldTimer >= per) { c.shieldTimer = 0; c.shieldLayers++; }
  }

  // --- enemy shields recharge ---
  if (e.shieldLayers < e.shieldLayersMax) {
    const sysDown = e.systems.find(s => s.sys === 'shields' && s.disabled);
    if (!sysDown) {
      e.shieldTimer += dt;
      if (e.shieldTimer >= ENEMY_SHIP_DEFS[c.enemyType].rechargeSec) { e.shieldTimer = 0; e.shieldLayers++; }
    }
  }

  // --- enemy repairs its knocked-out systems ---
  e.systems.forEach(s => {
    if (!s.disabled) return;
    s.repairTimer += dt;
    if (s.repairTimer >= CONFIG.combat.enemyRepairSec) {
      s.disabled = false; s.repairTimer = 0;
      combatLog(`Their ${ENEMY_SYS_NAME[s.sys]} is back online.`, 'warn');
    }
  });

  // --- our crew repair disabled rooms they're standing in ---
  GAME.rooms.forEach(r => {
    if (!r.disabled) return;
    const hands = GAME.crew.filter(cr => cr.state !== 'dead' && cr.roomId === r.id && cr.atStation).length;
    if (!hands) return;
    r.repairTimer = (r.repairTimer || 0) + dt * hands;
    if (r.repairTimer >= CONFIG.combat.repairSec) {
      r.disabled = false; r.repairTimer = 0;
      combatLog(`${ROOM_DEFS[r.type].name} repaired.`, 'good');
    }
  });

  // --- our weapon charges and fires ---
  const wRoom = combatRoomReady('weapons');
  if (wRoom) {
    c.weaponTimer += dt;
    const need = ourChargeSec(wRoom);
    if (c.weaponTimer >= need) {
      c.weaponTimer = 0;
      damageEnemy(ourShotDamage(wRoom), wRoom.id);
      if (c.outcome) return;      // fight ended on that shot
    }
  }
  // NOTE: a gun that goes unready keeps its partial charge. Zeroing it here stacked with
  // room disables to make the weapon effectively never fire.

  // --- enemy weapon charges and fires ---
  const eGunDown = e.systems.find(s => s.sys === 'weapons' && s.disabled);
  if (!eGunDown) {
    e.weaponTimer += dt;
    if (e.weaponTimer >= e.chargeSec) {
      e.weaponTimer = 0;
      const target = enemyPickTarget();
      damagePlayer(e.damage, target && target.id);
      if (c.outcome || GAME.gameOver) return;
    }
  }

  // --- FTL jump charge, if we're running ---
  if (c.fleeing) {
    const eEngDown = e.systems.find(s => s.sys === 'engines' && s.disabled);
    // their engines being down makes escaping easier
    const rate = (1 / CONFIG.combat.fleeChargeSec) * (eEngDown ? 1.6 : 1);
    c.jumpCharge = Math.min(1, c.jumpCharge + rate * dt);
    if (c.jumpCharge >= 1) { endCombat('fled'); return; }
  }
}

/* ---------------- player actions ---------------- */
function setCombatTarget(sys) {
  const c = GAME.combat;
  if (!c || c.outcome) return false;
  c.targetSys = (c.targetSys === sys) ? null : sys;   // click again to clear
  return true;
}
function toggleFlee() {
  const c = GAME.combat;
  if (!c || c.outcome) return false;
  if (!c.fleeing && GAME.resources.fuel < CONFIG.combat.fleeFuelCost) {
    combatLog(`Not enough fuel to jump (need ${CONFIG.combat.fleeFuelCost}).`, 'bad');
    return false;
  }
  c.fleeing = !c.fleeing;
  if (!c.fleeing) c.jumpCharge = 0;                   // cancelling loses the charge
  combatLog(c.fleeing ? 'Charging FTL drive…' : 'FTL charge aborted.', 'warn');
  return true;
}
// Order a crew member to a room (combat replaces the economy AI's auto-assignment).
function orderCrewTo(crewId, roomId) {
  const cr = GAME.crew.find(x => x.id === crewId);
  if (!cr || cr.state === 'dead') return false;
  const room = GAME.rooms.find(r => r.id === roomId);
  if (!room) return false;
  // combat rooms are single-operator, same as production
  if (!MULTI_CREW_ROOMS.has(room.type) && assignedOn(room.id) > 0 && cr.roomId !== room.id) return false;
  cr.state = 'working';
  cr.roomId = room.id;
  return true;
}
