/* ============================================================
   STELLAR DRIFT — sector map: a branching tree of destinations

   Replaces the old "roll 3 random options" jump with a persistent tree that is
   generated as you explore and kept for the whole run.

   IDENTITY vs SCALING — the important split:
     GAME.sectorNode  node id, e.g. 'n7'  -> WHICH sector you are in
     GAME.sector      depth number        -> HOW DEEP you are
   Everything that scales difficulty (enemies, events, prices, stock) keeps
   reading GAME.sector exactly as before; only identity moved to the node id.
   ============================================================ */

const SECTOR_NAMES = [
  'Halcyon Reach', 'Cinder Belt', 'Verdant Hollow', 'The Long Dark', 'Ashfall Drift',
  'Silent Anchorage', 'Kestrel Gap', 'Ember Shoals', 'Pale Meridian', 'Thorn Nebula',
  'Gallows Rift', 'Amber Expanse', 'Hollow Crown', 'Tidewater Verge', 'Iron Vigil',
  'Sable Crossing', 'Lantern Fields', 'Broken Compass', 'Quiet Fathom', 'Vesper Straits',
  'Cradle of Rust', 'Glass Horizon', 'Wandering Coal', 'Foundling Deep', 'Salt Harbour',
];

const SECTOR_DIFFICULTY = {
  1: { label: 'Quiet',      tone: 'good', stars: '★' },
  2: { label: 'Unsettled',  tone: 'warn', stars: '★★' },
  3: { label: 'Hostile',    tone: 'risk', stars: '★★★' },
  4: { label: 'Lethal',     tone: 'bad',  stars: '★★★★' },
};

/* ---------------- construction ---------------- */
function newSectorMap() {
  const map = { nodes: {}, nextId: 0 };
  GAME.sectorMap = map;
  const root = makeSectorNode(null, 1, { difficulty: 1, condition: 'calm' });
  root.visited = true;
  root.name = 'Home Drift';
  GAME.sectorNode = root.id;
  expandFrontier(root.id);
  return map;
}

// A node's difficulty biases its stock: riskier space is richer. This is the
// risk/reward curve — a Lethal sector carries roughly double a Quiet one.
function difficultyStockMult(d) { return 0.7 + d * 0.35; }

function makeSectorNode(parentId, depth, opts = {}) {
  const map = GAME.sectorMap;
  const id = 'n' + (map.nextId++);
  const difficulty = opts.difficulty || rollSectorDifficulty(depth);
  const isStation = opts.type === 'station';

  // reuse the existing condition/stock roller, then bias by difficulty
  const rolled = rollSector(depth);
  const mult = difficultyStockMult(difficulty);
  const node = {
    id, parent: parentId, depth,
    type: isStation ? 'station' : 'sector',
    name: isStation ? 'Waystation' : pickSectorName(),
    difficulty: isStation ? 1 : difficulty,
    condition: isStation ? 'calm' : (opts.condition || rolled.condition),
    stock: isStation ? { minerals: 0, ice: 0 }
                     : { minerals: Math.round(rolled.stock.minerals * mult),
                         ice:      Math.round(rolled.stock.ice * mult) },
    visited: false,
    children: [],
  };
  map.nodes[id] = node;
  if (parentId) map.nodes[parentId].children.push(id);
  return node;
}

// deeper space skews harder, but any branch can roll anything — that's the choice
function rollSectorDifficulty(depth) {
  const bias = Math.min(3, (depth - 1) * 0.35);
  const roll = rngFloat() * 4 + bias;
  return Math.max(1, Math.min(4, Math.ceil(roll * 0.8)));
}

function pickSectorName() {
  const used = new Set(Object.values(GAME.sectorMap.nodes).map(n => n.name));
  const free = SECTOR_NAMES.filter(n => !used.has(n));
  if (free.length) return pick(free);
  return pick(SECTOR_NAMES) + ' ' + String.fromCharCode(65 + Math.floor(rngFloat() * 26));
}

// Generate this node's children once. Called on arrival, so you always see one
// hop ahead but never the whole map.
function expandFrontier(nodeId) {
  const map = GAME.sectorMap, node = map.nodes[nodeId];
  if (!node || node.children.length) return;
  const count = 2 + Math.floor(rngFloat() * 3);          // 2-4 branches
  let stationPlaced = false;
  for (let i = 0; i < count; i++) {
    const station = !stationPlaced && rngFloat() < CONFIG.station.spawnChance;
    if (station) stationPlaced = true;
    makeSectorNode(nodeId, node.depth + 1, station ? { type: 'station' } : {});
  }
}

/* ---------------- navigation ---------------- */
// Never index CONDITIONS directly off saved data — an unknown key (old save,
// renamed condition) would otherwise take the whole sector map down with it.
function sectorCondition(n) { return (n && CONDITIONS[n.condition]) || CONDITIONS.calm; }
function sectorNode(id) { return GAME.sectorMap && GAME.sectorMap.nodes[id]; }
function currentSector() { return sectorNode(GAME.sectorNode); }

