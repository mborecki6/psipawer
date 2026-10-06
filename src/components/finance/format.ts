const shortDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  timeZone: "Europe/Warsaw",
  day: "numeric",
  month: "short",
  year: "numeric",
});
export function shortDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}
