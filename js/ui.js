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
  ore:      { label: 'Ore',      cls: 'ore' },
  scrap:    { label: 'Scrap',    cls: 'scrap' },
  food:     { label: 'Food',     cls: 'food' },
  fuel:     { label: 'Fuel',     cls: 'fuel' },
};

// Top bar: primary resource meters
const RES_PRIMARY = [
  { name: 'Power',        keys: ['power'] },
  { name: 'Life Support', keys: ['oxygen', 'co2'] },
  { name: 'Supplies',     keys: ['water', 'food', 'minerals'] },
  { name: 'Fuel',         keys: ['fuel'] },
];
// Storage panel resources (crew pane Storage tab — bulk/raw materials)
const RES_STORAGE = ['ice', 'ore', 'scrap'];

let lastRates = { power: 0, oxygen: 0, co2: 0, water: 0, ice: 0, minerals: 0, ore: 0, scrap: 0, food: 0, fuel: 0 };
let hoveredRes = null;
let crewPaneTab = 'crew';

/* ---------------- resource flow breakdown (for hover tooltip) ---------------- */
// per-second sources (+) and sinks (-) for a resource, mirroring sim.js step().
function resourceBreakdown(res) {
  const R = GAME.resources, N = CONFIG.needs, RM = CONFIG.rooms;
  const powered = hasPower(GAME);
  const sources = [], sinks = [];
  const add = (arr, label, rate) => { if (rate > 0.001) arr.push({ label, rate }); };
  const headcount = aliveCrew().length;
  const o2Slow = 1;
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
    if (powered) roomsOfType('extractor').forEach(r => { if (staffOn(r.id) > 0) add(sources, 'Mining Drone', RM.extractor.iceOut * attrMult(r, 'iceyield') * staffOn(r.id) * mineMult); });
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
  const rateCls = m.hazard ? (rate > 0.05 ? 'down' : rate < -0.05 ? 'up' : '') : rcls;
  return `<div class="res ${m.cls} ${danger ? 'danger' : ''}" data-res="${res}">
    <div class="res-label">${m.label}</div>
    <div class="res-line"><span class="res-val">${fmt(val)}<span class="res-max">/${fmt(max)}</span></span><span class="rate ${rateCls}">${fmtRate(rate).replace('/s', '')}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
  </div>`;
}
function renderTop() {
  $('#run-sub').textContent = `Sector ${GAME.sector} · ${fmtTime(GAME.time)}`;
  const cl = $('#challenge-label');
  if (cl) { const ch = challengeDef(); cl.textContent = ch.name; cl.className = `challenge-label cond-${ch.tone}`; cl.title = ch.desc; }

  $('#resources').innerHTML = RES_PRIMARY.map(g =>
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

let _trayHtml = '';
function renderShip() {
  // The ship is drawn on the canvas by ship.js. Building is done by clicking an
  // empty bay on the ship; here we just show a hint line + the hull-expand button.
  const tray = $('#build-tray');
  if (!tray) return;
  const msg = shipFull()
    ? `All ${maxRooms()} bays occupied — demolish a module or expand the hull.`
    : `▦ Click an empty bay on the ship to build a module.`;
  const hullLink = hullTier() < CONFIG.hull.maxTier
    ? `<button class="btn small ghost tray-hull" onclick="openHullModal()">⊕ Expand Hull</button>` : '';
  const html = `<div class="tray-msg">${msg}</div>${hullLink}`;
  // only rewrite when it actually changes — otherwise the button element is
  // replaced every frame and clicks (mousedown→mouseup) get lost
  if (html !== _trayHtml) { tray.innerHTML = html; _trayHtml = html; }
}

/* hull expansion — behind a confirmation so it isn't clicked by accident */
function openHullModal() {
  if (!GAME || hullTier() >= CONFIG.hull.maxTier) return;
  const cost = hullCost(), afford = canExpandHull();
  openModal(`<span class="close" onclick="closeModal()">×</span>
    <h2>Expand Hull</h2>
    <p class="muted">Weld on another bay column — module bays grow from <b>${maxRooms()}</b> to <b>${maxRooms() + 2}</b>. Permanent, and widens the ship.</p>
    <div class="detail-row"><span>Cost</span><span class="u-cost">${cost} minerals</span></div>
    <div class="detail-row"><span>You have</span><span>${fmt(GAME.resources.minerals)} minerals</span></div>
    <div class="row-actions">
      <button class="btn primary" ${afford ? '' : 'disabled'} onclick="confirmExpandHull()">Expand for ${cost} min</button>
      <button class="btn" onclick="closeModal()">Cancel</button>
    </div>`);
}
function confirmExpandHull() {
  if (expandHull()) { shipRelayout(); closeModal(); renderAll(); }
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

/* ---------------- crew pane tabs ---------------- */
function switchCrewTab(tab) {
  crewPaneTab = tab;
  $('#ctab-crew').classList.toggle('active', tab === 'crew');
  $('#ctab-storage').classList.toggle('active', tab === 'storage');
  $('#crew-list').classList.toggle('hidden', tab !== 'crew');
  $('#storage-panel').classList.toggle('hidden', tab !== 'storage');
  if (tab === 'storage') renderStoragePanel();
  if (tab === 'crew') renderCrew();
}

function renderStoragePanel() {
  $('#storage-panel').innerHTML = RES_STORAGE.map(res => {
    const m = RES_META[res];
    const val = GAME.resources[res], max = cap(GAME, res);
    const pct = clamp((val / max) * 100, 0, 100);
    const rate = lastRates[res] || 0;
    const rateCls = rate > 0.05 ? 'up' : rate < -0.05 ? 'down' : '';
    const rateStr = Math.abs(rate) >= 0.05 ? `<span class="sr-rate ${rateCls}">${rate > 0 ? '+' : ''}${rate.toFixed(1)}/s</span>` : '';
    const danger = m.hazard && pct >= CONFIG.needs.co2Danger * 100;
    return `<div class="stor-row ${danger ? 'danger' : ''}">
      <span class="stor-label ${m.cls}">${m.label}</span>
      <div class="stor-bar"><i style="width:${pct}%" class="${m.cls}"></i></div>
      <span class="stor-val">${fmt(val)}<span class="stor-max">/${fmt(max)}</span></span>
      ${rateStr}
    </div>`;
  }).join('');
}

/* ---------------- crew ---------------- */
function needRow(label, cls, val, max) {
  const pct = clamp((val / (max || 100)) * 100, 0, 100);
  const low = pct < 25 ? 'low' : '';
  return `<div class="need ${cls} ${low}"><span class="nlabel">${label}</span>
    <span class="nbar"><i style="width:${pct}%"></i></span></div>`;
}
function ejectCrew(id) {
  const idx = GAME.crew.findIndex(c => c.id === id && c.state === 'dead');
  if (idx === -1) return;
  const name = GAME.crew[idx].name;
  GAME.crew.splice(idx, 1);
  logMsg(`${name} was ejected into space.`, 'info');
  renderAll();
  saveGame();
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
        ${dead
          ? `<button class="btn small eject-btn" onclick="ejectCrew('${c.id}')">⏏ Eject</button>`
          : `<span class="crew-state ${c.state}">${c.state}</span>`}
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
  $('#log').innerHTML = GAME.log.map(e => {
    const pending = e.hasChoices ? ' <span style="color:var(--accent);font-size:10px">▸ Comm</span>' : '';
    return `<div class="entry"><div><span class="ts">${fmtTime(e.t)}</span><span class="${e.kind}">${e.text}${pending}</span></div></div>`;
  }).join('');
}

/* ---------------- buttons state ---------------- */
function renderControls() {
  const btnJump = $('#btn-jump');
  btnJump.disabled = !canJump();
  btnJump.textContent = `Jump ⟶ (${jumpFuelCost()} fuel)`;
  const low = GAME.stock && (GAME.stock.minerals < 30 || GAME.stock.ice < 30);
  btnJump.classList.toggle('flash', low && !GAME.atStation);
  const synth = $('#btn-synth');
  if (synth) {
    synth.disabled = !canSynthFuel();
    synth.textContent = `Synth Fuel (${CONFIG.synth.waterPerFuel} water → ${CONFIG.synth.fuelPerClick})`;
    synth.title = 'Convert water into fuel — inefficient, but reliable';
  }
  const comm = $('#btn-comm');
  if (comm) {
    const pendingEntry = GAME.log.find(e => e.hasChoices);
    const hasEncounter = !!pendingEntry;
    const atStation = GAME.atStation;
    comm.disabled = !hasEncounter && !atStation;
    comm.classList.toggle('flash', hasEncounter);
    if (atStation && !hasEncounter) {
      comm.textContent = '◉ Trade';
    } else if (hasEncounter && pendingEntry.spawnedAt !== undefined) {
      const secs = Math.max(0, Math.ceil(ENCOUNTER_TIMEOUT_S - (GAME.time - pendingEntry.spawnedAt)));
      comm.textContent = `📡 Comm ${secs}s`;
    } else {
      comm.textContent = '📡 Comm';
    }
  }
  const si = $('#sector-info');
  if (si && GAME.stock) {
    const sdBadge = GAME.sd > 0 ? `<span class="si-stock" style="color:var(--warn)">◈ ${GAME.sd} SD</span>` : '';
    if (GAME.atStation) {
      si.innerHTML = `<span class="si-sector">Sector ${GAME.sector}</span>
        <span class="si-cond" style="color:var(--warn); border-color:rgba(255,206,92,.3)">◉ Space Station</span>
        ${sdBadge}`;
    } else {
      const low = GAME.stock.minerals < 30 && GAME.stock.ice < 30;
      const c = condDef();
      si.innerHTML = `<span class="si-sector">Sector ${GAME.sector}</span>
        <span class="si-cond cond-${c.tone}" title="${c.desc}">${c.icon} ${c.name}</span>
        <span class="si-stock"><b style="color:var(--minerals)">${fmt(GAME.stock.minerals)}</b> ore</span>
        <span class="si-stock"><b style="color:var(--ice)">${fmt(GAME.stock.ice)}</b> ice</span>
        <span class="muted">${low ? 'depleted' : ''}</span>
        ${sdBadge}`;
    }
  }
}

/* ---------------- jump: choose the next sector ---------------- */
let jumpOptions = null;
let stationPrices = null;

function openJumpModal() {
  if (!canJump()) return;
  jumpOptions = generateJumpOptions();
  const cost = jumpFuelCost();
  const cards = jumpOptions.map((o, i) => {
    if (o.type === 'station') {
      return `<div class="upg station-card">
        <div class="u-top"><span class="u-name" style="color:var(--warn)">◉ Space Station</span><span class="u-cat">Sector ${o.sector}</span></div>
        <div class="u-desc">A neutral trade outpost. Sell surplus resources for SD or restock what you need.</div>
        <div class="u-blurb">Trades: minerals · ice · water · food · fuel</div>
        <div class="u-foot"><span class="u-cost" style="color:var(--fuel)">${cost} fuel</span>
          <button class="btn small primary" onclick="confirmJump(${i})">Dock Here</button></div>
      </div>`;
    }
    const c = CONDITIONS[o.condition];
    return `<div class="upg ${c.tone === 'risk' ? 'risk-card' : ''}">
      <div class="u-top"><span class="u-name cond-${c.tone}">${c.icon} ${c.name}</span><span class="u-cat">Sector ${o.sector}</span></div>
      <div class="u-desc">${c.desc}</div>
      ${c.reward ? `<div class="reward-line">★ Reward: ${c.reward}</div>` : ''}
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
  if (!opt) return;
  const result = doJumpTo(opt);
  if (result === 'station') {
    triggerJumpFlash();
    closeModal();
    renderAll();
    stationPrices = generateStationPrices();
    openStationModal();
  } else if (result) {
    triggerJumpFlash();
    closeModal();
    renderAll();
  }
}

/* ---------------- space station trading modal with tabs ---------------- */
const STATION_ICONS = { minerals: '◆', ore: '◇', scrap: '🔩', ice: '❄', water: '〜', food: '❀', fuel: '⬡' };
let stationTab = 'resources';

function renderStationTab(tab) {
  if (tab === 'resources') return renderStationResources();
  if (tab === 'blueprints') return renderStationBlueprints();
  if (tab === 'crew') return renderStationCrew();
  return '';
}

function renderStationResources() {
  if (!stationPrices) return '';
  const rows = Object.keys(CONFIG.station.resources).map(res => {
    const p = stationPrices[res];
    const have = Math.floor(GAME.resources[res]);
    const c = cap(GAME, res);
    const room = Math.floor(c - GAME.resources[res]);
    const afford = Math.floor(GAME.sd / p.buy);
    const demandTag = p.hot ? '<span class="demand-tag hot">▲ hot</span>' : p.cold ? '<span class="demand-tag cold">▼ cold</span>' : '';
    const sellBtn = (qty) => {
      const n = qty === 'all' ? have : qty;
      const dis = have < (qty === 'all' ? 1 : qty) ? 'disabled' : '';
      return `<button class="btn small" ${dis} onclick="tradeStation('sell','${res}','${qty}')">${qty === 'all' ? 'All' : qty}</button>`;
    };
    const buyBtn = (qty) => {
      const n = qty === 'max' ? Math.min(afford, room) : qty;
      const dis = (GAME.sd < p.buy || room <= 0 || (qty !== 'max' && (GAME.sd < qty * p.buy || room < qty))) ? 'disabled' : '';
      return `<button class="btn small" ${dis} onclick="tradeStation('buy','${res}','${qty}')">${qty === 'max' ? 'Max' : qty}</button>`;
    };
    return `<div class="station-row">
      <div class="sr-meta">
        <span class="sr-icon" style="color:var(--${res})">${STATION_ICONS[res]}</span>
        <span class="sr-name">${res[0].toUpperCase() + res.slice(1)}</span>
        <span class="sr-have muted">${have}/${c}</span>
      </div>
      <div class="sr-side">
        <div class="sr-price">Sell <b style="color:var(--warn)">${p.sell}</b> SD ${demandTag}</div>
        <div class="sr-btns">${sellBtn(5)} ${sellBtn(25)} ${sellBtn('all')}</div>
      </div>
      <div class="sr-side">
        <div class="sr-price">Buy <b style="color:var(--warn)">${p.buy}</b> SD/unit</div>
        <div class="sr-btns">${buyBtn(5)} ${buyBtn(25)} ${buyBtn('max')}</div>
      </div>
    </div>`;
  }).join('');
  return `<div class="station-trades">${rows}</div>`;
}

function renderStationBlueprints() {
  const bps = Object.entries(CONFIG.blueprints).map(([id, bp]) => {
    const owned = GAME.unlockedBlueprints.has(id);
    const afford = GAME.sd >= bp.cost;
    const btnClass = owned ? '' : (afford ? 'primary' : '');
    const btnText = owned ? '✓ Owned' : `Buy · ${bp.cost} SD`;
    const btnDis = owned ? 'disabled' : '';
    return `<div class="shop-item">
      <div class="si-icon" style="font-size:18px">${bp.icon}</div>
      <div class="si-info">
        <div class="si-name">${bp.name}</div>
        <div class="si-desc muted">${bp.desc}</div>
      </div>
      <button class="btn small ${btnClass}" ${btnDis} onclick="buyBlueprintAndRefresh('${id}')">${btnText}</button>
    </div>`;
  }).join('');
  return `<div class="shop-list">${bps}</div>`;
}

function renderStationCrew() {
  const crewCount = GAME.crew.length;
  const canRecruit = canRecruitCrew();
  const rows = [];
  if (crewCount < CONFIG.station.crewMax) {
    rows.push(`<div class="shop-item">
      <div class="si-icon">👤</div>
      <div class="si-info">
        <div class="si-name">Recruit Crew</div>
        <div class="si-desc muted">Add a trained crew member with random specialty.</div>
      </div>
      <button class="btn small ${canRecruit ? 'primary' : ''}" ${canRecruit ? '' : 'disabled'} onclick="recruitCrewAndRefresh()">
        ${canRecruit ? `Recruit · ${CONFIG.station.crewCost} SD` : 'Crew Full'}</button>
    </div>`);
  } else {
    rows.push(`<div class="shop-item">
      <div class="si-icon">👥</div>
      <div class="si-info">
        <div class="si-name">Crew Full</div>
        <div class="si-desc muted">Max crew size (${CONFIG.station.crewMax}) reached.</div>
      </div>
    </div>`);
  }
  return `<div class="shop-list">${rows.join('')}</div>`;
}

function openStationModal() {
  if (!GAME || !stationPrices || !GAME.atStation) return;
  stationTab = 'resources';
  const tabBtns = ['resources', 'blueprints', 'crew'].map(t => {
    const active = stationTab === t ? 'active' : '';
    const label = t.charAt(0).toUpperCase() + t.slice(1);
    return `<button class="station-tab ${active}" onclick="switchStationTab('${t}')">${label}</button>`;
  }).join('');
  const content = renderStationTab(stationTab);
  openModal(`<span class="close" onclick="closeModal()">×</span>
    <h2>◉ Space Station · Sector ${GAME.sector}</h2>
    <p class="muted">A neutral trade outpost.</p>
    <div class="station-balance">Balance: <b style="color:var(--warn)">${GAME.sd} SD</b></div>
    <div class="station-tabs">${tabBtns}</div>
    ${content}
    <div class="row-actions"><button class="btn primary" onclick="closeModal()">✓ Undock</button></div>`);
}

function switchStationTab(tab) {
  stationTab = tab;
  const content = renderStationTab(tab);
  const tabBtns = ['resources', 'blueprints', 'crew'].map(t => {
    const active = tab === t ? 'active' : '';
    const label = t.charAt(0).toUpperCase() + t.slice(1);
    return `<button class="station-tab ${active}" onclick="switchStationTab('${t}')">${label}</button>`;
  }).join('');
  const modal = $('#modal-card');
  if (modal) {
    modal.innerHTML = `<div class="modal-pad">
      <span class="close" onclick="closeModal()">×</span>
      <h2>◉ Space Station · Sector ${GAME.sector}</h2>
      <p class="muted">A neutral trade outpost.</p>
      <div class="station-balance">Balance: <b style="color:var(--warn)">${GAME.sd} SD</b></div>
      <div class="station-tabs">${tabBtns}</div>
      ${content}
      <div class="row-actions"><button class="btn primary" onclick="closeModal()">✓ Undock</button></div>
    </div>`;
  }
}

function buyBlueprintAndRefresh(blueprintId) {
  if (buyBlueprint(blueprintId)) {
    renderAll();
    openStationModal();
    switchStationTab('blueprints');
  }
}

function recruitCrewAndRefresh() {
  if (recruitCrew()) {
    renderAll();
    openStationModal();
    switchStationTab('crew');
  }
}

function tradeStation(dir, res, amount) {
  if (!stationPrices || !stationPrices[res] || !GAME) return;
  const p = stationPrices[res];
  const R = GAME.resources;
  const c = cap(GAME, res);
  if (dir === 'sell') {
    const have = Math.floor(R[res]);
    const qty = amount === 'all' ? have : Math.min(Number(amount), have);
    if (qty <= 0) return;
    R[res] -= qty;
    const earned = Math.floor(qty * p.sell);
    GAME.sd += earned;
    logMsg(`Sold ${qty} ${res} → +${earned} SD.`, 'good');
  } else {
    const afford = Math.floor(GAME.sd / p.buy);
    const room = Math.floor(c - R[res]);
    const max = Math.min(afford, room);
    const qty = amount === 'max' ? max : Math.min(Number(amount), max);
    if (qty <= 0) return;
    GAME.sd -= qty * p.buy;
    R[res] = Math.min(c, R[res] + qty);
    logMsg(`Bought ${qty} ${res} for ${qty * p.buy} SD.`, 'good');
  }
  saveGame();
  openStationModal();
}

/* ============================================================
   Comm modal — shows pending encounter choices
   ============================================================ */
function openCommModal() {
  const hasEncounter = GAME.log.some(e => e.hasChoices);

  // at station with no pending encounter → open trade
  if (GAME.atStation && !hasEncounter) {
    stationPrices = stationPrices || generateStationPrices();
    openStationModal();
    return;
  }

  const pending = GAME.log.map((e, i) => ({ e, i })).filter(({ e }) => e.hasChoices && e.choices);
  if (!pending.length) return;
  const { e: entry, i: logIndex } = pending[0];

  // mark as opened — cannot be re-opened without choosing
  entry.commOpened = true;

  const defaultAction = _defaultEncounterAction(entry.eventId);
  const secsLeft = () => Math.max(0, Math.ceil(ENCOUNTER_TIMEOUT_S - (GAME.time - (entry.spawnedAt ?? GAME.time))));

  const choiceBtns = entry.choices.map(ch =>
    `<button class="btn" style="margin:4px 0;width:100%" onclick="handleEventChoice(${logIndex}, '${ch.action}')">${ch.label}</button>`
  ).join('');

  // no × close button, no ignore — must choose; backdrop click blocked
  openModal(`<h2 style="margin-top:0">📡 Incoming Transmission</h2>
    <p style="color:var(--muted);font-size:11px;margin:0 0 4px">⏱ <span id="comm-countdown">${secsLeft()}</span>s to respond${defaultAction ? ' or auto-resolve' : ''}</p>
    <p style="color:var(--text);margin:8px 0 20px">${entry.text}</p>
    <div style="display:flex;flex-direction:column;gap:6px">${choiceBtns}</div>`,
    { lockClose: true });

  if (_commTimerInterval) { clearInterval(_commTimerInterval); _commTimerInterval = null; }
  _commTimerInterval = setInterval(() => {
    const r = secsLeft();
    const el = document.getElementById('comm-countdown');
    if (el) { el.textContent = r; el.style.color = r <= 10 ? 'var(--danger,#f55)' : ''; }
    if (r <= 0 && defaultAction) {
      clearInterval(_commTimerInterval); _commTimerInterval = null;
      handleEventChoice(logIndex, defaultAction);
    }
  }, 1000);
}

/* ============================================================
   Event choices
   ============================================================ */
function handleEventChoice(logIndex, action) {
  const entry = GAME.log[logIndex];
  if (!entry) return;

  const fuelBuyQty = action === 'buyFuel5' ? 5 : action === 'buyFuel10' ? 10 : action === 'buyFuel20' ? 20 : 0;
  if (fuelBuyQty > 0) {
    const price = fuelBuyQty * entry.pricePerUnit;
    if (GAME.resources.minerals < price) {
      logMsg(`Not enough minerals (need ${price}).`, 'bad');
      return;
    }
    GAME.resources.minerals -= price;
    GAME.resources.fuel = Math.min(cap(GAME, 'fuel'), GAME.resources.fuel + fuelBuyQty);
    logMsg(`Purchased ${fuelBuyQty} fuel for ${price} minerals from the trader.`, 'good');
    entry.hasChoices = false; entry.choices = [];
    _forceCloseModal(); renderAll(); saveGame(); return;
  } else if (action === 'ignoreFuel') {
    logMsg('Continued on without buying fuel.', 'info');
    entry.hasChoices = false; entry.choices = [];
    _forceCloseModal(); renderAll(); saveGame(); return;
  }

  if (action === 'payPirateBribe') {
    const bribeAmt = entry.bribeAmount ?? Math.floor(20 + GAME.sector * 5);
    const minCost = Math.min(bribeAmt, GAME.resources.minerals);
    GAME.resources.minerals -= minCost;
    logMsg(`Paid ${minCost} minerals to the pirates. They departed.`, 'bad');
  } else if (action === 'fightPirates') {
    const damageMultiplier = 1 + (GAME.sector - 2) * 0.3;
    const crewDamage = Math.floor(15 * damageMultiplier);
    const fuelLost = Math.floor(8 + GAME.sector * 2);
    const mineralLost = Math.floor(25 + GAME.sector * 6);

    GAME.resources.fuel = Math.max(0, GAME.resources.fuel - fuelLost);
    GAME.resources.minerals = Math.max(0, GAME.resources.minerals - mineralLost);

    aliveCrew().forEach(c => {
      c.health = Math.max(0, c.health - crewDamage);
    });

    logMsg(`Fought the pirates! Lost ${fuelLost} fuel, ${mineralLost} minerals, and crew took ${crewDamage} damage.`, 'bad');

  // ---- Distress Signal ----
  } else if (action === 'rescueFull') {
    GAME.resources.food  = Math.max(0, GAME.resources.food  - entry.foodCost);
    GAME.resources.water = Math.max(0, GAME.resources.water - entry.waterCost);
    GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + 25);
    aliveCrew().forEach(c => { c.needs.morale = Math.min(100, c.needs.morale + 30); });
    logMsg(`Rescued ${entry.survivorCount} survivors. Crew morale soared. +25 minerals as thanks.`, 'good');
  } else if (action === 'rescueDrop') {
    GAME.resources.food = Math.max(0, GAME.resources.food - Math.floor(entry.foodCost / 2));
    aliveCrew().forEach(c => { c.needs.morale = Math.min(100, c.needs.morale + 10); });
    logMsg('Dropped supplies to the survivors. Crew feel good about it.', 'good');
  } else if (action === 'ignoreSignal') {
    aliveCrew().forEach(c => { c.needs.morale = Math.max(0, c.needs.morale - 20); });
    logMsg('Ignored the distress signal. Crew morale dropped.', 'bad');

  // ---- Derelict Station ----
  } else if (action === 'stationSurvey') {
    GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + 40);
    GAME.resources.scrap    = Math.min(cap(GAME, 'scrap'),    GAME.resources.scrap    + 30);
    logMsg('Careful survey of the derelict station. Recovered 40 minerals and 30 scrap.', 'good');
  } else if (action === 'stationRaid') {
    GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + 80);
    GAME.resources.scrap    = Math.min(cap(GAME, 'scrap'),    GAME.resources.scrap    + 60);
    GAME.resources.ore      = Math.min(cap(GAME, 'ore'),      GAME.resources.ore      + 20);
    // trigger a hull breach as the risk
    const breach = { id: 'hull_breach', name: 'Hull Breach', duration: 70, o2Drain: 2.8, needsRepair: true, repairNeeded: 4 };
    GAME.events.push(breach);
    logMsg('Fast raid netted 80 minerals, 60 scrap, 20 ore — but rushing triggered a hull breach!', 'bad');
  } else if (action === 'passStation') {
    logMsg('You passed by the derelict station.', 'info');

  // ---- Cargo Pod ----
  } else if (action === 'openPod') {
    const c = entry.podContents || {};
    if (c.food)     GAME.resources.food     = Math.min(cap(GAME, 'food'),     GAME.resources.food     + c.food);
    if (c.minerals) GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + c.minerals);
    if (c.scrap)    GAME.resources.scrap    = Math.min(cap(GAME, 'scrap'),    GAME.resources.scrap    + c.scrap);
    if (c.fuel)     GAME.resources.fuel     = Math.min(cap(GAME, 'fuel'),     GAME.resources.fuel     + c.fuel);
    if (c.ice)      GAME.resources.ice      = Math.min(cap(GAME, 'ice'),      GAME.resources.ice      + c.ice);
    logMsg(`Recovered cargo pod: ${c.label}.`, 'good');
  } else if (action === 'ignorePod') {
    logMsg('Left the cargo pod drifting.', 'info');

  // ---- Smuggler's Cache ----
  } else if (action === 'cacheAll') {
    GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + entry.cacheMineral);
    GAME.resources.scrap    = Math.min(cap(GAME, 'scrap'),    GAME.resources.scrap    + entry.cacheScrap);
    aliveCrew().forEach(c => { c.needs.morale = Math.max(0, c.needs.morale - 15); });
    logMsg(`Took everything from the cache: ${entry.cacheMineral} minerals + ${entry.cacheScrap} scrap. Crew felt uneasy about it.`, 'bad');
  } else if (action === 'cacheFuel') {
    GAME.resources.fuel = Math.min(cap(GAME, 'fuel'), GAME.resources.fuel + 20);
    logMsg('Took only the fuel from the cache. +20 fuel.', 'good');
  } else if (action === 'leaveCache') {
    logMsg('Left the smuggler\'s cache untouched.', 'info');
  }

  entry.hasChoices = false;
  entry.choices = [];
  _forceCloseModal(); renderAll(); saveGame();
}

function renderAll() {
  if (!GAME) return;
  checkEncounterExpiry();
  renderTop();
  renderShip();
  if (crewPaneTab === 'crew') renderCrew();
  else renderStoragePanel();
  renderLog();
  renderControls();
}

/* ============================================================
   Modals
   ============================================================ */
let _commModalOpen = false;
let _commTimerInterval = null;

const ENCOUNTER_TIMEOUT_S = 60;

function _defaultEncounterAction(eventId) {
  return { space_pirate: 'fightPirates', fuel_shortage: 'ignoreFuel',
           distress_signal: 'ignoreSignal', abandoned_station: 'passStation',
           cargo_pod: 'ignorePod', smuggler_cache: 'leaveCache' }[eventId] || null;
}

function checkEncounterExpiry() {
  GAME.log.forEach((entry, i) => {
    if (!entry.hasChoices || entry.spawnedAt === undefined) return;
    if (GAME.time - entry.spawnedAt < ENCOUNTER_TIMEOUT_S) return;
    const action = _defaultEncounterAction(entry.eventId);
    if (!action) return;
    if (_commModalOpen) _forceCloseModal();
    handleEventChoice(i, action);
  });
}

function openModal(html, opts = {}) {
  _commModalOpen = !!opts.lockClose;
  $('#modal-card').innerHTML = `<div class="modal-pad">${html}</div>`;
  $('#modal').classList.remove('hidden');
}
function closeModal() {
  if (_commModalOpen) return;  // encounter modal requires a choice
  $('#modal').classList.add('hidden');
}
function _forceCloseModal() {
  _commModalOpen = false;
  if (_commTimerInterval) { clearInterval(_commTimerInterval); _commTimerInterval = null; }
  $('#modal').classList.add('hidden');
}

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

/* challenge select — choose the run's modifiers (replaces the Salvage Bay) */
function challengeCards() {
  return CHALLENGE_ORDER.map(id => {
    const ch = CHALLENGES[id];
    return `<div class="upg">
      <div class="u-top"><span class="u-name cond-${ch.tone}">${ch.name}</span></div>
      <div class="u-blurb">${ch.desc}</div>
      <div class="u-foot"><span></span>
        <button class="btn small primary" onclick="startRun('${id}')">Start</button></div>
    </div>`;
  }).join('');
}
function openChallengeSelect(fromGameOver) {
  openModal(`${fromGameOver ? '' : '<span class="close" onclick="closeModal()">×</span>'}
    <h2>Choose a Challenge</h2>
    <p class="muted">Each run is a fresh start — pick the conditions you'll play under.${fromGameOver ? '' : ' Starting a new run abandons the current one.'}</p>
    <div class="upg-grid">${challengeCards()}</div>
    ${fromGameOver ? '' : '<div class="row-actions"><button class="btn" onclick="closeModal()">Cancel</button></div>'}`);
}

/* game over */
function openGameOver() {
  openModal(`
    <h2 style="color:var(--bad)">All Hands Lost</h2>
    <p class="muted">Your crew didn't make it — run over. Choose your next challenge.</p>
    <div class="gameover-stats">
      <div class="stat"><div class="v">${GAME.sector}</div><div class="k">Sector reached</div></div>
      <div class="stat"><div class="v">${fmtTime(GAME.time)}</div><div class="k">Time survived</div></div>
      <div class="stat"><div class="v">${GAME.roomsBuilt}</div><div class="k">Rooms built</div></div>
      <div class="stat"><div class="v">${GAME.peakCrew}</div><div class="k">Peak crew</div></div>
    </div>
    <div class="section-title">Next run</div>
    <div class="upg-grid">${challengeCards()}</div>
  `);
}
