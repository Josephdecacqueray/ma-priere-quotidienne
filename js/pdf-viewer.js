let workerConfigured = false;

function ensurePdfJs() {
  const lib = window.pdfjsLib;
  if (!lib) {
    throw new Error("Le lecteur PDF n'est pas encore chargé.");
  }
  if (!workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
    workerConfigured = true;
  }
  return lib;
}

export async function renderPdfIntoContainer(pdfBlob, containerEl, { scale = 1, onPageCount } = {}) {
  containerEl.innerHTML = '<p class="empty-sub" style="padding:20px;text-align:center;">Ouverture du document PDF…</p>';
  const lib = ensurePdfJs();
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
