"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import {
  dogSchema,
  behaviorSchema,
  walkSchema,
  uuid,
  dogStatuses,
} from "@/lib/validation/schemas";
import type { ActionState } from "@/components/action-form";
import { warsawLocalToISO } from "@/lib/time";
import { calendarWrite, calendarWarning } from "../../modules/calendar/write";
import { prepareAvatarPhoto } from "../avatar-photo";
import {
  cleanupRetiredAvatar,
  cleanupUnattachedUpload,
  reserveAvatarUpload,
  type AvatarState,
} from "./avatar-cleanup";
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
function issue(message: string): ActionState {
  return { error: message };
}
function dbError(message: string): ActionState {
  const allowed = [
    "Sprawdź prowadzącego i miejsce zajęć.",
    "Przypisanie zmieniło się. Odśwież widok przed zapisem.",
    "Wybierz aktywnego członka zespołu.",
    "Wybierz aktywne miejsce.",
    "Ten czas jest już zajęty dla wybranego prowadzącego lub sali. Sprawdź kalendarz.",
    "Termin wykracza poza godziny pracy prowadzącego. Sprawdź ustawienia kalendarza.",
    "Termin wraz z przerwami wykracza poza godziny pracy. Sprawdź ustawienia kalendarza.",
    "Ten czas jest już zajęty przez spacer, konsultację lub blokadę. Sprawdź kalendarz.",
    "Brak wolnych miejsc.",
    "Spacer zmienił się w międzyczasie. Odśwież formularz przed zapisem.",
    "Nie można edytować rozpoczętego lub odwołanego spaceru.",
    "Po pierwszym zgłoszeniu cena, tryb zapisów i zasady odwołania pozostają bez zmian.",
    "Limit nie może być mniejszy od zaakceptowanego składu.",
    "Nie można zmieniać zgłoszeń po rozpoczęciu lub odwołaniu spaceru.",
    "Nie można odwołać rozpoczętego spaceru.",
    "Zgłoszenie już istnieje.",
    "Spacer tylko na zaproszenie.",
    "Zapisy są zamknięte.",
    "Profil psa wymaga akceptacji behawiorysty.",
    "Najpierw zakwalifikuj psa w jego profilu.",
    "Przed zapisem skontaktuj się z behawiorystą.",
    "Nie można już zaakceptować zgłoszenia.",
    "Niedozwolona zmiana statusu.",
    "Spacer jeszcze się nie rozpoczął.",
    "Nie można odwołać tego zgłoszenia.",
  ];
  return issue(
    allowed.includes(message)
      ? message
      : "Nie udało się zapisać zmiany. Odśwież stronę i spróbuj ponownie.",
  );
}
export async function saveDog(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user, role } = await requireSession();
  const result = dogSchema.safeParse(Object.fromEntries(form));
  if (!result.success)
    return {
      error: "Sprawdź dane psa.",
      fields: result.error.flatten().fieldErrors,
    };
  const id = form.get("id");
  let dogId: string;
  if (id) {
    if (!uuid.safeParse(id).success) return issue("Nieprawidłowy profil.");
    const { data: dog } = await db
      .from("dogs")
      .select("id,guardian_id")
      .eq("id", id)
      .single();
    if (!dog || (role !== "admin" && dog.guardian_id !== user.id))
      return issue("Nie masz dostępu do tego psa.");
    const { error } = await db.from("dogs").update(result.data).eq("id", id);
    if (error) return dbError(error.message);
    dogId = String(id);
  } else {
    const { data, error } = await db
      .from("dogs")
      .insert({ ...result.data, guardian_id: user.id })
      .select("id")
      .single();
    if (error) return dbError(error.message);
    dogId = data.id;
  }
  refresh();
  redirect(`${role === "admin" ? "/admin" : "/app"}/dogs/${dogId}?saved=1`);
}
export async function saveBehavior(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user, role } = await requireSession();
  const id = uuid.safeParse(form.get("dog_id"));
  const result = behaviorSchema.safeParse(Object.fromEntries(form));
  if (!id.success || !result.success)
    return issue("Sprawdź dane kwestionariusza.");
  const { data: dog } = await db
    .from("dogs")
    .select("guardian_id")
    .eq("id", id.data)
    .single();
  if (!dog || (role !== "admin" && dog.guardian_id !== user.id))
    return issue("Brak dostępu do profilu.");
  const { error } = await db
    .from("dog_behavior_profiles")
    .upsert({ ...result.data, dog_id: id.data });
  if (error) return dbError(error.message);
  refresh();
  return {
    success:
      "Kwestionariusz zapisany. Zmiana reakcji lub historii pogryzień wymaga ponownej oceny psa.",
  };
}
export async function createWalk(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const raw = Object.fromEntries(form);
  let starts_at: string;
  try {
    starts_at = warsawLocalToISO(String(raw.local_start));
  } catch {
    return issue("Podaj poprawną datę i godzinę w strefie Europe/Warsaw.");
  }
  const result = walkSchema.safeParse({
    ...raw,
    starts_at,
    price_cents: Math.round(Number(raw.price) * 100),
  });
  if (!result.success)
    return {
      error: "Sprawdź dane spaceru.",
      fields: result.error.flatten().fieldErrors,
    };
  const { data, error } = await calendarWrite(
    db,
    "create_walk",
    { payload: result.data },
    form,
  );
  const warning = calendarWarning(error);
  if (warning) return warning;
  if (error) return dbError(error.message);
  refresh();
  redirect(`/admin/walks/${data}?saved=1`);
}
export async function registerDog(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user } = await requireSession("client");
  const walk = uuid.safeParse(form.get("walk_id"));
  const dog = uuid.safeParse(form.get("dog_id"));
  if (!walk.success || !dog.success) return issue("Wybierz psa i spacer.");
  const { data: owned } = await db
    .from("dogs")
    .select("guardian_id")
    .eq("id", dog.data)
    .single();
  if (!owned || owned.guardian_id !== user.id)
    return issue("To nie jest Twój pies.");
  const { error } = await db.rpc("register_dog", {
    p_walk: walk.data,
    p_dog: dog.data,
  });
  if (error) return dbError(error.message);
  refresh();
  return {
    success:
      "Zgłoszenie zapisane. Aktualny status zobaczysz na karcie spaceru.",
  };
}
export async function decideRegistration(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const result = z
    .object({
      id: uuid,
      status: z.enum([
        "accepted",
        "waitlisted",
        "rejected",
        "pending",
        "cancelled_on_time",
        "cancelled_late",
      ]),
      note: z.string().max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success) return issue("Sprawdź dane decyzji.");
  const { error } = await db.rpc("decide_registration", {
    p_registration: result.data.id,
    p_status: result.data.status,
    p_note: result.data.note,
  });
  if (error) return dbError(error.message);
  refresh();
  return { success: "Decyzja zapisana." };
}
export async function cancelRegistration(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("client");
  const id = uuid.safeParse(form.get("id"));
  if (!id.success) return issue("Nieprawidłowe zgłoszenie.");
  const { error } = await db.rpc("cancel_registration", {
    p_registration: id.data,
  });
  if (error) return dbError(error.message);
  refresh();
  return {
    success: "Zgłoszenie odwołane. Termin odwołania został uwzględniony.",
  };
}
export async function setDogStatus(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const result = z
    .object({
      dog_id: uuid,
      status: z.enum(dogStatuses),
      note: z.string().trim().min(3).max(8000),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success) return issue("Wybierz status i podaj powód zmiany.");
  const { error } = await db.rpc("set_dog_status", {
    p_dog: result.data.dog_id,
    p_status: result.data.status,
    p_note: result.data.note,
  });
  if (error) return dbError(error.message);
  refresh();
  return { success: "Status psa został zmieniony." };
}
export async function addNote(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db, user } = await requireSession("admin");
  const result = z
    .object({
      dog_id: uuid,
      body: z.string().trim().min(1).max(8000),
      visibility: z.enum(["admin_only", "client_visible"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success) return issue("Uzupełnij notatkę.");
  const { error } = await db
    .from("dog_notes")
    .insert({ ...result.data, author_id: user.id });
  if (error) return dbError(error.message);
  refresh();
  return { success: "Notatka zapisana." };
}
export async function markAttendance(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const result = z
    .object({
      id: uuid,
      attendance: z.enum(["pending", "present", "absent", "no_show"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success) return issue("Wybierz obecność.");
  try {
    const { error } = await db.rpc("mark_attendance", {
      p_registration: result.data.id,
      p_attendance: result.data.attendance,
    });
    if (error?.message === "Brak dostępnych wejść w pakiecie.")
      return issue(
        "Brak dostępnych wejść w pakiecie. Sprawdź przypisane spacery w rozliczeniach i uzgodnij korektę wejścia przed ponownym zapisem obecności.",
      );
    if (error?.message === "Pakiet nie jest aktywny lub utracił ważność.")
      return issue(
        "Pakiet nie jest aktywny lub utracił ważność. Sprawdź jego rozliczenie przed korektą obecności.",
      );
    if (error) return dbError(error.message);
  } catch {
    return issue(
      "Nie udało się potwierdzić zapisu obecności. Twoje pole pozostaje w formularzu. Sprawdź aktualny stan spaceru i spróbuj ponownie.",
    );
  }
  refresh();
  return { success: "Obecność zapisana." };
}
export async function uploadAvatar(
  _: AvatarState,
  form: FormData,
): Promise<AvatarState> {
  const { db, user, role } = await requireSession();
  const id = uuid.safeParse(form.get("dog_id"));
  const file = form.get("photo");
  if (
    !id.success ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > 1500000
  )
    return issue("Wybierz zdjęcie JPG, PNG lub WebP do 1,5 MB.");
  const { data: dog } = await db
    .from("dogs")
    .select("guardian_id,avatar_path")
    .eq("id", id.data)
    .single();
  if (!dog || (role !== "admin" && dog.guardian_id !== user.id))
    return issue("Brak dostępu do psa.");
  const expected = String(form.get("expected_avatar_path") || "") || null;
  const conflict =
    "Zdjęcie psa zmieniło się. Odśwież kartę przed kolejną zmianą.";
  if (dog.avatar_path !== expected) return issue(conflict);
  let bytes: Buffer;
  try {
    bytes = await prepareAvatarPhoto(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    return issue(
      error instanceof Error ? error.message : "Nie można odczytać zdjęcia.",
    );
  }
  const path = `${dog.guardian_id}/${id.data}/${crypto.randomUUID()}.webp`;
  const uncertain =
    "Nie udało się potwierdzić zapisu zdjęcia. Sprawdź kartę psa i spróbuj ponownie.";
  try {
    await reserveAvatarUpload(db, id.data, "dog-avatars", path);
    const upload = await db.storage.from("dog-avatars").upload(path, bytes, {
      contentType: "image/webp",
      upsert: false,
    });
    if (upload.error) {
      await cleanupUnattachedUpload(db, "dog-avatars", path);
      return issue(uncertain);
    }
    const result = await db.rpc("set_dog_avatar", {
      p_dog: id.data,
      p_expected_path: expected,
      p_path: path,
    });
    if (result.error) {
      await cleanupUnattachedUpload(db, "dog-avatars", path);
      return issue(result.error.message === conflict ? conflict : uncertain);
    }
  } catch {
    await cleanupUnattachedUpload(db, "dog-avatars", path);
    return issue(uncertain);
  }
  await cleanupRetiredAvatar(db, "dog-avatars", expected);
  refresh();
  return { success: "Zdjęcie zapisane.", avatarPath: path };
}
export async function removeAvatar(
  _: AvatarState,
  form: FormData,
): Promise<AvatarState> {
  const { db } = await requireSession();
  const id = uuid.safeParse(form.get("dog_id"));
  const expected = String(form.get("expected_avatar_path") || "") || null;
  if (!id.success || (expected && expected.length > 500))
    return issue("Wybierz psa.");
  const conflict =
    "Zdjęcie psa zmieniło się. Odśwież kartę przed kolejną zmianą.";
  const uncertain =
    "Nie udało się potwierdzić usunięcia zdjęcia. Sprawdź kartę psa i spróbuj ponownie.";
  try {
    const result = await db.rpc("set_dog_avatar", {
      p_dog: id.data,
      p_expected_path: expected,
      p_path: null,
    });
    if (result.error)
      return issue(result.error.message === conflict ? conflict : uncertain);
  } catch {
    return issue(uncertain);
  }
  await cleanupRetiredAvatar(db, "dog-avatars", expected);
  refresh();
  return { success: "Zdjęcie usunięte z karty psa.", avatarPath: null };
}
export async function inviteDog(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const result = z
    .object({ walk_id: uuid, dog_id: uuid })
    .safeParse(Object.fromEntries(form));
  if (!result.success) return issue("Wybierz psa.");
  const { error } = await db.rpc("invite_dog", {
    p_walk: result.data.walk_id,
    p_dog: result.data.dog_id,
  });
  if (error) return dbError(error.message);
  refresh();
  return {
    success:
      "Pies dodany do zgłoszeń. Możesz teraz podjąć decyzję o przyjęciu do składu.",
  };
}

export async function cancelWalk(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const result = z
    .object({
      walk_id: uuid,
      reason: z.string().trim().min(3).max(2000),
      confirmed: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  if (!result.success)
    return issue("Podaj powód i potwierdź odwołanie spaceru.");
  const { error } = await db.rpc("cancel_walk", {
    p_walk: result.data.walk_id,
    p_reason: result.data.reason,
  });
  if (error) return dbError(error.message);
  refresh();
  return {
    success:
      "Spacer odwołany. Powód jest widoczny dla opiekunów. Poinformuj uczestników o zmianie.",
  };
}

export async function updateWalk(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const meta = z
    .object({
      id: uuid,
      updated_at: z.iso.datetime({ offset: true }),
      change_note: z.string().trim().min(3).max(2000),
    })
    .safeParse(Object.fromEntries(form));
  if (!meta.success)
    return issue(
      "Podaj opis zmiany. Jeśli formularz jest nieaktualny, odśwież stronę.",
    );
  const raw = Object.fromEntries(form);
  let starts_at: string;
  try {
    starts_at = warsawLocalToISO(String(raw.local_start));
  } catch {
    return issue("Podaj poprawną datę i godzinę w strefie Europe/Warsaw.");
  }
  const result = walkSchema.safeParse({
    ...raw,
    starts_at,
    price_cents: Math.round(Number(raw.price) * 100),
  });
  if (!result.success)
    return {
      error: "Sprawdź dane spaceru.",
      fields: result.error.flatten().fieldErrors,
    };
  const { error } = await calendarWrite(
    db,
    "update_walk",
    {
      p_walk: meta.data.id,
      p_expected_updated_at: meta.data.updated_at,
      payload: result.data,
      p_note: meta.data.change_note,
    },
    form,
  );
  const warning = calendarWarning(error);
  if (warning) return warning;
  if (error) return dbError(error.message);
  refresh();
  redirect(`/admin/walks/${meta.data.id}?saved=1`);
}
