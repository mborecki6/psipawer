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
export function validCalendarDate(value?: string, now = new Date()) {
  return typeof value === "string" &&
    /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
    ? value
    : localDate(now);
}
export function weekRange(value?: string, now = new Date()) {
  const focus = validCalendarDate(value, now);
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
export function monthRange(value?: string, now = new Date()) {
  const focus = validCalendarDate(value, now);
  const first = `${focus.slice(0, 7)}-01`;
  const nextMonth = new Date(`${first}T12:00:00Z`);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const next = nextMonth.toISOString().slice(0, 10);
  const previousMonth = new Date(`${first}T12:00:00Z`);
  previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1);
  const start = weekRange(first).start;
  const lastWeek = weekRange(addDays(next, -1));
  const end = addDays(lastWeek.start, 7);
  const length = Math.round(
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
      86400000,
  );
  return {
    start,
    days: Array.from({ length }, (_, index) => addDays(start, index)),
    from: warsawLocalToISO(`${start}T00:00`),
    to: warsawLocalToISO(`${end}T00:00`),
    previous: previousMonth.toISOString().slice(0, 10),
    next,
  };
}
export function appointmentAnchor(
  item: { kind: string; id: string; starts_at: string },
  day = localDate(item.starts_at),
) {
  return `appointment-${item.kind}-${item.id}-${Date.parse(item.starts_at)}-${day}`;
}
export function calendarAppointmentHref(
  base: "/admin" | "/app",
  item: { kind: string; id: string; starts_at: string },
) {
  const date = localDate(item.starts_at);
  const event = `${item.kind}:${item.id}:${Date.parse(item.starts_at)}`;
  return `${base}/calendar?date=${date}&event=${encodeURIComponent(event)}#${appointmentAnchor(item)}`;
}
export function isAllDayBlock(item: { starts_at: string; ends_at: string }) {
  return (
    clockTime(item.starts_at) === "00:00" && clockTime(item.ends_at) === "00:00"
  );
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
