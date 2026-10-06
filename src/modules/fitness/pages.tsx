import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import { fitnessFilter, fitnessPage } from "./types";
import {
  getFitnessPackage,
  getFitnessPackages,
  getFitnessRequestData,
} from "./queries";
import { FitnessDetailView, FitnessListView } from "./views";
import { FitnessRequestForm } from "./forms";
import { getFitnessCare } from "@/modules/care/queries";
import styles from "./fitness.module.css";
export async function FitnessListPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  await requireSession();
  const q = await searchParams,
    filter = fitnessFilter(q.filter),
    page = fitnessPage(q.page);
  return (
    <FitnessListView
      {...await getFitnessPackages(filter, page)}
      filter={filter}
      page={page}
    />
  );
}
export async function FitnessPackagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ historyPage?: string; plans?: string }>;
}) {
  await requireSession();
  const [{ id }, q] = await Promise.all([params, searchParams]),
    historyPage = fitnessPage(q.historyPage),
    plansPage = fitnessPage(q.plans);
  const data = await getFitnessPackage(id, historyPage);
  const care = await getFitnessCare(id, plansPage);
  return (
    <FitnessDetailView
      data={data}
      care={care}
      plansPage={plansPage}
      historyPage={historyPage}
      now={new Date().toISOString()}
    />
  );
}
export async function FitnessRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  await requireSession("client");
  const [data, q] = await Promise.all([getFitnessRequestData(), searchParams]);
  return (
    <div className={`stack ${styles.create}`}>
      <header className={styles.header}>
        <Link className="text-button" href="/app/fitness">
          ← Pakiety fitness
        </Link>
        <h2>Zgłoszenie na PSI FITNESS</h2>
        <p className="muted">
          Indywidualna praca z psem. Najpierw zgłoszenie, później potwierdzenie
          i wspólnie ustalone terminy.
        </p>
      </header>
      <section className="card pad">
        {!data.services.length ? (
          <p className="muted">
            Obecnie nie ma dostępnego pakietu do zgłoszenia. Skontaktuj się z
            prowadzącą.
          </p>
        ) : !data.dogs.length ? (
          <>
            <p className="muted">Najpierw dodaj psa do swojego konta.</p>
            <Link className="primary-button" href="/app/dogs">
              Moje psy →
            </Link>
          </>
        ) : data.dogs.every((d) => d.unavailable) ? (
          <>
            <p className="muted">
              Każdy z Twoich psów ma już otwarte zgłoszenie lub pakiet. Sprawdź
              bieżący pakiet.
            </p>
            <Link className="primary-button" href="/app/fitness">
              Moje pakiety →
            </Link>
          </>
        ) : (
          <FitnessRequestForm
            {...data}
            requestId={randomUUID()}
            serviceId={q.service}
          />
        )}
      </section>
    </div>
  );
}
