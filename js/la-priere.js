/* =========================================================
   SECTION « LA PRIÈRE » (CEC, SAINT THOMAS D'AQUIN & GUIDES)
   Module chargé dynamiquement à la demande (zéro surcharge accueil)
   ========================================================= */

const INDEX_URL = './data/la-priere/index.json';
const GUIDES_URL = './data/la-priere/guides.json';

let indexCache = null;
let guidesCache = null;
const textCache = new Map();

let initialized = false;
let hostCallbacks = {
  onExit: () => {},
  adjustFontSize: () => {},
  showToast: () => {}
};

// Pile de navigation interne pour retours fluides (y compris Guide -> Référence -> Guide)
let navStack = [{ screen: 'home' }];

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function createChevronSvg() {
  const span = el('span', 'chevron');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
  return span;
}

function createThemeIconSvg(themeId) {
  const icons = {
    'nature-et-necessite': '<circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path>',
    'formes-et-methodes': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
    'dispositions-et-attention': '<path d="M12 2L14.8 8.6L22 9.3L16.5 14L18.2 21L12 17.3L5.8 21L7.5 14L2 9.3L9.2 8.6L12 2Z"></path>',
    'demande-et-intercession': '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"></path>',
    'combats-et-perseverance': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
    'notre-pere': '<path d="M12 3v18"></path><path d="M7 8h10"></path>'
  };
  const path = icons[themeId] || icons['formes-et-methodes'];
  const wrap = el('span', 'lp-theme-icon');
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return wrap;
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Impossible de charger ${url} (${resp.status})`);
  }
  return resp.json();
}

async function loadIndex() {
  if (!indexCache) {
    indexCache = await fetchJson(INDEX_URL);
  }
  return indexCache;
}

async function loadGuides() {
  if (!guidesCache) {
    const payload = await fetchJson(GUIDES_URL);
    guidesCache = payload.guides || [];
  }
  return guidesCache;
}

async function loadTextDoc(textId) {
  if (textCache.has(textId)) {
    return textCache.get(textId);
  }
  const doc = await fetchJson(`./data/la-priere/texts/${encodeURIComponent(textId)}.json`);
  textCache.set(textId, doc);
  return doc;
}

function currentEntry() {
  return navStack[navStack.length - 1] || { screen: 'home' };
}

function pushScreen(entry) {
  // Sauvegarde la position de défilement de l'écran courant pour un retour fluide
  const cur = currentEntry();
  cur.scrollY = window.scrollY || 0;
  navStack.push(entry);
  renderCurrentScreen();
}

function popScreen() {
  if (navStack.length <= 1) {
    hostCallbacks.onExit();
    return;
  }
  navStack.pop();
  renderCurrentScreen({ restoreScroll: true });
}

function jumpToStackIndex(targetIdx) {
  if (targetIdx < 0) {
    hostCallbacks.onExit();
    return;
  }
  if (targetIdx >= navStack.length - 1) return;
  navStack = navStack.slice(0, targetIdx + 1);
  renderCurrentScreen({ restoreScroll: true });
}

function updateNavChrome(entry, idxData) {
  const backLabel = $('lp-back-label');
  const guidesShortcut = $('btn-lp-guides-shortcut');
  const fontControls = $('lp-font-controls');

  if (navStack.length <= 1) {
    backLabel.textContent = 'Accueil';
  } else {
    const prev = navStack[navStack.length - 2];
    if (prev.screen === 'home') {
      backLabel.textContent = 'La prière';
    } else if (prev.screen === 'theme') {
      const th = idxData?.themes?.find((t) => t.id === prev.themeId);
      backLabel.textContent = th ? th.shortTitle : 'Thème';
    } else if (prev.screen === 'guides') {
      backLabel.textContent = 'Méthodes';
    } else if (prev.screen === 'guide') {
      backLabel.textContent = 'Retour au guide';
    } else {
      backLabel.textContent = 'Retour';
    }
  }

  const isReading = entry.screen === 'text' || entry.screen === 'guide';
  const showGuidesShortcut = entry.screen !== 'guides' && entry.screen !== 'guide' && !entry.fromGuideTitle;
  if (fontControls) fontControls.classList.toggle('hidden', !isReading);
  if (guidesShortcut) guidesShortcut.classList.toggle('hidden', !showGuidesShortcut);
  const rightGroup = $('lp-nav-right-group');
  if (rightGroup) rightGroup.classList.remove('hidden');
}

function renderBreadcrumbs(entry, idxData, extraTitle) {
  const bar = $('lp-breadcrumbs');
  bar.innerHTML = '';

  if (entry.screen === 'home') {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');

  const crumbs = [];
  navStack.forEach((step, i) => {
    const isLast = i === navStack.length - 1;
    let label = 'La prière';
    if (step.screen === 'theme') {
      const th = idxData?.themes?.find((t) => t.id === step.themeId);
      label = th ? th.shortTitle : 'Thème';
    } else if (step.screen === 'guides') {
      label = 'Méthodes & Plans';
    } else if (step.screen === 'guide') {
      const g = idxData?.guides?.find((x) => x.id === step.guideId);
      label = g ? g.title : 'Guide';
    } else if (step.screen === 'text') {
      const meta = idxData?.texts?.find((x) => x.id === step.textId);
      label = extraTitle || (meta ? meta.ref : 'Texte');
    }
    crumbs.push({ label, index: i, isLast });
  });

  crumbs.forEach((c, idx) => {
    if (idx > 0) {
      const sep = el('span', 'lp-crumb-sep', '›');
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
    }
    if (c.isLast) {
      bar.appendChild(el('span', 'lp-crumb-current', c.label));
    } else {
      const btn = el('button', 'lp-crumb-btn', c.label);
      btn.type = 'button';
      btn.addEventListener('click', () => jumpToStackIndex(c.index));
      bar.appendChild(btn);
    }
  });
}

function renderLoading(container, message = 'Chargement…') {
  container.innerHTML = '';
  const box = el('div', 'ios-card lp-loading-card');
  box.appendChild(el('p', 'empty-sub', message));
  container.appendChild(box);
}

function renderError(container, err) {
  container.innerHTML = '';
  const box = el('div', 'ios-card lp-loading-card');
  box.appendChild(el('p', 'empty-title', 'Texte indisponible'));
  box.appendChild(el('p', 'empty-sub', err?.message || 'Vérifiez votre connexion puis réessayez.'));
  const retry = el('button', 'btn-outline-ios', 'Réessayer');
  retry.type = 'button';
  retry.addEventListener('click', () => renderCurrentScreen());
  box.appendChild(retry);
  container.appendChild(box);
}

/* =========================================================
   NIVEAU 1 : ACCUEIL DE « LA PRIÈRE » (MÉTHODES + 6 THÈMES)
   ========================================================= */
function renderLevel1(container, idxData) {
  container.innerHTML = '';

  // En-tête calligraphique
  const heroHeader = el('div', 'lp-header-block');
  heroHeader.appendChild(el('h1', 'prayer-cover-title', 'La prière'));
  heroHeader.appendChild(
    el(
      'p',
      'lp-intro-subtitle',
      'Catéchisme de l’Église Catholique (§§ 2558–2865), saint Thomas d’Aquin et guides pratiques pour nourrir votre vie d’oraison.'
    )
  );
  container.appendChild(heroHeader);

  // Bouton mis en avant : « Méthodes & Plans de prière »
  const methodsBtn = el('button', 'lp-methods-hero-btn');
  methodsBtn.type = 'button';
  methodsBtn.id = 'btn-lp-open-methods';

  const methodsLeft = el('div', 'lp-methods-hero-left');
  const methodsIcon = el('span', 'lp-methods-hero-icon');
  methodsIcon.setAttribute('aria-hidden', 'true');
  methodsIcon.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg>';

  const methodsText = el('div', 'lp-methods-hero-text');
  const kickerRow = el('div', 'lp-methods-kicker-row');
  kickerRow.appendChild(el('span', 'lp-methods-kicker', 'Accompagnement pratique'));
  kickerRow.appendChild(el('span', 'lp-methods-count', `${idxData.stats.totalGuides} guides`));
  methodsText.appendChild(kickerRow);
  methodsText.appendChild(el('span', 'lp-methods-title', 'Méthodes & Plans de prière'));
  methodsText.appendChild(
    el(
      'span',
      'lp-methods-sub',
      'Repères souples par durée (10 min, 20 min, 1 h) et par méthode (Lectio Divina, Adoration, Oraison, Notre Père…)'
    )
  );

  methodsLeft.appendChild(methodsIcon);
  methodsLeft.appendChild(methodsText);
  methodsBtn.appendChild(methodsLeft);
  methodsBtn.appendChild(createChevronSvg());
  methodsBtn.addEventListener('click', () => pushScreen({ screen: 'guides' }));
  container.appendChild(methodsBtn);

  // Titre de section Thématiques
  const secHead = el('div', 'lp-section-head');
  secHead.appendChild(el('h2', 'section-heading-script lp-section-title', 'Textes par thématique'));
  secHead.appendChild(
    el('span', 'lp-section-meta', `${idxData.stats.cecTexts} CEC · ${idxData.stats.thomasTexts} St Thomas`)
  );
  container.appendChild(secHead);

  // Grille des 6 thèmes (boutons Liquid Glass)
  const grid = el('div', 'lp-themes-grid');
  grid.setAttribute('role', 'list');

  idxData.themes.forEach((theme) => {
    const btn = el('button', 'lp-theme-btn');
    btn.type = 'button';
    btn.dataset.themeId = theme.id;

    const topRow = el('div', 'lp-theme-btn-top');
    topRow.appendChild(createThemeIconSvg(theme.id));
    topRow.appendChild(el('span', 'lp-theme-count-pill', `${theme.count} textes`));

    const titleEl = el('span', 'lp-theme-btn-title', theme.title);
    const subEl = el('span', 'lp-theme-btn-sub', theme.subtitle);

    const footRow = el('div', 'lp-theme-btn-foot');
    const sourcesRow = el('div', 'lp-theme-sources');
    if (theme.cecCount > 0) {
      sourcesRow.appendChild(el('span', 'lp-src-badge lp-src-cec', `CEC (${theme.cecCount})`));
    }
    if (theme.thomasCount > 0) {
      sourcesRow.appendChild(el('span', 'lp-src-badge lp-src-thomas', `St Thomas (${theme.thomasCount})`));
    }
    footRow.appendChild(sourcesRow);
    footRow.appendChild(createChevronSvg());

    btn.appendChild(topRow);
    btn.appendChild(titleEl);
    btn.appendChild(subEl);
    btn.appendChild(footRow);

    btn.addEventListener('click', () => pushScreen({ screen: 'theme', themeId: theme.id, sourceFilter: 'all' }));
    grid.appendChild(btn);
  });

  container.appendChild(grid);
}

/* =========================================================
   NIVEAU 2 : TEXTES D'UN THÈME (BOUTONS AVEC SOURCE DISCRÈTE)
   ========================================================= */
function renderLevel2Theme(container, idxData, entry) {
  const theme = idxData.themes.find((t) => t.id === entry.themeId);
  if (!theme) {
    renderError(container, new Error('Thématique introuvable.'));
    return;
  }

  const allThemeTexts = idxData.texts.filter((t) => t.themeId === theme.id);
  const filter = entry.sourceFilter || 'all';
  const filtered = filter === 'all' ? allThemeTexts : allThemeTexts.filter((t) => t.source === filter);

  container.innerHTML = '';

  const head = el('div', 'lp-header-block');
  head.appendChild(el('h1', 'prayer-cover-title', theme.title));
  head.appendChild(el('p', 'lp-intro-subtitle', theme.subtitle));
  container.appendChild(head);

  // Filtre discret par source si les deux sources sont présentes
  if (theme.cecCount > 0 && theme.thomasCount > 0) {
    const pills = el('div', 'filter-pills-scroll lp-filter-row');
    pills.setAttribute('role', 'tablist');
    pills.setAttribute('aria-label', 'Filtrer par source');
    [
      { key: 'all', label: `Tous (${allThemeTexts.length})` },
      { key: 'cec', label: `CEC (${theme.cecCount})` },
      { key: 'thomas', label: `Saint Thomas (${theme.thomasCount})` }
    ].forEach((opt) => {
      const pBtn = el('button', `pill-btn${filter === opt.key ? ' active' : ''}`, opt.label);
      pBtn.type = 'button';
      pBtn.dataset.sourceFilter = opt.key;
      pBtn.addEventListener('click', () => {
        entry.sourceFilter = opt.key;
        renderLevel2Theme(container, idxData, entry);
      });
      pills.appendChild(pBtn);
    });
    container.appendChild(pills);
  }

  const listWrap = el('div', 'lp-texts-list');
  filtered.forEach((item) => {
    const btn = el('button', 'lp-text-btn');
    btn.type = 'button';
    btn.dataset.textId = item.id;

    const mainCol = el('div', 'lp-text-btn-main');
    const metaRow = el('div', 'lp-text-meta-row');
    metaRow.appendChild(
      el('span', `lp-src-badge ${item.source === 'cec' ? 'lp-src-cec' : 'lp-src-thomas'}`, item.sourceLabel)
    );
    metaRow.appendChild(el('span', 'lp-text-ref', item.ref));

    mainCol.appendChild(metaRow);
    mainCol.appendChild(el('span', 'lp-text-btn-title', item.title));
    mainCol.appendChild(el('span', 'lp-text-btn-summary', item.summary));

    btn.appendChild(mainCol);
    btn.appendChild(createChevronSvg());
    btn.addEventListener('click', () => pushScreen({ screen: 'text', textId: item.id }));
    listWrap.appendChild(btn);
  });

  container.appendChild(listWrap);
}

/* =========================================================
   VUE LECTURE D'UN TEXTE INTÉGRAL (CEC OU SAINT THOMAS)
   ========================================================= */
async function renderTextReader(container, idxData, entry) {
  renderLoading(container, 'Ouverture du texte…');
  try {
    const doc = await loadTextDoc(entry.textId);
    renderBreadcrumbs(entry, idxData, doc.ref);
    container.innerHTML = '';

    // Bannière contextuelle si ouvert depuis un guide de prière
    if (entry.fromGuideTitle) {
      const retBar = el('button', 'lp-return-guide-bar');
      retBar.type = 'button';
      retBar.id = 'btn-lp-return-guide-top';
      retBar.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
      retBar.appendChild(el('span', '', `Revenir au guide : ${entry.fromGuideTitle}`));
      retBar.addEventListener('click', popScreen);
      container.appendChild(retBar);
    }

    const sheet = el('article', 'prayer-sheet lp-reader-sheet');

    // Métadonnées en tête
    const topMeta = el('div', 'lp-reader-meta-row');
    topMeta.appendChild(
      el('span', `lp-src-badge ${doc.source === 'cec' ? 'lp-src-cec' : 'lp-src-thomas'}`, doc.sourceLabel)
    );
    topMeta.appendChild(el('span', 'lp-reader-ref-pill', doc.ref));
    sheet.appendChild(topMeta);

    sheet.appendChild(el('p', 'lp-reader-work', doc.work));
    if (doc.latinRef) {
      sheet.appendChild(el('p', 'lp-reader-latin-ref', doc.latinRef));
    }

    sheet.appendChild(el('h1', 'prayer-cover-title lp-reader-title', doc.title));

    // Corps du texte (blocs structurés sécurisés)
    const body = el('div', 'prayer-body lp-reader-body');
    const normTitle = (s) => String(s || '')
      .replace(/^(?:I|II|III|IV|V|VI|VII)\.\s*/i, '')
      .replace(/[«»"“”']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const docNormTitle = normTitle(doc.title);

    (doc.blocks || []).forEach((blk, blkIdx) => {
      if (blkIdx === 0 && blk.type === 'heading' && normTitle(blk.text) === docNormTitle) {
        return;
      }
      if (blk.type === 'heading') {
        const h = el('h2', 'lp-doc-heading');
        h.appendChild(el('span', '', blk.text));
        body.appendChild(h);
      } else if (blk.type === 'section') {
        body.appendChild(el('div', 'lp-scholastic-section', blk.label));
      } else if (blk.type === 'conclusion') {
        const box = el('div', 'lp-conclusion-box');
        box.appendChild(el('span', 'lp-conclusion-label', 'Conclusion'));
        box.appendChild(el('p', '', blk.text));
        body.appendChild(box);
      } else if (blk.type === 'item') {
        const wrap = el('div', 'lp-scholastic-item');
        wrap.appendChild(el('strong', 'lp-scholastic-item-label', `${blk.label} — `));
        wrap.appendChild(document.createTextNode(blk.text));
        body.appendChild(wrap);
      } else if (blk.num) {
        const p = el('p', 'lp-cec-paragraph');
        p.appendChild(el('span', 'lp-cec-num', `§ ${blk.num}`));
        p.appendChild(document.createTextNode(` ${blk.text}`));
        body.appendChild(p);
      } else {
        body.appendChild(el('p', '', blk.text));
      }
    });
    sheet.appendChild(body);

    // Note de source & traduction en pied d'article
    const foot = el('footer', 'lp-reader-provenance');
    foot.appendChild(el('p', 'lp-provenance-note', doc.translationNote));
    if (doc.sourceUrl) {
      const link = el('a', 'lp-provenance-link', `Consulter la source de référence (${new URL(doc.sourceUrl).hostname})`);
      link.href = doc.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      foot.appendChild(link);
    }
    sheet.appendChild(foot);

    container.appendChild(sheet);

    // Bouton retour fluide en bas de lecture
    const bottomBack = el('button', 'btn-outline-ios lp-bottom-back-btn');
    bottomBack.type = 'button';
    bottomBack.id = 'btn-lp-reader-bottom-back';
    bottomBack.textContent = entry.fromGuideTitle
      ? `← Retour au guide : ${entry.fromGuideTitle}`
      : '← Retour à la liste';
    bottomBack.addEventListener('click', popScreen);
    container.appendChild(bottomBack);
  } catch (err) {
    renderError(container, err);
  }
}

/* =========================================================
   CATALOGUE « MÉTHODES & PLANS DE PRIÈRE »
   ========================================================= */
async function renderGuidesCatalog(container, idxData) {
  container.innerHTML = '';

  const head = el('div', 'lp-header-block');
  head.appendChild(el('h1', 'prayer-cover-title', 'Méthodes & Plans de prière'));
  head.appendChild(
    el(
      'p',
      'lp-intro-subtitle',
      'Des repères concrets et un cadre souple, puisés dans le CEC et saint Thomas d’Aquin, pour prier de façon plus recueillie — jamais une liste mécanique.'
    )
  );
  container.appendChild(head);

  const guides = idxData.guides || [];
  const byDuration = guides.filter((g) => g.category === 'duree');
  const byMethod = guides.filter((g) => g.category === 'methode');

  const renderGroup = (heading, subtitle, items, accentClass) => {
    const secHead = el('div', 'lp-section-head');
    secHead.appendChild(el('h2', 'section-heading-script lp-section-title', heading));
    secHead.appendChild(el('span', 'lp-section-meta', subtitle));
    container.appendChild(secHead);

    const wrap = el('div', 'lp-guides-grid');
    items.forEach((g) => {
      const btn = el('button', `lp-guide-card-btn ${accentClass}`);
      btn.type = 'button';
      btn.dataset.guideId = g.id;

      const top = el('div', 'lp-guide-card-top');
      top.appendChild(el('span', 'lp-duration-pill', g.durationBadge));
      top.appendChild(el('span', 'lp-ref-count-pill', `${g.refCount} sources`));

      btn.appendChild(top);
      btn.appendChild(el('span', 'lp-guide-card-title', g.title));
      btn.appendChild(el('span', 'lp-guide-card-sub', g.subtitle));

      const foot = el('div', 'lp-guide-card-foot');
      foot.appendChild(el('span', 'lp-guide-open-hint', 'Ouvrir le guide'));
      foot.appendChild(createChevronSvg());
      btn.appendChild(foot);

      btn.addEventListener('click', () => pushScreen({ screen: 'guide', guideId: g.id }));
      wrap.appendChild(btn);
    });
    container.appendChild(wrap);
  };

  renderGroup('Plans par durée', 'Choisir selon le temps disponible', byDuration, 'lp-guide-duration');
  renderGroup('Formes et méthodes de prière', 'Selon la grâce et le moment', byMethod, 'lp-guide-method');
}

/* =========================================================
   VUE DÉTAILLÉE D'UN GUIDE DE PRIÈRE + SOURCES CLIQUABLES
   ========================================================= */
async function renderGuideDetail(container, idxData, entry) {
  renderLoading(container, 'Ouverture du guide de prière…');
  try {
    const guides = await loadGuides();
    const guide = guides.find((g) => g.id === entry.guideId);
    if (!guide) {
      renderError(container, new Error('Guide introuvable.'));
      return;
    }

    container.innerHTML = '';

    const sheet = el('article', 'prayer-sheet lp-guide-sheet');

    // En-tête du guide
    const pillsRow = el('div', 'lp-reader-meta-row');
    pillsRow.appendChild(el('span', 'lp-duration-pill', guide.durationBadge));
    pillsRow.appendChild(el('span', 'lp-reader-ref-pill', guide.categoryLabel));
    sheet.appendChild(pillsRow);

    sheet.appendChild(el('h1', 'prayer-cover-title lp-reader-title', guide.title));
    sheet.appendChild(el('p', 'lp-guide-lead', guide.subtitle));

    // But et esprit
    const purposeSec = el('section', 'lp-guide-section');
    purposeSec.appendChild(el('h2', 'lp-guide-h2', 'Esprit et finalité'));
    const purposeBody = el('div', 'prayer-body');
    purposeBody.appendChild(el('p', '', guide.purpose));
    purposeSec.appendChild(purposeBody);
    sheet.appendChild(purposeSec);

    // Dispositions de départ
    const dispSec = el('section', 'lp-guide-section lp-dispositions-box');
    dispSec.appendChild(el('h2', 'lp-guide-h2', 'Dispositions de départ'));
    const ul = el('ul', 'lp-dispositions-list');
    (guide.dispositions || []).forEach((d) => {
      ul.appendChild(el('li', '', d));
    });
    dispSec.appendChild(ul);
    sheet.appendChild(dispSec);

    // Progression par étapes
    const stepsSec = el('section', 'lp-guide-section');
    stepsSec.appendChild(el('h2', 'lp-guide-h2', 'Progression proposée (repères indicatifs)'));
    const stepsWrap = el('div', 'lp-steps-list');
    (guide.steps || []).forEach((st, idx) => {
      const card = el('div', 'lp-step-card');
      const head = el('div', 'lp-step-head');
      const numBadge = el('span', 'lp-step-num', String(idx + 1));
      const titleBox = el('div', 'lp-step-title-wrap');
      titleBox.appendChild(el('h3', 'lp-step-title', st.title));
      head.appendChild(numBadge);
      head.appendChild(titleBox);
      if (st.timeCue) {
        head.appendChild(el('span', 'lp-step-time', st.timeCue));
      }
      card.appendChild(head);

      const gBody = el('div', 'prayer-body lp-step-body');
      gBody.appendChild(el('p', '', st.guidance));
      card.appendChild(gBody);

      if (st.tip) {
        const tip = el('p', 'lp-step-tip', `Repère concret : ${st.tip}`);
        card.appendChild(tip);
      }
      stepsWrap.appendChild(card);
    });
    stepsSec.appendChild(stepsWrap);
    sheet.appendChild(stepsSec);

    // Distractions & sécheresse
    const distSec = el('section', 'lp-guide-section lp-distractions-box');
    distSec.appendChild(el('h2', 'lp-guide-h2', 'En cas de distractions ou de sécheresse'));
    const distBody = el('div', 'prayer-body');
    distBody.appendChild(el('p', '', guide.distractionsAdvice));
    distSec.appendChild(distBody);
    sheet.appendChild(distSec);

    // Transition vers la fin
    const closeSec = el('section', 'lp-guide-section');
    closeSec.appendChild(el('h2', 'lp-guide-h2', 'Clôture et passage à la vie quotidienne'));
    const closeBody = el('div', 'prayer-body');
    closeBody.appendChild(el('p', '', guide.closing));
    closeSec.appendChild(closeBody);
    sheet.appendChild(closeSec);

    // OBLIGATOIRE : Sources et références cliquables vers les textes du site
    const refsSec = el('section', 'lp-guide-section lp-references-section');
    refsSec.id = 'lp-guide-references';
    refsSec.appendChild(el('h2', 'lp-guide-h2', 'Sources et références'));
    refsSec.appendChild(
      el(
        'p',
        'lp-references-intro',
        'Touchez une référence pour lire directement le texte intégral correspondant sur le site, puis revenir ici en un geste.'
      )
    );

    const refsList = el('div', 'lp-references-list');
    (guide.references || []).forEach((ref) => {
      const targetMeta = idxData.texts.find((t) => t.id === ref.id);
      const isCec = targetMeta ? targetMeta.source === 'cec' : ref.id.startsWith('cec-');

      const refBtn = el('button', 'lp-reference-btn');
      refBtn.type = 'button';
      refBtn.dataset.refTextId = ref.id;

      const left = el('div', 'lp-reference-left');
      left.appendChild(el('span', `lp-src-badge ${isCec ? 'lp-src-cec' : 'lp-src-thomas'}`, isCec ? 'CEC' : 'Saint Thomas'));
      left.appendChild(el('span', 'lp-reference-label', ref.label));
      if (ref.detail) {
        left.appendChild(el('span', 'lp-reference-detail', ref.detail));
      }

      refBtn.appendChild(left);
      refBtn.appendChild(createChevronSvg());
      refBtn.addEventListener('click', () => {
        pushScreen({
          screen: 'text',
          textId: ref.id,
          fromGuideId: guide.id,
          fromGuideTitle: guide.title
        });
      });
      refsList.appendChild(refBtn);
    });
    refsSec.appendChild(refsList);
    sheet.appendChild(refsSec);

    container.appendChild(sheet);
  } catch (err) {
    renderError(container, err);
  }
}

/* =========================================================
   DISPATCHER & POINT D'ENTRÉE PUBLIC
   ========================================================= */
async function renderCurrentScreen({ restoreScroll = false } = {}) {
  const container = $('lp-content');
  const entry = currentEntry();

  try {
    const idxData = await loadIndex();
    updateNavChrome(entry, idxData);
    renderBreadcrumbs(entry, idxData);

    if (entry.screen === 'home') {
      renderLevel1(container, idxData);
    } else if (entry.screen === 'theme') {
      renderLevel2Theme(container, idxData, entry);
    } else if (entry.screen === 'text') {
      await renderTextReader(container, idxData, entry);
    } else if (entry.screen === 'guides') {
      await renderGuidesCatalog(container, idxData);
    } else if (entry.screen === 'guide') {
      await renderGuideDetail(container, idxData, entry);
    }

    if (restoreScroll && typeof entry.scrollY === 'number') {
      requestAnimationFrame(() => window.scrollTo({ top: entry.scrollY, behavior: 'instant' }));
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  } catch (err) {
    updateNavChrome(entry, null);
    renderError(container, err);
  }
}

function bindEventsOnce() {
  if (initialized) return;
  initialized = true;

  $('btn-lp-back').addEventListener('click', popScreen);
  $('btn-lp-guides-shortcut').addEventListener('click', () => {
    const cur = currentEntry();
    if (cur.screen !== 'guides') {
      pushScreen({ screen: 'guides' });
    }
  });
  $('btn-lp-font-smaller').addEventListener('click', () => hostCallbacks.adjustFontSize(-1));
  $('btn-lp-font-larger').addEventListener('click', () => hostCallbacks.adjustFontSize(1));
}

export async function openLaPriere(callbacks = {}) {
  const { initialTextId, ...rest } = callbacks;
  hostCallbacks = { ...hostCallbacks, ...rest };
  bindEventsOnce();
  navStack = initialTextId
    ? [{ screen: 'home' }, { screen: 'text', textId: initialTextId }]
    : [{ screen: 'home' }];
  await renderCurrentScreen();
}
