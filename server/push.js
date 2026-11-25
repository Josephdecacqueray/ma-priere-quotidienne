import crypto from 'node:crypto';
import webpush from 'web-push';

const VAPID_SUBJECT = 'mailto:noreply@ma-priere-quotidienne.app';
const APP_URL = 'https://josephdecacqueray.github.io/ma-priere-quotidienne/';

let cachedVapid = null;

function subDocId(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 40);
}

export async function ensureVapid(firestore) {
  if (cachedVapid) return cachedVapid;
  const ref = firestore.collection('config').doc('vapid');
  const snap = await ref.get();
  let keys;
  if (snap.exists && snap.data()?.publicKey && snap.data()?.privateKey) {
    keys = snap.data();
  } else {
    const gen = webpush.generateVAPIDKeys();
    keys = {
      publicKey: gen.publicKey,
      privateKey: gen.privateKey,
      createdAt: Date.now()
    };
    await ref.set(keys);
  }
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  cachedVapid = keys;
  return keys;
}

export async function getVapidPublicKey(firestore) {
  const keys = await ensureVapid(firestore);
  return keys.publicKey;
}

export async function saveSubscription(firestore, { subscription, tzOffsetMinutes = 0 }) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error('INVALID_SUBSCRIPTION');
  }
  const id = subDocId(subscription.endpoint);
  await firestore.collection('push_subscriptions').doc(id).set({
    subscription,
    tzOffsetMinutes: Number(tzOffsetMinutes) || 0,
    updatedAt: Date.now()
  });
  return id;
}

export async function removeSubscription(firestore, endpoint) {
  if (!endpoint) return;
  const id = subDocId(endpoint);
  await firestore.collection('push_subscriptions').doc(id).delete();
}

async function sendToSubscription(firestore, docSnap, payloadObj) {
  const data = docSnap.data();
  if (!data?.subscription?.endpoint) return { sent: false, removed: false };
  try {
    await webpush.sendNotification(data.subscription, JSON.stringify(payloadObj));
    return { sent: true, removed: false };
  } catch (err) {
    if (err?.statusCode === 404 || err?.statusCode === 410) {
      await docSnap.ref.delete();
      return { sent: false, removed: true };
    }
    console.warn('WebPush error:', err?.statusCode || err?.message);
    return { sent: false, removed: false };
  }
}

export async function sendTestPush(firestore) {
  await ensureVapid(firestore);
  const subsSnap = await firestore.collection('push_subscriptions').get();
  let sent = 0;
  let removed = 0;
  for (const doc of subsSnap.docs) {
    const res = await sendToSubscription(firestore, doc, {
      title: 'Ma prière quotidienne',
      body: 'Les notifications Push iPhone sont activées pour vos neuvaines.',
      url: APP_URL,
      tag: 'mpq-test'
    });
    if (res.sent) sent += 1;
    if (res.removed) removed += 1;
  }
  return { ok: true, sent, removed };
}

function getLocalDateAndMinutes(utcMs, tzOffsetMinutes) {
  // JS getTimezoneOffset() = UTC - local en minutes (ex: -60 pour UTC+1)
  const localMs = utcMs - (Number(tzOffsetMinutes) || 0) * 60000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    localDate: `${y}-${m}-${day}`,
    localMinutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

function computeDayIndex(startDateStr, localDateStr) {
  const start = Date.parse(`${startDateStr}T00:00:00Z`);
  const cur = Date.parse(`${localDateStr}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(cur)) return 0;
  return Math.floor((cur - start) / 86400000) + 1;
}

export async function checkAndSendDueReminders(firestore) {
  await ensureVapid(firestore);
  const stateSnap = await firestore.collection('app_data').doc('default').get();
  if (!stateSnap.exists) return { ok: true, sent: 0, checked: 0 };

  const data = stateSnap.data() || {};
  const novenas = (data.novenas || []).filter((n) => n?.reminder?.enabled);
  const prayersById = new Map((data.prayers || []).map((p) => [p.id, p]));
  if (novenas.length === 0) return { ok: true, sent: 0, checked: 0 };

  const subsSnap = await firestore.collection('push_subscriptions').get();
  if (subsSnap.empty) return { ok: true, sent: 0, checked: 0 };

  const nowUtc = Date.now();
  let sent = 0;

  for (const subDoc of subsSnap.docs) {
    const subData = subDoc.data() || {};
    const { localDate, localMinutes } = getLocalDateAndMinutes(nowUtc, subData.tzOffsetMinutes);

    for (const n of novenas) {
      const totalDays = Math.max(1, Number(n.totalDays) || 9);
      const dayIdx = computeDayIndex(n.startDate, localDate);
      if (dayIdx < 1 || dayIdx > totalDays) continue;
      if ((n.completedDays || []).includes(dayIdx)) continue;

      const [hhStr, mmStr] = String(n.reminder?.time || '08:00').split(':');
      const remMinutes = (Number(hhStr) || 8) * 60 + (Number(mmStr) || 0);
      if (localMinutes < remMinutes || localMinutes >= remMinutes + 20) continue;

      const sentDocId = `${n.id}_${localDate}_${subDoc.id}`.slice(0, 120);
      const sentRef = firestore.collection('push_sent').doc(sentDocId);
      const sentSnap = await sentRef.get();
      if (sentSnap.exists) continue;

      const linkedPrayer = n.prayerId ? prayersById.get(n.prayerId) : null;
      const bodyParts = [`Jour ${dayIdx}/${totalDays}`];
      if (linkedPrayer?.title) bodyParts.push(linkedPrayer.title);
      if (n.intention) bodyParts.push(n.intention);

      const res = await sendToSubscription(firestore, subDoc, {
        title: `Prière : ${n.title || 'Neuvaine'}`,
        body: bodyParts.join(' — '),
        url: APP_URL,
        tag: `novena-${n.id}-${localDate}`
      });
      if (res.sent) {
        sent += 1;
        await sentRef.set({ novenaId: n.id, localDate, sentAt: nowUtc });
      }
    }
  }

  return { ok: true, sent, checked: subsSnap.size };
}
