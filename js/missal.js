/* =========================================================
   LECTURES DU JOUR — MISSEL ROMAIN 1962 (FORME EXTRAORDINAIRE)
   - De l’Introït à la Postcommunion (+ Commémorations, Préface, Séquence)
   - Bilingue Français / Latin (sources MIT Divinum Officium & Missale Meum)
   - Chargement 100 % paresseux (0 octet au boot) + préchargement 7 jours hors-ligne
   - 100 % DOM pur (zéro innerHTML)
   ========================================================= */

const LANG_MODE_KEY = 'mpq_missal_lang_mode';
const CALENDAR_CACHE = new Map();
const PROPER_CACHE = new Map();

const COLOR_META = {
  w: { label: 'Blanc', css: 'missal-color-white' },
  r: { label: 'Rouge', css: 'missal-color-red' },
  g: { label: 'Vert', css: 'missal-color-green' },
  v: { label: 'Violet', css: 'missal-color-violet' },
  b: { label: 'Noir', css: 'missal-color-black' },
  p: { label: 'Rose', css: 'missal-color-rose' }
};

const RANK_LABELS = {
  1: '1re classe',
  2: '2e classe',
  3: '3e classe',
  4: '4e classe'
};

let initialized = false;
let currentDateIso = '';
let currentMassIndex = 0;
let langMode = 'fr'; // 'fr' | 'bi' | 'la'
let hostCallbacks = {
  onExit: () => {},
  adjustFontSize: () => {},
  openTimer: () => {},
  showToast: () => {}
};

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function toIsoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftIsoDate(iso, deltaDays) {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + deltaDays);
  return toIsoDate(d);
}

