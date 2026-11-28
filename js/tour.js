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
    body: 'Votre carnet, vos intentions et vos neuvaines démarrent entièrement vierges. Touchez le bouton « + » pour écrire une prière, importer un PDF, prendre une photo ou piocher dans la bibliothèque classique.',
    tip: 'Tout fonctionne même en mode avion, sur téléphone comme sur ordinateur.',
    portrait: './img/vierge-en-priere.webp',
    accent: 'gold'
  },
  {
    kicker: 'Messe, Chapelet & Formation',
    title: 'Missel 1962, Chapelet, Catéchisme & saint Thomas',
    body: 'Retrouvez chaque jour les lectures complètes du calendrier extraordinaire (de l’Introït à la Postcommunion, en français et latin), les 20 mystères du Chapelet et 66 textes + 10 guides sur la prière.',
    tip: 'La loupe en haut recherche à la fois dans votre carnet, vos intentions, le chapelet et les textes du CEC.',
    iconShapes: [
      ['path', { d: 'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' }],
      ['path', { d: 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' }]
    ],
    accent: 'green'
  },
  {
    kicker: 'Compte & Sérénité',
    title: 'Retrouvez vos prières sur tous vos appareils',
    body: 'Utilisez l’application immédiatement sans compte, ou créez un compte gratuit en 10 secondes (pilule en haut à gauche) : votre session reste ouverte 180 jours sans reconnexion.',
    tip: 'Vous pouvez revoir cette visite à tout moment depuis le bouton (i) en haut à droite.',
    iconShapes: [
      ['path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }],
      ['circle', { cx: '12', cy: '7', r: '4' }]
    ],
    accent: 'red'
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

  if (step.portrait) {
    const cameo = el('div', 'tour-portrait-cameo');
    const img = document.createElement('img');
    img.src = step.portrait;
    img.alt = 'La Vierge en prière';
    img.width = 76;
    img.height = 76;
    cameo.appendChild(img);
    card.appendChild(cameo);
  } else {
    const iconWrap = el('div', `tour-icon-orb tour-orb-${step.accent}`);
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.appendChild(buildStepSvg(step.iconShapes));
    card.appendChild(iconWrap);
  }

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
