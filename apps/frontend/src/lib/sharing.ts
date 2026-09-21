/** Gör koden lätt att läsa och skriva: tre tecken, bindestreck, tre tecken. */
export function formatJoinCode(code: string): string {
  const compact = code
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase()
    .slice(0, 6);
  return compact.length > 3 ? `${compact.slice(0, 3)}-${compact.slice(3)}` : compact;
}

/** API:t accepterar sex tecken utan bindestreck. */
export function normalizeJoinCode(code: string): string {
  return code
    .replace(/[^0-9a-z]/gi, '')
    .toUpperCase()
    .slice(0, 6);
}

export function roleLabel(role: 'owner' | 'coach' | 'referee' | 'viewer'): string {
  return { owner: 'Ägare', coach: 'Tränare', referee: 'Domare', viewer: 'Tittare' }[role];
}

export function lastSeenLabel(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1_000));
  if (seconds < 60) return 'just nu';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min sedan`;
  return `${Math.floor(minutes / 60)} h sedan`;
}
