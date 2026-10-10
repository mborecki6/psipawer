import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ConsultationListView,
  ConsultationRequestView,
  ConsultationView,
} from "@/modules/consultations/views";
import type {
  Consultation,
  ConsultationHistory,
  ConsultationStatus,
} from "@/modules/consultations/types";
import "@/app/globals.css";
import { testServices } from "../services-data";
const search = new URLSearchParams(location.search);
const role = search.get("role") === "client" ? "client" : "admin";
const view = search.get("view") || "list";
const empty = search.has("empty");
const dog = { id: "20000000-0000-4000-8000-000000000001", name: "Kluska" };
const consultation: Consultation = {
  service_name: testServices[0].name,
  agreed_price_cents: 10000,
  service_duration_minutes: 90,
  service_meeting_mode: "in_person",
  is_test_price: true,
  id: "30000000-0000-4000-8000-000000000001",
  dog_id: dog.id,
  dogs: { name: dog.name },
  topic:
    "Chcemy lepiej zrozumieć potrzeby Kluski podczas spacerów i omówić, jak zaplanować dalszą wspólną pracę.",
  availability: "Najchętniej wtorek lub czwartek po 15:00.",
  status: (search.get("status") || "scheduled") as ConsultationStatus,
  starts_at: "2026-10-06T13:00:00Z",
  duration_minutes: 60,
  meeting_mode: "in_person",
  location: "Przykładowe miejsce spotkania — dane fikcyjne.",
  version: 2,
  created_at: "2026-09-18T10:00:00Z",
};
if (consultation.status === "requested")
  Object.assign(consultation, {
    starts_at: null,
    duration_minutes: null,
    meeting_mode: null,
    location: "",
    version: 1,
  });
if (search.has("long")) {
  consultation.dogs.name = "DługieImięBezPrzerw".repeat(9);
  consultation.topic = "DługiOpisDoSprawdzeniaUkładu".repeat(45);
  consultation.location = "DługieMiejsceSpotkania".repeat(15);
}
const history: ConsultationHistory[] = [
  {
    id: "history-2",
    version: 2,
    action: "scheduled",
    starts_at: consultation.starts_at,
    duration_minutes: 60,
    meeting_mode: "in_person",
    location: consultation.location,
    note: "Termin uzgodniony podczas rozmowy. Do zobaczenia!",
    created_at: "2026-09-19T12:30:00Z",
  },
  {
    id: "history-1",
    version: 1,
    action: "requested",
    starts_at: null,
    duration_minutes: null,
    meeting_mode: null,
    location: "",
    note: "",
    created_at: "2026-09-18T10:00:00Z",
  },
];
function Fixture() {
  const [item, setItem] = useState(consultation);
  useEffect(() => {
    window.refreshConsultation = () =>
      setItem((c) => ({ ...c, version: c.version + 10 }));
  }, []);
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
          <a className="nav-item" href="?view=list">
            Konsultacje
          </a>
          <a className="nav-item" href="?view=detail">
            Spotkanie
          </a>
          <a className="nav-item" href="?view=request&role=client">
            Nowe zgłoszenie
          </a>
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="page-heading">
            <h1>Konsultacje</h1>
            <p>{role === "admin" ? "Panel behawiorystki" : "Panel opiekuna"}</p>
          </div>
          <span className="badge">Dane testowe</span>
        </header>
        {view === "request" ? (
          <ConsultationRequestView
            services={testServices.filter(
              (s) => s.booking_flow === "consultation",
            )}
            dogs={empty ? [] : [dog]}
            id="30000000-0000-4000-8000-000000000009"
          />
        ) : view === "detail" ? (
          <ConsultationView
            role={role}
            consultation={item}
            booking={
              role === "admin"
                ? {
                    defaultStaffId: "10000000-0000-4000-8000-000000000001",
                    staff: [
                      {
                        user_id: "10000000-0000-4000-8000-000000000001",
                        full_name: "Prowadząca próbna",
                      },
                      {
                        user_id: "10000000-0000-4000-8000-000000000002",
                        full_name: "Druga prowadząca próbna",
                      },
                    ],
                    resources: [
                      {
                        id: "40000000-0000-4000-8000-000000000001",
                        name: "Sala próbna",
                        exclusive: true,
                        active: !search.has("inactive"),
                      },
                    ],
                    assignments: [
                      {
                        appointment_id: item.id,
                        assigned_staff_id:
                          "10000000-0000-4000-8000-000000000001",
                        resource_id: search.has("inactive")
                          ? "40000000-0000-4000-8000-000000000001"
                          : null,
                        version: 4,
                      },
                    ],
                  }
                : undefined
            }
            care={{
              hasDraft: search.has("care"),
              more: search.has("care"),
              plans: search.has("care")
                ? [
                    {
                      id: "90000000-0000-4000-8000-000000000001",
                      title: "Zalecenia po konsultacji",
                      revision: 7,
                      published_at: "2026-09-19T10:00:00Z",
                    },
                  ]
                : [],
            }}
            history={history}
            page={1}
            more={false}
            now="2026-09-20T10:00:00Z"
          />
        ) : (
          <ConsultationListView
            role={role}
            consultations={
              empty
                ? []
                : [
                    consultation,
                    {
                      ...consultation,
                      id: "30000000-0000-4000-8000-000000000002",
                      dogs: { name: "Borys" },
                      status: "requested",
                      starts_at: null,
                      topic:
                        "Chcielibyśmy umówić pierwszą rozmowę o potrzebach Borysa.",
                    },
                  ]
            }
            page={1}
            more={false}
            filter="active"
          />
        )}
        <p className="muted" style={{ marginTop: 24 }}>
          Podgląd interfejsu. Zapisy w tym podglądzie nie trafiają do bazy.
        </p>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
