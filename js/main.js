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

      // sub-step for stability if dt large
      let remaining = dt;
      while (remaining > 0) {
        const s = Math.min(remaining, CONFIG.tickMs / 1000);
        step(s);
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
    const id = e.target.closest('[data-eject]')?.dataset.eject;
    if (id) ejectCrew(id);
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
