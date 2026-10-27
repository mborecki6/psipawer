import type { getFitnessPackage } from "@/modules/fitness/queries";
import type { FitnessStatus, FitnessSession } from "@/modules/fitness/types";
import type { Service } from "@/modules/services/types";

export const fitnessService: Service = {
  id: "60000000-0000-4000-8000-000000000099",
  name: "Indywidualny pakiet fitness",
  description: "Ćwiczenia z prowadzącą",
  kind: "package",
  booking_flow: "fitness",
  course_format: null,
  meeting_mode: "in_person",
  price_cents: 30000,
  price_unit: "za pakiet",
  duration_minutes: 45,
  sessions_count: 5,
  active: true,
  is_test_price: true,
  source_url: "",
  source_note: "",
  version: 4,
  updated_at: "2026-10-01T10:00:00Z",
};
export const fitnessIds = {
  pack: "72000000-0000-4000-8000-000000000001",
  session: (n: number) =>
    `71000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
};
export function fitnessData(role: "admin" | "client", search: URLSearchParams) {
  const status = (search.get("fitnessStatus") || "active") as FitnessStatus;
  const refunded = search.has("refund");
  const long = search.has("long");
  const pack = {
    id: fitnessIds.pack,
    dog_id: "20000000-0000-4000-8000-000000000001",
    guardian_id: "10000000-0000-4000-8000-000000000099",
    service_id: fitnessService.id,
    service_version: 4,
    service_name: long
      ? "BardzoDługaNazwaPakietu".repeat(15)
      : fitnessService.name,
    sessions_count: 5,
    duration_minutes: 45,
    agreed_price_cents: 30000,
    is_test_price: true,
    topic: long
      ? "DługiCelWspółpracy".repeat(100)
      : "Współpraca i spokojne ćwiczenia",
    availability: "Wtorki po południu",
    status,
    charge_cents: 30000,
    accepted_at: "2026-10-01T10:00:00Z",
    settled_at: refunded ? "2026-10-26T10:00:00Z" : null,
    version: 3,
    created_at: "2026-10-01T10:00:00Z",
    updated_at: "2026-10-26T10:00:00Z",
    dogs: { name: long ? "DługieImięPsa".repeat(15) : "Kluska" },
  };
  const states: FitnessSession["status"][] = [
    "completed",
    "scheduled",
    "scheduled",
    "pending",
    "cancelled",
  ];
  const sessions =
    search.has("empty") || status === "requested"
      ? []
      : (states.map((state, index) => ({
          id: fitnessIds.session(index + 1),
          package_id: pack.id,
          ordinal: index + 1,
          status: state,
          starts_at:
            index < 3
              ? [
                  "2026-10-15T10:00:00Z",
                  "2026-10-26T10:00:00Z",
                  "2026-11-01T10:00:00Z",
                ][index]
              : null,
          duration_minutes: 45,
          attendance: index === 0 ? "absent" : null,
          version: 2,
          fitness_session_private_details:
            index < 3
              ? {
                  exact_location: long
                    ? "DługieMiejsceSpotkania".repeat(25)
                    : "Sala przy parku — fikcyjne miejsce",
                }
              : null,
        })) as FitnessSession[]);
  const balance = {
    id: pack.id,
    dog_id: pack.dog_id,
    guardian_id: pack.guardian_id,
    service_name: pack.service_name,
    status,
    version: 3,
    created_at: pack.created_at,
    agreed_price_cents: 30000,
    charge_cents: refunded ? 10000 : 30000,
    is_test_price: true,
    sessions_count: 5,
    duration_minutes: 45,
    settled_at: pack.settled_at,
    paid_cents: 20000,
    refunded_cents: 0,
    completed_sessions: 1,
    next_starts_at: "2026-11-01T10:00:00Z",
    due_cents: refunded ? 0 : 10000,
    refund_due_cents: refunded ? 10000 : 0,
    needs_settlement: status === "cancelled" && !refunded,
    needs_review: status === "cancelled",
    can_pay: status === "active",
  };
  const data = {
    role,
    pack,
    sessions,
    balance,
    refunds: [],
    history: [],
    historyMore: false,
    payments: [
      {
        id: "73000000-0000-4000-8000-000000000001",
        guardian_id: pack.guardian_id,
        dog_id: pack.dog_id,
        registration_id: null,
        package_id: null,
        consultation_id: null,
        fitness_package_id: pack.id,
        amount_cents: 20000,
        status: "paid",
        method: "transfer",
        paid_at: "2026-10-10T10:00:00Z",
        created_at: "2026-10-10T10:00:00Z",
        note: "Testowa wpłata",
      },
    ],
  } as Awaited<ReturnType<typeof getFitnessPackage>>;
  return data;
}
