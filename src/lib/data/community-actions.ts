"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { communityProfileSchema } from "@/lib/community";
import { prepareCommunityPhoto } from "@/lib/community-photo";
import { uuid } from "@/lib/validation/schemas";
import type { ActionState } from "@/components/action-form";
import {
  cleanupRetiredAvatar,
  cleanupUnattachedUpload,
  reserveAvatarUpload,
  type AvatarState,
} from "./avatar-cleanup";

const version = z.iso.datetime({ offset: true });
const decisionNote = z.string().trim().min(3).max(2000);
function refresh() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}
function failure(message: string): ActionState {
  const allowed = [
    "Profil Psiutka zmienił się w międzyczasie. Odśwież formularz.",
    "Oba profile muszą być opublikowane i zatwierdzone.",
    "Wybierz psa innego opiekuna.",
    "Opiekun musi ponownie wyrazić zgodę na publikację.",
    "Ta para wymaga zmiany profilu i ponownej oceny behawiorysty.",
    "Zainteresowanie zmieniło się w międzyczasie. Odśwież widok.",
    "Do oceny potrzebne jest aktualne zainteresowanie obu opiekunów.",
    "Wybierz zdjęcie przesłane do profilu tego Psiutka.",
  ];
  return {
    error: allowed.includes(message)
      ? message
      : "Nie udało się zapisać zmiany. Odśwież widok i sprawdź aktualny status wizytówki lub zainteresowania.",
  };
}

