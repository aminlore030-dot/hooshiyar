'use client';

/** Persian formatting helpers (dates, numbers, relative time). */

export function faDate(ts: number | Date): string {
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
  }).format(ts);
}

export function faDateTime(ts: number | Date): string {
  return new Intl.DateTimeFormat('fa-IR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(ts);
}

export function faTime(ts: number | Date): string {
  return new Intl.DateTimeFormat('fa-IR', { timeStyle: 'short' }).format(ts);
}

/** «۵ دقیقه پیش» style relative time. */
export function faRelative(ts: number): string {
  const rtf = new Intl.RelativeTimeFormat('fa-IR', { numeric: 'auto' });
  const diffMs = ts - Date.now();
  const mins = Math.round(diffMs / 60_000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(diffMs / 86_400_000);
  return rtf.format(days, 'day');
}

/** Convert ASCII digits to Persian digits. */
export function faDigits(s: string | number): string {
  const fa = '۰۱۲۳۴۵۶۷۸۹';
  return String(s).replace(/\d/g, (d) => fa[Number(d)]);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${faDigits(n)} بایت`;
  if (n < 1024 * 1024) return `${faDigits((n / 1024).toFixed(1))} کیلوبایت`;
  return `${faDigits((n / 1024 / 1024).toFixed(1))} مگابایت`;
}
