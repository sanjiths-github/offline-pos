function deviceDate(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

function sqliteUtcDate(value) {
  if (!value) return null;
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function deviceDateTime(value) {
  const parsed = sqliteUtcDate(value);
  return parsed
    ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(parsed)
    : '';
}

module.exports = { deviceDate, sqliteUtcDate, deviceDateTime };
