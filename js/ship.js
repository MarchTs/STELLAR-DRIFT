/* ============================================================
   STELLAR DRIFT — top-down ship view (RimWorld-style)
   Tilemap + walls + A* pathfinding crew on an HTML canvas.
   Sim logic stays in game.js; this is pure visualization +
   spatial crew movement (ephemeral, not saved).
   ============================================================ */

const TILE = 26, ROWS = 12;
const BAY_TOP_Y = 1, BAY_BOT_Y = 8;       // top bays rows 1-3, bottom rows 8-10
const WALL_ROWS = [4, 7];                 // walls separating bays from the corridor

// Hull tier sets the number of bay COLUMNS (tier 1 = 4 cols = 8 bays, +1 col per tier).
// Dimensions recompute from it, so upgrading the hull widens the ship.
let HULL_COLS = 4, COLS = 21, WIDTH = COLS * TILE;
const HEIGHT = ROWS * TILE;
const MARGIN_Y = 50;                  // band of open space above & below the hull
const MARGIN_X = 64;                  // band of space left (engines) & right (bow)
const CANVAS_H = HEIGHT + MARGIN_Y * 2;
function canvasW() { return WIDTH + MARGIN_X * 2; }

/* ---------------- ambient space: asteroids & passing ships ---------------- */
let SPACE = null;
function bandY() {
  return Math.random() < 0.5 ? 4 + Math.random() * (MARGIN_Y - 10)
                             : MARGIN_Y + HEIGHT + 4 + Math.random() * (MARGIN_Y - 10);
}
function makeAsteroid() {
  return { x: Math.random() * canvasW(), y: bandY(), r: 3 + Math.random() * 6,
    vx: -(3 + Math.random() * 6), spin: Math.random() * 6, vspin: (Math.random() - 0.5) * 0.7,
    verts: 5 + Math.floor(Math.random() * 4), seed: Math.random() * 10 };
}
function makePassingShip(tint) {
  const ltr = Math.random() < 0.5;
  return { x: ltr ? -34 : canvasW() + 34, y: bandY(), dir: ltr ? 1 : -1,
    vx: (ltr ? 1 : -1) * (16 + Math.random() * 24), w: 16 + Math.random() * 14, tint: tint || '#9fb4d8' };
}
function initSpace() { SPACE = { asteroids: [], ships: [], shipTimer: 5 + Math.random() * 8 }; for (let i = 0; i < 6; i++) SPACE.asteroids.push(makeAsteroid()); }
function updateSpace(dt) {
  if (!SPACE) initSpace();
  SPACE.asteroids.forEach(a => { a.x += a.vx * dt; a.spin += a.vspin * dt; if (a.x < -24) { a.x = canvasW() + 24; a.y = bandY(); } });
  SPACE.shipTimer -= dt;
  if (SPACE.shipTimer <= 0) { SPACE.ships.push(makePassingShip()); SPACE.shipTimer = 11 + Math.random() * 16; }
  // a tinted ship glides by when scavengers raid (red) or you find salvage (green)
  GAME.events.forEach(ev => {
    if ((ev.id === 'raiders' || ev.id === 'salvage') && !ev._shipShown) {
      ev._shipShown = true;
      SPACE.ships.push(makePassingShip(ev.id === 'raiders' ? '#ff6b6b' : '#7ee08a'));
    }
  });
  SPACE.ships.forEach(s => s.x += s.vx * dt);
  SPACE.ships = SPACE.ships.filter(s => s.x > -60 && s.x < canvasW() + 60);
}
function drawAsteroid(ctx, a) {
  ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.spin);
  ctx.fillStyle = '#39414f'; ctx.strokeStyle = '#4d5a6e'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < a.verts; i++) {
    const ang = i / a.verts * 6.2832, rr = a.r * (0.7 + 0.45 * Math.sin(a.seed + i * 1.7));
    const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawPassingShip(ctx, s) {
  ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.dir, 1);
  ctx.fillStyle = 'rgba(120,180,255,.45)'; ctx.fillRect(-s.w / 2 - 5, -1.3, 5, 2.6);   // engine trail
  ctx.fillStyle = s.tint;
  ctx.beginPath(); ctx.moveTo(s.w / 2, 0); ctx.lineTo(-s.w / 2, -3.5); ctx.lineTo(-s.w / 3, 0); ctx.lineTo(-s.w / 2, 3.5); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// big planet drifting in the corner
function drawPlanet(ctx) {
  const W = canvasW(), px = W * 0.86, py = CANVAS_H * 1.05, r = CANVAS_H * 0.78;
  ctx.save();
  ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.clip();
  const g = ctx.createLinearGradient(px - r, py - r, px + r * 0.4, py + r * 0.4);
  g.addColorStop(0, '#9a8662'); g.addColorStop(0.45, '#6c5a40'); g.addColorStop(0.52, '#241c12'); g.addColorStop(1, '#060403');
  ctx.fillStyle = g; ctx.fillRect(px - r, py - r, 2 * r, 2 * r);
  ctx.restore();
  ctx.strokeStyle = 'rgba(190,160,120,.25)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.stroke();
}
function drawSpace(ctx) {
  const W = canvasW();
  ctx.fillStyle = '#04060c'; ctx.fillRect(0, 0, W, CANVAS_H);
  // soft nebula clouds
  const neb = (cx, cy, rr, col) => { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, CANVAS_H); };
  neb(W * 0.22, CANVAS_H * 0.28, W * 0.55, 'rgba(132,44,60,.20)');
  neb(W * 0.72, CANVAS_H * 0.7, W * 0.5, 'rgba(70,46,120,.16)');
  // stars
  STARS && STARS.forEach(s => {
    ctx.globalAlpha = s.a; ctx.fillStyle = '#cfe0f5';
    if (jumpFlash > 0) { const len = jumpFlash * 90 * (s.r + 0.4); ctx.fillRect(s.x - len, s.y - s.r * 0.5, len, Math.max(1, s.r)); }
    else { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); }
  });
  ctx.globalAlpha = 1;
  drawPlanet(ctx);
  if (SPACE) { SPACE.asteroids.forEach(a => drawAsteroid(ctx, a)); SPACE.ships.forEach(s => drawPassingShip(ctx, s)); }
}

