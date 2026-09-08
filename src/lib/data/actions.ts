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
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
function issue(message: string): ActionState {
  return { error: message };
}
function dbError(message: string): ActionState {
  const allowed = [
    "Brak wolnych miejsc.",
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
  const { data, error } = await db.rpc("create_walk", { payload: result.data });
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
  const { error } = await db.rpc("mark_attendance", {
    p_registration: result.data.id,
    p_attendance: result.data.attendance,
  });
  if (error) return dbError(error.message);
  refresh();
  return { success: "Obecność zapisana." };
}
export async function uploadAvatar(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
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
    .select("guardian_id")
    .eq("id", id.data)
    .single();
  if (!dog || (role !== "admin" && dog.guardian_id !== user.id))
    return issue("Brak dostępu do psa.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  const webp =
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  const ext = jpeg ? "jpg" : png ? "png" : webp ? "webp" : null;
  if (!ext) return issue("Plik nie jest obsługiwanym zdjęciem.");
  const path = `${dog.guardian_id}/${id.data}/${crypto.randomUUID()}.${ext}`;
  const { error } = await db.storage.from("dog-avatars").upload(path, bytes, {
    contentType: ext === "jpg" ? "image/jpeg" : `image/${ext}`,
    upsert: false,
  });
  if (error) return dbError(error.message);
  const result = await db
    .from("dogs")
    .update({ avatar_path: path })
    .eq("id", id.data);
  if (result.error) {
    await db.storage.from("dog-avatars").remove([path]);
    return dbError(result.error.message);
  }
  refresh();
  return { success: "Zdjęcie zapisane." };
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
