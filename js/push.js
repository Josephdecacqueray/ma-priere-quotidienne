import { SYNC_API_URL } from './sync.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushSubscription() {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush() {
  if (!isPushSupported()) {
    throw new Error('PUSH_UNSUPPORTED');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error('PERMISSION_DENIED');
  }

  const keyResp = await fetch(`${SYNC_API_URL}/api/push/vapid-public-key`);
  if (!keyResp.ok) throw new Error('VAPID_FETCH_FAILED');
  const { publicKey } = await keyResp.json();
  if (!publicKey) throw new Error('VAPID_MISSING');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
  }

  const saveResp = await fetch(`${SYNC_API_URL}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscription: sub.toJSON(),
      tzOffsetMinutes: new Date().getTimezoneOffset()
    })
  });
  if (!saveResp.ok) throw new Error('SUBSCRIBE_SAVE_FAILED');

  return sub;
}

export async function unsubscribeFromPush() {
  const sub = await getPushSubscription();
  if (!sub) return false;
  try {
    await fetch(`${SYNC_API_URL}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
  } catch {
    // Ignoré si hors-ligne
  }
  await sub.unsubscribe();
  return true;
}

export async function sendTestPush() {
  const resp = await fetch(`${SYNC_API_URL}/api/push/test`, {
    method: 'POST'
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
