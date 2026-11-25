import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { emptyState, mergeStates } from './merge.js';

const PORT = Number(process.env.PORT) || 8080;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const CHUNK_SIZE = 700 * 1024;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

const ALLOWED_ORIGINS = new Set([
  'https://josephdecacqueray.github.io',
  'http://127.0.0.1:18765',
  'http://localhost:18765'
]);

const firestore = new Firestore();
const STATE_DOC = firestore.collection('app_data').doc('default');
const PDF_META_COL = firestore.collection('pdf_meta');
const PDF_CHUNKS_COL = firestore.collection('pdf_chunks');

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        tooLarge = true;
        req.destroy(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => reject(err));
  });
}

async function getServerState() {
  const snap = await STATE_DOC.get();
  if (!snap.exists) return emptyState();
  return { ...emptyState(), ...snap.data() };
}

async function deletePdfChunks(id, count) {
  const batch = firestore.batch();
  for (let i = 0; i < count; i += 1) {
    batch.delete(PDF_CHUNKS_COL.doc(`${id}_${i}`));
  }
  await batch.commit();
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const state = await getServerState();
      sendJson(res, 200, state);
      return;
    }

    if (req.method === 'POST' && pathname === '/api/state') {
      const buf = await readBody(req, MAX_JSON_BYTES);
      let clientState;
      try {
        clientState = JSON.parse(buf.toString('utf8') || '{}');
      } catch {
        sendJson(res, 400, { error: 'JSON invalide' });
        return;
      }

      const merged = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(STATE_DOC);
        const serverState = snap.exists ? { ...emptyState(), ...snap.data() } : emptyState();
        const nextState = mergeStates(serverState, clientState);
        tx.set(STATE_DOC, nextState);
        return nextState;
      });

      sendJson(res, 200, { ok: true, state: merged });
      return;
    }

    const pdfMatch = pathname.match(/^\/api\/pdfs\/([^/]+)$/);
    if (pdfMatch) {
      const pdfId = decodeURIComponent(pdfMatch[1]);
      if (!SAFE_ID_RE.test(pdfId)) {
        sendJson(res, 400, { error: 'Identifiant PDF invalide' });
        return;
      }

      if (req.method === 'PUT') {
        const buf = await readBody(req, MAX_PDF_BYTES);
        if (buf.length === 0) {
          sendJson(res, 400, { error: 'PDF vide' });
          return;
        }
        const metaRef = PDF_META_COL.doc(pdfId);
        const oldMetaSnap = await metaRef.get();
        const oldChunkCount = oldMetaSnap.exists ? Number(oldMetaSnap.data()?.chunkCount) || 0 : 0;

        const chunkCount = Math.ceil(buf.length / CHUNK_SIZE);
        for (let i = 0; i < chunkCount; i += 1) {
          const slice = buf.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          await PDF_CHUNKS_COL.doc(`${pdfId}_${i}`).set({
            pdfId,
            index: i,
            data: slice
          });
        }
        await metaRef.set({
          size: buf.length,
          chunkCount,
          updatedAt: Date.now()
        });
        if (oldChunkCount > chunkCount) {
          for (let i = chunkCount; i < oldChunkCount; i += 1) {
            await PDF_CHUNKS_COL.doc(`${pdfId}_${i}`).delete();
          }
        }
        sendJson(res, 200, { ok: true, id: pdfId, size: buf.length });
        return;
      }

      if (req.method === 'GET') {
        const metaSnap = await PDF_META_COL.doc(pdfId).get();
        if (!metaSnap.exists) {
          sendJson(res, 404, { error: 'PDF introuvable' });
          return;
        }
        const { chunkCount = 0 } = metaSnap.data() || {};
        const buffers = [];
        for (let i = 0; i < chunkCount; i += 1) {
          const chunkSnap = await PDF_CHUNKS_COL.doc(`${pdfId}_${i}`).get();
          if (!chunkSnap.exists) {
            sendJson(res, 404, { error: 'Morceau PDF manquant' });
            return;
          }
          const raw = chunkSnap.data().data;
          buffers.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
        }
        const out = Buffer.concat(buffers);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Length': String(out.length),
          'Cache-Control': 'no-store'
        });
        res.end(out);
        return;
      }

      if (req.method === 'DELETE') {
        const metaRef = PDF_META_COL.doc(pdfId);
        const metaSnap = await metaRef.get();
        if (metaSnap.exists) {
          const count = Number(metaSnap.data()?.chunkCount) || 0;
          if (count > 0) await deletePdfChunks(pdfId, count);
          await metaRef.delete();
        }
        sendJson(res, 200, { ok: true });
        return;
      }
    }

    sendJson(res, 404, { error: 'Route introuvable' });
  } catch (err) {
    if (err?.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, { error: 'Fichier trop volumineux' });
      return;
    }
    console.error('Server error:', err);
    sendJson(res, 500, { error: 'Erreur interne du serveur' });
  }
});

server.listen(PORT, () => {
  console.log(`ma-priere-sync listening on port ${PORT}`);
});
