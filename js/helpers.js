/* STELLAR DRIFT — small shared helpers (room attributes, capacities, skills, events) */
/* ----------------------------------------------------------
   Helpers for rooms / staffing
   ---------------------------------------------------------- */
function roomsOfType(type) { return GAME.rooms.filter(r => r.type === type); }

/* per-attribute helpers */
function attrDef(type, key) { return (ROOM_ATTRS[type] || []).find(a => a.key === key); }
function attrLvl(room, key) { return (room.attrs && room.attrs[key]) || 1; }
function attrMult(room, key) { return A_MULT(attrLvl(room, key)); }     // output / storage / comfort / treatment
function attrEff(room, key) { return A_EFF(attrLvl(room, key)); }       // efficiency power-draw factor
function bedCount(room) { const d = attrDef(room.type, 'beds'); return d ? A_BEDS(d.baseN, attrLvl(room, 'beds')) : 0; }
function primaryMult(room) { const list = ROOM_ATTRS[room.type]; return (list && list[0]) ? attrMult(room, list[0].key) : 1; }
// power a module currently draws: base × primary-upgrade level × efficiency.
// Staffed production rooms only draw while worked; others draw whenever powered.
function roomPowerDraw(room) {
  const def = CONFIG.rooms[room.type];
  if (!def || !def.powerCost) return 0;
  // operator-run modules draw power only while actually being operated
  if (['extractor', 'hydroponics', 'lifesupport'].includes(room.type) && staffOn(room.id) <= 0) return 0;
  let cost = def.powerCost * primaryMult(room);
  if (attrDef(room.type, 'efficiency')) cost *= attrEff(room, 'efficiency');
  return cost * condMod('powerDrawMult', 1);   // hot sectors make everything draw more
}
function totalBeds() { return roomsOfType('quarters').reduce((s, r) => s + bedCount(r), 0); }
function totalMedBeds() { return roomsOfType('medbay').reduce((s, r) => s + bedCount(r), 0); }
function seatCount(room) { const d = attrDef(room.type, 'seats'); return d ? A_BEDS(d.baseN, attrLvl(room, 'seats')) : 0; }
function totalSeats() { return roomsOfType('messhall').reduce((s, r) => s + seatCount(r), 0); }
function countState(s) { return GAME.crew.filter(c => c.state === s).length; }
function crewSkillLevel(crew, key) { return (crew.skills[key] && crew.skills[key].level) || 1; }
// efficiency a crew brings to a given room, based on that room's skill
function roomSkillMult(crew, room) {
  const sk = ROOM_SKILL[room.type];
  if (!sk) return 1;
  return 1 + (crewSkillLevel(crew, sk) - 1) * CONFIG.skill.outputPerLevel;
}
function aliveCrew() { return GAME.crew.filter(c => c.state !== 'dead'); }
function hasPower(st) { return st.resources.power > 0.5; }

function activeEvent(id) { return GAME.events.find(e => e.id === id); }

// engineer claims a located hazard to repair (keeps its current claim if still valid)
function claimRepairJob(c) {
  let ev = GAME.events.find(e => e.needsRepair && e.assignedTo === c.id);
  if (ev) return ev;
  ev = GAME.events.find(e => e.needsRepair &&
    (!e.assignedTo || !GAME.crew.some(x => x.id === e.assignedTo && x.state === 'repairing')));
  if (ev) { ev.assignedTo = c.id; return ev; }
  return null;
}

function reactorMultiplier() {
  const fault = activeEvent('power_failure');
  return fault ? fault.reactorMult : 1;
}

