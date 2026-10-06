import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import { getFinanceData } from "@/lib/data/finance-queries";
import { getServices } from "@/modules/services/queries";
import type {
  GiftCard,
  GiftLedgerEntry,
  GiftHistoryEntry,
  GiftSale,
} from "./types";

const columns =
  "id,beneficiary_id,service_id,service_version,service_name,is_test_price,value_cents,purchased_on,expires_on,sender_label,recipient_label,message,status,version,created_at,balance_cents,redeemed_cents,returned_cents,cash_refunded_cents,usable";
export function giftPage(value?: string) {
  return value && /^[1-9]\d{0,4}$/.test(value) ? Number(value) : 1;
}
export async function getGiftCards(page: number) {
  const { db, role } = await requireSession();
  const { data, error } = await db
    .from("gift_card_balances")
    .select(columns)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (error || !data)
    throw new Error("Nie udało się pobrać kart podarunkowych.");
  return {
    cards: data.slice(0, 20) as GiftCard[],
    more: data.length > 20,
    role,
  };
}
export async function getGiftIssueData() {
  const { db } = await requireSession("admin");
  const [catalogue, people, roles] = await Promise.all([
    getServices(true),
    allRows<{ id: string; full_name: string }>((a, b) =>
      db
        .from("profiles")
        .select("id,full_name")
        .order("full_name")
        .order("id")
        .range(a, b),
    ),
    allRows<{ user_id: string }>((a, b) =>
      db
        .from("user_roles")
        .select("user_id")
        .eq("role", "client")
        .order("user_id")
        .range(a, b),
    ),
  ]);
  return {
    services: catalogue.services,
    people: people.filter((p) => roles.some((r) => r.user_id === p.id)),
  };
}
export async function getGiftCard(id: string, page: number) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db, role } = await requireSession();
  const card = await db
    .from("gift_card_balances")
    .select(columns)
    .eq("id", id)
    .maybeSingle();
  if (card.error) throw new Error("Nie udało się pobrać karty podarunkowej.");
  if (!card.data) notFound();
  const [ledger, history, code, sale] = await Promise.all([
    db
      .from("gift_card_ledger")
      .select("id,card_id,kind,delta_cents,payment_id,note,created_at")
      .eq("card_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 20, page * 20),
    role === "admin"
      ? db
          .from("gift_card_history")
          .select("id,action,note,details,created_at")
          .eq("card_id", id)
          .order("created_at", { ascending: false })
          .order("id")
          .range((page - 1) * 20, page * 20)
      : null,
    role === "admin"
      ? db.from("gift_card_codes").select("code").eq("card_id", id).single()
      : null,
    role === "admin"
      ? db
          .from("gift_card_sales")
          .select("card_id,amount_cents,method,note,created_at")
          .eq("card_id", id)
          .single()
      : null,
  ]);
  if (
    ledger.error ||
    !ledger.data ||
    history?.error ||
    code?.error ||
    sale?.error ||
    (role === "admin" && (!history?.data || !code?.data || !sale?.data))
  )
    throw new Error("Nie udało się pobrać historii i rozliczenia karty.");
  return {
    card: card.data as GiftCard,
    ledger: ledger.data.slice(0, 20) as GiftLedgerEntry[],
    history: (history?.data || []).slice(0, 20) as GiftHistoryEntry[],
    code: code?.data?.code as string | undefined,
    sale: sale?.data as GiftSale | undefined,
    more: ledger.data.length > 20 || (history?.data?.length || 0) > 20,
    role,
  };
}
export async function getGiftRedemptionData(
  card: Pick<GiftCard, "beneficiary_id" | "service_id">,
) {
  const { db } = await requireSession("admin");
  const [finance, issue, consultations, courses, enrollments, fitness, links] =
    await Promise.all([
      getFinanceData(),
      getGiftIssueData(),
      allRows<{ id: string; service_id: string | null }>((a, b) =>
        db
          .from("consultations")
          .select("id,service_id")
          .order("id")
          .range(a, b),
      ),
      allRows<{ id: string; service_id: string }>((a, b) =>
        db.from("courses").select("id,service_id").order("id").range(a, b),
      ),
      allRows<{ id: string; course_id: string }>((a, b) =>
        db
          .from("course_enrollments")
          .select("id,course_id")
          .order("id")
          .range(a, b),
      ),
      allRows<{ id: string; service_id: string }>((a, b) =>
        db
          .from("fitness_packages")
          .select("id,service_id")
          .order("id")
          .range(a, b),
      ),
      allRows<{
        registration_id: string | null;
        package_id: string | null;
        service_id: string;
        version: number;
      }>((a, b) =>
        db
          .from("gift_card_service_links")
          .select("registration_id,package_id,service_id,version")
          .order("id")
          .range(a, b),
      ),
    ]);
  const terms = new Map<string, string | null>();
  const bindings = new Map(
    links.map((link) => [
      `${link.registration_id ? "registration" : "package"}:${link.registration_id || link.package_id}`,
      link,
    ]),
  );
  for (const c of consultations)
    terms.set(`consultation:${c.id}`, c.service_id);
  for (const f of fitness) terms.set(`fitness:${f.id}`, f.service_id);
  for (const e of enrollments)
    terms.set(
      `course:${e.id}`,
      courses.find((c) => c.id === e.course_id)?.service_id || null,
    );
  for (const link of links)
    terms.set(
      `${link.registration_id ? "registration" : "package"}:${link.registration_id || link.package_id}`,
      link.service_id,
    );
  const specific = issue.services.find((s) => s.id === card.service_id);
  const charges = finance.charges
    .filter(
      (c) => c.guardianId === card.beneficiary_id && c.canPay && c.dueCents > 0,
    )
    .flatMap((c) => {
      const serviceId = terms.get(`${c.kind}:${c.id}`) || null;
      const needsBinding = Boolean(
        card.service_id &&
        serviceId !== card.service_id &&
        ((c.kind === "registration" && specific?.kind === "group") ||
          (c.kind === "package" &&
            specific?.kind === "package" &&
            specific.booking_flow !== "fitness")),
      );
      if (card.service_id && serviceId !== card.service_id && !needsBinding)
        return [];
      const binding = bindings.get(`${c.kind}:${c.id}`);
      return [
        {
          ...c,
          needsBinding,
          bindingVersion: binding?.version || 0,
          boundServiceName: binding
            ? issue.services.find((s) => s.id === binding.service_id)?.name ||
              "wcześniej wskazana usługa"
            : null,
        },
      ];
    });
  return { ...issue, charges };
}
