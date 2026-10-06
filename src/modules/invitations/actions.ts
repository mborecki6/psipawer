"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import { invitationDeliveryConfig } from "./config";
import { invitationDeliveryClient } from "./delivery";

export async function prepareInvitation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      id: z.uuid(),
      email: z.string().trim().pipe(z.email().max(254)),
      name: z.string().trim().min(2).max(120),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Podaj poprawny adres e-mail i imię opiekuna.",
      fields: parsed.error.flatten().fieldErrors,
    };
  try {
    const { data, error } = await db.rpc("prepare_client_invitation", {
      p_id: parsed.data.id,
      p_email: parsed.data.email,
      p_name: parsed.data.name,
    });
    if (error || data !== parsed.data.id) {
      const safe = [
        "Zaproszenie dla tego adresu jest już na liście.",
        "Adres znajduje się już w archiwum. Otwórz archiwum i przywróć zaproszenie.",
        "Ten adres ma już aktywne konto. W razie potrzeby opiekun może odzyskać hasło.",
      ];
      return {
        error:
          error && safe.includes(error.message)
            ? error.message
            : "Nie udało się przygotować zaproszenia. Twoje dane pozostają w formularzu.",
      };
    }
  } catch {
    return {
      error: "Nie udało się przygotować zaproszenia. Spróbuj ponownie.",
    };
  }
  revalidatePath("/admin/invitations");
  redirect(`/admin/invitations?saved=${parsed.data.id}`);
}

export async function sendInvitation(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      id: z.uuid(),
      version: z.coerce.number().int().min(1).max(2147483646),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Odśwież zaproszenie przed wysłaniem." };
  const config = invitationDeliveryConfig();
  if (!config)
    return {
      error:
        "Wysyłka zaproszeń jest wyłączona. Obecnie przygotowujemy dostęp i testujemy wyłącznie lokalną skrzynkę.",
    };
  const attempt = randomUUID();
  let email: string;
  try {
    const { data, error } = await db.rpc("claim_client_invitation", {
      p_id: parsed.data.id,
      p_expected_version: parsed.data.version,
      p_attempt: attempt,
    });
    if (error || !z.email().safeParse(data).success) {
      const safe = [
        "Odśwież zaproszenie przed wysłaniem.",
        "To zaproszenie jest w archiwum. Przywróć je przed wysłaniem.",
        "Poczekaj dwie minuty od poprzedniej próby.",
        "Konto zostało już aktywowane. Nie wysyłaj nowego zaproszenia.",
      ];
      return {
        error:
          error && safe.includes(error.message)
            ? error.message
            : "Nie udało się rozpocząć wysyłki. Odśwież listę i sprawdź stan zaproszenia.",
      };
    }
    email = data;
  } catch {
    return {
      error:
        "Nie udało się rozpocząć wysyłki. Odśwież listę i sprawdź stan zaproszenia.",
    };
  }
  let provider;
  try {
    provider = invitationDeliveryClient(config);
  } catch {
    revalidatePath("/admin/invitations");
    revalidatePath(`/admin/invitations/${parsed.data.id}`);
    return {
      error:
        "Nie udało się połączyć z lokalną pocztą. Odśwież listę i sprawdź stan zaproszenia.",
    };
  }
  let outcome: "sent" | "failed" | "uncertain" = "uncertain";
  let code: "rejected" | "rate_limited" | "unknown_result" | null =
    "unknown_result";
  try {
    const { data, error } = await provider.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${config.origin}/auth/invitation`,
    });
    if (!error && data.user?.id) {
      outcome = "sent";
      code = null;
    } else if (
      error?.status &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408
    ) {
      outcome = "failed";
      code = error.status === 429 ? "rate_limited" : "rejected";
    }
  } catch {
    /* A timeout may follow an accepted send. Do not retry automatically. */
  }
  let recorded = false;
  try {
    const { data, error } = await provider.rpc("finish_client_invitation", {
      p_id: parsed.data.id,
      p_attempt: attempt,
      p_outcome: outcome,
      p_error: code,
    });
    recorded = !error && data === true;
  } catch {
    /* The list exposes a stale in-flight request as uncertain. */
  }
  revalidatePath("/admin/invitations");
  revalidatePath(`/admin/invitations/${parsed.data.id}`);
  if (!recorded || outcome === "uncertain")
    return {
      error:
        "Nie można potwierdzić wyniku wysyłki. Wiadomość mogła trafić do skrzynki. Sprawdź ją i odśwież stan konta przed kolejną próbą.",
    };
  if (outcome === "failed")
    return {
      error:
        code === "rate_limited"
          ? "Serwer ograniczył liczbę wiadomości. Spróbuj ponownie później."
          : "Serwer nie przyjął zaproszenia. Sprawdź adres oraz ustawienia lokalnej poczty.",
    };
  return {
    success:
      "Serwer przyjął zaproszenie. Sprawdź lokalną skrzynkę testową. Aktywacja konta będzie widoczna osobno po otwarciu linku.",
  };
}

export async function setInvitationArchive(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { db } = await requireSession("admin");
  const parsed = z
    .object({
      id: z.uuid(),
      version: z.coerce.number().int().min(1).max(2147483646),
      archived: z.enum(["true", "false"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Odśwież zaproszenie przed zmianą." };
  const { id, version, archived } = parsed.data;
  try {
    const { data, error } = await db.rpc("set_client_invitation_archived", {
      p_id: id,
      p_expected_version: version,
      p_archived: archived === "true",
    });
    if (error || !Number.isInteger(data)) {
      const safe = [
        "Można archiwizować tylko zaproszenia, których wysyłka jeszcze się nie rozpoczęła.",
        "Zaproszenie zmieniło się. Odśwież widok przed zmianą.",
        "Nie znaleziono zaproszenia.",
      ];
      return {
        error:
          error && safe.includes(error.message)
            ? error.message
            : "Nie udało się zmienić zaproszenia. Odśwież jego stan przed kolejną próbą.",
      };
    }
  } catch {
    return {
      error:
        "Nie udało się potwierdzić zmiany. Odśwież zaproszenie, aby sprawdzić jego stan.",
    };
  }
  revalidatePath("/admin/invitations");
  revalidatePath(`/admin/invitations/${id}`);
  redirect(`/admin/invitations/${id}`);
}
