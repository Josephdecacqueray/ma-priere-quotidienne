function pad2(n) {
  return String(n).padStart(2, '0');
}

function escapeIcsText(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatUtcStamp(date) {
  return (
    date.getUTCFullYear() +
    pad2(date.getUTCMonth() + 1) +
    pad2(date.getUTCDate()) +
    'T' +
    pad2(date.getUTCHours()) +
    pad2(date.getUTCMinutes()) +
    pad2(date.getUTCSeconds()) +
    'Z'
  );
}

/**
 * Génère un fichier calendrier .ics RFC 5545 avec récurrence quotidienne sur N jours
 * et alarme VALARM pour notification native iPhone hors-ligne.
 */
export function generateNovenaIcs(novena, prayerTitle = '', appUrl = '') {
  const startDate = (novena.startDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const [hhStr, mmStr] = String(novena.reminder?.time || '08:00').split(':');
  const hh = pad2(Number(hhStr) || 8);
  const mm = pad2(Number(mmStr) || 0);

  const startMinutes = (Number(hhStr) || 8) * 60 + (Number(mmStr) || 0);
  const endMinutes = Math.min(23 * 60 + 55, startMinutes + 10);
  const endHh = pad2(Math.floor(endMinutes / 60));
  const endMm = pad2(endMinutes % 60);

  const totalDays = Math.max(1, Math.min(365, Number(novena.totalDays) || 9));
  const dtStart = `${startDate}T${hh}${mm}00`;
  const dtEnd = `${startDate}T${endHh}${endMm}00`;
  const dtStamp = formatUtcStamp(new Date());
  const uid = `${novena.id || 'novena'}-${startDate}@ma-priere-quotidienne`;

  const summary = `Prière : ${novena.title || 'Neuvaine'}`;
  const descParts = [];
  if (prayerTitle) descParts.push(`Prière : ${prayerTitle}`);
  if (novena.intention) descParts.push(`Intention : ${novena.intention}`);
  if (appUrl) descParts.push(`Ouvrir l'app : ${appUrl}`);
  const description = descParts.join('\n') || 'Moment de prière quotidienne.';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ma priere quotidienne//PWA iPhone//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `RRULE:FREQ=DAILY;COUNT=${totalDays}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...(appUrl ? [`URL:${appUrl}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcsText(summary)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ];

  return lines.join('\r\n');
}

export function downloadNovenaIcs(novena, prayerTitle = '', appUrl = '') {
  const icsContent = generateNovenaIcs(novena, prayerTitle, appUrl);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (novena.title || 'neuvaine')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/(^-|-$)/g, '');
  a.href = url;
  a.download = `${safeName || 'neuvaine'}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function buildReminderMessage(novena, prayerTitle = '', currentDay = 1) {
  const parts = [`Neuvaine « ${novena.title} » (Jour ${currentDay}/${novena.totalDays})`];
  if (prayerTitle) parts.push(`Prière : ${prayerTitle}`);
  if (novena.intention) parts.push(`Intention : ${novena.intention}`);
  return parts.join(' — ');
}

export function buildSmsLink(phone, novena, prayerTitle = '', currentDay = 1) {
  const cleanPhone = String(phone || '').replace(/[^\d+]/g, '');
  const body = encodeURIComponent(buildReminderMessage(novena, prayerTitle, currentDay));
  // iOS Safari accepte `&body=` même sans destinataire ou avec destinataire
  return cleanPhone ? `sms:${cleanPhone}&body=${body}` : `sms:&body=${body}`;
}

export function buildMailtoLink(email, novena, prayerTitle = '', currentDay = 1) {
  const cleanEmail = String(email || '').trim();
  const subject = encodeURIComponent(`Rappel prière — ${novena.title} (Jour ${currentDay}/${novena.totalDays})`);
  const body = encodeURIComponent(buildReminderMessage(novena, prayerTitle, currentDay));
  return `mailto:${encodeURIComponent(cleanEmail)}?subject=${subject}&body=${body}`;
}
