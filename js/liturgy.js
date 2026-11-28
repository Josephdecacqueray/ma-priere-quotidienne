/**
 * Calcul de la date de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher).
 */
export function getEasterDate(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function dayNum(d) {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function getAdventStart(year) {
  // 4e dimanche avant Noël (dimanche le plus proche du 30 novembre)
  const nov30 = new Date(year, 10, 30);
  const dow = nov30.getDay(); // 0 = dimanche
  const offset = dow <= 3 ? -dow : 7 - dow;
  return addDays(nov30, offset);
}

function getBaptismOfTheLord(year) {
  // Dimanche suivant le 6 janvier (Épiphanie)
  const jan6 = new Date(year, 0, 6);
  const dow = jan6.getDay();
  const add = dow === 0 ? 7 : 7 - dow;
  return addDays(jan6, add);
}

/**
 * Retourne le temps liturgique et sa couleur associée pour une date donnée.
 */
export function getLiturgicalSeason(date = new Date()) {
  const y = date.getFullYear();
  const cur = dayNum(date);

  const christmas = dayNum(new Date(y, 11, 25));
  const advent = dayNum(getAdventStart(y));
  const prevChristmas = dayNum(new Date(y - 1, 11, 25));
  const baptism = dayNum(getBaptismOfTheLord(y));

  const easterDate = getEasterDate(y);
  const ashWednesday = dayNum(addDays(easterDate, -46));
  const palmSunday = dayNum(addDays(easterDate, -7));
  const holyThursday = dayNum(addDays(easterDate, -3));
  const goodFriday = dayNum(addDays(easterDate, -2));
  const holySaturday = dayNum(addDays(easterDate, -1));
  const easter = dayNum(easterDate);
  const ascension = dayNum(addDays(easterDate, 39));
  const pentecost = dayNum(addDays(easterDate, 49));
  const epiphany = dayNum(new Date(y, 0, 6));
  const assumption = dayNum(new Date(y, 7, 15));
  const allSaints = dayNum(new Date(y, 10, 1));
  const immaculate = dayNum(new Date(y, 11, 8));

  // Grandes solennités majeures
  if (cur === christmas) return { key: 'christmas', name: 'Nativité du Seigneur', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === epiphany) return { key: 'christmas', name: 'Épiphanie du Seigneur', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === ashWednesday) return { key: 'lent', name: 'Mercredi des Cendres', colorLabel: 'Violet', rgb: '109, 76, 158', accentHex: '#6D4C9E' };
  if (cur === palmSunday) return { key: 'holy_week', name: 'Dimanche des Rameaux', colorLabel: 'Rouge', rgb: '178, 34, 34', accentHex: '#B22222' };
  if (cur === holyThursday) return { key: 'holy_week', name: 'Jeudi Saint', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === goodFriday) return { key: 'holy_week', name: 'Vendredi Saint', colorLabel: 'Rouge', rgb: '178, 34, 34', accentHex: '#B22222' };
  if (cur === holySaturday) return { key: 'holy_week', name: 'Samedi Saint', colorLabel: 'Violet', rgb: '109, 76, 158', accentHex: '#6D4C9E' };
  if (cur === easter) return { key: 'easter', name: 'Dimanche de Pâques', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === ascension) return { key: 'easter', name: 'Ascension du Seigneur', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === pentecost) return { key: 'pentecost', name: 'Pentecôte', colorLabel: 'Rouge', rgb: '178, 34, 34', accentHex: '#B22222' };
  if (cur === assumption) return { key: 'solemnity', name: 'Assomption de Marie', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === allSaints) return { key: 'solemnity', name: 'Toussaint', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };
  if (cur === immaculate) return { key: 'solemnity', name: 'Immaculée Conception', colorLabel: 'Or & Blanc', rgb: '200, 155, 43', accentHex: '#B8861B' };

  if ((cur >= prevChristmas && cur <= baptism) || cur >= christmas) {
    return {
      key: 'christmas',
      name: 'Temps de Noël',
      colorLabel: 'Or & Blanc',
      rgb: '200, 155, 43',
      accentHex: '#B8861B'
    };
  }

  if (cur >= advent && cur < christmas) {
    return {
      key: 'advent',
      name: "Temps de l'Avent",
      colorLabel: 'Violet',
      rgb: '109, 76, 158',
      accentHex: '#6D4C9E'
    };
  }

  if (cur >= ashWednesday && cur < palmSunday) {
    return {
      key: 'lent',
      name: 'Carême',
      colorLabel: 'Violet',
      rgb: '109, 76, 158',
      accentHex: '#6D4C9E'
    };
  }

  if (cur >= palmSunday && cur < easter) {
    return {
      key: 'holy_week',
      name: 'Semaine Sainte',
      colorLabel: 'Rouge',
      rgb: '178, 34, 34',
      accentHex: '#B22222'
    };
  }

  if (cur === pentecost) {
    return {
      key: 'pentecost',
      name: 'Pentecôte',
      colorLabel: 'Rouge',
      rgb: '178, 34, 34',
      accentHex: '#B22222'
    };
  }

  if (cur >= easter && cur < pentecost) {
    return {
      key: 'easter',
      name: 'Temps Pascal',
      colorLabel: 'Or & Blanc',
      rgb: '200, 155, 43',
      accentHex: '#B8861B'
    };
  }

  return {
    key: 'ordinary',
    name: 'Temps ordinaire',
    colorLabel: 'Vert',
    rgb: '30, 126, 52',
    accentHex: '#1E7E34'
  };
}

/**
 * Résumé léger du mystère du chapelet du jour (évite de charger rosary.js au boot).
 */
export function getTodayRosarySummary(date = new Date()) {
  const dow = date.getDay();
  if (dow === 1 || dow === 6) return { key: 'joyeux', title: 'Mystères joyeux', daysLabel: 'Lundi et Samedi' };
  if (dow === 4) return { key: 'lumineux', title: 'Mystères lumineux', daysLabel: 'Jeudi' };
  if (dow === 2 || dow === 5) return { key: 'douloureux', title: 'Mystères douloureux', daysLabel: 'Mardi et Vendredi' };
  return { key: 'glorieux', title: 'Mystères glorieux', daysLabel: 'Mercredi et Dimanche' };
}
