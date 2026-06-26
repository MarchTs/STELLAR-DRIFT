/* ============================================================
   STELLAR DRIFT — rendering & interaction (DOM)
   ============================================================ */

const $ = sel => document.querySelector(sel);

function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return '' + n;
}
function fmtTime(s) {
  s = Math.floor(s);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
function fmtRate(r) {
  if (Math.abs(r) < 0.05) return '';
  const sign = r > 0 ? '+' : '';
  return sign + r.toFixed(1) + '/s';
}

const RES_META = {
  power:    { label: 'Power',    cls: 'power' },
  oxygen:   { label: 'Oxygen',   cls: 'oxygen' },
  co2:      { label: 'CO₂',      cls: 'co2', hazard: true },
  water:    { label: 'Water',    cls: 'water' },
  ice:      { label: 'Ice',      cls: 'ice' },
  minerals: { label: 'Minerals', cls: 'minerals' },
  food:     { label: 'Food',     cls: 'food' },
  fuel:     { label: 'Fuel',     cls: 'fuel' },
};

// top bar groups: each group is a labelled cluster of resource meters
const RES_GROUPS = [
  { name: 'Power', keys: ['power'] },
  { name: 'Life Support', keys: ['oxygen', 'co2'] },
  { name: 'Storage', keys: ['food', 'water', 'ice', 'minerals'] },
  { name: 'Fuel', keys: ['fuel'] },
];

let lastRates = { power: 0, oxygen: 0, co2: 0, water: 0, ice: 0, minerals: 0, food: 0, fuel: 0 };
let hoveredRes = null;   // which resource meter the mouse is over (for the breakdown tooltip)

/* ---------------- resource flow breakdown (for hover tooltip) ---------------- */
// per-second sources (+) and sinks (-) for a resource, mirroring sim.js step().
function resourceBreakdown(res) {
  const R = GAME.resources, N = CONFIG.needs, RM = CONFIG.rooms;
  const powered = hasPower(GAME);
  const sources = [], sinks = [];
  const add = (arr, label, rate) => { if (rate > 0.001) arr.push({ label, rate }); };
  const headcount = aliveCrew().length;
  const o2Slow = 1 - metaLevel('o2_reserve') * 0.05;
  const mineMult = 1 + (GAME.sector - 1) * CONFIG.jump.mineralBonusPerSector;
  const eaters = aliveCrew().filter(c => c.state === 'eating' && c.atStation).length;
  const tag = (a, i) => a.length > 1 ? ' #' + (i + 1) : '';

  if (res === 'power') {
    roomsOfType('reactor').forEach((r, i, a) =>
      add(sources, 'Reactor' + tag(a, i), (RM.reactor.powerPassive + RM.reactor.powerPerStaff * staffOn(r.id)) * attrMult(r, 'output') * reactorMultiplier() * condMod('reactorMult', 1)));
    ['lifesupport', 'extractor', 'hydroponics', 'quarters', 'medbay'].forEach(t =>
      roomsOfType(t).forEach((r, i, a) => add(sinks, ROOM_DEFS[t].name + tag(a, i), roomPowerDraw(r))));
  } else if (res === 'oxygen') {
    if (powered) roomsOfType('lifesupport').forEach((r, i, a) => {
      if (staffOn(r.id) > 0) add(sources, 'Life Support' + tag(a, i), R.water > 0 ? RM.lifesupport.o2Out * attrMult(r, 'output') : 0);
    });
    add(sinks, `Crew breathing ×${headcount}`, headcount * N.o2PerCrew * o2Slow);
    if (powered) roomsOfType('hydroponics').forEach(r => { if (staffOn(r.id) > 0) add(sinks, 'Hydroponics', RM.hydroponics.o2Cost * attrMult(r, 'output') * staffOn(r.id)); });
    const breach = activeEvent('hull_breach'); if (breach) add(sinks, 'Hull breach', breach.o2Drain);
  } else if (res === 'co2') {
    add(sources, `Crew exhaling ×${headcount}`, headcount * N.co2PerCrew);
    roomsOfType('reactor').forEach((r, i, a) => add(sources, 'Reactor' + tag(a, i), RM.reactor.co2Out * attrMult(r, 'output')));
    if (powered) roomsOfType('extractor').forEach(r => { if (staffOn(r.id) > 0) add(sources, 'Mining (drilling)', RM.extractor.co2Out * attrMult(r, 'output')); });
    GAME.events.forEach(ev => { if (ev.co2Out) add(sources, ev.name || 'Hazard', ev.co2Out); });
    if (powered) roomsOfType('lifesupport').forEach(r => { if (staffOn(r.id) > 0) add(sinks, 'Life Support (scrub)', RM.lifesupport.co2Scrub * attrMult(r, 'co2scrub')); });
  } else if (res === 'water') {
    if (powered) roomsOfType('lifesupport').forEach(r => {
      if (staffOn(r.id) <= 0) return;
      add(sources, 'Life Support (melt ice)', RM.lifesupport.iceMelt * attrMult(r, 'water'));
      add(sinks, 'Life Support (make O₂)', R.water > 0 ? RM.lifesupport.waterCost * attrMult(r, 'output') : 0);
    });
    if (powered) roomsOfType('hydroponics').forEach(r => { if (staffOn(r.id) > 0) add(sinks, 'Hydroponics', RM.hydroponics.waterCost * attrMult(r, 'output') * staffOn(r.id)); });
  } else if (res === 'ice') {
    if (powered) roomsOfType('extractor').forEach(r => { if (staffOn(r.id) > 0) add(sources, 'Mining Drone', RM.extractor.iceOut * attrMult(r, 'output') * staffOn(r.id) * mineMult); });
    if (powered) roomsOfType('lifesupport').forEach(r => { if (staffOn(r.id) > 0) add(sinks, 'Life Support (melt)', RM.lifesupport.iceMelt * attrMult(r, 'water')); });
  } else if (res === 'minerals') {
    if (powered) roomsOfType('extractor').forEach(r => { if (staffOn(r.id) > 0) add(sources, 'Mining Drone', RM.extractor.mineralsOut * attrMult(r, 'output') * staffOn(r.id) * mineMult); });
  } else if (res === 'food') {
    if (powered) roomsOfType('hydroponics').forEach(r => {
      if (staffOn(r.id) > 0) add(sources, 'Hydroponics', (R.water > 0 && R.oxygen > 0) ? RM.hydroponics.foodOut * attrMult(r, 'output') * staffOn(r.id) : 0);
    });
    if (eaters) add(sinks, `Crew eating ×${eaters}`, eaters * N.foodPerEat);
  }
  const net = sources.reduce((s, x) => s + x.rate, 0) - sinks.reduce((s, x) => s + x.rate, 0);
  return { sources, sinks, net };
}

function renderResTip() {
  const tip = $('#res-tip');
  if (!tip) return;
  const meter = hoveredRes && document.querySelector(`#resources .res[data-res="${hoveredRes}"]`);
  if (!hoveredRes || !meter || !GAME) { tip.classList.add('hidden'); return; }
  const bd = resourceBreakdown(hoveredRes), m = RES_META[hoveredRes];
  const fr = r => (r > 0 ? '+' : '−') + Math.abs(r).toFixed(2) + '/s';
  const row = (s, cls) => `<div class="rt-row"><span>${s.label}</span><span class="${cls}">${fr(cls === 'down' ? -s.rate : s.rate)}</span></div>`;
  const body = bd.sources.map(s => row(s, 'up')).concat(bd.sinks.map(s => row(s, 'down'))).join('');
  tip.innerHTML = `<div class="rt-title">${m.label} flow</div>${body || '<div class="rt-empty">No continuous flow — manual only (synth / jump / salvage / build).</div>'}` +
    (body ? `<div class="rt-net"><span>Net</span><span class="${bd.net > 0.01 ? 'up' : bd.net < -0.01 ? 'down' : ''}">${fr(bd.net)}</span></div>` : '');
  const r = meter.getBoundingClientRect();
  tip.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
  tip.style.top = (r.bottom + 6) + 'px';
  tip.classList.remove('hidden');
}

/* ---------------- top bar ---------------- */
function resMeter(res) {
  const m = RES_META[res];
  const val = GAME.resources[res], max = cap(GAME, res);
  const pct = clamp((val / max) * 100, 0, 100);
  const rate = lastRates[res] || 0;
  const rcls = rate > 0.05 ? 'up' : rate < -0.05 ? 'down' : '';
  // CO₂ is a hazard meter: full = bad, so flip the rate colours and warn near the top
  const danger = m.hazard && pct >= CONFIG.needs.co2Danger * 100;
  return `<div class="res ${m.cls} ${danger ? 'danger' : ''}" data-res="${res}">
    <div class="res-top"><span>${m.label}</span><span class="res-val">${fmt(val)}<span class="muted">/${fmt(max)}</span></span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="rate ${m.hazard ? (rate > 0.05 ? 'down' : rate < -0.05 ? 'up' : '') : rcls}">${fmtRate(rate)}</div>
  </div>`;
}
function renderTop() {
  $('#run-sub').textContent = `Sector ${GAME.sector} · ${fmtTime(GAME.time)}`;
  $('#core-count').textContent = fmt(META.cores);

  $('#resources').innerHTML = RES_GROUPS.map(g =>
    `<div class="res-group"><div class="res-group-label">${g.name}</div>
      <div class="res-row">${g.keys.map(resMeter).join('')}</div></div>`
  ).join('');
  renderResTip();
}

/* ---------------- ship grid ---------------- */
function staffCountText(room) {
  if (room.type === 'lifesupport') {
    if (!hasPower(GAME)) return 'no power';
    return staffOn(room.id) > 0 ? 'making O₂ · scrubbing CO₂' : 'idle — no operator';
  }
  if (room.type === 'medbay') return hasPower(GAME) ? 'online' : 'no power';
  if (room.type === 'quarters') return `${aliveCrew().filter(c => c.state === 'sleeping').length} resting`;
  if (room.type === 'messhall') return `${aliveCrew().filter(c => c.state === 'eating').length} eating`;
  if (room.type === 'engine') return 'standby';
  const present = aliveCrew().filter(c => c.state === 'working' && c.roomId === room.id && c.atStation);
  if (room.type === 'reactor') return present.length ? `${present.length} operating` : 'automated (low output)';
  return present.length ? `${present.length} working` : 'idle';
}

function renderShip() {
  // The ship is drawn on the canvas by ship.js. Building is done by clicking an
  // empty bay on the ship; here we just show a hint line.
  const tray = $('#build-tray');
  if (!tray) return;
  tray.innerHTML = shipFull()
    ? `<div class="tray-msg">All ${maxRooms()} bays occupied — expand the hull or demolish a module.</div>`
    : `<div class="tray-msg">▦ Click an empty bay on the ship to build a module.</div>`;
}

/* build menu for a specific empty bay */
function openBuildModal(bay) {
  const types = buildableTypes();
  const cards = types.map(type => {
    const cost = buildCost(type);
    const afford = GAME.resources.minerals >= cost;
    const def = ROOM_DEFS[type];
    return `<div class="upg">
      <div class="u-top"><span class="u-name">${def.icon} ${def.name}</span></div>
      <div class="u-desc">${roomEffectText(type)}</div>
      <div class="u-blurb">${def.desc}</div>
      <div class="u-foot">
        <span class="u-cost">${cost} minerals</span>
        <button class="btn small ${afford ? 'primary' : ''}" ${afford ? '' : 'disabled'} onclick="doBuildInBay('${type}',${bay})">Build</button>
      </div>
    </div>`;
  }).join('');
  openModal(`
    <span class="close" onclick="closeModal()">×</span>
    <h2>Build a Module</h2>
    <p class="muted">Bay ${bay + 1} is empty. Costs minerals. You have <b style="color:var(--minerals)">${fmt(GAME.resources.minerals)}</b> minerals.</p>
    <div class="upg-grid">${cards}</div>
    <div class="row-actions"><button class="btn" onclick="closeModal()">Cancel</button></div>
  `);
}
function doBuildInBay(type, bay) {
  if (buildRoom(type, bay)) { renderAll(); closeModal(); }
}

/* ---------------- crew ---------------- */
function needRow(label, cls, val, max) {
  const pct = clamp((val / (max || 100)) * 100, 0, 100);
  const low = pct < 25 ? 'low' : '';
  return `<div class="need ${cls} ${low}"><span class="nlabel">${label}</span>
    <span class="nbar"><i style="width:${pct}%"></i></span></div>`;
}
function renderCrew() {
  $('#crew-count').textContent = `${aliveCrew().length} alive`;
  const list = $('#crew-list');
  list.innerHTML = GAME.crew.map(c => {
    const dead = c.state === 'dead';
    const maxH = crewMaxHealth();
    // skill chips: highlight the crew's strongest skill
    const top = SKILL_KEYS.reduce((a, k) => crewSkillLevel(c, k) > crewSkillLevel(c, a) ? k : a, SKILL_KEYS[0]);
    const skillChips = SKILL_KEYS.map(k =>
      `<span class="sk ${k === top ? 'top' : ''}" style="--sk:${SKILLS[k].color}" title="${SKILLS[k].name}">${SKILLS[k].name.slice(0, 3)} ${crewSkillLevel(c, k)}</span>`
    ).join('');
    return `<div class="crew ${dead ? 'dead' : ''}" style="--role:${c.color}">
      <div class="crew-top">
        <div><span class="crew-name">${c.name}</span></div>
        <span class="crew-state ${c.state}">${dead ? '☠ dead' : c.state}</span>
      </div>
      ${dead ? '' : `<div class="crew-skills">${skillChips}</div>
      <div class="needs">
        ${needRow('Food', 'hunger', c.needs.hunger)}
        ${needRow('Rest', 'energy', c.needs.energy)}
        ${needRow('Health', 'health', c.needs.health, maxH)}
        ${needRow('Morale', 'morale', c.needs.morale)}
      </div>`}
    </div>`;
  }).join('');
}

/* ---------------- log ---------------- */
function renderLog() {
  $('#log').innerHTML = GAME.log.map(e =>
    `<div class="entry"><span class="ts">${fmtTime(e.t)}</span><span class="${e.kind}">${e.text}</span></div>`
  ).join('');
}

/* ---------------- buttons state ---------------- */
function renderControls() {
  $('#btn-jump').disabled = !canJump();
  $('#btn-jump').textContent = `Jump ⟶ (${jumpFuelCost()} fuel)`;
  const synth = $('#btn-synth');
  if (synth) {
    synth.disabled = !canSynthFuel();
    synth.textContent = `Synth Fuel (${CONFIG.synth.waterPerFuel} water → ${CONFIG.synth.fuelPerClick})`;
    synth.title = 'Convert water into fuel — inefficient, but reliable';
  }
  const hull = $('#btn-hull');
  if (hull) {
    const maxed = hullTier() >= CONFIG.hull.maxTier;
    hull.disabled = !canExpandHull();
    hull.textContent = maxed ? 'Hull Maxed' : `Expand Hull (${hullCost()} min → +2 bays)`;
    hull.title = `Widen the ship for more module bays (currently ${maxRooms()})`;
  }
  const si = $('#sector-info');
  if (si && GAME.stock) {
    const low = GAME.stock.minerals < 30 && GAME.stock.ice < 30;
    const c = condDef();
    si.innerHTML = `<span class="si-sector">Sector ${GAME.sector}</span>
      <span class="si-cond cond-${c.tone}" title="${c.desc}">${c.icon} ${c.name}</span>
      <span class="si-stock"><b style="color:var(--minerals)">${fmt(GAME.stock.minerals)}</b> ore</span>
      <span class="si-stock"><b style="color:var(--ice)">${fmt(GAME.stock.ice)}</b> ice</span>
      <span class="muted">${low ? 'depleted' : ''}</span>`;
  }
}

/* ---------------- jump: choose the next sector ---------------- */
let jumpOptions = null;
function openJumpModal() {
  if (!canJump()) return;
  jumpOptions = generateJumpOptions();
  const cost = jumpFuelCost();
  const cards = jumpOptions.map((o, i) => {
    const c = CONDITIONS[o.condition];
    return `<div class="upg">
      <div class="u-top"><span class="u-name">${c.icon} ${c.name}</span><span class="u-cat">Sector ${o.sector}</span></div>
      <div class="u-desc cond-${c.tone}">${c.desc}</div>
      <div class="u-blurb">Stock: <b style="color:var(--minerals)">${fmt(o.stock.minerals)}</b> ore · <b style="color:var(--ice)">${fmt(o.stock.ice)}</b> ice</div>
      <div class="u-foot"><span class="u-cost" style="color:var(--fuel)">${cost} fuel</span>
        <button class="btn small primary" onclick="confirmJump(${i})">Jump here</button></div>
    </div>`;
  }).join('');
  openModal(`<span class="close" onclick="closeModal()">×</span>
    <h2>Plot a Jump</h2>
    <p class="muted">Scanners found ${jumpOptions.length} reachable sectors. Each jump costs <b style="color:var(--fuel)">${cost} fuel</b> (you have ${fmt(GAME.resources.fuel)}). Deeper space is more hostile.</p>
    <div class="upg-grid">${cards}</div>
    <div class="row-actions"><button class="btn" onclick="closeModal()">Cancel</button></div>`);
}
function confirmJump(i) {
  const opt = jumpOptions && jumpOptions[i];
  if (opt && doJumpTo(opt)) { triggerJumpFlash(); closeModal(); renderAll(); }
}

function renderAll() {
  if (!GAME) return;
  renderTop();
  renderShip();
  renderCrew();
  renderLog();
  renderControls();
}

/* ============================================================
   Modals
   ============================================================ */
function openModal(html) {
  $('#modal-card').innerHTML = `<div class="modal-pad">${html}</div>`;
  $('#modal').classList.remove('hidden');
}
function closeModal() { $('#modal').classList.add('hidden'); }

/* summary line for build-tray chips: the room's primary attribute at L1 */
function roomEffectText(type) {
  const def = (ROOM_ATTRS[type] || [])[0];
  return def ? def.hint(1) : '';
}

/* room detail — one upgradeable row per attribute */
function openRoomDetail(roomId, mode) {
  const room = GAME.rooms.find(r => r.id === roomId);
  if (!room) return;
  const def = ROOM_DEFS[room.type];
  const confirming = mode === 'confirm';
  const refund = removeRefund(room.type);

  const attrRows = (ROOM_ATTRS[room.type] || []).map(a => {
    const lvl = attrLvl(room, a.key);
    const maxed = attrMaxed(room, a.key);
    const cost = maxed ? 0 : attrUpgradeCost(room, a.key);
    const afford = canUpgradeAttr(room, a.key);
    return `<div class="attr">
      <div class="attr-head"><span class="attr-name">${a.name}</span><span class="attr-lvl">L${lvl}${maxed ? ' · MAX' : ''}</span></div>
      <div class="attr-now">${a.hint(lvl)}</div>
      ${maxed ? '' : `<div class="attr-next hint-next">→ ${a.hint(lvl + 1)}</div>`}
      <div class="attr-foot">
        ${maxed ? '<span class="u-cost">Fully upgraded</span>'
          : `<button class="btn small ${afford ? 'primary' : ''}" ${afford ? '' : 'disabled'} onclick="doUpgradeAttr('${room.id}','${a.key}')">Upgrade · ${cost} min</button>`}
      </div>
    </div>`;
  }).join('');

  openModal(`
    <span class="close" onclick="closeModal()">×</span>
    <h2>${def.icon} ${def.name}</h2>
    <p class="muted">${def.desc}</p>
    <div class="detail-row"><span>Status</span><span>${staffCountText(room)}</span></div>
    ${CONFIG.rooms[room.type] && CONFIG.rooms[room.type].powerCost
      ? `<div class="detail-row"><span>Power draw</span><span style="color:var(--power)">${(CONFIG.rooms[room.type].powerCost * primaryMult(room) * (attrDef(room.type,'efficiency') ? attrEff(room,'efficiency') : 1)).toFixed(1)}/s</span></div>` : ''}
    <div class="attr-grid">${attrRows}</div>
    <div class="row-actions">
      ${confirming
        ? `<span class="muted" style="flex:1">Demolish this ${def.name}? You get back <b style="color:var(--minerals)">${refund} minerals</b>.</span>
           <button class="btn danger" onclick="doRemoveRoom('${room.id}')">Confirm demolish</button>
           <button class="btn" onclick="openRoomDetail('${room.id}')">Cancel</button>`
        : `<button class="btn danger-ghost" onclick="openRoomDetail('${room.id}','confirm')">Demolish</button>
           <button class="btn" onclick="closeModal()">Close</button>`}
    </div>
  `);
}
function doUpgradeAttr(roomId, key) {
  if (upgradeAttr(roomId, key)) { renderAll(); openRoomDetail(roomId); }
}
function doRemoveRoom(roomId) {
  if (removeRoom(roomId)) { renderAll(); closeModal(); }
}

/* meta hub */
function openMetaHub() {
  const cats = ['Start', 'Survival'];
  let body = `<span class="close" onclick="closeModal()">×</span>
    <h2>Salvage Bay</h2>
    <p class="muted">Spend <b style="color:var(--core)">✦ ${fmt(META.cores)}</b> salvage cores on permanent upgrades. They apply to every future run.</p>`;
  cats.forEach(cat => {
    body += `<div class="section-title">${cat === 'Start' ? 'Starting Conditions' : 'Survivability'}</div><div class="upg-grid">`;
    META_UPGRADES.filter(u => u.cat === cat).forEach(u => {
      const lvl = metaLevel(u.id);
      const maxed = lvl >= u.max;
      const cost = maxed ? 0 : u.cost(lvl);
      const afford = META.cores >= cost && !maxed;
      body += `<div class="upg ${maxed ? 'maxed' : ''}">
        <div class="u-top"><span class="u-name">${u.name}</span><span class="u-cat">${u.cat}</span></div>
        <div class="u-desc">${u.desc(maxed ? lvl - 1 : lvl)}</div>
        <div class="u-blurb">${u.blurb}</div>
        <div class="u-foot">
          <span class="u-lvl">Lv ${lvl}/${u.max}</span>
          ${maxed ? '<span class="u-cost">MAX</span>'
            : `<button class="btn small ${afford ? 'primary' : ''}" ${afford ? '' : 'disabled'} onclick="doBuy('${u.id}')">✦ ${cost}</button>`}
        </div>
      </div>`;
    });
    body += `</div>`;
  });
  body += `<div class="row-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
  openModal(body);
}
function doBuy(id) { if (buyUpgrade(id)) openMetaHub(); renderTop(); }

/* game over */
function openGameOver() {
  openModal(`
    <h2 style="color:var(--bad)">All Hands Lost</h2>
    <p class="muted">Your crew didn't make it. But their salvage lives on.</p>
    <div class="gameover-stats">
      <div class="stat"><div class="v">${GAME.sector}</div><div class="k">Sector reached</div></div>
      <div class="stat"><div class="v">${fmtTime(GAME.time)}</div><div class="k">Time survived</div></div>
      <div class="stat"><div class="v">${GAME.roomsBuilt}</div><div class="k">Rooms built</div></div>
      <div class="stat"><div class="v">${GAME.peakCrew}</div><div class="k">Peak crew</div></div>
    </div>
    <div class="earned">Salvage banked: <b>✦ ${GAME.coresEarned}</b></div>
    <div class="row-actions">
      <button class="btn primary" onclick="goMetaThenNew()">Spend & Upgrade</button>
      <button class="btn" onclick="startNewRun()">New Run ⟶</button>
    </div>
  `);
}
function goMetaThenNew() { openMetaHub(); }
