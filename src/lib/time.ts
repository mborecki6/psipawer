// Warsaw wall-clock input, independent of the server/browser timezone. Reject DST gaps.
export function warsawLocalToISO(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Invalid date");
  const base = Date.parse(`${value}:00Z`);
  for (const offset of [60, 120]) {
    const date = new Date(base - offset * 60000);
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(date)
      .replace(" ", "T");
    if (parts === value) return date.toISOString();
  }
  throw new Error("Invalid Warsaw wall-clock date");
}