// the ship hull silhouette: engine nacelles (left), wings, body plate, bow (right)
function drawHull(ctx) {
  const W = WIDTH, H = HEIGHT, midY = H / 2;
  const plate = '#586773', plateHi = '#74858f', plateLo = '#3b4751', edge = '#a9bcc7';
  // ENGINE NACELLES (poke into the left margin)
  [-0.34, 0, 0.34].forEach(f => {
    const ey = midY + f * H;
    ctx.fillStyle = plateLo; roundRect(ctx, -46, ey - 10, 52, 20, 5); ctx.fill();
    ctx.fillStyle = 'rgba(130,185,255,.85)'; roundRect(ctx, -49, ey - 5, 6, 10, 2); ctx.fill();
    ctx.fillStyle = 'rgba(130,185,255,.28)'; ctx.fillRect(-62, ey - 3, 14, 6);
  });
  // WINGS (angled plates, left half top & bottom)
  ctx.fillStyle = plateLo; ctx.strokeStyle = edge; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W * 0.06, -4); ctx.lineTo(W * 0.46, -4); ctx.lineTo(W * 0.34, -38); ctx.lineTo(W * 0.12, -38); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W * 0.06, H + 4); ctx.lineTo(W * 0.46, H + 4); ctx.lineTo(W * 0.34, H + 38); ctx.lineTo(W * 0.12, H + 38); ctx.closePath(); ctx.fill(); ctx.stroke();
  // BODY plate + bow (beveled, pointed to the right)
  const b = 18;
  ctx.fillStyle = plate; ctx.strokeStyle = edge; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-10 + b, -10);
  ctx.lineTo(W - 6, -10);
  ctx.lineTo(W + 10, -10 + b);
  ctx.lineTo(W + 46, midY - 16); ctx.lineTo(W + 62, midY); ctx.lineTo(W + 46, midY + 16);
  ctx.lineTo(W + 10, H + 10 - b);
  ctx.lineTo(W - 6, H + 10);
  ctx.lineTo(-10 + b, H + 10);
  ctx.lineTo(-10, H + 10 - b);
  ctx.lineTo(-10, -10 + b);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // top-edge highlight
  ctx.fillStyle = plateHi; ctx.fillRect(-10 + b, -10, W + 30, 3);
}
function syncHull() {
  HULL_COLS = 4 + (((GAME && GAME.hullTier) || 1) - 1);
  COLS = HULL_COLS * 5 + 1;               // each bay column = 4 wide + 1 divider, + left border
  WIDTH = COLS * TILE;
}
function bayCount() { return HULL_COLS * 2; }

