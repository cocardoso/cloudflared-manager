export function formatDuration(fromIso: string | null, now = Date.now()): string | null {
  if (!fromIso) return null;
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function formatRelative(iso: string, lng: string, now = Date.now()) {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const rtf = new Intl.RelativeTimeFormat(lng, { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export const formatDateTime = (iso: string, lng: string) => new Date(iso).toLocaleString(lng);

/** "gru01" → "GRU", de-duplicated. */
export const coloCodes = (colos: string[]) => [...new Set(colos.map((c) => c.replace(/\d+$/, '').toUpperCase()))];
