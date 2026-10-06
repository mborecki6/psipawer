"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/action-form";
import { serviceSchema } from "./schemas";
export type ServiceState = ActionState & { version?: number };
export async function updateService(
  _: ServiceState,
  form: FormData,
): Promise<ServiceState> {
  const { db } = await requireSession("admin");
  const parsed = serviceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error:
        "Sprawdź pola. Cena powinna wynosić od 0,01 do 10 000 zł i mieć najwyżej dwa miejsca po przecinku.",
      fields: parsed.error.flatten().fieldErrors,
    };
  const p = parsed.data;
  try {
    const { data, error } = await db.rpc("update_service", {
      p_id: p.id,
      p_expected_version: p.expected_version,
      p_name: p.name,
      p_description: p.description,
      p_price_cents: p.price,
      p_price_unit: p.price_unit,
      p_duration: p.duration_minutes,
      p_sessions: p.sessions_count,
      p_active: p.active,
      p_is_test_price: p.is_test_price,
    });
    if (error || !Number.isInteger(data)) {
      const allowed = [
        "Usługa zmieniła się. Odśwież widok przed zapisem.",
        "Pojedyncze spotkanie wymaga czasu 15–240 minut i liczby spotkań 1.",
      ];
      return {
        error:
          error && allowed.includes(error.message)
            ? error.message
            : "Nie udało się zapisać usługi. Twoje zmiany pozostają w formularzu.",
      };
    }
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
    return {
      version: data,
      success:
        "Usługa zapisana. Nowa cena jest dostępna w ofercie. Wcześniej zapisane zgłoszenia i terminy zachowują swoje kwoty.",
    };
  } catch {
    return { error: "Nie udało się zapisać usługi. Spróbuj ponownie." };
  }
}
