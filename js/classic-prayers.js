/* =========================================================
   BIBLIOTHÈQUE OPTIONNELLE DE PRIÈRES CLASSIQUES (AJOUT 1 CLIC)
   - Le carnet démarre toujours 100 % vierge pour chaque nouvel utilisateur
   - Chargée uniquement sur demande depuis « + » ou l'écran vierge
   - 100 % DOM pur (zéro innerHTML)
   ========================================================= */

export const CLASSIC_PRAYERS = [
  {
    key: 'saint-joseph',
    title: 'Prière à saint Joseph',
    folder: 'Saints',
    subtitle: 'Protection paternelle dans l’épreuve',
    content: `Glorieux saint Joseph,
époux de Marie,
accordez-nous votre protection paternelle,
nous vous en supplions par le Cœur de Jésus-Christ.

Ô vous dont la puissance infinie
s’étend à toutes nos nécessités
et sait nous rendre possibles
les choses les plus impossibles,
ouvrez vos yeux de père
sur les intérêts de vos enfants.

Dans l’embarras et la peine
qui nous pressent,
nous recourons à vous avec confiance ;
daignez nous prendre sous votre charitable conduite
et réglez pour nous
cette affaire si importante et si difficile, (l’exprimer)
cause de toutes nos inquiétudes.

Faites que son heureuse issue
tourne à la gloire de Dieu
et au bien de ses dévoués serviteurs. Amen.`
  },
  {
    key: 'saint-thomas-etude',
    title: 'Prière de saint Thomas avant l’étude',
    folder: 'Matin',
    subtitle: 'Pour l’intelligence, la mémoire et le travail',
    content: `Créateur ineffable,
Vous qui êtes la vraie source de la lumière et de la sagesse,
et le principe suprême de toutes choses,
daignez répandre un rayon de votre clarté
sur les ténèbres de mon intelligence,
en chassant la double obscurité dans laquelle je suis né :
le péché et l’ignorance.

Vous qui rendez éloquente la langue des petits enfants,
façonnez ma parole et versez sur mes lèvres
la grâce de votre bénédiction.

Donnez-moi la pénétration pour comprendre,
la mémoire pour retenir,
la méthode et la facilité pour apprendre,
la subtilité pour interpréter,
et une grâce abondante pour m’exprimer.

Dirigez le début de mon travail,
conduisez-en le progrès,
et couronnez-en l’achèvement,
Vous qui êtes vrai Dieu et vrai homme,
et qui vivez et régnez dans les siècles des siècles. Amen.`
  },
  {
    key: 'veni-creator',
    title: 'Veni Creator Spiritus',
    folder: 'Matin',
    subtitle: 'Hymne traditionnelle à l’Esprit Saint',
    content: `# Invocation à l’Esprit Saint
Venez, Esprit Créateur, visitez l’âme de vos fidèles,
emplissez de la grâce d’en haut les cœurs que vous avez créés.

Vous qu’on nomme le Consolateur, don du Dieu Très-Haut,
source vive, feu, charité, invisible consécration.

Vous êtes l’Esprit aux sept dons, le doigt de la main du Père,
l’Esprit de vérité promis par le Père,
c’est vous qui inspirez nos paroles.

Allumez en nous votre lumière, emplissez d’amour nos cœurs,
affermissez toujours de votre force la faiblesse de notre corps.

Repoussez l’adversaire au loin, donnez-nous votre paix sans retard,
pour que, sous votre conduite et votre conseil, nous évitions tout mal.

Faites-nous connaître le Père, révélez-nous le Fils,
et vous, leur commun Esprit, faites-nous toujours croire en vous.

Gloire soit à Dieu le Père, au Fils ressuscité des morts,
à l’Esprit Saint Consolateur, maintenant et dans tous les siècles. Amen.`
  },
  {
    key: 'angelus',
    title: 'L’Angélus',
    folder: 'Matin',
    subtitle: 'Méditation de l’Incarnation (matin, midi, soir)',
    content: `# Annonce de l’Ange
℣. L’Ange du Seigneur porta l’annonce à Marie,
℟. Et elle conçut du Saint-Esprit.
Je vous salue Marie…

℣. Voici la servante du Seigneur,
℟. Qu’il me soit fait selon votre parole.
Je vous salue Marie…

℣. Et le Verbe s’est fait chair,
℟. Et il a habité parmi nous.
Je vous salue Marie…

℣. Priez pour nous, sainte Mère de Dieu,
℟. Afin que nous devenions dignes des promesses du Christ.

# Oraison
Que votre grâce, Seigneur notre Dieu, se répande en nos cœurs : par le message de l’Ange vous nous avez fait connaître l’Incarnation de votre Fils bien-aimé ; conduisez-nous, par sa Passion et par sa Croix, jusqu’à la gloire de la Résurrection. Par le Christ notre Seigneur. Amen.`
  },
  {
    key: 'anima-christi',
    title: 'Âme du Christ (Anima Christi)',
    folder: 'Messe',
    subtitle: 'Action de grâces après la Communion',
    content: `Âme du Christ, sanctifiez-moi.
Corps du Christ, sauvez-moi.
Sang du Christ, enivrez-moi.
Eau du côté du Christ, lavez-moi.
Passion du Christ, fortifiez-moi.

Ô bon Jésus, exaucez-moi.
Dans vos blessures, cachez-moi.
Ne permettez pas que je sois séparé de vous.
De l’ennemi défendez-moi.
À l’heure de ma mort, appelez-moi.

Ordonnez-moi de venir à vous,
pour qu’avec vos saints je vous loue
dans les siècles des siècles. Amen.`
  },
  {
    key: 'sub-tuum',
    title: 'Sous l’abri de votre miséricorde (Sub tuum)',
    folder: 'Soir',
    subtitle: 'Plus ancienne prière mariale de l’Église',
    content: `Sous l’abri de votre miséricorde,
nous nous réfugions, sainte Mère de Dieu.
Ne méprisez pas nos prières
quand nous sommes dans l’épreuve,
mais de tous les dangers
délivrez-nous toujours,
Vierge glorieuse et bénie. Amen.`
  },
  {
    key: 'salve-regina',
    title: 'Salve Regina',
    folder: 'Soir',
    subtitle: 'Antienne mariale du soir',
    content: `Salut, ô Reine, Mère de miséricorde,
notre vie, notre douceur et notre espérance, salut !
Enfants d’Ève, malheureux exilés,
nous élevons nos cris vers vous ;
nous soupirons vers vous, gémissant et pleurant
dans cette vallée de larmes.

Ô notre Avocate, tournez donc vers nous
vos regards miséricordieux ;
et après cet exil, montrez-nous Jésus,
le fruit béni de vos entrailles.
Ô clémente, ô miséricordieuse, ô douce Vierge Marie !

℣. Priez pour nous, sainte Mère de Dieu,
℟. Afin que nous devenions dignes des promesses du Christ.`
  },
  {
    key: 'memorare',
    title: 'Souvenez-vous (Memorare)',
    folder: 'Saints',
    subtitle: 'Prière confiante attribuée à saint Bernard',
    content: `Souvenez-vous, ô très miséricordieuse Vierge Marie,
qu’on n’a jamais entendu dire
qu’aucun de ceux qui ont eu recours à votre protection,
imploré votre assistance ou réclamé vos suffrages,
ait été abandonné.

Animé d’une pareille confiance,
ô Vierge des vierges, ô ma Mère,
je viens à vous, et gémissant sous le poids de mes péchés,
je me prosterne à vos pieds.

Ô Mère du Verbe incarné,
ne méprisez pas mes prières,
mais écoutez-les favorablement et daignez les exaucer. Amen.`
  },
  {
    key: 'saint-michel',
    title: 'Prière à saint Michel Archange',
    folder: 'Saints',
    subtitle: 'Défense dans le combat spirituel (Léon XIII)',
    content: `Saint Michel Archange,
défendez-nous dans le combat ;
soyez notre secours contre la malice et les embûches du démon.
Que Dieu exerce sur lui son empire, nous vous le demandons en suppliant.
Et vous, Prince de la milice céleste,
par la vertu divine, refoulez en enfer Satan et les autres esprits mauvais
qui rôdent dans le monde pour la perte des âmes. Amen.`
  },
  {
    key: 'acte-contrition',
    title: 'Acte de contrition',
    folder: 'Soir',
    subtitle: 'Prière du soir et préparation à la confession',
    content: `Mon Dieu, j’ai un très grand regret de vous avoir offensé,
parce que vous êtes infiniment bon, infiniment aimable,
et que le péché vous déplaît.
Je prends la ferme résolution,
avec le secours de votre sainte grâce,
de ne plus vous offenser et de faire pénitence. Amen.`
  }
];

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