function bayRect(i) {
  // column-major: bay = col*2 + (bottom?1:0). Stable when columns are added,
  // so existing rooms keep their physical spot when the hull is expanded.
  const col = Math.floor(i / 2), isTop = (i % 2) === 0;
  const x0 = 1 + col * 5, x1 = x0 + 3;
  const y0 = isTop ? BAY_TOP_Y : BAY_BOT_Y;
  const y1 = y0 + 2, cy = y0 + 1;          // 3 tiles tall
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

/* ---------------- static layout grids (rebuilt when hull tier changes) ---------------- */
let WALK = null, WALL = null, DOORS = [], _layoutCols = 0;
function ensureLayout() {
  syncHull();
  if (WALK && _layoutCols === COLS) return;
  _layoutCols = COLS;
  WALL = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  WALK = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) WALK[y][x] = true;
  // hull border
  for (let x = 0; x < COLS; x++) { WALL[0][x] = WALL[ROWS - 1][x] = true; }
  for (let y = 0; y < ROWS; y++) { WALL[y][0] = WALL[y][COLS - 1] = true; }
  // vertical bay dividers between columns (not across the corridor rows 5-6)
  for (let c = 1; c < HULL_COLS; c++) { const x = c * 5; [1, 2, 3, 8, 9, 10].forEach(y => { WALL[y][x] = true; }); }
  // corridor boundary walls
  WALL_ROWS.forEach(y => { for (let x = 1; x < COLS - 1; x++) WALL[y][x] = true; });
  // carve a door per bay
  DOORS = [];
  for (let i = 0; i < bayCount(); i++) { const d = bayRect(i).door; WALL[d.y][d.x] = false; DOORS.push(d); }
  // walls block walking
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALL[y][x]) WALK[y][x] = false;
  for (const d of DOORS) WALK[d.y][d.x] = true;
}
// rebuild layout + resize the canvas after a hull upgrade
function shipRelayout() { WALK = null; setupCanvas(); drawShip(); }

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
  updateSpace(dt);
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
  ensureLayout();                          // sync dimensions to the current hull tier
  const cv = document.querySelector('#ship-canvas');
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const CW = canvasW();
  cv.width = CW * dpr; cv.height = CANVAS_H * dpr;
  // natural size up to the pane width; max-width:100% + height:auto scales it
  // down proportionally (zoom out) when the hull gets wide
  cv.style.width = CW + 'px'; cv.style.height = 'auto';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  STARS = [];                              // (re)scatter stars across the whole canvas
  for (let i = 0; i < 80; i++) STARS.push({ x: Math.random() * CW, y: Math.random() * CANVAS_H, r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.5 + 0.2 });
  initSpace();
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

  // open space (nebula, planet, stars, asteroids, passing ships) fills the whole canvas...
  drawSpace(ctx);
  // ...then the hull is drawn into the middle, surrounded by a band of space
  ctx.save();
  ctx.translate(MARGIN_X, MARGIN_Y);
  drawHull(ctx);   // hull silhouette (engines, wings, body, bow) behind the bays

  // base interior floor (corridor)
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALK[y][x]) tileFill(ctx, x, y, '#141b29');

  // room floors
  GAME.rooms.forEach(r => {
    if (r.bay >= bayCount()) return;
    const b = bayRect(r.bay), col = ROOM_FLOOR[r.type] || '#1a2233';
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (WALK[y][x]) tileFill(ctx, x, y, col);
  });

  // tile grid lines
  ctx.strokeStyle = 'rgba(120,150,190,.05)'; ctx.lineWidth = 1;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (WALK[y][x]) ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);

  // walls — hull border drawn as light plating, interior walls dark
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (!WALL[y][x]) continue;
    const border = x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1;
    ctx.fillStyle = border ? '#586773' : '#0a0f1a'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
    ctx.fillStyle = border ? '#74858f' : '#1c2740'; ctx.fillRect(x * TILE, y * TILE, TILE, 3);   // lit top edge
  }

  // doors (a lighter sill in the wall gap)
  DOORS.forEach(d => {
    const cx = d.x * TILE, cy = d.y * TILE;
    ctx.fillStyle = '#1a2840'; ctx.fillRect(cx + 3, cy + 3, TILE - 6, TILE - 6);
  });

  // empty bays: a dashed "build here" slot
  for (let i = 0; i < bayCount(); i++) {
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
  if (hoverBay >= 0 && hoverBay < bayCount()) {
    const b = bayRect(hoverBay);
    ctx.strokeStyle = 'rgba(92,200,255,.7)'; ctx.lineWidth = 2;
    ctx.strokeRect(b.x0 * TILE + 1, b.y0 * TILE + 1, (b.x1 - b.x0 + 1) * TILE - 2, (b.y1 - b.y0 + 1) * TILE - 2);
  }

  // stations, beds & labels
  GAME.rooms.forEach(r => {
    if (r.bay >= bayCount()) return;
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

  ctx.restore();   // end hull translate

  // jump flash — a bright bluish-white wash that fades out (whole canvas)
  if (jumpFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, jumpFlash);
    ctx.fillStyle = '#dff0ff';
    ctx.fillRect(0, 0, canvasW(), CANVAS_H);
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
// map a mouse event to tile coords, accounting for CSS scaling (the canvas is
// scaled down to fit the pane when the hull is wide)
function eventTile(cv, e) {
  const rect = cv.getBoundingClientRect();
  return {
    // account for the space margins around the hull
    tx: Math.floor(((e.clientX - rect.left) / rect.width * canvasW() - MARGIN_X) / TILE),
    ty: Math.floor(((e.clientY - rect.top) / rect.height * CANVAS_H - MARGIN_Y) / TILE),
  };
}
function bayAtTile(tx, ty) {
  for (let i = 0; i < bayCount(); i++) {
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
    const { tx, ty } = eventTile(cv, e);
    hoverBay = bayAtTile(tx, ty);
    cv.style.cursor = hoverBay >= 0 ? 'pointer' : 'default';
  };
  cv.onmouseleave = () => { hoverBay = -1; };
  cv.onclick = e => {
    const { tx, ty } = eventTile(cv, e);
    const i = bayAtTile(tx, ty);
    if (i < 0) return;
    const room = roomInBay(i);
    if (room) openRoomDetail(room.id);     // occupied bay -> manage module
    else openBuildModal(i);                // empty bay -> build menu
  };
  updateShip(0.001);
  drawShip();
}
