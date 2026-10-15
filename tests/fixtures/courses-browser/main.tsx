import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CourseCreateView, CourseDetailView } from "@/modules/courses/views";
import type { Course, SessionDetail } from "@/modules/courses/types";
import type { BookingChoices } from "@/modules/calendar/booking-queries";
import "@/app/globals.css";
import { testServices } from "../services-data";

const search = new URLSearchParams(location.search);
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
          role="admin"
          course={course}
          sessions={sessions.map((session) => ({
            ...session,
            version: session.version + revision,
          }))}
          booking={booking}
          enrollments={[]}
          roster={[]}
          attendance={[]}
          history={[]}
          dogs={[]}
          hasDogs={false}
          page={1}
          filter="all"
          focus={undefined}
          historyPage={1}
          more={false}
          historyMore={false}
          requestId="85000000-0000-4000-8000-000000000001"
          now="2026-10-15T08:00:00Z"
          balances={[]}
          payments={[]}
          refunds={[]}
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
