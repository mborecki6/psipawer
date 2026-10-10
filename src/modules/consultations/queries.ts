import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getBookingChoices } from "@/modules/calendar/booking-queries";
import type { ConsultationBalance } from "@/lib/finance";
import {
  consultationFilter,
  type Consultation,
  type ConsultationHistory,
} from "./types";
const columns =
  "id,dog_id,topic,availability,status,starts_at,duration_minutes,meeting_mode,location,version,created_at,dogs(name),service_name,agreed_price_cents,service_duration_minutes,service_meeting_mode,is_test_price";
export async function getConsultations(
  filter: ReturnType<typeof consultationFilter>,
  page: number,
  dogId?: string,
) {
  const { db, role } = await requireSession();
  if (dogId && !z.uuid().safeParse(dogId).success) notFound();
  let query = db
    .from("consultations")
    .select(columns)
    .in(
      "status",
      filter === "history"
        ? ["completed", "cancelled"]
        : filter === "active"
          ? ["requested", "scheduled"]
          : [filter],
    );
  if (dogId) query = query.eq("dog_id", dogId);
  const { data, error } = await query
    .order("starts_at", { ascending: filter !== "history", nullsFirst: true })
    .order("created_at", { ascending: filter !== "history" })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (error) throw new Error("Nie udało się pobrać konsultacji.");
  return {
    role,
    consultations: (data || []).slice(0, 20) as unknown as Consultation[],
    more: (data?.length || 0) > 20,
  };
}
export async function getConsultation(id: string, page: number) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, role, user } = await requireSession();
  const c = await db
    .from("consultations")
    .select(columns)
    .eq("id", id)
    .maybeSingle();
  if (c.error) throw new Error("Nie udało się pobrać konsultacji.");
  if (!c.data) notFound();
  const history = await db
    .from("consultation_history")
    .select(
      "id,version,action,starts_at,duration_minutes,meeting_mode,location,note,created_at,agreed_price_cents,is_test_price",
    )
    .eq("consultation_id", id)
    .order("version", { ascending: false })
    .range((page - 1) * 10, page * 10);
  if (history.error)
    throw new Error("Nie udało się pobrać historii spotkania.");
  const balance = await db
    .from("consultation_balances")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (balance.error || !balance.data)
    throw new Error("Nie udało się pobrać rozliczenia spotkania.");
  const booking =
    role === "admin"
      ? await getBookingChoices(db, user.id, {
          kind: "consultation",
          ids: [id],
        })
      : undefined;
  return {
    ...(booking ? { booking } : {}),
    role,
    consultation: c.data as unknown as Consultation,
    balance: balance.data as ConsultationBalance,
    history: (history.data || []).slice(0, 10) as ConsultationHistory[],
    more: (history.data?.length || 0) > 10,
  };
}
export async function getConsultationDogs() {
  const { db } = await requireSession("client");
  const dogs: { id: string; name: string }[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await db
      .from("dogs")
      .select("id,name")
      .order("name")
      .order("id")
      .range(offset, offset + 99);
    if (error) throw new Error("Nie udało się pobrać Twoich psów.");
    dogs.push(...(data || []));
    if (!data || data.length < 100) return dogs;
  }
}
