let workerConfigured = false;
let pdfLibPromise = null;

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

export async function renderPdfIntoContainer(pdfBlob, containerEl, { scale = 1, onPageCount } = {}) {
  containerEl.innerHTML = '<p class="empty-sub" style="padding:20px;text-align:center;">Ouverture du document PDF…</p>';
  const lib = await ensurePdfJs();
  const data = await pdfBlob.arrayBuffer();
  const loadingTask = lib.getDocument({ data });
  const pdf = await loadingTask.promise;

  if (typeof onPageCount === 'function') {
    onPageCount(pdf.numPages);
  }

  containerEl.innerHTML = '';
  const availWidth = Math.max(280, (containerEl.clientWidth || window.innerWidth) - 24);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
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
  }
}

export function openPdfNatively(pdfBlob, fileName = 'priere.pdf') {
  const url = URL.createObjectURL(pdfBlob);
  const win = window.open(url, '_blank', 'noopener');
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
