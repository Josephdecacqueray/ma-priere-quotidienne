/**
 * Convertit un entier positif en chiffres romains majuscules.
 */
export function toRoman(num) {
  const n = Math.max(1, Math.floor(Number(num) || 1));
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ];
  let rem = n;
  let out = '';
  for (const [val, sym] of table) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return out;
}

/**
 * Convertit un entier positif en lettres minuscules (1 -> a, 26 -> z, 27 -> aa).
 */
export function toLetter(num) {
  let n = Math.max(1, Math.floor(Number(num) || 1));
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

/**
 * Rendu DOM 100 % sûr (zéro innerHTML) du texte d'une prière :
 * - `# Titre` -> Titre niveau 1 (I., II., ...), souligné rouge, alinéa 1
 * - `## Sous-titre` -> Niveau 2 (1), 2), ...), souligné vert, alinéa 2
 * - `### Sous-sous-titre` -> Niveau 3 (a), b), ...), souligné vert, alinéa 3
 * - Paragraphes en Georgia justifiés, retours à la ligne internes conservés.
 */
export function renderPrayerContentToNode(containerEl, rawText) {
  const frag = document.createDocumentFragment();
  const lines = String(rawText ?? '').replace(/\r\n/g, '\n').split('\n');
  let h1Count = 0;
  let h2Count = 0;
  let h3Count = 0;
  let paraLines = [];
  let blockCount = 0;

  const flushParagraph = () => {
    if (paraLines.length === 0) return;
    const p = document.createElement('p');
    paraLines.forEach((line, idx) => {
      if (idx > 0) p.appendChild(document.createElement('br'));
      p.appendChild(document.createTextNode(line));
    });
    frag.appendChild(p);
    blockCount += 1;
    paraLines = [];
  };

  const appendHeading = (tag, className, label) => {
    const h = document.createElement(tag);
    h.className = className;
    const span = document.createElement('span');
    span.textContent = label;
    h.appendChild(span);
    frag.appendChild(h);
    blockCount += 1;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('### ')) {
      flushParagraph();
      h3Count += 1;
      const body = trimmed.slice(4).trim();
      const hasPrefix = /^[a-z]+\)\s/i.test(body);
      const label = hasPrefix ? body : `${toLetter(h3Count)}) ${body}`;
      appendHeading('h4', 'prayer-h3', label);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushParagraph();
      h2Count += 1;
      h3Count = 0;
      const body = trimmed.slice(3).trim();
      const hasPrefix = /^\d+\)\s/.test(body);
      const label = hasPrefix ? body : `${h2Count}) ${body}`;
      appendHeading('h3', 'prayer-h2', label);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushParagraph();
      h1Count += 1;
      h2Count = 0;
      h3Count = 0;
      const body = trimmed.slice(2).trim();
      const hasPrefix = /^[IVXLCDM]+\.\s/i.test(body);
      const label = hasPrefix ? body : `${toRoman(h1Count)}. ${body}`;
      appendHeading('h2', 'prayer-h1', label);
      continue;
    }

    paraLines.push(rawLine);
  }

  flushParagraph();

  if (blockCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-prayer-note';
    empty.textContent = '(Note vide)';
    frag.appendChild(empty);
  }

  containerEl.replaceChildren(frag);
}

export function stripFormattingForPreview(rawText) {
  return String(rawText ?? '')
    .replace(/^#{1,3}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