export function openClassicPrayersLibrary({ existingTitles = new Set(), onAddPrayer } = {}) {
  const prev = document.getElementById('classic-prayers-overlay');
  if (prev) prev.remove();

  const overlay = el('div', 'tour-overlay');
  overlay.id = 'classic-prayers-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Bibliothèque de prières classiques');

  const card = el('div', 'tour-card classic-library-card');

  const head = el('div', 'tour-top-bar');
  head.appendChild(el('span', 'tour-kicker', 'Ajout optionnel · 1 clic'));
  const closeBtn = el('button', 'tour-skip-btn', 'Fermer');
  closeBtn.id = 'btn-classics-close';
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => overlay.remove());
  head.appendChild(closeBtn);
  card.appendChild(head);

  card.appendChild(el('h2', 'tour-title', 'Prières classiques'));
  card.appendChild(
    el('p', 'field-help classic-library-intro', 'Choisissez librement les prières à ajouter dans votre carnet. Vous pourrez ensuite les modifier ou les épingler.')
  );

  const list = el('div', 'classic-library-list');
  for (const item of CLASSIC_PRAYERS) {
    const row = el('div', 'classic-prayer-row');
    const info = el('div', 'classic-prayer-info');
    const titleLine = el('div', 'classic-prayer-title-line');
    titleLine.appendChild(el('strong', '', item.title));
    titleLine.appendChild(el('span', 'folder-tag', item.folder));
    info.appendChild(titleLine);
    info.appendChild(el('span', 'classic-prayer-sub', item.subtitle));

    const already = existingTitles.has(item.title.toLowerCase());
    const addBtn = el('button', already ? 'btn-outline-ios classic-add-btn' : 'btn-primary-ios classic-add-btn', already ? 'Ajoutée ✓' : '+ Ajouter');
    addBtn.type = 'button';
    addBtn.dataset.classicKey = item.key;
    if (already) addBtn.disabled = true;
    addBtn.addEventListener('click', async () => {
      addBtn.disabled = true;
      await onAddPrayer?.(item);
      addBtn.className = 'btn-outline-ios classic-add-btn';
      addBtn.textContent = 'Ajoutée ✓';
    });

    row.append(info, addBtn);
    list.appendChild(row);
  }
  card.appendChild(list);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
