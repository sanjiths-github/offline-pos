export function deviceDate(date: Date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

export function sqliteUtcDate(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deviceDateTime(value?: string | null) {
  const parsed = sqliteUtcDate(value);
  return parsed
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(parsed)
    : '—';
}
