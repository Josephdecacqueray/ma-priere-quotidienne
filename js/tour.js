/* =========================================================
   VISITE GUIDÉE DE PREMIÈRE VISITE (LIQUID GLASS)
   - Chargée dynamiquement uniquement à la première visite ou sur demande
   - 5 étapes sereines, claires, 100 % DOM pur (zéro innerHTML utilisateur)
   ========================================================= */

const TOUR_SEEN_KEY = 'mpq_tour_seen_v1';

const STEPS = [
  {
    kicker: 'Bienvenue',
    title: 'Votre carnet de prière, libre et hors connexion',
    body: 'Ma prière quotidienne démarre entièrement vierge pour accueillir vos prières, vos intentions et vos neuvaines. Tout fonctionne même en mode avion, sur téléphone comme sur ordinateur.',
    tip: 'Vous pouvez l’utiliser immédiatement sans compte, ou créer un compte gratuit à tout moment.',
    iconShapes: [
      ['path', { d: 'M3 10.5L12 3l9 7.5' }],
      ['path', { d: 'M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5' }]
    ],
    accent: 'gold'
  },
  {
    kicker: 'Carnet & bouton +',
    title: 'Notes, PDF et photos de vos prières',
    body: 'Touchez le bouton doré « + » en bas à droite pour écrire une prière (avec titres automatiques I., 1), a)), importer un PDF ou photographier une carte. L’onglet Carnet vous permet de tout filtrer et rechercher par mot-clé.',
    tip: 'Astuce : glissez une prière vers la gauche dans la liste pour l’épingler en haut.',
    iconShapes: [
      ['path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }],
      ['path', { d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }]
    ],
    accent: 'gold'
  },
  {
    kicker: 'Neuvaines & Intentions',
    title: 'Suivez vos neuvaines et confiez vos intentions',
    body: 'Dans l’onglet Neuvaines, créez un parcours (3, 7, 9, 30 ou 54 jours) lié à une prière avec rappel quotidien. Votre carnet « Mes intentions » reste aussi accessible d’un geste en pleine lecture.',
    tip: 'Le mode Recueillement et le minuteur d’oraison vous aident à prier sans distraction.',
    iconShapes: [
      ['path', { d: 'M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z' }]
    ],
    accent: 'red'
  },
  {
    kicker: 'Chapelet & La prière',
    title: '20 mystères, Catéchisme et saint Thomas d’Aquin',
    body: 'L’onglet Chapelet propose les 20 mystères (dont les lumineux) avec un compteur grain par grain. La section « La prière » rassemble 66 textes du Catéchisme et de saint Thomas + 10 guides pratiques.',
    tip: 'Tous ces textes se préparent automatiquement pour rester lisibles en mode avion.',
    iconShapes: [
      ['path', { d: 'M12 3v18' }],
      ['path', { d: 'M7 8h10' }]
    ],
    accent: 'green'
  },
  {
    kicker: 'Compte & Sauvegarde',
    title: 'Retrouvez votre carnet sur tous vos appareils',
    body: 'Touchez la pilule en haut à gauche pour créer un compte gratuit en 10 secondes (une adresse e-mail et un mot de passe suffisent). Votre session reste ouverte 180 jours sans reconnexion.',
    tip: 'Vous pouvez revoir cette visite à tout moment depuis le bouton (i) en haut à droite.',
    iconShapes: [
      ['path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '12', cy: '7', r: '4' }]
    ],
    accent: 'gold'
  }
];

let currentStep = 0;

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function buildStepSvg(shapes) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '28');
  svg.setAttribute('height', '28');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      node.setAttribute(k, v);
    }
    svg.appendChild(node);
  }
  return svg;
}

export function hasSeenTour() {
  try {
    return localStorage.getItem(TOUR_SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
  } catch {
    // Ignoré
  }
}

function renderStep(overlay, onClose) {
  const step = STEPS[currentStep];
  const card = overlay.querySelector('.tour-card');
  if (!card) return;
  card.replaceChildren();

  const topBar = el('div', 'tour-top-bar');
  topBar.appendChild(el('span', 'tour-step-counter', `Étape ${currentStep + 1} / ${STEPS.length}`));
  const skipBtn = el('button', 'tour-skip-btn', 'Passer');
  skipBtn.id = 'btn-tour-skip';
  skipBtn.type = 'button';
  skipBtn.addEventListener('click', () => {
    markTourSeen();
    onClose();
  });
  topBar.appendChild(skipBtn);
  card.appendChild(topBar);

  const iconWrap = el('div', `tour-icon-orb tour-orb-${step.accent}`);
  iconWrap.setAttribute('aria-hidden', 'true');
  iconWrap.appendChild(buildStepSvg(step.iconShapes));
  card.appendChild(iconWrap);

  card.appendChild(el('span', 'tour-kicker', step.kicker));
  card.appendChild(el('h2', 'tour-title', step.title));
  card.appendChild(el('p', 'tour-body', step.body));
  card.appendChild(el('p', 'tour-tip', step.tip));

  // Indicateurs de progression
  const dots = el('div', 'tour-dots');
  dots.setAttribute('aria-hidden', 'true');
  STEPS.forEach((_, i) => {
    dots.appendChild(el('span', `tour-dot${i === currentStep ? ' active' : ''}`));
  });
  card.appendChild(dots);

  const actions = el('div', 'tour-actions');
  if (currentStep > 0) {
    const prevBtn = el('button', 'btn-outline-ios tour-btn-prev', 'Précédent');
    prevBtn.id = 'btn-tour-prev';
    prevBtn.type = 'button';
    prevBtn.addEventListener('click', () => {
      currentStep -= 1;
      renderStep(overlay, onClose);
    });
    actions.appendChild(prevBtn);
  }

  const isLast = currentStep === STEPS.length - 1;
  const nextBtn = el('button', 'btn-primary-ios tour-btn-next', isLast ? 'Commencer' : 'Suivant');
  nextBtn.id = 'btn-tour-next';
  nextBtn.type = 'button';
  nextBtn.addEventListener('click', () => {
    if (isLast) {
      markTourSeen();
      onClose();
    } else {
      currentStep += 1;
      renderStep(overlay, onClose);
    }
  });
  actions.appendChild(nextBtn);
  card.appendChild(actions);
}

export function openGuidedTour({ onFinish } = {}) {
  const existing = document.getElementById('guided-tour-overlay');
  if (existing) existing.remove();

  currentStep = 0;
  const overlay = el('div', 'tour-overlay');
  overlay.id = 'guided-tour-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Visite guidée de Ma prière quotidienne');

  const card = el('div', 'tour-card');
  overlay.appendChild(card);

  const close = () => {
    overlay.remove();
    onFinish?.();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      markTourSeen();
      close();
    }
  });

  renderStep(overlay, close);
  document.body.appendChild(overlay);
}
