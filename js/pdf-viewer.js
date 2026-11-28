let workerConfigured = false;
let pdfLibPromise = null;
let activePdfDoc = null;
let activeRenderToken = 0;

function loadPdfJsScript() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfLibPromise) return pdfLibPromise;

  pdfLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = './vendor/pdf.min.js';
    script.async = true;
    script.onload = () => {
      if (window.pdfjsLib) {
        resolve(window.pdfjsLib);
      } else {
        pdfLibPromise = null;
        reject(new Error('Le lecteur PDF ne s’est pas initialisé correctement.'));
      }
    };
    script.onerror = () => {
      pdfLibPromise = null;
      reject(new Error('Impossible de charger le module PDF hors-ligne.'));
    };
    document.head.appendChild(script);
  });

  return pdfLibPromise;
}

async function ensurePdfJs() {
  const lib = await loadPdfJsScript();
  if (!workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    workerConfigured = true;
  }
  return lib;
}

/**
 * Libère proprement la mémoire Safari iPhone (destruction PDFDocumentProxy + remise à 0 des canvas).
 */
export function releasePdfResources(containerEl) {
  activeRenderToken += 1;

  if (activePdfDoc) {
    const doc = activePdfDoc;
    activePdfDoc = null;
    try {
      doc.cleanup?.();
      doc.destroy?.();
    } catch {
      // Ignoré
    }
  }

  if (containerEl) {
    const canvases = containerEl.querySelectorAll('canvas');
    for (const c of canvases) {
      try {
        c.width = 0;
        c.height = 0;
      } catch {
        // Ignoré
      }
    }
    containerEl.replaceChildren();
  }
}

export async function renderPdfIntoContainer(pdfBlob, containerEl, { scale = 1, onPageCount } = {}) {
  releasePdfResources(containerEl);
  const myToken = activeRenderToken;

  const loadingP = document.createElement('p');
  loadingP.className = 'empty-sub pdf-status-msg';
  loadingP.textContent = 'Ouverture du document PDF…';
  containerEl.replaceChildren(loadingP);

  const lib = await ensurePdfJs();
  if (myToken !== activeRenderToken) return;

  const data = await pdfBlob.arrayBuffer();
  if (myToken !== activeRenderToken) return;

  const loadingTask = lib.getDocument({ data });
  const pdf = await loadingTask.promise;

  if (myToken !== activeRenderToken) {
    pdf.destroy?.();
    return;
  }

  activePdfDoc = pdf;

  if (typeof onPageCount === 'function') {
    onPageCount(pdf.numPages);
  }

  containerEl.replaceChildren();
  const availWidth = Math.max(280, (containerEl.clientWidth || window.innerWidth) - 24);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.2);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    if (myToken !== activeRenderToken) return;

    const page = await pdf.getPage(pageNum);
    if (myToken !== activeRenderToken) return;

    const unscaledViewport = page.getViewport({ scale: 1 });
    const baseScale = availWidth / unscaledViewport.width;
    const targetScale = baseScale * scale;
    const viewport = page.getViewport({ scale: targetScale });

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    containerEl.appendChild(canvas);

    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup?.();
  }
}

export function openPdfNatively(pdfBlob, fileName = 'priere.pdf') {
  const url = URL.createObjectURL(pdfBlob);
  const win = window.open(url, '_blank', 'noopener,noreferrer');
  if (!win) {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
