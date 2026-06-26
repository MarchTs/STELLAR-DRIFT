/* ============================================================
   STELLAR DRIFT — top-down ship view (RimWorld-style)
   Tilemap + walls + A* pathfinding crew on an HTML canvas.
   Sim logic stays in game.js; this is pure visualization +
   spatial crew movement (ephemeral, not saved).
   ============================================================ */

const TILE = 26, COLS = 21, ROWS = 12;
const WIDTH = COLS * TILE, HEIGHT = ROWS * TILE;

// 4 bays across × 2 rows of bays = 8 room slots
const BAY_X = [[1, 4], [6, 9], [11, 14], [16, 19]];
const BAY_TOP_Y = 1, BAY_BOT_Y = 8;       // top bays rows 1-3, bottom rows 8-10
const DIV_COLS = [5, 10, 15];             // vertical walls between bays
const WALL_ROWS = [4, 7];                 // walls separating bays from the corridor

function bayRect(i) {
  const col = i % 4, isTop = i < 4;
  const [x0, x1] = BAY_X[col];
  const y0 = isTop ? BAY_TOP_Y : BAY_BOT_Y;
  const y1 = y0 + 2;                       // 3 tiles tall
  const cy = isTop ? y0 + 1 : y0 + 1;      // center row of bay
  return {
    i, x0, y0, x1, y1, isTop, cy,
    station: { x: x0 + 1, y: cy },
    door: { x: x0 + 1, y: isTop ? y1 + 1 : y0 - 1 },
    bedRow: isTop ? y0 : y1,               // beds along the hull edge
  };
}
// up to `n` bed tiles: fill the hull-edge row first, then the opposite edge row
function bedTiles(b, n) {
  n = Math.max(1, n || 2);
  const rows = [b.bedRow, b.bedRow === b.y0 ? b.y1 : b.y0];
  const out = [];
  for (const ry of rows) {
    for (let x = b.x0; x <= b.x1 && out.length < n; x++) if (WALK[ry] && WALK[ry][x]) out.push({ x, y: ry });
    if (out.length >= n) break;
  }
  return out.length ? out : [{ x: b.x0, y: b.bedRow }];
}
function roomAndBay(type) {
  const room = GAME.rooms.find(r => r.type === type);
  return room ? { room, bay: bayRect(room.bay) } : null;
}
function roomInBay(i) { return GAME.rooms.find(r => r.bay === i); }
function standTiles(b) {
  const out = [];
  for (let x = b.x0; x <= b.x1; x++) if (WALK[b.cy][x]) out.push({ x, y: b.cy });
  return out.length ? out : [b.station];
}

/* ---------------- static layout grids ---------------- */
let WALK = null, WALL = null, DOORS = [];
function ensureLayout() {
  if (WALK) return;
  WALL = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  WALK = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) WALK[y][x] = true;
  // hull border
  for (let x = 0; x < COLS; x++) { WALL[0][x] = WALL[ROWS - 1][x] = true; }
  for (let y = 0; y < ROWS; y++) { WALL[y][0] = WALL[y][COLS - 1] = true; }
  // vertical bay dividers (not across the corridor rows 5-6)
  DIV_COLS.forEach(x => [1, 2, 3, 8, 9, 10].forEach(y => { WALL[y][x] = true; }));
  // corridor boundary walls
  WALL_ROWS.forEach(y => { for (let x = 1; x < COLS - 1; x++) WALL[y][x] = true; });
  // carve a door per bay
  for (let i = 0; i < 8; i++) { const d = bayRect(i).door; WALL[d.y][d.x] = false; DOORS.push(d); }
  // walls block walking
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALL[y][x]) WALK[y][x] = false;
  for (const d of DOORS) WALK[d.y][d.x] = true;
}

function tileCenter(tx, ty) { return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE }; }

