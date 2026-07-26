/* ============================================================
   STELLAR DRIFT — bootstrap, game loop, wiring
   ============================================================ */

let lastNow = 0;
let wasGameOver = false;
let saveTimer = 0;

// start a fresh run with the chosen challenge
function startRun(challengeId) {
  newRun(challengeId);
  for (const k in PAWNS) delete PAWNS[k];
  wasGameOver = false;
  _closeModal();          // bypass the game-over re-open guard
  shipRelayout();
  renderAll();
}

// While game over, closing any modal brings back the game-over screen
// (so you must pick a challenge to continue).
const _closeModal = closeModal;
closeModal = function () {
  _closeModal();
  if (GAME && GAME.gameOver) openGameOver();
};

function loop(now) {
  try {
    if (!lastNow) lastNow = now;
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    // clamp dt so a throttled/inactive tab can't fast-forward a disaster
    dt = Math.min(dt, 0.5);

    if (GAME && !GAME.gameOver && !GAME.paused) {
      // snapshot for rate display
      const before = Object.assign({}, GAME.resources);

      // sub-step for stability if dt large. A fight replaces the economy tick
      // entirely — resources and crew needs hold still until it resolves.
      let remaining = dt;
      while (remaining > 0) {
        const s = Math.min(remaining, CONFIG.tickMs / 1000);
        if (GAME.combat) combatStep(s); else step(s);
        remaining -= s;
        if (GAME.gameOver) break;
      }

      // smoothed rates
      if (dt > 0) {
        Object.keys(GAME.resources).forEach(res => {
          const inst = (GAME.resources[res] - (before[res] || 0)) / dt;
          lastRates[res] = (lastRates[res] || 0) * 0.7 + inst * 0.3;
        });
      }

      // periodic autosave
      saveTimer += dt;
      if (saveTimer >= CONFIG.saveEveryMs / 1000) { saveTimer = 0; saveGame(); }
    }

    // Render outside the pause gate so a paused fight still draws and stays clickable.
    if (GAME && !GAME.gameOver) {
      renderAll();
      updateShip(dt);
      drawShip();
    }

    // game over transition
    if (GAME && GAME.gameOver && !wasGameOver) {
      wasGameOver = true;
      renderAll();
      openGameOver();
    }
  } catch (e) {
    console.error('[loop]', e);
  }

  requestAnimationFrame(loop);
}

function init() {
  const hadSave = loadGame();
  if (!hadSave) newRun('standard');   // a default run so the ship renders behind the picker
  renderAll();
  initShip();
  if (!hadSave) openChallengeSelect(); // first launch -> choose your challenge

  $('#btn-jump').onclick = () => { openJumpModal(); };
  $('#btn-synth').onclick = () => { if (synthFuel()) renderAll(); };
  $('#btn-meta').onclick = () => { openChallengeSelect(false); };

  $('#crew-list').addEventListener('click', e => {
    const ejectId = e.target.closest('[data-eject]')?.dataset.eject;
    if (ejectId) { ejectCrew(ejectId); return; }
    const unpostId = e.target.closest('[data-unpost]')?.dataset.unpost;
    if (unpostId) { unassignCrew(unpostId); renderAll(); return; }
    // clicking the card selects that crew — then click a room to post them
    const selId = e.target.closest('[data-select]')?.dataset.select;
    if (selId) selectCrew(selectedCrewId === selId ? null : selId);
  });

  // combat panel controls (delegated — the panel is rebuilt once per fight)
  $('#combat-panel').addEventListener('click', e => {
    if (!GAME.combat) return;
    const t = e.target.closest('[data-target]');
    if (t) { setCombatTarget(t.dataset.target); renderAll(); return; }
    const pip = e.target.closest('[data-pip]');
    if (pip) { setPips(pip.dataset.pip, +pip.dataset.d); renderAll(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'pause') { GAME.paused = !GAME.paused; renderAll(); }
    else if (act === 'flee') { toggleFlee(); renderAll(); }
  });

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && selectedCrewId) selectCrew(null);
    // spacebar pauses during a fight, like FTL
    if (e.code === 'Space' && GAME && GAME.combat && !GAME.gameOver) {
      e.preventDefault();
      GAME.paused = !GAME.paused;
      renderAll();
    }
  });

  // resource flow breakdown on hover
  const resEl = $('#resources');
  resEl.addEventListener('mouseover', e => { const el = e.target.closest('.res'); hoveredRes = el ? el.dataset.res : null; });
  resEl.addEventListener('mouseleave', () => { hoveredRes = null; });

  // click backdrop to close modal
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

  // save on exit
  window.addEventListener('beforeunload', saveGame);

  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', init);
