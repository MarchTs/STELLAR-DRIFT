/* ============================================================
   STELLAR DRIFT — bootstrap, game loop, wiring
   ============================================================ */

let lastNow = 0;
let wasGameOver = false;
let saveTimer = 0;

function startNewRun() {
  newRun();
  wasGameOver = false;
  closeModal();
  renderAll();
}

// When game over, closing any modal should bring back the summary
const _closeModal = closeModal;
closeModal = function () {
  _closeModal();
  if (GAME && GAME.gameOver) openGameOver();
};

function loop(now) {
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

  requestAnimationFrame(loop);
}

function init() {
  loadMeta();
  if (!loadGame()) {
    // no valid run -> fresh start (meta upgrades apply)
    newRun();
  }
  renderAll();
  initShip();

  $('#btn-jump').onclick = () => { if (doJump()) { triggerJumpFlash(); renderAll(); } };
  $('#btn-synth').onclick = () => { if (synthFuel()) renderAll(); };
  $('#btn-meta').onclick = openMetaHub;

  // click backdrop to close modal
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };

  // save on exit
  window.addEventListener('beforeunload', saveGame);

  requestAnimationFrame(loop);
}

window.addEventListener('DOMContentLoaded', init);
