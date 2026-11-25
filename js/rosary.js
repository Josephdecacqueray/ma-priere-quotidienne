export const ROSARY_GROUPS = [
  {
    key: 'joyeux',
    roman: 'I.',
    title: 'Mystères joyeux',
    daysLabel: 'Lundi et Samedi',
    days: [1, 6],
    mysteries: [
      {
        number: 1,
        title: "L'Annonciation",
        ref: 'Lc 1, 26-38',
        fruit: "L'humilité",
        meditation: "L'ange Gabriel annonce à Marie qu'elle concevra le Fils du Très-Haut. Par son « oui » confiant, le Verbe se fait chair."
      },
      {
        number: 2,
        title: 'La Visitation',
        ref: 'Lc 1, 39-56',
        fruit: 'La charité fraternelle',
        meditation: "Marie part en hâte servir sa cousine Élisabeth, portant Jésus caché en elle. Jean-Baptiste tressaille de joie et Marie chante le Magnificat."
      },
      {
        number: 3,
        title: 'La Nativité',
        ref: 'Lc 2, 1-20',
        fruit: "L'esprit de pauvreté et le détachement",
        meditation: "Dans la pauvreté de Bethléem, Jésus naît et repose dans une mangeoire. Les anges chantent la gloire de Dieu et la paix aux hommes."
      },
      {
        number: 4,
        title: 'La Présentation de Jésus au Temple',
        ref: 'Lc 2, 22-38',
        fruit: "L'obéissance et la pureté",
        meditation: "Marie et Joseph offrent Jésus au Seigneur. Le vieillard Syméon reconnaît en l'Enfant la lumière des nations et annonce le glaive qui transpercera Marie."
      },
      {
        number: 5,
        title: 'Le Recouvrement de Jésus au Temple',
        ref: 'Lc 2, 41-52',
        fruit: 'La recherche de Dieu en toutes choses',
        meditation: "Après trois jours d'angoisse, Marie et Joseph retrouvent Jésus assis parmi les docteurs, tout entier occupé aux affaires de son Père."
      }
    ]
  },
  {
    key: 'lumineux',
    roman: 'II.',
    title: 'Mystères lumineux',
    daysLabel: 'Jeudi',
    days: [4],
    mysteries: [
      {
        number: 1,
        title: 'Le Baptême de Jésus dans le Jourdain',
        ref: 'Mt 3, 13-17',
        fruit: 'La fidélité aux promesses du baptême',
        meditation: "Jésus descend dans les eaux du Jourdain. Les cieux s'ouvrent, l'Esprit Saint descend comme une colombe et le Père proclame : « Celui-ci est mon Fils bien-aimé. »"
      },
      {
        number: 2,
        title: 'Les Noces de Cana',
        ref: 'Jn 2, 1-11',
        fruit: 'La confiance en Jésus par Marie',
        meditation: "À la prière de Marie — « Faites tout ce qu'il vous dira » — Jésus change l'eau en vin et manifeste pour la première fois sa gloire."
      },
      {
        number: 3,
        title: "L'Annonce du Royaume de Dieu",
        ref: 'Mc 1, 14-15',
        fruit: 'La conversion du cœur',
        meditation: "Jésus parcourt la Galilée en appelant à la conversion et en pardonnant les péchés, ouvrant à tous le chemin de la miséricorde."
      },
      {
        number: 4,
        title: 'La Transfiguration',
        ref: 'Lc 9, 28-36',
        fruit: 'La grâce de la contemplation',
        meditation: "Sur le mont Thabor, le visage de Jésus resplendit devant Pierre, Jacques et Jean. Le Père invite les disciples : « Écoutez-le ! »"
      },
      {
        number: 5,
        title: "L'Institution de l'Eucharistie",
        ref: 'Mt 26, 26-29',
        fruit: "L'amour de l'Eucharistie",
        meditation: "Lors de la dernière Cène, Jésus offre son Corps et son Sang sous les espèces du pain et du vin, demeurant avec nous jusqu'à la fin des temps."
      }
    ]
  },
  {
    key: 'douloureux',
    roman: 'III.',
    title: 'Mystères douloureux',
    daysLabel: 'Mardi et Vendredi',
    days: [2, 5],
    mysteries: [
      {
        number: 1,
        title: "L'Agonie de Jésus à Gethsémani",
        ref: 'Lc 22, 39-46',
        fruit: 'La contrition des péchés',
        meditation: "Dans la nuit du jardin des Oliviers, Jésus porte nos péchés et s'abandonne au Père : « Non pas ma volonté, mais la tienne. »"
      },
      {
        number: 2,
        title: 'La Flagellation',
        ref: 'Jn 19, 1',
        fruit: 'La mortification des sens',
        meditation: "Jésus endure en silence la violence des coups pour guérir nos blessures et expier nos infidélités."
      },
      {
        number: 3,
        title: "Le Couronnement d'épines",
        ref: 'Mt 27, 27-31',
        fruit: "La victoire sur l'orgueil",
        meditation: "Couvert d'un manteau dérisoire et couronné d'épines, le Roi de l'univers accepte les moqueries par amour pour nous."
      },
      {
        number: 4,
        title: 'Le Portement de la Croix',
        ref: 'Lc 23, 26-32',
        fruit: 'La patience dans les épreuves',
        meditation: "Chargé du bois de la Croix, Jésus gravit le Calvaire, soutenu un instant par Simon de Cyrène, et croise le regard de sa Mère."
      },
      {
        number: 5,
        title: 'Le Crucifiement et la Mort de Jésus',
        ref: 'Jn 19, 17-37',
        fruit: 'Le pardon des offenses et le zèle des âmes',
        meditation: "Élevé sur la Croix, Jésus pardonne, nous confie à Marie comme notre Mère et remet son esprit entre les mains du Père."
      }
    ]
  },
  {
    key: 'glorieux',
    roman: 'IV.',
    title: 'Mystères glorieux',
    daysLabel: 'Mercredi et Dimanche',
    days: [3, 0],
    mysteries: [
      {
        number: 1,
        title: 'La Résurrection',
        ref: 'Mt 28, 1-10',
        fruit: 'La foi vive',
        meditation: "Au matin de Pâques, le tombeau est vide : Jésus a vaincu la mort et ouvre à tous les croyants l'espérance de la vie éternelle."
      },
      {
        number: 2,
        title: "L'Ascension",
        ref: 'Ac 1, 6-11',
        fruit: "L'espérance et le désir du Ciel",
        meditation: "Quarante jours après Pâques, Jésus monte auprès du Père pour nous préparer une place et nous envoie en mission."
      },
      {
        number: 3,
        title: 'La Pentecôte',
        ref: 'Ac 2, 1-11',
        fruit: 'Les dons du Saint-Esprit',
        meditation: "Réunis au Cénacle avec Marie, les Apôtres reçoivent le feu de l'Esprit Saint et annoncent l'Évangile avec audace."
      },
      {
        number: 4,
        title: "L'Assomption de la Vierge Marie",
        ref: 'Ap 12, 1',
        fruit: 'La grâce d’une bonne mort',
        meditation: "Au terme de sa vie terrestre, la Mère de Dieu est élevée corps et âme dans la gloire du Ciel."
      },
      {
        number: 5,
        title: 'Le Couronnement de Marie au Ciel',
        ref: 'Ap 12, 1 ; Lc 1, 48',
        fruit: 'La persévérance et la confiance en Marie',
        meditation: "Couronnée Reine du Ciel et de la terre, Marie intercède sans cesse auprès de son Fils pour chacun de ses enfants."
      }
    ]
  }
];

export function getTodayRosaryGroup(date = new Date()) {
  const day = date.getDay();
  return ROSARY_GROUPS.find((g) => g.days.includes(day)) || ROSARY_GROUPS[0];
}