export async function saveCommunityProfile(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession();
  const meta = z
    .object({
      dog_id: uuid,
      expected_updated_at: version.nullable(),
      consent: z.literal("yes"),
    })
    .safeParse({
      dog_id: form.get("dog_id"),
      expected_updated_at: form.get("expected_updated_at") || null,
      consent: form.get("consent"),
    });
  if (!meta.success)
    return {
      error:
        "Potwierdź zgodę na publikację wybranych informacji w Psiutkach. Jeśli formularz jest nieaktualny, odśwież stronę.",
    };
  const parsed = communityProfileSchema.safeParse({
    display_name: form.get("display_name"),
    area: form.get("area") || "",
    headline: form.get("headline"),
    seeking: form.get("seeking"),
    traits: [
      ...new Set(
        String(form.get("traits") || "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ],
    likes: form.get("likes") || "",
    dislikes: form.get("dislikes") || "",
    avatar_path:
      form.get("remove_avatar") === "yes"
        ? null
        : form.get("avatar_path") || null,
  });
  if (!parsed.success)
    return {
      error:
        "Sprawdź opis wizytówki i długość pól. Możesz dodać do 8 cech po 40 znaków.",
      fields: parsed.error.flatten().fieldErrors,
    };
  const { data: current, error: readError } = await db
    .from("psiutki_profiles")
    .select("avatar_path")
    .eq("dog_id", meta.data.dog_id)
    .maybeSingle();
  if (readError)
    return { error: "Nie udało się odczytać wizytówki. Spróbuj ponownie." };
  const { error } = await db.rpc("save_community_profile", {
    p_dog: meta.data.dog_id,
    p_expected_updated_at: meta.data.expected_updated_at,
    payload: parsed.data,
    p_consent: true,
  });
  if (error) return failure(error.message);
  if (current?.avatar_path !== parsed.data.avatar_path)
    await cleanupRetiredAvatar(
      db,
      "community-avatars",
      current?.avatar_path || null,
    );
  refresh();
  return {
    success:
      "Wizytówka wysłana do sprawdzenia. Pojawi się w Psiutkach po akceptacji prowadzącej.",
  };
}

export async function hideCommunityProfile(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession();
  const id = uuid.safeParse(form.get("dog_id"));
  if (!id.success) return { error: "Wybierz wizytówkę do ukrycia." };
  const { error } = await db.rpc("hide_community_profile", { p_dog: id.data });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Wizytówka ukryta. Powrót do katalogu wymaga akceptacji prowadzącej i aktualnej zgody opiekuna.",
  };
}

export async function moderateCommunityProfile(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      dog_id: uuid,
      expected_updated_at: version,
      decision: z.enum(["approved", "rejected"]),
      note: decisionNote,
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Wybierz decyzję i podaj krótkie uzasadnienie dla opiekuna (3–2000 znaków).",
    };
  const p = parsed.data;
  const { error } = await db.rpc("moderate_community_profile", {
    p_dog: p.dog_id,
    p_expected_updated_at: p.expected_updated_at,
    p_decision: p.decision,
    p_note: p.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      p.decision === "approved"
        ? "Wizytówka zatwierdzona i opublikowana."
        : "Decyzja zapisana. Opiekun zobaczy uzasadnienie w swojej wizytówce.",
  };
}

export async function expressCommunityInterest(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession();
  const parsed = z
    .object({ from_dog_id: uuid, to_dog_id: uuid })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return { error: "Wybierz psa, który chce poznać nowego kumpla." };
  const { error } = await db.rpc("express_community_interest", {
    p_from_dog: parsed.data.from_dog_id,
    p_to_dog: parsed.data.to_dog_id,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Zainteresowanie zapisane. Jeśli będzie wzajemne, prowadząca sprawdzi tę parę.",
  };
}

export async function withdrawCommunityInterest(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession();
  const id = uuid.safeParse(form.get("interest_id"));
  if (!id.success) return { error: "Wybierz zainteresowanie do wycofania." };
  const { error } = await db.rpc("withdraw_community_interest", {
    p_interest: id.data,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Zainteresowanie wycofane. Poprzednia ocena wspólnego spotkania nie jest już aktualna.",
  };
}

export async function reviewCommunityInterest(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      interest_id: uuid,
      expected_updated_at: version,
      decision: z.enum(["reviewed", "rejected"]),
      note: decisionNote,
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Wybierz decyzję i podaj wskazówki dla opiekunów (3–2000 znaków).",
    };
  const p = parsed.data;
  const { error } = await db.rpc("review_community_interest", {
    p_interest: p.interest_id,
    p_expected_updated_at: p.expected_updated_at,
    p_decision: p.decision,
    p_note: p.note,
  });
  if (error) return failure(error.message);
  refresh();
  return {
    success:
      "Ocena pary zapisana. Opiekunowie zobaczą wskazówki w swoich zainteresowaniach.",
  };
}

export async function uploadCommunityAvatar(
  _: AvatarState,
  form: FormData,
): Promise<AvatarState> {
  const { db, user } = await requireSession();
  const meta = z
    .object({
      dog_id: uuid,
      expected_updated_at: version,
      consent: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  const file = form.get("file");
  if (!meta.success)
    return {
      error:
        "Potwierdź zgodę na pokazanie zdjęcia innym opiekunom. Najpierw zapisz wizytówkę.",
    };
  if (!(file instanceof File) || !file.size || file.size > 1_500_000)
    return { error: "Wybierz zdjęcie JPG, PNG lub WebP do 1,5 MB." };
  const { data: dog } = await db
    .from("dogs")
    .select("guardian_id")
    .eq("id", meta.data.dog_id)
    .maybeSingle();
  if (dog?.guardian_id !== user.id)
    return { error: "Możesz dodać zdjęcie tylko do wizytówki swojego psa." };
  const { data: current, error: readError } = await db
    .from("psiutki_profiles")
    .select("avatar_path,updated_at")
    .eq("dog_id", meta.data.dog_id)
    .maybeSingle();
  if (readError || !current)
    return {
      error: "Najpierw zapisz wizytówkę psa, a następnie dodaj zdjęcie.",
    };
  if (
    new Date(current.updated_at).getTime() !==
    new Date(meta.data.expected_updated_at).getTime()
  )
    return failure(
      "Profil Psiutka zmienił się w międzyczasie. Odśwież formularz.",
    );
  let bytes: Buffer;
  try {
    bytes = await prepareCommunityPhoto(
      new Uint8Array(await file.arrayBuffer()),
    );
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Nie można odczytać zdjęcia.",
    };
  }
  const path = `${user.id}/${meta.data.dog_id}/${crypto.randomUUID()}.webp`;
  const uncertain =
    "Nie udało się potwierdzić zapisu zdjęcia. Sprawdź wizytówkę i spróbuj ponownie.";
  let updatedAt: string;
  try {
    await reserveAvatarUpload(db, meta.data.dog_id, "community-avatars", path);
    const upload = await db.storage
      .from("community-avatars")
      .upload(path, bytes, {
        contentType: "image/webp",
        upsert: false,
      });
    if (upload.error) {
      await cleanupUnattachedUpload(db, "community-avatars", path);
      return { error: uncertain };
    }
    const result = await db.rpc("set_community_avatar", {
      p_dog: meta.data.dog_id,
      p_expected_updated_at: meta.data.expected_updated_at,
      p_path: path,
    });
    if (result.error || typeof result.data !== "string") {
      await cleanupUnattachedUpload(db, "community-avatars", path);
      return result.error
        ? failure(result.error.message)
        : { error: uncertain };
    }
    updatedAt = result.data;
  } catch {
    await cleanupUnattachedUpload(db, "community-avatars", path);
    return { error: uncertain };
  }
  await cleanupRetiredAvatar(db, "community-avatars", current.avatar_path);
  refresh();
  return {
    success:
      "Zdjęcie dodane. Wizytówka ponownie czeka na sprawdzenie przed publikacją.",
    avatarPath: path,
    updatedAt,
  };
}
