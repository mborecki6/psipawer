export const workKinds = {
  followups: "Kontakty kontrolne",
  consultations: "Konsultacje",
  progress: "Odpowiedzi o postępach",
  profiles: "Psy do kwalifikacji",
  walks: "Zapisy na spacery",
  fitness: "PSI FITNESS",
};
export type WorkKind = keyof typeof workKinds;
export type WorkItem = {
  kind: WorkKind;
  id: string;
  dog_id: string;
  dog_name: string;
  title: string;
  due_on: string | null;
  created_at: string;
  priority: number;
  source_id: string;
};
export type WorkCount = { kind: WorkKind; total: number; overdue: number };
export const followUpStates = {
  open: "Do kontaktu",
  done: "Kontakt zakończony",
  cancelled: "Kontakt odwołany",
  superseded: "Zastąpiony nowym planem",
};
export type FollowUp = {
  id: string;
  plan_id: string;
  dog_id: string;
  due_on: string;
  status: keyof typeof followUpStates;
  version: number;
  created_at: string;
  closed_at: string | null;
};
export const followUpActions = {
  scheduled: "Zaplanowano kontakt",
  rescheduled: "Przełożono kontakt",
  completed: "Zakończono kontakt",
  cancelled: "Odwołano kontakt",
  reopened: "Ponownie zaplanowano",
  superseded: "Opublikowano nowszy plan",
};
export type FollowUpHistory = {
  version: number;
  action: keyof typeof followUpActions;
  due_on: string;
  note: string;
  created_at: string;
};
export function workFilter(value?: string): WorkKind | "all" {
  return value && Object.hasOwn(workKinds, value) ? (value as WorkKind) : "all";
}
export function workPage(value?: string) {
  return value && /^\d{1,6}$/.test(value)
    ? Math.min(50000, Math.max(1, Number(value)))
    : 1;
}
export function workHref(item: WorkItem) {
  if (item.kind === "followups") return `/admin/work/follow-ups/${item.id}`;
  if (item.kind === "progress") return `/admin/work/progress/${item.id}`;
  if (item.kind === "walks")
    return `/admin/walks/${item.source_id}#registration-${item.id}`;
  if (item.kind === "consultations") return `/admin/consultations/${item.id}`;
  if (item.kind === "fitness") return `/admin/fitness/${item.id}`;
  return `/admin/dogs/${item.dog_id}`;
}
