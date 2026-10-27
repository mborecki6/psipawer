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
  CareCourse,
  CareFitness,
  CareContext,
} from "@/modules/care/types";
import "@/app/globals.css";
import { careContextKey } from "@/modules/care/types";

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
const multiple = search.get("multi") === "1";
if (multiple) {
  plan.follow_up_on = "2026-11-01";
  plan.control_invite_on = "2026-11-03";
}
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
const course: CareCourse = {
  id: "81000000-0000-4000-8000-000000000001",
  course_id: "81000000-0000-4000-8000-000000000002",
  title: "Kurs spokojnych spacerów",
  sessions: [
    {
      id: "81000000-0000-4000-8000-000000000003",
      ordinal: 1,
      starts_at: "2026-09-18T10:00:00Z",
      status: "completed",
    },
    {
      id: "81000000-0000-4000-8000-000000000004",
      ordinal: 2,
      starts_at: "2026-10-01T10:00:00Z",
      status: "scheduled",
    },
  ],
};
const fitness: CareFitness = {
  id: "82000000-0000-4000-8000-000000000001",
  title: "PSI FITNESS — pakiet 4 spotkań",
  sessions: [
    {
      id: "82000000-0000-4000-8000-000000000002",
      ordinal: 1,
      starts_at: "2026-09-18T10:00:00Z",
      status: "completed",
    },
    {
      id: "82000000-0000-4000-8000-000000000003",
      ordinal: 2,
      starts_at: "2026-10-01T10:00:00Z",
      status: "scheduled",
    },
  ],
};
if (search.get("long") === "1")
  fitness.title = "Długi tytuł pakietu fitness ".repeat(8);
if (search.has("meeting") || search.get("saved") === "consultation")
  plan.consultation_id = meetings[0].id;
if (search.get("saved") === "course") plan.course_enrollment_id = course.id;
const requested =
  search.get("meeting") === "scheduled"
    ? meetings[1]
    : search.has("meeting")
      ? meetings[0]
      : null;
const chosenContext: CareContext = {
  consultation_id: search.get("consultation") || requested?.id || null,
  course_enrollment_id:
    search.get("enrollment") || (search.has("course") ? course.id : null),
  course_session_id:
    search.get("session") ||
    (search.get("course") === "scheduled"
      ? course.sessions[1].id
      : search.get("course") === "completed"
        ? course.sessions[0].id
        : null),
  fitness_package_id: search.has("fitness") ? fitness.id : null,
  fitness_session_id:
    search.get("fitness_session") ||
    (search.get("fitness") === "scheduled"
      ? fitness.sessions[1].id
      : search.get("fitness") === "completed"
        ? fitness.sessions[0].id
        : null),
};
const sameContext = careContextKey(chosenContext) === careContextKey(plan);
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
          context={chosenContext}
          contexts={
            empty
              ? []
              : multiple
                ? [
                    {
                      ...plan,
                      context_key: "general",
                      published_id: plan.id,
                      has_draft: true,
                    },
                    {
                      consultation_id: meetings[0].id,
                      context_key: `consultation:${meetings[0].id}`,
                      title: "Plan po konsultacji",
                      published_id: null,
                      revision: null,
                      has_draft: true,
                    },
                    {
                      consultation_id: null,
                      course_enrollment_id: course.id,
                      context_key: `course:${course.id}:all`,
                      title: "Zalecenia do kursu",
                      published_id: null,
                      revision: null,
                      has_draft: true,
                    },
                    {
                      consultation_id: null,
                      fitness_package_id: fitness.id,
                      context_key: `fitness:${fitness.id}:all`,
                      title: "Plan treningów fitness",
                      published_id: null,
                      revision: null,
                      has_draft: true,
                    },
                  ]
                : [
                    {
                      ...plan,
                      context_key: careContextKey(plan),
                      title: plan.title,
                      published_id: plan.id,
                      has_draft: role === "admin",
                    },
                  ]
          }
          consultations={meetings}
          requestedConsultation={requested}
          courses={[course]}
          requestedCourse={search.has("course") ? course : null}
          requestedSession={
            search.get("course") === "scheduled"
              ? course.sessions[1].id
              : search.get("course") === "completed"
                ? course.sessions[0].id
                : undefined
          }
          fitness={[fitness]}
          requestedFitness={search.has("fitness") ? fitness : null}
          requestedFitnessSession={
            search.get("fitness") === "scheduled"
              ? fitness.sessions[1].id
              : search.get("fitness") === "completed"
                ? fitness.sessions[0].id
                : undefined
          }
          dog={dog}
          latest={empty || !sameContext ? null : plan}
          draft={
            empty || !sameContext
              ? null
              : { ...plan, version: 3, updated_at: plan.published_at }
          }
          templates={[template]}
          history={
            empty || !sameContext
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
          progress={empty || !sameContext ? [] : [response]}
          moreProgress={false}
          followUp={
            multiple && sameContext
              ? {
                  id: "60000000-0000-4000-8000-000000000001",
                  plan_id: plan.id,
                  dog_id: dog.id,
                  due_on: "2026-11-01",
                  status: "open",
                  version: 1,
                  created_at: plan.published_at,
                  closed_at: null,
                }
              : null
          }
          controlInvitation={
            multiple && sameContext
              ? {
                  id: "60000000-0000-4000-8000-000000000002",
                  plan_id: plan.id,
                  dog_id: dog.id,
                  guardian_id: "10000000-0000-4000-8000-000000000001",
                  due_on: "2026-11-03",
                  status: "open",
                  version: 1,
                  consultation_id: null,
                }
              : undefined
          }
          reporting={
            multiple
              ? {
                  id: null,
                  included: true,
                  allowed: true,
                  starts_at: null,
                  expires_at: null,
                  version: 0,
                  overridden: false,
                  snapshot_days: null,
                  service_id: null,
                }
              : undefined
          }
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