function formatLongFrDate(iso) {
  try {
    const d = parseIsoDate(iso);
    const str = d.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
    return str.charAt(0).toUpperCase() + str.slice(1);
  } catch {
    return iso;
  }
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function loadYearCalendar(year) {
  const y = Number(year);
  if (CALENDAR_CACHE.has(y)) return CALENDAR_CACHE.get(y);
  const data = await fetchJson(`./data/missel-1962/cal/${y}.json`);
  CALENDAR_CACHE.set(y, data);
  return data;
}

async function loadProper(slug) {
  if (PROPER_CACHE.has(slug)) return PROPER_CACHE.get(slug);
  const data = await fetchJson(`./data/missel-1962/propers/${encodeURIComponent(slug)}.json`);
  PROPER_CACHE.set(slug, data);
  return data;
}

/**
 * Retourne un léger résumé de la fête 1962 du jour (pour la carte Accueil),
 * sans bloquer le démarrage.
 */
export async function getTodayMissalSummary(dateObj = new Date()) {
  const iso = toIsoDate(dateObj);
  const year = dateObj.getFullYear();
  if (year < 2025 || year > 2035) return null;
  try {
    const cal = await loadYearCalendar(year);
    const entry = cal[iso];
    if (!entry) return null;
    return {
      iso,
      title: entry.t || '',
      rank: entry.r || 4,
      color: entry.c || 'g'
    };
  } catch {
    return null;
  }
}

function renderFormattedLiturgicalText(parent, rawText) {
  const lines = String(rawText || '').split('\n');
  let curPara = null;

  const flushPara = () => {
    if (curPara && curPara.childNodes.length > 0) {
      parent.appendChild(curPara);
    }
    curPara = null;
  };

  for (const raw of lines) {
    const ln = raw.trim();
    if (!ln) {
      flushPara();
      continue;
    }

    // Référence biblique / rubrique entre crochets [Ps 24:1-3] ou [Saint André]
    if (ln.startsWith('[') && ln.endsWith(']') && ln.length <= 120) {
      flushPara();
      parent.appendChild(el('div', 'missal-ref-line', ln.slice(1, -1)));
      continue;
    }

    // Incipit d'Épître / Évangile
    if (/^(Lecture de |Suite du saint Évangile|Commencement du saint Évangile|L[eé]ctio |Sequ[eé]ntia |In[ií]tium )/i.test(ln)) {
      flushPara();
      parent.appendChild(el('p', 'missal-incipit', ln));
      continue;
    }

    // Verset / Répons (℣. / ℟.)
    if (ln.startsWith('℣.') || ln.startsWith('℟.')) {
      flushPara();
      const p = el('p', 'missal-versicle');
      const sig = el('span', 'missal-rubric-sig', `${ln.slice(0, 2)} `);
      p.append(sig, document.createTextNode(ln.slice(2).trim()));
      parent.appendChild(p);
      continue;
    }

    if (!curPara) {
      curPara = el('p', 'missal-para');
    } else {
      curPara.appendChild(document.createTextNode(' '));
    }
    curPara.appendChild(document.createTextNode(ln));
  }
  flushPara();
}

function prefetchUpcomingWeek(baseIso) {
  if (!navigator.onLine) return;
  setTimeout(async () => {
    try {
      for (let offset = 1; offset <= 7; offset += 1) {
        const nextIso = shiftIsoDate(baseIso, offset);
        const y = Number(nextIso.slice(0, 4));
        if (y < 2025 || y > 2035) continue;
        const cal = await loadYearCalendar(y);
        const e = cal[nextIso];
        if (e?.m?.[0]?.p) {
          await loadProper(e.m[0].p).catch(() => {});
        }
      }
    } catch {
      // Silencieux si hors connexion
    }
  }, 1500);
}

async function renderMissalScreen() {
  const container = $('missal-content');
  if (!container) return;

  const dateInput = $('missal-date-picker');
  if (dateInput) dateInput.value = currentDateIso;

  const todayIso = toIsoDate(new Date());
  const todayBtn = $('btn-missal-today');
  if (todayBtn) todayBtn.classList.toggle('active', currentDateIso === todayIso);

  document.querySelectorAll('.missal-lang-btn').forEach((b) => {
    const active = b.dataset.missalLang === langMode;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });

  container.replaceChildren(
    (() => {
      const box = el('div', 'ios-card lp-loading-card');
      box.appendChild(el('p', 'empty-sub', 'Ouverture du Missel 1962…'));
      return box;
    })()
  );

  const year = Number(currentDateIso.slice(0, 4));
  if (year < 2025 || year > 2035) {
    const box = el('div', 'ios-card lp-loading-card');
    box.appendChild(el('p', 'empty-title', 'Année hors période couverte'));
    box.appendChild(el('p', 'empty-sub', 'Le calendrier extraordinaire hors connexion couvre actuellement les années 2025 à 2035.'));
    container.replaceChildren(box);
    return;
  }

  try {
    const cal = await loadYearCalendar(year);
    const entry = cal[currentDateIso];
    if (!entry || !entry.m || entry.m.length === 0) {
      throw new Error('Aucun propre trouvé pour cette date.');
    }

    if (currentMassIndex >= entry.m.length) currentMassIndex = 0;
    const activeMass = entry.m[currentMassIndex];
    const proper = await loadProper(activeMass.p);

    const frag = document.createDocumentFragment();

    // En-tête liturgique de la fête du jour
    const headCard = el('article', 'prayer-sheet missal-header-sheet');
    const metaRow = el('div', 'missal-meta-row');
    metaRow.appendChild(el('span', 'missal-date-pill', formatLongFrDate(currentDateIso)));

    const badges = el('div', 'missal-badges-row');
    const colInfo = COLOR_META[entry.c] || COLOR_META.g;
    const colPill = el('span', `missal-color-pill ${colInfo.css}`);
    colPill.appendChild(el('span', 'missal-color-dot'));
    colPill.appendChild(document.createTextNode(colInfo.label));
    badges.appendChild(colPill);
    badges.appendChild(el('span', 'missal-rank-pill', RANK_LABELS[entry.r] || 'Férie'));
    metaRow.appendChild(badges);
    headCard.appendChild(metaRow);

    headCard.appendChild(el('h1', 'prayer-cover-title missal-feast-title', entry.t || 'Messe du jour'));
    if (entry.tl && entry.tl !== entry.t) {
      headCard.appendChild(el('p', 'missal-latin-title', entry.tl));
    }

    if (entry.cm && entry.cm.length > 0) {
      headCard.appendChild(
        el('p', 'missal-comm-line', `Commémoration : ${entry.cm.join(' · ')}`)
      );
    }

    // Sélecteur multi-messes (Noël : 3 messes, Défunts : 3 messes)
    if (entry.m.length > 1) {
      const mTabs = el('div', 'segmented-control missal-masses-tabs');
      const christmasLabels = ['Minuit', 'Aurore', 'Jour'];
      const isChristmas = currentDateIso.endsWith('-12-25') && entry.m.length === 3;
      entry.m.forEach((mObj, idx) => {
        const label = mObj.t || `Messe ${idx + 1}`;
        const shortLabel = isChristmas
          ? christmasLabels[idx]
          : (label.length > 20 ? `${idx + 1}${idx === 0 ? 're' : 'e'} messe` : label);
        const b = el('button', `segment-btn${idx === currentMassIndex ? ' active' : ''}`, shortLabel);
        b.type = 'button';
        b.title = label;
        b.addEventListener('click', () => {
          currentMassIndex = idx;
          renderMissalScreen();
        });
        mTabs.appendChild(b);
      });
      headCard.appendChild(mTabs);
    }

    // Sommaire rapide des parties (Introït -> Postcommunion)
    const navStrip = el('div', 'missal-jump-strip');
    for (const sec of proper.sections || []) {
      const chip = el('button', 'missal-jump-chip', sec.label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        const target = document.getElementById(`missal-sec-${sec.id}`);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      navStrip.appendChild(chip);
    }
    headCard.appendChild(navStrip);
    frag.appendChild(headCard);

    // Corps liturgique complet : de l'Introït à la Postcommunion
    const bodySheet = el('article', 'prayer-sheet missal-body-sheet');
    for (const sec of proper.sections || []) {
      const secBox = el('section', 'missal-section');
      secBox.id = `missal-sec-${sec.id}`;

      const h2 = el('h2', 'missal-section-title');
      h2.appendChild(el('span', '', sec.label));
      secBox.appendChild(h2);

      if (langMode === 'bi') {
        const grid = el('div', 'missal-bilingual-grid');
        const colFr = el('div', 'missal-lang-col');
        colFr.appendChild(el('span', 'missal-col-tag', 'Français'));
        renderFormattedLiturgicalText(colFr, sec.fr || sec.la);

        const colLa = el('div', 'missal-lang-col missal-col-latin');
        colLa.appendChild(el('span', 'missal-col-tag', 'Latin'));
        renderFormattedLiturgicalText(colLa, sec.la || sec.fr);

        grid.append(colFr, colLa);
        secBox.appendChild(grid);
      } else if (langMode === 'la') {
        const col = el('div', 'missal-body-text missal-col-latin');
        renderFormattedLiturgicalText(col, sec.la || sec.fr);
        secBox.appendChild(col);
      } else {
        const col = el('div', 'missal-body-text');
        renderFormattedLiturgicalText(col, sec.fr || sec.la);
        secBox.appendChild(col);
      }

      bodySheet.appendChild(secBox);
    }

    const credit = el(
      'p',
      'missal-source-credit',
      'Missel romain 1962 (Forme extraordinaire · Rubriques 1960) — Textes bilingues issus de Divinum Officium & Missale Meum (licence MIT), disponibles hors connexion.'
    );
    bodySheet.appendChild(credit);
    frag.appendChild(bodySheet);

    container.replaceChildren(frag);
    window.scrollTo({ top: 0, behavior: 'instant' });
    prefetchUpcomingWeek(currentDateIso);
  } catch (err) {
    const box = el('div', 'ios-card lp-loading-card');
    box.appendChild(el('p', 'empty-title', 'Lectures indisponibles hors connexion'));
    box.appendChild(
      el('p', 'empty-sub', 'Ouvrez cette journée une première fois avec Internet pour la conserver en mode avion.')
    );
    const retry = el('button', 'btn-outline-ios', 'Réessayer');
    retry.type = 'button';
    retry.addEventListener('click', () => renderMissalScreen());
    box.appendChild(retry);
    container.replaceChildren(box);
  }
}

function bindEventsOnce() {
  if (initialized) return;
  initialized = true;

  try {
    const saved = localStorage.getItem(LANG_MODE_KEY);
    if (saved === 'fr' || saved === 'bi' || saved === 'la') langMode = saved;
  } catch {
    // Ignoré
  }

  $('btn-missal-back')?.addEventListener('click', () => hostCallbacks.onExit());
  $('btn-missal-prev-day')?.addEventListener('click', () => {
    currentDateIso = shiftIsoDate(currentDateIso, -1);
    currentMassIndex = 0;
    renderMissalScreen();
  });
  $('btn-missal-next-day')?.addEventListener('click', () => {
    currentDateIso = shiftIsoDate(currentDateIso, 1);
    currentMassIndex = 0;
    renderMissalScreen();
  });
  $('btn-missal-today')?.addEventListener('click', () => {
    currentDateIso = toIsoDate(new Date());
    currentMassIndex = 0;
    renderMissalScreen();
  });
  $('missal-date-picker')?.addEventListener('change', (e) => {
    const val = e.currentTarget.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
      currentDateIso = val;
      currentMassIndex = 0;
      renderMissalScreen();
    }
  });
  $('btn-missal-font-smaller')?.addEventListener('click', () => hostCallbacks.adjustFontSize(-1));
  $('btn-missal-font-larger')?.addEventListener('click', () => hostCallbacks.adjustFontSize(1));
  $('btn-missal-timer')?.addEventListener('click', () => hostCallbacks.openTimer());

  document.querySelectorAll('.missal-lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.missalLang;
      if (m === 'fr' || m === 'bi' || m === 'la') {
        langMode = m;
        try { localStorage.setItem(LANG_MODE_KEY, m); } catch { /* ignoré */ }
        renderMissalScreen();
      }
    });
  });
}

export async function openMissalView(callbacks = {}) {
  const { initialDateIso, ...rest } = callbacks;
  hostCallbacks = { ...hostCallbacks, ...rest };
  bindEventsOnce();
  currentDateIso = initialDateIso || toIsoDate(new Date());
  currentMassIndex = 0;
  await renderMissalScreen();
}