/* ---------------- A* pathfinding (4-dir grid) ---------------- */
function astar(start, goal) {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!WALK[goal.y] || !WALK[goal.y][goal.x]) return null;
  const key = (x, y) => y * COLS + x;
  const open = [{ x: start.x, y: start.y, g: 0, f: 0, parent: null }];
  const seen = new Set();
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === goal.x && cur.y === goal.y) {
      const path = []; let n = cur;
      while (n.parent) { path.push({ x: n.x, y: n.y }); n = n.parent; }
      return path.reverse();
    }
    const k = key(cur.x, cur.y); if (seen.has(k)) continue; seen.add(k);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      if (!WALK[ny][nx] || seen.has(key(nx, ny))) continue;
      const ng = cur.g + 1;
      open.push({ x: nx, y: ny, g: ng, f: ng + h(nx, ny), parent: cur });
    }
  }
  return null;
}

/* ---------------- crew pawns (ephemeral) ---------------- */
const PAWNS = {};

function bayForRoomId(id) {
  const r = GAME.rooms.find(x => x.id === id);
  return r ? bayRect(r.bay) : null;
}
function bayOfType(type) {
  const r = GAME.rooms.find(x => x.type === type);
  return r ? bayRect(r.bay) : null;
}

function updateShip(dt) {
  if (!GAME) return;
  if (jumpFlash > 0) jumpFlash = Math.max(0, jumpFlash - dt);
  ensureLayout();
  const alive = GAME.crew.filter(c => c.state !== 'dead');

  // group crew so co-workers / co-sleepers / patients / diners get distinct tiles
  const workOrder = {}, sleepers = [], patients = [], diners = [];
  alive.forEach(c => {
    if (c.state === 'working' && c.roomId) (workOrder[c.roomId] = workOrder[c.roomId] || []).push(c.id);
    else if (c.state === 'sleeping') sleepers.push(c.id);
    else if (c.state === 'healing') patients.push(c.id);
    else if (c.state === 'eating') diners.push(c.id);
  });

  // place a location on any hazard that doesn't have one yet
  GAME.events.forEach(ev => { if (ev.needsRepair && !ev.tile) assignHazardTile(ev); });

  function targetTile(c) {
    if (c.state === 'repairing') {
      const ev = GAME.events.find(e => e.assignedTo === c.id && e.needsRepair);
      if (ev && ev.repairStand) return ev.repairStand;
    }
    if (c.state === 'sleeping') {
      const rb = roomAndBay('quarters');
      if (rb) { const beds = bedTiles(rb.bay, bedCount(rb.room)); return beds[Math.max(0, sleepers.indexOf(c.id)) % beds.length]; }
    }
    if (c.state === 'healing') {
      const rb = roomAndBay('medbay');
      if (rb) { const beds = bedTiles(rb.bay, bedCount(rb.room)); return beds[Math.max(0, patients.indexOf(c.id)) % beds.length]; }
    }
    if (c.state === 'eating') {
      const rbM = roomAndBay('messhall');
      if (rbM) { const seats = bedTiles(rbM.bay, seatCount(rbM.room)); return seats[Math.max(0, diners.indexOf(c.id)) % seats.length]; }
      const b = bayOfType('hydroponics'); if (b) return b.station;   // no Mess Hall -> graze the garden
    }
    if (c.state === 'working' && c.roomId) {
      const b = bayForRoomId(c.roomId);
      if (b) { const t = standTiles(b); return t[Math.max(0, (workOrder[c.roomId] || []).indexOf(c.id)) % t.length]; }
    }
    if (c.state === 'idle') {                          // off-duty: mill about the corridor
      const i = alive.indexOf(c);
      return { x: 6 + (i * 3) % 11, y: 5 + (i % 2) };
    }
    return { x: 10, y: 5 };                            // fallback: corridor
  }

  alive.forEach(c => {
    const tt = targetTile(c);
    let p = PAWNS[c.id];
    if (!p) { const ctr = tileCenter(tt.x, tt.y); p = PAWNS[c.id] = { px: ctr.x, py: ctr.y, path: [], tx: tt.x, ty: tt.y, facing: 1 }; }

    const here = { x: Math.max(0, Math.min(COLS - 1, Math.floor(p.px / TILE))), y: Math.max(0, Math.min(ROWS - 1, Math.floor(p.py / TILE))) };
    if (p.tx !== tt.x || p.ty !== tt.y) { p.tx = tt.x; p.ty = tt.y; p.path = astar(here, tt) || []; }

    let budget = 78 * dt;                              // run speed px/s
    while (budget > 0 && p.path.length) {
      const wp = tileCenter(p.path[0].x, p.path[0].y);
      const dx = wp.x - p.px, dy = wp.y - p.py, d = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 0.2) p.facing = dx < 0 ? -1 : 1;
      if (d <= budget) { p.px = wp.x; p.py = wp.y; budget -= d; p.path.shift(); }
      else { p.px += dx / d * budget; p.py += dy / d * budget; budget = 0; }
    }
    p.running = p.path.length > 0;
    p.state = c.state; p.color = c.color; p.name = c.name;
    // crew only "operate" (produce/rest/eat/heal) once physically at their target tile
    c.atStation = p.path.length === 0 && Math.abs(p.px - (tt.x + 0.5) * TILE) < 10 && Math.abs(p.py - (tt.y + 0.5) * TILE) < 10;
  });

  // a hazard is "being repaired" only while its assigned engineer is physically on the spot
  GAME.events.forEach(ev => {
    if (!ev.needsRepair) return;
    ev.beingRepaired = false;
    const p = ev.assignedTo && PAWNS[ev.assignedTo];
    if (p && ev.repairStand) {
      const c = tileCenter(ev.repairStand.x, ev.repairStand.y);
      if (Math.hypot(p.px - c.x, p.py - c.y) < 9) ev.beingRepaired = true;
    }
  });

  Object.keys(PAWNS).forEach(id => { if (!alive.find(c => c.id === id)) delete PAWNS[id]; });
}

