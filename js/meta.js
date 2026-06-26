/* STELLAR DRIFT — meta progression (Salvage Bay permanent upgrades) */
/* ----------------------------------------------------------
   META (persistent across runs)
   ---------------------------------------------------------- */
const META_UPGRADES = [
  // --- better starting conditions ---
  { id: 'extra_crew', name: 'Cryo Pod', cat: 'Start', max: 3,
    cost: l => 12 + l * 10,
    desc: l => `Begin each run with +${l + 1} crew member${l ? 's' : ''}.`,
    blurb: 'Adds a randomly-skilled crew member to your starting roster.' },
  { id: 'start_minerals', name: 'Cargo Cache', cat: 'Start', max: 4,
    cost: l => 8 + l * 6,
    desc: l => `Start with +${(l + 1) * 25} minerals.`,
    blurb: 'A head start on building and repairs.' },
  { id: 'start_skill', name: 'Veteran Crew', cat: 'Start', max: 4,
    cost: l => 10 + l * 8,
    desc: l => `Starting crew begin at skill level ${l + 1 + 1}.`,
    blurb: 'Trained crew produce more from the first second.' },
  { id: 'prebuilt_medbay', name: 'Standard Medbay', cat: 'Start', max: 1,
    cost: () => 25,
    desc: () => 'Start every run with a Medbay already built.',
    blurb: 'Skip the early scramble to treat your first casualty.' },

  // --- survivability buffers ---
  { id: 'max_health', name: 'Reinforced Suits', cat: 'Survival', max: 4,
    cost: l => 10 + l * 9,
    desc: l => `Crew max health +${(l + 1) * 20}.`,
    blurb: 'Crew endure crises longer before dying.' },
  { id: 'o2_reserve', name: 'O₂ Reserves', cat: 'Survival', max: 3,
    cost: l => 12 + l * 10,
    desc: l => `Oxygen capacity +${(l + 1) * 25} and crew breathe ${5 * (l + 1)}% slower.`,
    blurb: 'A bigger buffer against breaches and life-support faults.' },
  { id: 'illness_resist', name: 'Vaccines', cat: 'Survival', max: 3,
    cost: l => 10 + l * 8,
    desc: l => `Outbreak severity −${(l + 1) * 25}%.`,
    blurb: 'Illness drains health more slowly.' },
  { id: 'revive', name: 'Revive Nanites', cat: 'Survival', max: 2,
    cost: l => 18 + l * 16,
    desc: l => `Auto-revive the first ${l + 1} crew death${l ? 's' : ''} per run.`,
    blurb: 'A dead crew member is restored once (per charge) at low health.' },
];

function metaLevel(id) { return (META && META.upgrades[id]) || 0; }

function defaultMeta() { return { cores: 0, upgrades: {} }; }

function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    META = raw ? JSON.parse(raw) : defaultMeta();
  } catch (e) { META = defaultMeta(); }
  if (!META.upgrades) META.upgrades = {};
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(META)); } catch (e) {}
}

function buyUpgrade(id) {
  const def = META_UPGRADES.find(u => u.id === id);
  const lvl = metaLevel(id);
  if (!def || lvl >= def.max) return false;
  const cost = def.cost(lvl);
  if (META.cores < cost) return false;
  META.cores -= cost;
  META.upgrades[id] = lvl + 1;
  saveMeta();
  return true;
}