// You may travel to anywhere you've been, or anywhere adjacent to somewhere
// you've been — "visited or visible".
function canTravelTo(id) {
  const n = sectorNode(id);
  if (!n || id === GAME.sectorNode) return false;
  if (n.visited) return true;
  const p = n.parent && sectorNode(n.parent);
  return !!(p && p.visited);
}

// Nodes worth drawing: everything visited, plus their children (the frontier).
function knownSectors() {
  const map = GAME.sectorMap;
  if (!map) return [];
  const out = [];
  Object.values(map.nodes).forEach(n => {
    const p = n.parent && map.nodes[n.parent];
    if (n.visited || (p && p.visited)) out.push(n);
  });
  return out;
}

function travelTo(id) {
  const n = sectorNode(id);
  if (!n || !canTravelTo(id) || !canJump()) return false;
  GAME.resources.fuel -= jumpFuelCost();

  GAME.sectorNode = id;
  GAME.sector = n.depth;                 // keeps every difficulty formula working
  GAME.stock = n.stock;
  GAME.condition = n.condition;
  GAME.atStation = n.type === 'station';
  GAME.nextEventIn = Math.min(GAME.nextEventIn, 12);
  const firstVisit = !n.visited;
  n.visited = true;
  expandFrontier(id);

  if (n.type === 'station') {
    logMsg(`Docked at ${n.name} — Sector ${n.depth}. Trade resources for SD.`, 'good');
    saveGame();
    return 'station';
  }
  const c = sectorCondition(n);
  if (firstVisit) {
    if (c.salvageFuel) GAME.resources.fuel = Math.min(cap(GAME, 'fuel'), GAME.resources.fuel + c.salvageFuel);
    if (c.salvageMinerals) GAME.resources.minerals = Math.min(cap(GAME, 'minerals'), GAME.resources.minerals + c.salvageMinerals);
  }
  const d = SECTOR_DIFFICULTY[n.difficulty];
  logMsg(`${firstVisit ? 'Jumped to' : 'Returned to'} ${n.name} (Sector ${n.depth}, ${d.label}) — ${c.name}.`,
    c.tone === 'good' ? 'good' : 'warn');
  saveGame();
  return true;
}

/* ---------------- stashing crew & cargo in a sector ---------------- */
// Encounters can leave people or cargo behind; you collect them by travelling back.
function sectorStash(id) {
  if (!GAME.sectorStash) GAME.sectorStash = {};
  if (!GAME.sectorStash[id]) GAME.sectorStash[id] = { crew: [], res: {} };
  return GAME.sectorStash[id];
}
function hasStash(id) {
  const s = GAME.sectorStash && GAME.sectorStash[id];
  return !!s && (s.crew.length > 0 || Object.keys(s.res || {}).length > 0);
}
function stashCrewAt(id, crewId) {
  const idx = GAME.crew.findIndex(c => c.id === crewId);
  if (idx < 0) return false;
  const [c] = GAME.crew.splice(idx, 1);
  sectorStash(id).crew.push(c);
  delete PAWNS[c.id];
  logMsg(`${c.name} was left at ${sectorNode(id)?.name || 'a distant sector'}.`, 'warn');
  saveGame();
  return true;
}
function stashResourceAt(id, res, amount) {
  const s = sectorStash(id);
  s.res[res] = (s.res[res] || 0) + amount;
  GAME.resources[res] = Math.max(0, GAME.resources[res] - amount);
  saveGame();
  return true;
}
// Collect whatever is waiting in the sector you're currently in.
function collectStash() {
  const id = GAME.sectorNode;
  if (!hasStash(id)) return false;
  const s = GAME.sectorStash[id];
  s.crew.forEach(c => GAME.crew.push(c));
  const names = s.crew.map(c => c.name);
  Object.keys(s.res).forEach(r => {
    GAME.resources[r] = Math.min(cap(GAME, r), GAME.resources[r] + s.res[r]);
  });
  const resTxt = Object.keys(s.res).map(r => `${Math.round(s.res[r])} ${r}`).join(', ');
  delete GAME.sectorStash[id];
  logMsg(`Recovered ${[names.join(', '), resTxt].filter(Boolean).join(' and ')}.`, 'good');
  saveGame();
  return true;
}

/* ---------------- save migration ---------------- */
// Runs saved before the map existed get a tree rooted at wherever they are.
function ensureSectorMap() {
  if (!GAME) return;
  if (GAME.sectorMap && GAME.sectorNode && sectorNode(GAME.sectorNode)) return;
  GAME.sectorMap = { nodes: {}, nextId: 0 };
  const root = makeSectorNode(null, GAME.sector || 1, {
    difficulty: 1, condition: CONDITIONS[GAME.condition] ? GAME.condition : 'calm',
  });
  root.visited = true;
  root.name = 'Current Position';
  root.stock = GAME.stock || root.stock;
  root.type = GAME.atStation ? 'station' : 'sector';
  GAME.sectorNode = root.id;
  expandFrontier(root.id);
}
