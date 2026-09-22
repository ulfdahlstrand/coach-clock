/** Presentation helpers for the live fair-play controls. */
export function fairnessTileClass(debtMs: number | undefined, thresholdMs: number): string {
  if (debtMs === undefined) return 'border-orange-200/65 bg-orange-400 text-slate-950';
  if (debtMs >= thresholdMs) return 'border-rose-100/80 bg-rose-400 text-slate-950';
  if (debtMs > 0) return 'border-amber-100/80 bg-amber-300 text-slate-950';
  return 'border-sky-100/60 bg-sky-300 text-slate-950';
}

/** Alerts are edge-triggered so a due substitution does not buzz every render. */
export function becameSubstitutionDue(wasDue: boolean, isDue: boolean): boolean {
  return !wasDue && isDue;
}

export function formatNextSubstitution(milliseconds: number | null): string {
  if (milliseconds === null) return '—';
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
}

type AlertNavigator = Navigator & { vibrate?: (pattern: number | readonly number[]) => boolean };

/**
 * Gives a short, best-effort sideline alert. iOS Safari intentionally has no
 * Vibration API, so callers always render a visual full-screen alert too.
 */
export function playFairnessAlert(): 'audio-and-vibrate' | 'audio-only' | 'visual-only' {
  let audioPlayed = false;
  try {
    const Context = window.AudioContext;
    if (Context !== undefined) {
      const context = new Context();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.06, context.currentTime);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.16);
      void context.close();
      audioPlayed = true;
    }
  } catch {
    // Audio is optional: the visual notification remains the reliable fallback.
  }
  const vibrated = (navigator as AlertNavigator).vibrate?.([100, 70, 130]) === true;
  return audioPlayed && vibrated ? 'audio-and-vibrate' : audioPlayed ? 'audio-only' : 'visual-only';
}
