const VISIT_KEY = 'coach-clock.install-visits';
const DISMISSED_UNTIL_KEY = 'coach-clock.install-dismissed-until';

export const REQUIRED_VISITS_BEFORE_PROMPT = 2;
export const DISMISS_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

export function nextVisitCount(storage: Storage): number {
  const previousVisits = Number.parseInt(storage.getItem(VISIT_KEY) ?? '0', 10);
  const visits = Number.isFinite(previousVisits) ? previousVisits + 1 : 1;
  storage.setItem(VISIT_KEY, String(visits));
  return visits;
}

export function canShowInstallPrompt(storage: Storage, now: number): boolean {
  const dismissedUntil = Number.parseInt(storage.getItem(DISMISSED_UNTIL_KEY) ?? '0', 10);
  return !Number.isFinite(dismissedUntil) || dismissedUntil <= now;
}

export function dismissInstallPrompt(storage: Storage, now: number): void {
  storage.setItem(DISMISSED_UNTIL_KEY, String(now + DISMISS_DURATION_MS));
}

export function isAppleMobileBrowser(navigator: Navigator): boolean {
  const userAgent = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(userAgent) && !('standalone' in navigator && navigator.standalone);
}

export function isStandaloneDisplayMode(window: Window): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}