// hull breaches land on a random hull-wall tile (stand on the adjacent floor);
// fires land on a random module's station tile.
function hullBreachSpots() {
  const spots = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!WALL[y][x]) continue;
    if (x !== 0 && x !== COLS - 1 && y !== 0 && y !== ROWS - 1) continue;   // perimeter only
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && WALK[ny] && WALK[ny][nx]) {
        spots.push({ wall: { x, y }, stand: { x: nx, y: ny } }); break;
      }
    }
  }
  return spots;
}
function assignHazardTile(ev) {
  ensureLayout();
  if (ev.id === 'hull_breach') {
    const spots = hullBreachSpots();
    const s = spots[Math.floor(rngFloat() * spots.length)] || { wall: { x: 0, y: 5 }, stand: { x: 1, y: 5 } };
    ev.tile = s.wall; ev.repairStand = s.stand;
  } else {                                  // fire on a random installed module
    const idx = Math.floor(rngFloat() * Math.min(8, GAME.rooms.length));
    const b = bayRect(idx);
    ev.tile = b.station; ev.repairStand = b.station;
  }
}

/* ---------------- colors ---------------- */
const ROOM_FLOOR = {
  reactor: '#33282f', lifesupport: '#1c2b35', extractor: '#322f1f',
  hydroponics: '#203121', quarters: '#272234', medbay: '#311f26', engine: '#2a2620', messhall: '#2e2a1d',
};
const ROOM_ACCENT = {
  reactor: '#ffd25c', lifesupport: '#6fd3ff', extractor: '#c8a4ff',
  hydroponics: '#9ad36f', quarters: '#9aa6c8', medbay: '#ff6b6b', engine: '#ff9d5c', messhall: '#ffce5c',
};
const STATE_BADGE = { sleeping: 'z', eating: '◦', healing: '✚', repairing: '🔧' };

let STARS = null, hoverBay = -1, jumpFlash = 0;
function triggerJumpFlash() { jumpFlash = 0.9; }   // seconds of warp flash

/* ---------------- drawing ---------------- */
function setupCanvas() {
  const cv = document.querySelector('#ship-canvas');
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = WIDTH * dpr; cv.height = HEIGHT * dpr;
  cv.style.width = WIDTH + 'px'; cv.style.height = HEIGHT + 'px';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!STARS) {
    STARS = [];
    for (let i = 0; i < 60; i++) STARS.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT, r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.5 + 0.2 });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tileFill(ctx, x, y, color) { ctx.fillStyle = color; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }

