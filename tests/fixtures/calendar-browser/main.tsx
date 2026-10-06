import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarView } from "@/modules/calendar/views";
import { NextAppointment } from "@/modules/calendar/next-appointment";
import { weekRange } from "@/modules/calendar/dates";
import type { Appointment } from "@/modules/calendar/types";
import "@/app/globals.css";
const query = new URLSearchParams(location.search),
  admin = query.get("role") !== "client";
const range = weekRange("2026-09-21");
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
        {query.get("view") === "home" ? (
          <NextAppointment appointment={filtered[0] || null} admin={admin} />
        ) : (
          <CalendarView
            appointments={filtered}
            range={range}
            admin={admin}
            newBlockId="90000000-0000-4000-8000-000000000009"
            now="2026-09-21T06:00:00Z"
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
