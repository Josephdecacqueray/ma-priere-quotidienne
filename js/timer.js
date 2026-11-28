/* =========================================================
   MINUTEUR DE RECUEILLEMENT / ORAISON SILENCIEUSE
   - Chargé dynamiquement uniquement si l'utilisateur touche l'icône Minuteur
   - Doux tintement harmonique Web Audio API à la fin (0 fichier audio, 100 % hors-ligne)
   ========================================================= */

let intervalId = null;
let endAtMs = 0;
let remainingSec = 0;
let selectedMinutes = 15;
let running = false;
let audioCtx = null;

function formatMmSs(totalSec) {
  const s = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function playGentleBell() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    // Accord doux de clochette (fondamentale 528 Hz + harmonique 1056 Hz)
    [528, 1056].forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(idx === 0 ? 0.14 : 0.04, now + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.6);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 2.7);
    });
  } catch {
    // Silencieux si audio bloqué
  }
}

export function openPrayerTimerSheet({ showToast } = {}) {
  let modal = document.getElementById('prayer-timer-overlay');
  if (modal) modal.remove();

  const overlay = document.createElement('div');
  overlay.id = 'prayer-timer-overlay';
  overlay.className = 'tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Minuteur d’oraison');

  const card = document.createElement('div');
  card.className = 'tour-card timer-card';

  const head = document.createElement('div');
  head.className = 'tour-top-bar';
  const title = document.createElement('span');
  title.className = 'tour-kicker';
  title.textContent = 'Oraison silencieuse';
  const closeBtn = document.createElement('button');
  closeBtn.id = 'btn-timer-close';
  closeBtn.type = 'button';
  closeBtn.className = 'tour-skip-btn';
  closeBtn.textContent = 'Fermer';
  closeBtn.addEventListener('click', () => overlay.remove());
  head.append(title, closeBtn);
  card.appendChild(head);

  const h2 = document.createElement('h2');
  h2.className = 'tour-title';
  h2.textContent = 'Minuteur de recueillement';
  card.appendChild(h2);

  const display = document.createElement('div');
  display.id = 'prayer-timer-display';
  display.className = 'timer-clock-display';
  display.textContent = formatMmSs(remainingSec > 0 ? remainingSec : selectedMinutes * 60);
  card.appendChild(display);

  const presetsRow = document.createElement('div');
  presetsRow.className = 'timer-presets-row';
  const presetBtns = [];
  const syncPresetActive = () => {
    presetBtns.forEach(({ btn, min }) => {
      btn.classList.toggle('active', min === selectedMinutes);
    });
  };
  [5, 10, 15, 20, 30, 60].forEach((min) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill-btn';
    b.dataset.timerMin = String(min);
    b.textContent = min === 60 ? '1 h' : `${min} min`;
    b.addEventListener('click', () => {
      stopTimer();
      selectedMinutes = min;
      remainingSec = min * 60;
      display.textContent = formatMmSs(remainingSec);
      syncPresetActive();
      syncButtons();
    });
    presetBtns.push({ btn: b, min });
    presetsRow.appendChild(b);
  });
  syncPresetActive();
  card.appendChild(presetsRow);

  const note = document.createElement('p');
  note.className = 'field-help timer-note';
  note.textContent = 'Un tintement discret retentit à la fin du temps choisi, sans interrompre votre prière.';
  card.appendChild(note);

  const ctrlRow = document.createElement('div');
  ctrlRow.className = 'tour-actions';
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'btn-timer-toggle';
  toggleBtn.type = 'button';
  toggleBtn.className = 'btn-primary-ios';
  const resetBtn = document.createElement('button');
  resetBtn.id = 'btn-timer-reset';
  resetBtn.type = 'button';
  resetBtn.className = 'btn-outline-ios';
  resetBtn.textContent = 'Réinitialiser';

  const updateFloatingBadge = () => {
    const badge = document.getElementById('floating-timer-pill');
    if (!badge) return;
    if (running && remainingSec > 0) {
      badge.textContent = `Oraison · ${formatMmSs(remainingSec)}`;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  };

  const stopTimer = () => {
    running = false;
    clearInterval(intervalId);
    intervalId = null;
    updateFloatingBadge();
  };

  const syncButtons = () => {
    toggleBtn.textContent = running
      ? 'Pause'
      : (remainingSec > 0 && remainingSec < selectedMinutes * 60 ? 'Reprendre' : 'Démarrer');
  };

  toggleBtn.addEventListener('click', () => {
    if (running) {
      remainingSec = Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000));
      stopTimer();
      syncButtons();
      return;
    }
    if (remainingSec <= 0) remainingSec = selectedMinutes * 60;
    endAtMs = Date.now() + remainingSec * 1000;
    running = true;
    syncButtons();
    updateFloatingBadge();
    intervalId = setInterval(() => {
      remainingSec = Math.max(0, Math.ceil((endAtMs - Date.now()) / 1000));
      const d = document.getElementById('prayer-timer-display');
      if (d) d.textContent = formatMmSs(remainingSec);
      updateFloatingBadge();
      if (remainingSec <= 0) {
        stopTimer();
        playGentleBell();
        showToast?.('Temps d’oraison terminé. Gloire à Dieu.');
        syncButtons();
      }
    }, 500);
  });

  resetBtn.addEventListener('click', () => {
    stopTimer();
    remainingSec = selectedMinutes * 60;
    display.textContent = formatMmSs(remainingSec);
    syncButtons();
  });

  syncButtons();
  ctrlRow.append(resetBtn, toggleBtn);
  card.appendChild(ctrlRow);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
