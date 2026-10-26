import { validMailbox, type BusinessEmailConfig } from "./config";

const labels: Record<string, readonly [string, string]> = {
  consultation_scheduled: [
    "Potwierdzono termin",
    "W panelu potwierdzono termin spotkania.",
  ],
  consultation_rescheduled: [
    "Zmieniono termin",
    "W panelu zapisano zmianę terminu spotkania.",
  ],
  consultation_cancelled: [
    "Odwołano termin",
    "W panelu zapisano odwołanie spotkania.",
  ],
  registration_changed: [
    "Potwierdzono udział",
    "W panelu potwierdzono udział w spacerze.",
  ],
  registration_cancelled: [
    "Odwołano udział",
    "W panelu zapisano odwołanie udziału w spacerze.",
  ],
  walk_changed: [
    "Zmieniono termin spaceru",
    "W panelu zapisano zmianę dotyczącą spaceru.",
  ],
  walk_cancelled: ["Odwołano spacer", "W panelu zapisano odwołanie spaceru."],
  course_enrollment_accepted: [
    "Potwierdzono udział w kursie",
    "W panelu potwierdzono udział w kursie.",
  ],
  course_session_rescheduled: [
    "Zmieniono termin spotkania",
    "W panelu zapisano zmianę terminu spotkania kursu.",
  ],
  course_session_cancelled: [
    "Odwołano spotkanie",
    "W panelu zapisano odwołanie spotkania kursu.",
  ],
  course_cancelled: ["Odwołano kurs", "W panelu zapisano odwołanie kursu."],
  fitness_session_scheduled: [
    "Potwierdzono termin",
    "W panelu potwierdzono termin spotkania fitness.",
  ],
  fitness_session_rescheduled: [
    "Zmieniono termin",
    "W panelu zapisano zmianę terminu spotkania fitness.",
  ],
  fitness_session_cancelled: [
    "Odwołano termin",
    "W panelu zapisano odwołanie spotkania fitness.",
  ],
  fitness_cancelled: [
    "Odwołano pakiet fitness",
    "W panelu zapisano odwołanie pakietu fitness. Sprawdź aktualny stan spotkań w panelu.",
  ],
  consultation_reminder: [
    "Przypomnienie o spotkaniu",
    "Zbliża się umówione spotkanie. Sprawdź aktualny termin w panelu.",
  ],
  walk_reminder: [
    "Przypomnienie o spacerze",
    "Zbliża się umówiony spacer. Sprawdź aktualny termin w panelu.",
  ],
  course_reminder: [
    "Przypomnienie o kursie",
    "Zbliża się spotkanie kursu. Sprawdź aktualny termin w panelu.",
  ],
  fitness_reminder: [
    "Przypomnienie o fitness",
    "Zbliża się spotkanie fitness. Sprawdź aktualny termin w panelu.",
  ],
  payment_confirmed: [
    "Potwierdzono wpłatę",
    "W panelu zapisano potwierdzoną wpłatę. Jej kwotę i rozliczenie sprawdzisz w historii wpłat.",
  ],
};

export type EmailMessageData = {
  recipient: string;
  recipient_role: "admin" | "client";
  kind: string;
  entity_id: string;
  enrollment_id: string | null;
  session_id: string | null;
};
export type BusinessEmailMessage = {
  from: string;
  to: string;
  replyTo?: string;
  messageId: string;
  subject: string;
  text: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildBusinessEmail(
  config: BusinessEmailConfig,
  jobId: string,
  data: EmailMessageData,
): BusinessEmailMessage {
  if (
    !uuid.test(jobId) ||
    !uuid.test(data.entity_id) ||
    (data.enrollment_id !== null && !uuid.test(data.enrollment_id)) ||
    (data.session_id !== null && !uuid.test(data.session_id)) ||
    !["admin", "client"].includes(data.recipient_role) ||
    !validMailbox(data.recipient) ||
    !Object.hasOwn(labels, data.kind)
  )
    throw new Error("Invalid email message");
  const base = data.recipient_role === "admin" ? "/admin" : "/app";
  let path: string;
  if (data.kind === "payment_confirmed")
    path = `${base}/finance#payment-${data.entity_id}`;
  else if (data.kind.startsWith("consultation_"))
    path = `${base}/consultations/${data.entity_id}`;
  else if (
    data.kind.startsWith("walk_") ||
    data.kind.startsWith("registration_")
  )
    path = `${base}/walks/${data.entity_id}`;
  else if (data.kind.startsWith("course_"))
    path = `${base}/courses/${data.entity_id}${data.enrollment_id ? `?enrollment=${data.enrollment_id}` : ""}${data.session_id ? `#spotkanie-${data.session_id}` : ""}`;
  else
    path = `${base}/fitness/${data.entity_id}${data.session_id ? `#spotkanie-${data.session_id}` : ""}`;
  const [subject, body] = labels[data.kind];
  return {
    from: config.from,
    to: data.recipient,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    messageId: `<business-${jobId}@${new URL(config.appOrigin).hostname.replace(/^\[|\]$/g, "")}>`,
    subject: `Psi Pawer — ${subject}`,
    text: `${body}\n\nOtwórz panel Psi Pawer:\n${config.appOrigin}${path}\n\nSzczegóły są dostępne po zalogowaniu.${data.kind === "payment_confirmed" ? "\nTa wiadomość jest informacją o zapisie wpłaty w aplikacji, nie jest fakturą ani paragonem." : ""}`,
  };
}
