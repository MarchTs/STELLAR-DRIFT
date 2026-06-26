/* STELLAR DRIFT — simulation: new run, the per-tick step, jump/synth, end run */
function newRun() {
  // each starting crew is strong in one skill (but can do anything)
  const startLevel = 3 + metaLevel('start_skill');
  const crew = SKILL_KEYS.map(sp => makeCrew(sp, startLevel));

  // extra crew from meta (random specialty)
  for (let i = 0; i < metaLevel('extra_crew'); i++) {
    crew.push(makeCrew(pick(SKILL_KEYS), startLevel));
  }
  // ensure unique names
  const used = new Set();
  crew.forEach(c => { let n = 0; while (used.has(c.name) && n++ < 50) c.name = pick(CREW_NAMES); used.add(c.name); });

  // bays are column-major (even = top, odd = bottom). Production across the top row,
  // crew rooms on the bottom.
  const rooms = [
    makeRoom('reactor', 0), makeRoom('lifesupport', 2), makeRoom('extractor', 4),
    makeRoom('hydroponics', 6), makeRoom('quarters', 1),
  ];
  if (metaLevel('prebuilt_medbay')) rooms.push(makeRoom('medbay', 3));

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
    hullTier: 1,
    condition: 'calm',
    stock: rollSectorStock(1),
  };
  GAME.resources.minerals += metaLevel('start_minerals') * 25;
  clampResources();
  logMsg('Systems online. Keep your crew alive.', 'good');
  saveGame();
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
      + CONFIG.rooms.reactor.powerPerStaff * staff) * attrMult(r, 'output') * reactorMultiplier() * condMod('reactorMult', 1);
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
      const melt = Math.min(LS.iceMelt * attrMult(r, 'water') * condMod('meltMult', 1) * dt, R.ice);   // melt ice into water
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
      // only pull from the sector what we can actually store (don't waste a full hold)
      const dMin = Math.min(EX.mineralsOut * m, GAME.stock.minerals, cap(GAME, 'minerals') - R.minerals);
      const dIce = Math.min(EX.iceOut * m, GAME.stock.ice, cap(GAME, 'ice') - R.ice);
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
    n.health -= condMod('crewDmg', 0) * dt;   // e.g. irradiated sectors

    // morale: recovers when fed+rested, decays otherwise
    const needsOk = n.hunger > 40 && n.energy > 40 && !o2Low;
    n.morale += (needsOk ? N.moraleRecover : -N.moraleDecay) * dt;
    // eating: a Mess Hall lifts morale; grazing the Hydroponics bay (no Mess Hall) lowers it
    if (c.state === 'eating' && c.atStation) {
      const mess = roomsOfType('messhall')[0];
      if (mess) n.morale += N.messMorale * attrMult(mess, 'quality') * dt;
      else n.morale -= N.eatNoMessMorale * dt;
    }

    // clamp
    n.hunger = clamp(n.hunger, 0, 100);
    n.energy = clamp(n.energy, 0, 100);
    n.morale = clamp(n.morale, 0, 100);
    n.health = clamp(n.health, 0, maxH);

    // skill XP while working — the crew improves the skill the job uses
    if (c.state === 'working' && c.roomId && c.atStation) {
      const room = GAME.rooms.find(r => r.id === c.roomId);
      const sk = room && ROOM_SKILL[room.type];
      if (sk) {
        const s = c.skills[sk];
        s.xp += CONFIG.skill.xpPerSecondWorking * dt;
        const need = CONFIG.skill.xpToLevel * s.level;
        if (s.level < CONFIG.skill.maxLevel && s.xp >= need) {
          s.xp -= need; s.level++;
          logMsg(`${c.name} reached ${SKILLS[sk].name} level ${s.level}.`, 'good');
        }
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

// effective operators ON a module — only crew physically present produce/consume.
// Output scales with the operator's relevant skill and their morale.
/* ----------------------------------------------------------
   Jump to next sector
   ---------------------------------------------------------- */
// jump fuel cost, reduced by the Engine's Fuel Efficiency attribute
function jumpFuelCost() {
  const eng = roomsOfType('engine')[0];
  const eff = eng ? A_EFF(attrLvl(eng, 'fuelefficiency')) : 1;
  return Math.round(CONFIG.jump.fuelCost * eff);
}
// manual fuel synthesis: click to convert water -> fuel (very inefficient)
function canSynthFuel() {
  return GAME && !GAME.gameOver &&
    GAME.resources.water >= CONFIG.synth.waterPerFuel &&
    GAME.resources.fuel < cap(GAME, 'fuel');
}
function synthFuel() {
  if (!canSynthFuel()) return false;
  GAME.resources.water -= CONFIG.synth.waterPerFuel;
  GAME.resources.fuel = Math.min(cap(GAME, 'fuel'), GAME.resources.fuel + CONFIG.synth.fuelPerClick);
  return true;
}

function canJump() { return GAME && !GAME.gameOver && GAME.resources.fuel >= jumpFuelCost(); }

// current sector's environmental condition
function condDef() { return CONDITIONS[(GAME && GAME.condition) || 'calm'] || CONDITIONS.calm; }
function condMod(key, dflt) { const v = condDef()[key]; return v === undefined ? dflt : v; }

// roll a candidate sector (stock + condition); deeper sectors are more hazardous
function rollCondition(depth) {
  const badChance = Math.min(0.85, 0.15 + depth * 0.09);
  if (rngFloat() > badChance) return rngFloat() < 0.45 ? 'rich' : 'calm';
  return BAD_CONDITIONS[Math.floor(rngFloat() * BAD_CONDITIONS.length)];
}
function rollSector(depth) {
  const condition = rollCondition(depth);
  const mult = CONDITIONS[condition].stockMult || 1;
  const stock = rollSectorStock(depth);
  stock.minerals = Math.round(stock.minerals * mult);
  stock.ice = Math.round(stock.ice * mult);
  return { sector: depth, condition, stock };
}
function generateJumpOptions() {
  const depth = GAME.sector + 1;
  return [rollSector(depth), rollSector(depth), rollSector(depth)];
}

// jump to a chosen candidate sector
function doJumpTo(opt) {
  if (!canJump() || !opt) return false;
  GAME.resources.fuel -= jumpFuelCost();
  GAME.sector = opt.sector;
  GAME.stock = opt.stock;
  GAME.condition = opt.condition;
  GAME.nextEventIn = Math.min(GAME.nextEventIn, 12);
  const c = CONDITIONS[opt.condition];
  logMsg(`Jumped to Sector ${opt.sector} — ${c.name}. ${c.desc}`, c.tone === 'good' ? 'good' : 'warn');
  saveGame();
  return true;
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
