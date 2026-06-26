/* STELLAR DRIFT — rooms: creation, building, demolishing, attribute upgrades */
function makeRoom(type, bay) {
  const attrs = {};
  (ROOM_ATTRS[type] || []).forEach(a => { attrs[a.key] = 1; });
  return { id: 'r' + Math.floor(rngFloat() * 1e9).toString(36), type, attrs, bay };
}

/* ----------------------------------------------------------
   Build / upgrade rooms
   ---------------------------------------------------------- */
const BUILDABLE = ['extractor', 'hydroponics', 'quarters', 'medbay', 'messhall', 'lifesupport', 'reactor', 'engine'];
const SINGLE_INSTANCE = { medbay: 1, engine: 1, messhall: 1 };   // at most one of these
// bay count grows with the hull tier (tier 1 = 8 bays, +2 per tier). See js/ship.js.
function hullTier() { return (GAME && GAME.hullTier) || 1; }
function maxRooms() { return (4 + (hullTier() - 1)) * 2; }
function shipFull() { return GAME.rooms.length >= maxRooms(); }
function bayOccupied(bay) { return GAME.rooms.some(r => r.bay === bay); }
function firstEmptyBay() { for (let i = 0; i < maxRooms(); i++) if (!bayOccupied(i)) return i; return -1; }

/* ---- hull expansion: upgrade the ship to add more bays ---- */
function hullCost() { return Math.round(CONFIG.hull.cost(hullTier())); }
function canExpandHull() {
  return GAME && !GAME.gameOver && hullTier() < CONFIG.hull.maxTier && GAME.resources.minerals >= hullCost();
}
function expandHull() {
  if (!canExpandHull()) return false;
  GAME.resources.minerals -= hullCost();
  GAME.hullTier = hullTier() + 1;
  logMsg(`Hull expanded — the ship now has ${maxRooms()} bays.`, 'good');
  saveGame();
  return true;
}
function buildableTypes() {
  return BUILDABLE.filter(t => !(SINGLE_INSTANCE[t] && roomsOfType(t).length >= SINGLE_INSTANCE[t]));
}
function buildCost(type) { return CONFIG.build[type] || 50; }
function canBuild(type) {
  return !shipFull() && buildableTypes().includes(type) && GAME.resources.minerals >= buildCost(type);
}
function buildRoom(type, bay) {
  if (!canBuild(type)) return false;
  if (bay === undefined || bayOccupied(bay)) bay = firstEmptyBay();
  if (bay < 0) return false;
  GAME.resources.minerals -= buildCost(type);
  GAME.rooms.push(makeRoom(type, bay));
  GAME.roomsBuilt++;
  logMsg(`Built a new ${ROOM_DEFS[type].name}.`, 'good');
  saveGame();
  return true;
}

// salvage value of a room ~ half its build cost (starting rooms use the default)
function removeRefund(type) { return Math.round((CONFIG.build[type] || 50) * 0.5); }
function removeRoom(roomId) {
  const idx = GAME.rooms.findIndex(r => r.id === roomId);
  if (idx < 0) return false;
  const room = GAME.rooms[idx];
  const refund = removeRefund(room.type);
  GAME.rooms.splice(idx, 1);
  GAME.resources.minerals = clamp(GAME.resources.minerals + refund, 0, cap(GAME, 'minerals'));
  // release any crew assigned to it; they re-task next tick
  GAME.crew.forEach(c => { if (c.roomId === roomId) { c.roomId = null; if (c.state === 'working') c.state = 'idle'; } });
  logMsg(`Demolished ${ROOM_DEFS[room.type].name} (+${refund} minerals).`, 'warn');
  saveGame();
  return true;
}

/* per-attribute upgrades */
function attrUpgradeCost(room, key) {
  const def = attrDef(room.type, key), l = attrLvl(room, key);
  return Math.round(def.base * l * Math.pow(CONFIG.build.upgradeMult, l - 1));
}
function attrMaxed(room, key) { const def = attrDef(room.type, key); return attrLvl(room, key) >= def.max; }
function canUpgradeAttr(room, key) { return !attrMaxed(room, key) && GAME.resources.minerals >= attrUpgradeCost(room, key); }
function upgradeAttr(roomId, key) {
  const room = GAME.rooms.find(r => r.id === roomId);
  if (!room || !canUpgradeAttr(room, key)) return false;
  GAME.resources.minerals -= attrUpgradeCost(room, key);
  room.attrs[key] = attrLvl(room, key) + 1;
  logMsg(`${ROOM_DEFS[room.type].name}: ${attrDef(room.type, key).name} → L${room.attrs[key]}.`, 'good');
  saveGame();
  return true;
}

