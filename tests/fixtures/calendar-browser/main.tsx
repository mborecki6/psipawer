import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarView } from "@/modules/calendar/views";
import { NextAppointment } from "@/modules/calendar/next-appointment";
import { weekRange, monthRange } from "@/modules/calendar/dates";
import { CalendarSettingsEditor } from "@/modules/calendar/settings-editor";
import { CalendarResourcesEditor } from "@/modules/calendar/resource-editor";
import type { Appointment } from "@/modules/calendar/types";
import "@/app/globals.css";
const query = new URLSearchParams(location.search),
  admin =
    query.get("role") !== "client" && !location.pathname.startsWith("/app/");
const view = query.get("view") === "month" ? "month" : "week";
const range =
  view === "month"
    ? monthRange(query.get("date") || "2026-09-21")
    : weekRange(query.get("date") || "2026-09-21");
const members = [
  {
    user_id: "90000000-0000-4000-8000-000000000010",
    full_name: "Prowadząca Anna",
  },
  {
    user_id: "90000000-0000-4000-8000-000000000011",
    full_name: "Prowadzący Jan",
  },
];
const resources = [
  {
    id: "90000000-0000-4000-8000-000000000012",
    name: "Sala do ćwiczeń",
    active: true,
    exclusive: true,
    version: 1,
  },
];
const events: Appointment[] = [
  {
    id: "90000000-0000-4000-8000-000000000001",
    kind: "walk",
    title: "Spacery socjalizacyjne — pojedynczy spacer",
    starts_at: "2026-09-21T08:00:00Z",
    ends_at: "2026-09-21T09:00:00Z",
    location: "Park przy rzece",
    status: "open",
    version: null,
  },
  {
    id: "90000000-0000-4000-8000-000000000002",
    kind: "consultation",
    title: "Konsultacja behawioralna — online · Kluska",
    starts_at: "2026-09-21T10:00:00Z",
    ends_at: "2026-09-21T11:30:00Z",
    location: "Instrukcję połączenia ustalisz z prowadzącą.",
    status: "scheduled",
    version: 2,
  },
  {
    id: "90000000-0000-4000-8000-000000000003",
    kind: "block",
    title: "Dojazd i przerwa",
    starts_at: "2026-09-21T11:30:00Z",
    ends_at: "2026-09-21T12:00:00Z",
    location: "",
    status: "blocked",
    version: 1,
  },
  {
    id: "90000000-0000-4000-8000-000000000004",
    kind: "block",
    title: "Czas na odpoczynek",
    starts_at: "2026-09-23T22:00:00Z",
    ends_at: "2026-09-25T22:00:00Z",
    location: "",
    status: "blocked",
    version: 1,
  },
];
for (const [index, item] of events.entries())
  Object.assign(item, {
    appointment_id: item.id,
    assignment_version: 1,
    assigned_staff_id: members[index % 2].user_id,
    assigned_staff_name: members[index % 2].full_name,
    resource_id: index === 0 ? resources[0].id : null,
    resource_name: index === 0 ? resources[0].name : null,
    created_by: members[0].user_id,
    created_by_name: members[0].full_name,
  });
if (query.has("former-lead"))
  for (const index of [0, 2])
    Object.assign(events[index], {
      assigned_staff_id: "90000000-0000-4000-8000-000000000021",
      assigned_staff_name: "Dawna prowadząca",
    });
if (query.has("long")) {
  events[0].title = "DługaNazwaSpotkaniaBezPrzerw".repeat(12);
  events[0].location = "DługaLokalizacjaBezPrzerw".repeat(20);
}
function Fixture() {
  const [items, setItems] = useState(events);
  useEffect(() => {
    window.refreshCalendar = () =>
      setItems((list) => list.map((i) => ({ ...i, version: 10 })));
  }, []);
  const filtered = query.has("empty")
    ? []
    : items.filter((i) => admin || i.kind !== "block");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-copy">
            <strong>Psi Pawer</strong>
            <span>Lokalny podgląd na danych fikcyjnych</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <a className="nav-item" href="?">
            Kalendarz
          </a>
          <a className="nav-item" href="?view=home">
            Pulpit
          </a>
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="page-heading">
            <h1>Kalendarz</h1>
            <p>{admin ? "Panel behawiorystki" : "Panel opiekuna"}</p>
          </div>
          <span className="badge">Dane testowe</span>
        </header>
        {query.get("view") === "settings" ? (
          <article className="card pad" id="calendar-settings">
            <CalendarSettingsEditor
              initial={{
                version: 1,
                hours_enabled: false,
                before_minutes: 15,
                after_minutes: 15,
                use_default: false,
                week: Array.from({ length: 7 }, (_, index) => ({
                  weekday: index + 1,
                  enabled: index < 5,
                  start_minute: 540,
                  end_minute: 1020,
                })),
              }}
              staffId={
                query.has("staff-settings") ? members[0].user_id : undefined
              }
            />
            <h2>Miejsca</h2>
            <CalendarResourcesEditor
              resources={resources}
              newResourceId="90000000-0000-4000-8000-000000000019"
            />
          </article>
        ) : query.get("view") === "home" ? (
          <NextAppointment appointment={filtered[0] || null} admin={admin} />
        ) : (
          <CalendarView
            appointments={filtered}
            range={range}
            admin={admin}
            newBlockId="90000000-0000-4000-8000-000000000009"
            now="2026-09-21T06:00:00Z"
            view={view}
            focusDate={query.get("date") || undefined}
            selectedStaff={query.get("staff") || "all"}
            selectedEvent={query.get("event") || undefined}
            members={admin ? members : []}
            resources={admin ? resources : []}
            currentUserId={admin ? members[0].user_id : null}
          />
        )}
        <p className="muted" style={{ marginTop: 24 }}>
          Podgląd interfejsu. Zapis nie trafia do bazy.
        </p>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
