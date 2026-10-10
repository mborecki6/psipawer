"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import { calendarWrite, calendarWarning } from "../calendar/write";
import {
  createCourseSchema,
  courseChangeSchema,
  enrollmentSchema,
  decisionSchema,
  rescheduleSchema,
  sessionChangeSchema,
  attendanceSchema,
  courseSettingsSchema,
  attendanceCorrectionSchema,
  reopeningSchema,
} from "./schemas";

export type CourseActionState = ActionState & { version?: number };
const allowed = new Set([
  "Sprawdź prowadzącego i miejsce zajęć.",
  "Przypisanie zmieniło się. Odśwież widok przed zapisem.",
  "Wybierz aktywnego członka zespołu.",
  "Wybierz aktywne miejsce.",
  "Ten czas jest już zajęty dla wybranego prowadzącego lub sali. Sprawdź kalendarz.",
  "Termin wykracza poza godziny pracy prowadzącego. Sprawdź ustawienia kalendarza.",
  "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
  "Termin kursu nakłada się na inne zajęcia lub blokadę. Sprawdź kalendarz.",
  "Oferta zmieniła się. Odśwież formularz i sprawdź cenę.",
  "Ta usługa nie jest dostępna jako kurs.",
  "Kurs indywidualny ma miejsce dla jednego psa z opiekunem.",
  "Podaj termin każdego spotkania kursu.",
  "Terminy kursu muszą być przyszłe, uporządkowane i nie mogą się nakładać.",
  "Kurs zmienił się. Odśwież widok przed zapisem.",
  "Zapisy można otworzyć przed pierwszym spotkaniem kursu.",
  "Najpierw zakończ lub odwołaj spotkania kursu.",
  "Ta zmiana kursu nie jest dostępna.",
  "Zgłoszenie zmieniło się. Odśwież widok przed zapisem.",
  "Spotkanie zmieniło się. Odśwież widok przed zapisem.",
  "Obecność zmieniła się. Odśwież widok przed zapisem.",
  "Obecność zapisz po rozpoczęciu spotkania dla przyjętego uczestnika.",
  "Poczekaj do końca spotkania i uzupełnij obecności uczestników.",
  "Zapisy na ten kurs są zamknięte.",
  "Ten pies ma już zgłoszenie na kurs.",
  "Ta zmiana zgłoszenia nie jest dostępna.",
  "Brak wolnych miejsc na kursie.",
  "Można przełożyć tylko przyszłe spotkanie kursu.",
  "Zachowaj kolejność i odstęp między spotkaniami kursu.",
  "Ta zmiana spotkania nie jest dostępna.",
  "Ten zapis ustawień został już użyty. Odśwież widok przed kolejną zmianą.",
  "Ustawienia zmienisz tylko w szkicu lub trwającym kursie.",
  "Liczba miejsc nie może być mniejsza od liczby przyjętych psów.",
  "Korekta dotyczy zapisanej obecności na zakończonym spotkaniu.",
  "Wybierz inną obecność niż aktualnie zapisana.",
  "Opiekun psa zmienił się. Historycznego zgłoszenia nie można przywrócić.",
  "Powrót jest dostępny tylko przed pierwszym spotkaniem aktywnego kursu.",
]);
function failure(message?: string): CourseActionState {
  return {
    error:
      message && allowed.has(message)
        ? message
        : "Nie udało się zapisać zmiany kursu. Wpisane dane pozostają w formularzu. Odśwież widok, sprawdź warunki i spróbuj ponownie.",
  };
}
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
export async function createCourse(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = createCourseSchema.safeParse({
    ...Object.fromEntries(form),
    starts: form.getAll("starts"),
  });
  if (!parsed.success)
    return {
      error:
        "Sprawdź nazwę, liczbę miejsc, oba opisy zbiórki i każdy termin (czas polski).",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    const { data, error } = await calendarWrite(
      db,
      "create_course",
      {
        p_id: p.id,
        p_service: p.service_id,
        p_expected_service_version: p.service_version,
        p_title: p.title,
        p_capacity: p.capacity,
        p_public_location: p.public_location,
        p_exact_location: p.exact_location,
        p_starts: p.starts,
      },
      form,
    );
    const warning = calendarWarning(error);
    if (warning) return warning;
    if (error || data !== p.id) return failure(error?.message);
  } catch {
    return failure();
  }
  refresh();
  redirect(`/admin/courses/${p.id}`);
}
export async function requestEnrollment(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("client");
  const parsed = enrollmentSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Wybierz swojego psa i aktualny kurs." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("request_course_enrollment", {
      p_id: p.id,
      p_course: p.course_id,
      p_dog: p.dog_id,
      p_expected_course_version: p.course_version,
    });
    if (error || data !== p.id) return failure(error?.message);
  } catch {
    return failure();
  }
  refresh();
  return {
    success:
      "Zgłoszenie zapisane. Przyjęcie potwierdzi prowadząca; samo zgłoszenie nie rezerwuje miejsca.",
  };
}
export async function changeCourse(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = courseChangeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Wybierz zmianę kursu. Odwołanie wymaga powodu (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const args = {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_note: p.note,
    };
    const { data, error } =
      p.intent === "publish"
        ? await calendarWrite(db, "change_course", args, form)
        : await db.rpc("change_course", args);
    const warning = calendarWarning(error);
    if (warning) return warning;
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return { version: data, success: "Zmiana kursu zapisana." };
  } catch {
    return failure();
  }
}
export async function decideEnrollment(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const parsed = decisionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz decyzję. Odmowa i rezygnacja wymagają powodu (3–3000 znaków).",
    };
  const p = parsed.data;
  const { db } = await requireSession(
    p.intent === "cancel" ? undefined : "admin",
  );
  try {
    const { data, error } = await db.rpc("change_course_enrollment", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_note: p.note,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return { version: data, success: "Decyzja zapisana." };
  } catch {
    return failure();
  }
}
export async function reopenEnrollment(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = reopeningSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Wybierz powrót do zgłoszenia i podaj powód (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("reopen_course_enrollment", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_note: p.note,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        p.intent === "restore"
          ? "Udział przywrócony z wcześniejszą ceną całego cyklu. Wpłaty i zwroty pozostały w ewidencji."
          : "Zgłoszenie wróciło do decyzji. Miejsce wymaga osobnego przyjęcia przez prowadzącą.",
    };
  } catch {
    return failure();
  }
}
export async function rescheduleSession(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Sprawdź termin, oba opisy zbiórki i powód zmiany (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await calendarWrite(
      db,
      "reschedule_course_session",
      {
        p_id: p.id,
        p_expected_version: p.expected_version,
        p_starts_at: p.starts_at,
        p_note: p.note,
        p_public_location: p.public_location,
        p_exact_location: p.exact_location,
      },
      form,
    );
    const warning = calendarWarning(error);
    if (warning) return warning;
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        "Termin i zbiórka tego spotkania zapisane. Pozostałe spotkania zachowały swoje dane.",
    };
  } catch {
    return failure();
  }
}
export async function changeSession(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = sessionChangeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz zmianę spotkania i podaj powód odwołania (3–3000 znaków).",
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("change_course_session", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_action: p.intent,
      p_note: p.note,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return { version: data, success: "Zmiana spotkania zapisana." };
  } catch {
    return failure();
  }
}
export async function recordAttendance(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = attendanceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Wybierz uczestnika i obecność na tym spotkaniu." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("record_course_attendance", {
      p_session: p.session_id,
      p_enrollment: p.enrollment_id,
      p_expected_version: p.expected_version,
      p_attendance: p.attendance,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return { version: data, success: "Obecność zapisana." };
  } catch {
    return failure();
  }
}

export async function editCourse(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = courseSettingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Sprawdź nazwę, liczbę miejsc i powód zmiany kursu." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("edit_course", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_title: p.title,
      p_capacity: p.capacity,
      p_note: p.note,
      p_request_id: p.request_id,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return {
      version: data,
      success: "Ustawienia cyklu zapisane. Ceny i terminy pozostały bez zmian.",
    };
  } catch {
    return failure();
  }
}

export async function correctAttendance(
  _: CourseActionState,
  form: FormData,
): Promise<CourseActionState> {
  const { db } = await requireSession("admin");
  const parsed = attendanceCorrectionSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Wybierz zapisaną obecność i podaj powód korekty." };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("correct_course_attendance", {
      p_session: p.session_id,
      p_enrollment: p.enrollment_id,
      p_expected_version: p.expected_version,
      p_attendance: p.attendance,
      p_note: p.note,
    });
    if (error || !Number.isInteger(data)) return failure(error?.message);
    refresh();
    return {
      version: data,
      success:
        "Korekta obecności zapisana z powodem. Należność za kurs pozostała bez zmian.",
    };
  } catch {
    return failure();
  }
}
