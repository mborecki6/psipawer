import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CourseCreateView, CourseDetailView } from "@/modules/courses/views";
import type {
  Course,
  SessionDetail,
  EnrollmentDetail,
  AttendanceDetail,
} from "@/modules/courses/types";
import type { CourseBalance, PaymentRecord } from "@/lib/finance";
import type { BookingChoices } from "@/modules/calendar/booking-queries";
import "@/app/globals.css";
import { testServices } from "../services-data";

const search = new URLSearchParams(location.search);
const scenario = search.get("scenario") || "future";
const role = search.get("role") === "client" ? "client" : "admin";
const now = "2026-10-26T12:30:00Z";
const service = {
  ...testServices[2],
  name: "PAWER UP — grupowy",
  course_format: "group" as const,
};
const course: Course = {
  id: "81000000-0000-4000-8000-000000000001",
  service_id: service.id,
  service_version: 1,
  service_name: service.name,
  price_cents: service.price_cents,
  is_test_price: true,
  sessions_count: 5,
  duration_minutes: 60,
  course_format: "group",
  title: service.name,
  public_location: "Okolica parku testowego",
  capacity: 4,
  status: "open",
  version: 2,
  created_at: "2026-10-15T08:00:00Z",
  updated_at: "2026-10-15T08:00:00Z",
};
const sessions: SessionDetail[] = Array.from({ length: 5 }, (_, index) => ({
  id: `82000000-0000-4000-8000-00000000000${index + 1}`,
  course_id: course.id,
  ordinal: index + 1,
  starts_at: `2028-01-${String(3 + index * 5).padStart(2, "0")}T13:00:00Z`,
  duration_minutes: 60,
  public_location: course.public_location,
  status: "scheduled",
  version: 1,
  course_session_private_details: {
    exact_location: `Prywatna zbiórka testowa ${index + 1}`,
  },
}));
if (["mixed", "overdue"].includes(scenario)) {
  sessions[0].status = "completed";
  sessions[0].starts_at = "2026-10-19T12:00:00Z";
  sessions[1].starts_at =
    scenario === "mixed" ? "2026-10-26T12:00:00Z" : "2026-10-25T12:00:00Z";
  sessions[3].status = "cancelled";
}
if (scenario === "completed" || scenario === "cancelled") {
  course.status = scenario;
  sessions.forEach((session, index) => {
    session.status = scenario;
    session.starts_at = `2026-10-${String(1 + index).padStart(2, "0")}T12:00:00Z`;
  });
}
if (scenario === "draft") course.status = "draft";
if (scenario === "empty") sessions.splice(0);
if (scenario === "long") {
  course.title = "Bardzo długa nazwa cyklu szkoleniowego ".repeat(6);
  course.public_location = "DługaNierozdzielonaNazwaMiejsca".repeat(10);
  sessions.forEach((session) => {
    session.public_location = course.public_location;
  });
}
const enrollment: EnrollmentDetail = {
  id: "86000000-0000-4000-8000-000000000001",
  course_id: course.id,
  dog_id: "87000000-0000-4000-8000-000000000001",
  guardian_id: "88000000-0000-4000-8000-000000000001",
  selected_course_version: 2,
  status: "accepted",
  agreed_price_cents: 10000,
  is_test_price: true,
  charge_cents: 10000,
  version: 2,
  created_at: course.created_at,
  updated_at: course.updated_at,
  dogs: { name: "Kluska — dane fikcyjne" },
};
const balance: CourseBalance = {
  ...enrollment,
  course_title: course.title,
  service_name: course.service_name,
  course_status: course.status,
  starts_at: sessions[0]?.starts_at || null,
  settled_at: null,
  paid_cents: 4000,
  refunded_cents: 0,
  due_cents: 6000,
  refund_due_cents: 0,
  needs_settlement: false,
  needs_review: false,
  can_pay: true,
};
if (search.get("balance") === "settlement") {
  enrollment.status = balance.status = "cancelled";
  balance.needs_settlement = true;
  balance.needs_review = true;
}
if (search.get("balance") === "refund") {
  enrollment.status = balance.status = "cancelled";
  balance.refund_due_cents = 2700;
  balance.due_cents = 0;
}
if (search.get("balance") === "review") {
  balance.needs_review = true;
  balance.due_cents = 0;
}
if (scenario === "long")
  enrollment.dogs!.name = "DługaNierozdzielonaNazwaPsa".repeat(12);
const payment: PaymentRecord = {
  id: "89000000-0000-4000-8000-000000000001",
  guardian_id: enrollment.guardian_id,
  dog_id: enrollment.dog_id,
  course_enrollment_id: enrollment.id,
  registration_id: null,
  package_id: null,
  amount_cents: 4000,
  status: "paid",
  method: "transfer",
  paid_at: course.created_at,
  created_at: course.created_at,
  note: "Fikcyjna wpłata do sprawdzenia widoku.",
};
const attendance: AttendanceDetail[] =
  scenario === "mixed" || scenario === "completed"
    ? [
        {
          session_id: sessions[0].id,
          enrollment_id: enrollment.id,
          attendance: "present",
          version: 1,
          course_enrollments: {
            dog_id: enrollment.dog_id,
            dogs: enrollment.dogs,
          },
        },
      ]
    : [];
const booking: BookingChoices = {
  defaultStaffId: "83000000-0000-4000-8000-000000000001",
  staff: [
    {
      user_id: "83000000-0000-4000-8000-000000000001",
      full_name: "Asia — dane testowe",
    },
  ],
  resources: search.has("resource")
    ? [
        {
          id: "84000000-0000-4000-8000-000000000001",
          name: "Sala testowa",
          exclusive: true,
          active: search.get("resource") !== "inactive",
        },
      ]
    : [],
  assignments: [],
};

function Fixture() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    window.refreshCourse = () => setRevision((value) => value + 10);
  }, []);
  return (
    <main className="main" style={{ margin: "0 auto", maxWidth: 1200 }}>
      {search.get("view") === "detail" ? (
        <CourseDetailView
          role={role}
          course={course}
          sessions={sessions.map((session) => ({
            ...session,
            version: session.version + revision,
          }))}
          booking={booking}
          enrollments={search.has("participants") ? [enrollment] : []}
          roster={
            search.has("participants") && enrollment.status === "accepted"
              ? [enrollment]
              : []
          }
          attendance={search.has("participants") ? attendance : []}
          history={
            search.has("participants")
              ? [
                  {
                    id: "90000000-0000-4000-8000-000000000001",
                    course_id: course.id,
                    session_id: null,
                    enrollment_id: null,
                    action: "created",
                    note: "Fikcyjna historia kursu.",
                    details: {},
                    created_at: course.created_at,
                  },
                ]
              : []
          }
          dogs={[]}
          hasDogs={false}
          page={1}
          filter="all"
          focus={search.get("enrollment") || undefined}
          historyPage={Number(search.get("history") || 1)}
          more={false}
          historyMore={false}
          requestId="85000000-0000-4000-8000-000000000001"
          now={now}
          balances={search.has("participants") ? [balance] : []}
          payments={search.has("participants") ? [payment] : []}
          refunds={[]}
          care={
            search.has("participants")
              ? {
                  [enrollment.id]: {
                    plans: [],
                    more: false,
                    hasDraft: role === "admin",
                    draftSessions: [null],
                  },
                }
              : {}
          }
        />
      ) : (
        <CourseCreateView
          id="81000000-0000-4000-8000-000000000009"
          services={search.has("empty") ? [] : [service]}
          booking={booking}
        />
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
