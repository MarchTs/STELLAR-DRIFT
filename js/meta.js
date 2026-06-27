/* STELLAR DRIFT — run challenges (replaces the old persistent meta progression).
   No cores, no permanent upgrades: instead you pick a challenge for each run.
   The chosen challenge id is stored on GAME.challenge; modifiers come from
   CHALLENGES (js/data.js). */

function challengeDef() { return CHALLENGES[(GAME && GAME.challenge) || 'standard'] || CHALLENGES.standard; }
function chMod(key, dflt) { const v = challengeDef()[key]; return v === undefined ? dflt : v; }
