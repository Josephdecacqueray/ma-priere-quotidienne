# Ma prière quotidienne

Application Web Progressive (PWA) adaptée pour **iPhone**, fonctionnant en **libre accès** et **hors connexion**, hébergée sur GitHub Pages.

## Fonctionnalités
- Interface inspirée de l'application **Notes** d'iOS.
- **Typographie fidèle** : corps du texte en **Georgia** justifié (~10,5–11 pt, interligne confortable) et titres en **Shelley Volante Script** (avec secours provisoire hors-ligne **Great Vibes** si le fichier n'est pas encore déposé dans `./fonts/`).
- **Hiérarchie automatique** via `# `, `## `, `### ` :
  - Niveau 1 (`I.`, `II.`, …) souligné en rouge (`#B22222`), alinéa 1.
  - Niveau 2 (`1)`, `2)`, …) souligné en vert (`#1E7E34`), alinéa 2.
  - Niveau 3 (`a)`, `b)`, …) souligné en vert (`#1E7E34`), alinéa 3.
- **Prières texte & PDF** : rédaction, édition, importation de fichiers PDF (stockés localement dans IndexedDB pour lecture hors-ligne via `pdf.js`), suppression.
- **Module Neuvaine** : suivi quotidien sur `N` jours, association à une prière, rappels (Calendrier iPhone `.ics` avec alarme native, SMS, E-mail, Notifications PWA).
- **Prière à saint Joseph** préchargée au premier lancement.

## Ajouter la police Shelley Volante Script
Déposez `ShelleyVolanteScript.ttf` ou `ShelleyVolanteScript.otf` dans `./fonts/` (voir `fonts/README.txt`).
