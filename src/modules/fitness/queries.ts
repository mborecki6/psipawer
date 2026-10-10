import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getBookingChoices } from "@/modules/calendar/booking-queries";
import { allRows } from "@/lib/data/queries";
import { getServices } from "@/modules/services/queries";
import type { PaymentRecord } from "@/lib/finance";
import type {
  FitnessPackage,
  FitnessSession,
  FitnessHistory,
  FitnessBalance,
  FitnessRefund,
} from "./types";
const columns =
  "id,dog_id,guardian_id,service_id,service_version,service_name,sessions_count,duration_minutes,agreed_price_cents,is_test_price,topic,availability,status,charge_cents,accepted_at,settled_at,version,created_at,updated_at,dogs(name)";
export async function getFitnessPackages(filter: string, page: number) {
  const { db, role } = await requireSession();
  let query = db.from("fitness_packages").select(columns);
  if (filter === "history")
    query = query.in("status", ["completed", "cancelled", "rejected"]);
  else if (filter === "open")
    query = query.in("status", ["requested", "active"]);
  else if (filter !== "all") query = query.eq("status", filter);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (error || !data) throw new Error("Nie udało się pobrać pakietów fitness.");
  return {
    role,
    packages: data.slice(0, 20) as unknown as FitnessPackage[],
    more: data.length > 20,
  };
}
export async function getFitnessRequestData() {
  const { db } = await requireSession("client");
  const [dogs, open, catalogue] = await Promise.all([
    allRows<{ id: string; name: string }>((a, b) =>
      db.from("dogs").select("id,name").order("name").order("id").range(a, b),
    ),
    allRows<{ dog_id: string }>((a, b) =>
      db
        .from("fitness_packages")
        .select("dog_id")
        .in("status", ["requested", "active"])
        .order("id")
        .range(a, b),
    ),
    getServices(false, "fitness"),
  ]);
  return {
    dogs: dogs.map((d) => ({
      ...d,
      unavailable: open.some((p) => p.dog_id === d.id),
    })),
    services: catalogue.services,
  };
}
export async function getFitnessPackage(id: string, historyPage: number) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, role, user } = await requireSession();
  const { data: pack, error } = await db
    .from("fitness_packages")
    .select(columns)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać pakietu fitness.");
  if (!pack) notFound();
  const [sessions, history, balance, payments, refunds] = await Promise.all([
    db
      .from("fitness_sessions")
      .select(
        "id,package_id,ordinal,status,starts_at,duration_minutes,attendance,version,fitness_session_private_details(exact_location)",
      )
      .eq("package_id", id)
      .order("ordinal")
      .limit(100),
    db
      .from("fitness_history")
      .select("id,package_id,session_id,action,note,details,created_at")
      .eq("package_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((historyPage - 1) * 10, historyPage * 10),
    db.from("fitness_balances").select("*").eq("id", id).single(),
    allRows<PaymentRecord>((a, b) =>
      db
        .from("payments")
        .select("*")
        .eq("fitness_package_id", id)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
    allRows<FitnessRefund>((a, b) =>
      db
        .from("fitness_payment_refunds")
        .select("id,payment_id,package_id,amount_cents,note,created_at")
        .eq("package_id", id)
        .order("created_at")
        .order("id")
        .range(a, b),
    ),
  ]);
  if (
    sessions.error ||
    !sessions.data ||
    history.error ||
    !history.data ||
    balance.error ||
    !balance.data
  )
    throw new Error(
      "Nie udało się pobrać spotkań, historii lub rozliczenia fitness.",
    );
  const booking =
    role === "admin"
      ? await getBookingChoices(db, user.id, {
          kind: "fitness",
          ids: sessions.data.map((s) => s.id),
        })
      : undefined;
  return {
    ...(booking ? { booking } : {}),
    role,
    pack: pack as unknown as FitnessPackage,
    sessions: sessions.data as unknown as FitnessSession[],
    history: history.data.slice(0, 10) as FitnessHistory[],
    historyMore: history.data.length > 10,
    balance: balance.data as FitnessBalance,
    payments,
    refunds,
  };
}