function drawShip() {
  const cv = document.querySelector('#ship-canvas');
  if (!cv || !GAME) return;
  ensureLayout();
  const ctx = cv.getContext('2d');

  // space backdrop
  ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  STARS && STARS.forEach(s => {
    ctx.globalAlpha = s.a; ctx.fillStyle = '#9fb4d8';
    if (jumpFlash > 0) {                                  // warp: stars streak horizontally
      const len = jumpFlash * 90 * (s.r + 0.4);
      ctx.fillRect(s.x - len, s.y - s.r * 0.5, len, Math.max(1, s.r));
    } else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
  });
  ctx.globalAlpha = 1;

  // base interior floor (corridor)
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALK[y][x]) tileFill(ctx, x, y, '#141b29');

  // room floors
  GAME.rooms.forEach(r => {
    if (r.bay >= 8) return;
    const b = bayRect(r.bay), col = ROOM_FLOOR[r.type] || '#1a2233';
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (WALK[y][x]) tileFill(ctx, x, y, col);
  });

  // tile grid lines
  ctx.strokeStyle = 'rgba(120,150,190,.05)'; ctx.lineWidth = 1;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALK[y][x]) ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);

  // walls
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!WALL[y][x]) continue;
    ctx.fillStyle = '#0a0f1a'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    ctx.fillStyle = '#1c2740'; ctx.fillRect(x * TILE, y * TILE, TILE, 3);          // lit top edge
  }

  // doors (a lighter sill in the wall gap)
  DOORS.forEach(d => {
    const cx = d.x * TILE, cy = d.y * TILE;
    ctx.fillStyle = '#1a2840'; ctx.fillRect(cx + 3, cy + 3, TILE - 6, TILE - 6);
  });

  // empty bays: a dashed "build here" slot
  for (let i = 0; i < 8; i++) {
    if (roomInBay(i)) continue;
    const b = bayRect(i);
    ctx.save();
    ctx.strokeStyle = 'rgba(120,150,190,.3)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    ctx.strokeRect(b.x0 * TILE + 3, b.y0 * TILE + 3, (b.x1 - b.x0 + 1) * TILE - 6, (b.y1 - b.y0 + 1) * TILE - 6);
    ctx.restore();
    const s = tileCenter(b.station.x, b.station.y);
    ctx.fillStyle = 'rgba(150,170,200,.5)'; ctx.font = '18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', s.x, s.y);
    ctx.fillStyle = 'rgba(150,170,200,.4)'; ctx.font = '8px sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText('BUILD', (b.x0 + (b.x1 - b.x0 + 1) / 2) * TILE, b.y0 * TILE + 2);
  }

  // hover highlight (occupied or empty bay)
  if (hoverBay >= 0 && hoverBay < 8) {
    const b = bayRect(hoverBay);
    ctx.strokeStyle = 'rgba(92,200,255,.7)'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x0 * TILE + 1, b.y0 * TILE + 1, (b.x1 - b.x0 + 1) * TILE - 2, (b.y1 - b.y0 + 1) * TILE - 2);
  }

  // stations, beds & labels
  GAME.rooms.forEach(r => {
    if (r.bay >= 8) return;
    const b = bayRect(r.bay), def = ROOM_DEFS[r.type], ac = ROOM_ACCENT[r.type] || '#5cc8ff';

    // furniture: beds (quarters/medbay) or seats (mess hall), scaling with the attribute
    const furniture = (r.type === 'quarters' || r.type === 'medbay') ? bedCount(r)
      : r.type === 'messhall' ? seatCount(r) : 0;
    if (furniture > 0) {
      bedTiles(b, furniture).forEach(bt => {
        const p = tileCenter(bt.x, bt.y);
        ctx.fillStyle = 'rgba(255,255,255,.07)'; roundRect(ctx, p.x - 9, p.y - 6, 18, 12, 3); ctx.fill();
        ctx.fillStyle = ac; ctx.fillRect(p.x - 9, p.y - 6, 4, 12);
      });
    }

    // station pad + icon
    const s = tileCenter(b.station.x, b.station.y);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; roundRect(ctx, s.x - 11, s.y - 11, 22, 22, 5); ctx.fill();
    ctx.strokeStyle = ac + '66'; ctx.lineWidth = 1.5; roundRect(ctx, s.x - 11, s.y - 11, 22, 22, 5); ctx.stroke();
    ctx.fillStyle = ac; ctx.font = '15px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.icon, s.x, s.y + 1);

    // label across the top of the bay
    ctx.fillStyle = 'rgba(205,217,238,.85)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const lx = (b.x0 + (b.x1 - b.x0 + 1) / 2) * TILE;
    ctx.fillText(def.name.toUpperCase(), lx, b.y0 * TILE + 2);
  });

  // located hazards (breach / fire) with a pulse + repair progress ring
  GAME.events.forEach(ev => { if (ev.needsRepair && ev.tile) drawHazard(ctx, ev); });

  // pawns
  Object.values(PAWNS).forEach(p => drawPawn(ctx, p));

  // jump flash — a bright bluish-white wash that fades out
  if (jumpFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, jumpFlash);
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }
}

