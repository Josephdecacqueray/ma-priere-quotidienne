#!/usr/bin/env node
/**
 * Script d'export sans perte de vos données v7 (Firestore GCP `ma-vm-510209`)
 * vers un fichier JSON directement importable dans la v8 (« Importer une sauvegarde (.json) »).
 *
 * Prérequis :
 *   1. Être authentifié avec `gcloud auth application-default login` sur le projet `ma-vm-510209`
 *   2. Lancer depuis le dossier `server/` ou après `npm install @google-cloud/firestore` :
 *      node scripts/export-firestore-v7.mjs --project=ma-vm-510209 --out=migration-v7-backup.json
 *
 * NOTE : Le fichier de sortie `migration-v7-backup.json` est automatiquement ignoré par `.gitignore`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  })
);

const projectId = args.project || process.env.GOOGLE_CLOUD_PROJECT || 'ma-vm-510209';
const outFile = path.resolve(args.out || 'migration-v7-backup.json');

let Firestore;
try {
  const req = createRequire(import.meta.url);
  ({ Firestore } = req(path.resolve('server/node_modules/@google-cloud/firestore')));
} catch {
  try {
    ({ Firestore } = await import('@google-cloud/firestore'));
  } catch {
    console.error('Module @google-cloud/firestore introuvable. Installez-le dans server/ avec `cd server && npm install`.');
    process.exit(1);
  }
}

const db = new Firestore({ projectId });
console.log(`Lecture Firestore v7 (projet: ${projectId})…`);

const stateSnap = await db.doc('app_data/default').get();
if (!stateSnap.exists) {
  console.error('Document app_data/default introuvable dans Firestore.');
  process.exit(1);
}

const data = stateSnap.data() || {};
const prayers = Array.isArray(data.prayers) ? data.prayers : [];
const novenas = Array.isArray(data.novenas) ? data.novenas : [];
const intentions = Array.isArray(data.intentions) ? data.intentions : [];

const enrichedPrayers = [];
for (const p of prayers) {
  const copy = { ...p };
  if (p.type === 'pdf' || p.type === 'image') {
    const metaSnap = await db.collection('app_pdfs').doc(p.id).get();
    if (metaSnap.exists) {
      const meta = metaSnap.data() || {};
      const chunksSnap = await db
        .collection('app_pdfs')
        .doc(p.id)
        .collection('chunks')
        .orderBy('index')
        .get();
      if (!chunksSnap.empty) {
        const buffers = chunksSnap.docs.map((d) => {
          const val = d.data().data;
          return Buffer.isBuffer(val) ? val : Buffer.from(val);
        });
        const fullBuf = Buffer.concat(buffers);
        const mime = meta.contentType || p.mimeType || (p.type === 'pdf' ? 'application/pdf' : 'image/jpeg');
        copy.embeddedDataUrl = `data:${mime};base64,${fullBuf.toString('base64')}`;
        copy.fileSize = fullBuf.byteLength;
        console.log(`  + Média récupéré : ${p.title || p.id} (${Math.round(fullBuf.byteLength / 1024)} Ko)`);
      }
    }
  }
  enrichedPrayers.push(copy);
}

const backup = {
  version: 3,
  source: 'firestore-v7-export',
  exportedAt: new Date().toISOString(),
  prayers: enrichedPrayers,
  novenas,
  intentions
};

await fs.writeFile(outFile, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\nExport terminé avec succès -> ${outFile}`);
console.log(`  Prières : ${enrichedPrayers.length} | Neuvaines : ${novenas.length} | Intentions : ${intentions.length}`);
console.log('Importez ensuite ce fichier dans la v8 via : Icône (i) -> « Importer une sauvegarde (.json) ».');
