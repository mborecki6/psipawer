import { createRoot } from "react-dom/client";
import {
  CareLibraryView,
  CarePublicationView,
  CareOverviewView,
  DogCareView,
} from "@/modules/care/views";
import type {
  CarePlan,
  CareProgress,
  CareTemplate,
} from "@/modules/care/types";
import "@/app/globals.css";

const dog = { id: "20000000-0000-4000-8000-000000000001", name: "Kluska" };
const template: CareTemplate = {
  id: "50000000-0000-4000-8000-000000000001",
  title: "Materiał do wspólnego omówienia",
  body: "Fikcyjny materiał do testowania aplikacji.\n\nMiejsce na własne wskazówki prowadzącej.",
  version: 1,
  updated_at: "2026-09-18T10:00:00Z",
};
const plan: CarePlan = {
  id: "30000000-0000-4000-8000-000000000001",
  dog_id: dog.id,
  consultation_id: null,
  title: "Nasz plan na najbliższe dni",
  body: "To fikcyjny plan do sprawdzenia aplikacji.\n\n1. Tutaj pojawi się cel wspólnej pracy.\n2. Tutaj prowadząca zapisze kroki dopasowane do psa.\n3. W odpowiedzi poniżej opiekun opisze swoje obserwacje.\n\nTe treści nie stanowią zaleceń behawioralnych.",
  revision: 2,
  follow_up_on: "2026-10-01",
  published_at: "2026-09-18T10:00:00Z",
};
const response: CareProgress = {
  id: "40000000-0000-4000-8000-000000000001",
  dog_id: dog.id,
  plan_id: plan.id,
  attempted: "To przykładowa odpowiedź opiekuna do sprawdzenia widoku.",
  went_well: "Udało się zapisać obserwacje w jednym miejscu.",
  difficult: "Chcemy omówić kilka pytań podczas następnego spotkania.",
  created_at: "2026-09-18T11:00:00Z",
  reviewed_at: null,
  care_plan_versions: { title: plan.title, revision: 2 },
  dogs: { name: dog.name },
};
const search = new URLSearchParams(location.search);
const role = search.get("role") === "client" ? "client" : "admin";
const view = search.get("view") || "dog";
const empty = search.get("empty") === "1";
if (search.get("long") === "1") {
  dog.name = "Bardzo długie imię psa ".repeat(5);
  plan.title = "Długi tytuł planu ".repeat(8);
  plan.body += "\n\n" + "NierozdzielonyBardzoDługiFragment".repeat(12);
  template.title = "Długi tytuł materiału ".repeat(8);
}
const meetings = [
  {
    id: "80000000-0000-4000-8000-000000000001",
    service_name: "Konsultacja testowa",
    starts_at: "2026-09-18T10:00:00Z",
    status: "completed" as const,
  },
  {
    id: "80000000-0000-4000-8000-000000000002",
    service_name: "Kolejna konsultacja testowa",
    starts_at: "2026-10-01T10:00:00Z",
    status: "scheduled" as const,
  },
];
if (search.has("meeting")) plan.consultation_id = meetings[0].id;
const requested =
  search.get("meeting") === "scheduled"
    ? meetings[1]
    : search.has("meeting")
      ? meetings[0]
      : null;
const base = role === "admin" ? "/admin" : "/app";
createRoot(document.getElementById("root")!).render(
  <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-copy">
          <strong>Psi Pawer</strong>
          <span>Lokalny podgląd na fikcyjnych danych</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        <a className="nav-item" href={`?role=${role}&view=overview`}>
          Plany i postępy
        </a>
        <a className="nav-item" href={`?role=${role}&view=dog`}>
          Plan psa
        </a>
        {role === "admin" && (
          <a className="nav-item" href="?view=library">
            Biblioteka materiałów
          </a>
        )}
      </nav>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="page-heading">
          <h1>Plany i postępy</h1>
          <p>{role === "admin" ? "Panel behawiorysty" : "Panel opiekuna"}</p>
        </div>
        <span className="badge">Dane testowe</span>
      </header>
      {view === "publication" ? (
        <CarePublicationView
          role={role}
          plan={{ ...plan, dogs: dog }}
          current={false}
        />
      ) : view === "library" ? (
        <CareLibraryView
          templates={empty ? [] : [template]}
          newId="50000000-0000-4000-8000-000000000002"
        />
      ) : view === "overview" ? (
        <CareOverviewView
          role={role}
          plans={
            empty ? [] : [{ ...plan, dog_name: dog.name, unread_count: 1 }]
          }
          morePlans={false}
          inbox={empty ? [] : [response]}
          moreInbox={false}
          inboxCount={empty ? 0 : 1}
          page={1}
          inboxPage={1}
        />
      ) : (
        <DogCareView
          role={role}
          consultations={meetings}
          requestedConsultation={requested}
          dog={dog}
          latest={empty ? null : plan}
          draft={
            empty
              ? null
              : { ...plan, version: 3, updated_at: plan.published_at }
          }
          templates={[template]}
          history={
            empty
              ? []
              : [
                  {
                    ...plan,
                    id: "30000000-0000-4000-8000-000000000002",
                    revision: 1,
                  },
                ]
          }
          moreHistory={false}
          progress={empty ? [] : [response]}
          moreProgress={false}
          historyPage={1}
          progressPage={1}
          responseId="40000000-0000-4000-8000-000000000002"
        />
      )}
      <p className="muted" style={{ marginTop: 24 }}>
        Podgląd interfejsu {base}. Zapisy w tym podglądzie nie trafiają do bazy.
      </p>
    </main>
  </div>,
);