function drawHazard(ctx, ev) {
  const c = tileCenter(ev.tile.x, ev.tile.y);
  const fire = ev.id === 'power_failure';
  const col = fire ? '#ff8a3c' : '#ff5a5a';
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
  // glow
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.35 * pulse;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(c.x, c.y, 11 + pulse * 4, 0, 7); ctx.fill();
  ctx.restore();
  // icon
  ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fire ? '🔥' : '✸', c.x, c.y + 1);
  // repair progress ring
  const prog = ev.repairNeeded ? clamp((ev.repairProg || 0) / ev.repairNeeded, 0, 1) : 0;
  if (prog > 0) {
    ctx.strokeStyle = '#7ee08a'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(c.x, c.y, 13, -Math.PI / 2, -Math.PI / 2 + prog * 7); ctx.stroke();
  }
}

function drawPawn(ctx, p) {
  const color = p.color || '#5cc8ff';
  const bob = p.running ? Math.sin(performance.now() / 90 + p.px) * 2.5 : 0;
  const y = p.py + bob;

  // floor shadow
  ctx.fillStyle = 'rgba(0,0,0,.45)';
  ctx.beginPath(); ctx.ellipse(p.px, p.py + 8, 8, 3, 0, 0, 7); ctx.fill();

  // body
  ctx.save(); ctx.translate(p.px, y); if (p.facing < 0) ctx.scale(-1, 1);
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(6,18,31,.75)'; ctx.stroke();
  ctx.restore();

  // initial
  ctx.fillStyle = '#06121f'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText((p.name || '?')[0], p.px, y);

  // status badge
  const badge = STATE_BADGE[p.state];
  if (badge && !p.running) {
    ctx.fillStyle = '#cdd9ee'; ctx.font = 'bold 10px sans-serif';
    ctx.fillText(badge, p.px + 10, y - 9);
  }
}

/* ---------------- interaction ---------------- */
function bayAtTile(tx, ty) {
  for (let i = 0; i < 8; i++) {
    const b = bayRect(i);
    if (tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1) return i;
  }
  return -1;
}

function initShip() {
  setupCanvas();
  ensureLayout();
  const cv = document.querySelector('#ship-canvas');
  if (!cv) return;
  cv.onmousemove = e => {
    const rect = cv.getBoundingClientRect();
    const tx = Math.floor((e.clientX - rect.left) / TILE), ty = Math.floor((e.clientY - rect.top) / TILE);
    hoverBay = bayAtTile(tx, ty);
    cv.style.cursor = hoverBay >= 0 ? 'pointer' : 'default';
  };
  cv.onmouseleave = () => { hoverBay = -1; };
  cv.onclick = e => {
    const rect = cv.getBoundingClientRect();
    const tx = Math.floor((e.clientX - rect.left) / TILE), ty = Math.floor((e.clientY - rect.top) / TILE);
    const i = bayAtTile(tx, ty);
    if (i < 0) return;
    const room = roomInBay(i);
    if (room) openRoomDetail(room.id);     // occupied bay -> manage module
    else openBuildModal(i);                // empty bay -> build menu
  };
  updateShip(0.001);
  drawShip();
}
