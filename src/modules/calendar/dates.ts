import { warsawLocalToISO } from "../../lib/time";
export function localDate(value: string | Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
export function addDays(day: string, count: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function weekRange(value?: string, now = new Date()) {
  const valid =
    typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const focus = valid ? value : localDate(now);
  const dayIndex = (new Date(`${focus}T12:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(focus, -dayIndex);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return {
    start,
    days,
    from: warsawLocalToISO(`${start}T00:00`),
    to: warsawLocalToISO(`${addDays(start, 7)}T00:00`),
    previous: addDays(start, -7),
    next: addDays(start, 7),
  };
}
export function onDay(
  item: { starts_at: string; ends_at: string },
  day: string,
) {
  return (
    Date.parse(item.starts_at) <
      Date.parse(warsawLocalToISO(`${addDays(day, 1)}T00:00`)) &&
    Date.parse(item.ends_at) > Date.parse(warsawLocalToISO(`${day}T00:00`))
  );
}
export function clockTime(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function dayLabel(day: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T12:00:00Z`));
}
