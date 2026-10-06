import "server-only";
import { requireSession } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { Service, ServiceRevision } from "./types";
const columns =
  "id,name,description,kind,booking_flow,meeting_mode,price_cents,price_unit,duration_minutes,sessions_count,active,is_test_price,source_url,source_note,version,updated_at,course_format";
export async function getServices(
  staff = false,
  flow?: Service["booking_flow"],
) {
  const { db, role } = await requireSession(staff ? "admin" : undefined);
  const services: Service[] = [];
  for (let offset = 0; ; offset += 100) {
    let query = db
      .from("services")
      .select(columns)
      .order("name")
      .order("id")
      .range(offset, offset + 99);
    if (!staff) query = query.eq("active", true);
    if (flow) query = query.eq("booking_flow", flow);
    const { data, error } = await query;
    if (error) throw new Error("Nie udało się pobrać usług i cennika.");
    services.push(...((data || []) as Service[]));
    if (!data || data.length < 100) return { services, role };
  }
}
export async function getService(id: string, page: number) {
  const { db } = await requireSession("admin");
  if (!z.uuid().safeParse(id).success) notFound();
  const [service, history] = await Promise.all([
    db.from("services").select(columns).eq("id", id).maybeSingle(),
    db
      .from("service_revisions")
      .select(
        "version,name,price_cents,price_unit,active,is_test_price,changed_by,created_at",
      )
      .eq("service_id", id)
      .order("version", { ascending: false })
      .range((page - 1) * 20, page * 20),
  ]);
  if (service.error || history.error)
    throw new Error("Nie udało się pobrać usługi.");
  if (!service.data) notFound();
  return {
    service: service.data as Service,
    history: (history.data || []).slice(0, 20) as ServiceRevision[],
    more: (history.data?.length || 0) > 20,
  };
}
