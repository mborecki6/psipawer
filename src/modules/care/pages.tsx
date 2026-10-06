import { randomUUID } from "node:crypto";
import {
  getCareLibrary,
  getCareOverview,
  getDogCare,
  getCarePublication,
} from "./queries";
import {
  CareLibraryView,
  CareOverviewView,
  DogCareView,
  CarePublicationView,
} from "./views";
import { carePage } from "./types";

export async function DogCarePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    history?: string;
    progress?: string;
    consultation?: string;
    enrollment?: string;
    session?: string;
    fitness?: string;
    fitness_session?: string;
  }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const historyPage = carePage(search.history),
    progressPage = carePage(search.progress);
  const data = await getDogCare(
    id,
    historyPage,
    progressPage,
    search.consultation,
    search.enrollment,
    search.session,
    search.fitness,
    search.fitness_session,
  );
  return (
    <DogCareView
      {...data}
      historyPage={historyPage}
      progressPage={progressPage}
      responseId={randomUUID()}
    />
  );
}

export async function CarePublicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CarePublicationView {...await getCarePublication(id)} />;
}
export async function CareOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; inbox?: string }>;
}) {
  const search = await searchParams;
  const page = carePage(search.page),
    inboxPage = carePage(search.inbox);
  const data = await getCareOverview(page, inboxPage);
  return <CareOverviewView {...data} page={page} inboxPage={inboxPage} />;
}
export async function CareLibraryPage() {
  return (
    <CareLibraryView templates={await getCareLibrary()} newId={randomUUID()} />
  );
}
