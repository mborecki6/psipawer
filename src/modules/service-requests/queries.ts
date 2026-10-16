import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { allRows } from "@/lib/data/queries";
import {
  bookableCourses,
  isDateRequestService,
  type PublicCourse,
  type RequestService,
  type ServiceRequest,
} from "./types";
const columns =
  "id,dog_id,guardian_id,service_id,service_name,message,availability,status,version,resolution_note,created_at,updated_at,dogs(name),profiles!service_requests_guardian_id_fkey(full_name),service_request_history(id,action,note,version,created_at)";
export async function getServiceRequestForm(
  id: string,
  page: number,
  focus?: string,
) {
  if (!z.uuid().safeParse(id).success) notFound();
  const { db } = await requireSession("client");
  let history = db
    .from("service_requests")
    .select(columns)
    .eq("service_id", id);
  if (focus) history = history.eq("id", focus);
  const [service, requests, dogs, openDogs, courses] = await Promise.all([
    db
      .from("services")
      .select("id,name,active,kind,booking_flow,course_format")
      .eq("id", id)
      .maybeSingle(),
    history
      .order("created_at", { ascending: false })
      .order("id")
      .range(focus ? 0 : (page - 1) * 20, focus ? 20 : page * 20),
    allRows<{ id: string; name: string }>((from, to) =>
      db
        .from("dogs")
        .select("id,name")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    allRows<{ dog_id: string }>((from, to) =>
      db
        .from("service_requests")
        .select("dog_id")
        .eq("service_id", id)
        .eq("status", "open")
        .order("dog_id")
        .range(from, to),
    ),
    allRows<PublicCourse>((from, to) =>
      db
        .from("courses")
        .select("id,title,course_sessions(starts_at,status)")
        .eq("service_id", id)
        .eq("status", "open")
        .order("id")
        .range(from, to),
    ),
  ]);
  if (service.error || requests.error)
    throw new Error("Nie udało się pobrać zgłoszeń terminu.");
  const rows = (requests.data || []).slice(
    0,
    20,
  ) as unknown as ServiceRequest[];
  if (!service.data && !rows.length) notFound();
  const offered = bookableCourses(courses);
  return {
    id,
    service: service.data as RequestService | null,
    title: service.data?.name || rows[0].service_name,
    requests: rows,
    more: (requests.data?.length || 0) > 20,
    hasDogs: dogs.length > 0,
    dogs: dogs.filter(
      (dog) => !openDogs.some((request) => request.dog_id === dog.id),
    ),
    offered,
    canRequest: Boolean(
      service.data &&
      isDateRequestService(service.data as RequestService) &&
      !offered.length,
    ),
  };
}
export async function getServiceRequests(
  admin: boolean,
  filter: "open" | "history",
  page: number,
) {
  const { db } = await requireSession(admin ? "admin" : "client");
  let query = db.from("service_requests").select(columns);
  query =
    filter === "open"
      ? query.eq("status", "open")
      : query.neq("status", "open");
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 20, page * 20);
  if (error) throw new Error("Nie udało się pobrać zgłoszeń terminu.");
  return {
    requests: (data || []).slice(0, 20) as unknown as ServiceRequest[],
    more: (data?.length || 0) > 20,
  };
}
export async function getOpenServiceRequestCount() {
  const { db } = await requireSession("admin");
  const { count, error } = await db
    .from("service_requests")
    .select("id", { count: "exact" })
    .eq("status", "open")
    .limit(0);
  if (error) throw new Error("Nie udało się pobrać liczby zgłoszeń terminu.");
  return count || 0;
}
