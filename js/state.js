/* STELLAR DRIFT — globals, RNG, persistence, resource caps, sector stock */
/* ============================================================
   STELLAR DRIFT — game state & simulation
   Pure logic. No DOM here (that lives in ui.js).
   ============================================================ */

// ---- tiny deterministic-ish RNG helper (just Math.random wrapped) ----
function rngFloat() { return Math.random(); }
function randInt(a, b) { return a + Math.floor(rngFloat() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rngFloat() * arr.length)]; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

let GAME = null;   // run state

const SAVE_KEY = 'stellardrift.save.v5';
/* ----------------------------------------------------------
   Resource caps (depend on room levels + meta)
   ---------------------------------------------------------- */
// each resource's cap scales with a storage-type attribute on a particular room
const RES_CAP_SRC = {
  power:    { type: 'reactor',     attr: 'storage' },
  oxygen:   { type: 'lifesupport', attr: 'storage' },
  co2:      { type: 'lifesupport', attr: 'co2storage' },
  water:    { type: 'lifesupport', attr: 'waterstorage' },
  minerals: { type: 'extractor',   attr: 'storage' },
  ore:      { type: 'extractor',   attr: 'storage' },
  scrap:    { type: 'extractor',   attr: 'storage' },
  ice:      { type: 'extractor',   attr: 'icestorage' },
  food:     { type: 'hydroponics', attr: 'storage' },
  fuel:     { type: 'engine',      attr: 'fuelstorage' },
};
function cap(st, res) {
  const base = CONFIG.baseCaps[res];
  const m = RES_CAP_SRC[res];
  if (!m) return Math.round(base);
  // every module of the storage type stacks: each adds base * its storage multiplier
  let c = 0;
  st.rooms.forEach(r => { if (r.type === m.type && attrDef(r.type, m.attr)) c += base * A_MULT(attrLvl(r, m.attr)); });
  return Math.round(c || base);
}

function crewMaxHealth() { return 100; }

/* ----------------------------------------------------------
   Save / load run
   ---------------------------------------------------------- */
function saveGame() {
  if (!GAME) return;
  try {
    const toSave = JSON.parse(JSON.stringify(GAME));
    if (GAME.unlockedBlueprints instanceof Set) {
      toSave.unlockedBlueprints = Array.from(GAME.unlockedBlueprints);
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(toSave));
  } catch (e) {}
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    GAME = JSON.parse(raw);
    // migrate any pre-attribute rooms (single `level`) -> attrs, and assign bay slots
    if (GAME && GAME.rooms) GAME.rooms.forEach((r, i) => {
      if (!r.attrs) {
        r.attrs = {};
        (ROOM_ATTRS[r.type] || []).forEach(a => { r.attrs[a.key] = 1; });
        if (r.level) r.attrs.output = r.level;
        delete r.level;
      }
      if (r.bay === undefined) r.bay = i;
    });
    // migrate pre-skill crew (role + single skillLevel) -> per-skill levels
    const ROLE_SKILL = { engineer: 'engineering', miner: 'mining', botanist: 'botany' };
    if (GAME && GAME.crew) GAME.crew.forEach(c => {
      if (!c.skills) {
        const sp = ROLE_SKILL[c.role] || 'engineering';
        c.skills = {}; SKILL_KEYS.forEach(k => { c.skills[k] = { level: 1, xp: 0 }; });
        c.skills[sp].level = c.skillLevel || 1;
        c.specialty = sp; c.color = SKILLS[sp].color;
        delete c.role; delete c.skillLevel; delete c.xp;
      }
    });
    // backfill any resources / sector stock added in later versions
    if (GAME && GAME.resources) {
      Object.keys(CONFIG.baseCaps).forEach(res => {
        if (GAME.resources[res] === undefined) GAME.resources[res] = CONFIG.start.resources[res] || 0;
      });
      if (!GAME.stock) GAME.stock = rollSectorStock(GAME.sector || 1);
    }
    if (GAME && !GAME.hullTier) GAME.hullTier = 1;
    if (GAME && !GAME.condition) GAME.condition = 'calm';
    if (GAME && !GAME.challenge) GAME.challenge = 'standard';
    if (GAME && GAME.sd === undefined) GAME.sd = 0;
    if (GAME && GAME.atStation === undefined) GAME.atStation = false;
    if (GAME && !GAME.unlockedBlueprints) {
      GAME.unlockedBlueprints = new Set();
    } else if (GAME && !(GAME.unlockedBlueprints instanceof Set)) {
      GAME.unlockedBlueprints = new Set(GAME.unlockedBlueprints);
    }
    return !!GAME && !GAME.gameOver;
  } catch (e) { return false; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

/* ----------------------------------------------------------
   Logging
   ---------------------------------------------------------- */
function logMsg(text, kind) {
  GAME.log.unshift({ t: GAME.time, text, kind: kind || 'info' });
  if (GAME.log.length > 40) GAME.log.length = 40;
}

function clampResources() {
  Object.keys(GAME.resources).forEach(res => {
    GAME.resources[res] = clamp(GAME.resources[res], 0, cap(GAME, res));
  });
}

// roll a sector's finite resource stock; deeper sectors are a touch richer
function rollSectorStock(sector) {
  const s = CONFIG.sectorStock, bonus = 1 + (sector - 1) * 0.1;
  return {
    minerals: Math.round((s.mineralsMin + rngFloat() * (s.mineralsMax - s.mineralsMin)) * bonus),
    ice: Math.round((s.iceMin + rngFloat() * (s.iceMax - s.iceMin)) * bonus),
  };
}

