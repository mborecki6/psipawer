import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ServicesView, ServiceDetailView } from "@/modules/services/views";
import { WalkServiceFields } from "@/modules/services/selection";
import { testServices } from "../services-data";
import "@/app/globals.css";
const search = new URLSearchParams(location.search);
const admin = search.get("role") !== "client";
const view = search.get("view") || "list";
function Fixture() {
  const [service, setService] = useState({
    ...testServices[0],
    ...(search.has("long")
      ? {
          name: "DługaNazwaUsługiBezSpacji".repeat(6),
          description: "DługiOpisBezPrzerw".repeat(30),
        }
      : {}),
  });
  useEffect(() => {
    window.refreshService = () =>
      setService((s) => ({
        ...s,
        version: s.version + 10,
        price_cents: 50000,
      }));
  }, []);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-copy">
            <strong>Psi Pawer</strong>
            <span>Lokalny podgląd</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <a className="nav-item" href="?view=list">
            Usługi i cennik
          </a>
          <a className="nav-item" href="?view=detail">
            Edycja usługi
          </a>
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="page-heading">
            <h1>{admin ? "Usługi i cennik" : "Oferta"}</h1>
            <p>{admin ? "Panel behawiorystki" : "Panel opiekuna"}</p>
          </div>
          <span className="badge">Podgląd lokalny</span>
        </header>
        {view === "detail" ? (
          <ServiceDetailView
            service={service}
            history={[
              {
                ...testServices[0],
                changed_by: null,
                created_at: service.updated_at,
              },
            ]}
            page={1}
            more={false}
          />
        ) : view === "walk" ? (
          <article className="card pad">
            <form className="form-stack">
              <WalkServiceFields
                services={testServices.filter((s) => s.booking_flow === "walk")}
                editing={search.has("editing")}
                hasRegistrations={search.has("editing")}
                initial={
                  search.has("editing")
                    ? {
                        type: "Wcześniejszy spacer",
                        price_cents: 7500,
                        duration_minutes: 45,
                      }
                    : {}
                }
              />
            </form>
          </article>
        ) : (
          <ServicesView
            services={
              search.has("empty") ? [] : [service, ...testServices.slice(1)]
            }
            admin={admin}
          />
        )}
        <p className="muted" style={{ marginTop: 24 }}>
          Podgląd na danych testowych. Zapis nie trafia do bazy.
        </p>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
