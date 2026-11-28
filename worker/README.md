# Backend Cloudflare Workers + D1 (`ma-priere-api` v8)

Backend multi-utilisateurs (jusqu'à **1 000 comptes gratuits**) garanti **0,00 €/mois sans carte bancaire** :
- **Cloudflare Workers** (plan Free) : authentification PBKDF2-SHA256 + JWT HS256 + rotation de Refresh Token 180 jours avec détection de rejeu, synchronisation LWW cloisonnée par `user_id`, Web Push RFC 8291 pur Web Crypto, formulaire de contact privé.
- **Cloudflare D1** (SQLite managé 5 Go gratuit) : texte et métadonnées uniquement (**zéro binaire PDF** stocké sur le serveur).
- **Cron Trigger (`*/5 * * * *`)** : rappels de neuvaines multi-utilisateurs strictement plafonnés à **40 sous-requêtes `fetch` max par exécution** (plafond Free = 50).

> **Sécurité :** Ne commitez **jamais** `.dev.vars`, de clé privée VAPID, de clé JWT ou d'adresse e-mail personnelle dans Git. Tous les secrets sont injectés uniquement via `wrangler secret put`.

## 1. Déploiement initial (plan Free sans CB)

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create ma_priere_db
```

Reportez l'identifiant `database_id` affiché dans `worker/wrangler.toml`, puis appliquez la migration SQL :

```bash
npx wrangler d1 migrations apply ma_priere_db --remote
```

## 2. Injection des secrets chiffrés Cloudflare

```bash
# Clé de signature JWT (générez une chaîne aléatoire >= 32 octets)
npx wrangler secret put JWT_SIGNING_KEY

# Clés Web Push VAPID (générez-les avec `npx web-push generate-vapid-keys`)
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT

# Redirection privée du formulaire Bug / Suggestion (jamais dans le dépôt Git !)
npx wrangler secret put CONTACT_TARGET_EMAIL
npx wrangler secret put EMAIL_RELAY_KEY

# Protection anti-bot / anti-spam Cloudflare Turnstile (optionnel mais recommandé)
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Déployez ensuite le Worker :

```bash
npx wrangler deploy
```

Notez l'URL obtenue (`https://ma-priere-api.<votre-sous-domaine>.workers.dev`) et reportez-la dans `js/config.js` (`DEFAULT_API_BASE_URL`).

## 3. Migration v7 -> v8 et extinction définitive de GCP (`ma-vm-510209`)

1. Exportez vos données v7 existantes depuis l'application (bouton `(i) -> Exporter mon carnet (.json)`) **ou** via `node scripts/export-firestore-v7.mjs --project=ma-vm-510209`.
2. Ouvrez la v8, créez votre compte personnel, puis importez votre `.json` via `(i) -> Importer une sauvegarde (.json)`.
3. Vérifiez que toutes vos prières, PDF, neuvaines et intentions apparaissent et sont synchronisées.
4. Supprimez ensuite les ressources payantes/facturables GCP :

```bash
gcloud scheduler jobs delete ma-priere-reminders --location=europe-west1 --project=ma-vm-510209 --quiet
gcloud run services delete ma-priere-sync --region=europe-west1 --project=ma-vm-510209 --quiet
```
