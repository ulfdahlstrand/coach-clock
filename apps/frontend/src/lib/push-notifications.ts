export type PushSupport =
  | { readonly supported: true; readonly installed: boolean }
  | { readonly supported: false; readonly reason: string };

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function getPushSupport(): PushSupport {
  if (
    !('serviceWorker' in navigator) ||
    !('PushManager' in window) ||
    !('Notification' in window)
  ) {
    return { supported: false, reason: 'Webbnotiser stöds inte av den här webbläsaren.' };
  }
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIos && !isStandalone()) {
    return {
      supported: false,
      reason:
        'På iPhone och iPad fungerar notiser först när Coach Clock har installerats på hemskärmen (iOS 16.4+).',
    };
  }
  return { supported: true, installed: isStandalone() };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const configuredPublicKey: unknown = import.meta.env.VITE_VAPID_PUBLIC_KEY;
const publicKey = typeof configuredPublicKey === 'string' ? configuredPublicKey : undefined;

export async function createPushSubscription(): Promise<PushSubscription> {
  if (typeof publicKey !== 'string' || publicKey.length === 0) {
    throw new Error('Bytesnotiser är inte konfigurerade på servern ännu.');
  }
  const registration = await navigator.serviceWorker.ready;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notiser är inte tillåtna på den här enheten.');
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(publicKey),
  });
}
