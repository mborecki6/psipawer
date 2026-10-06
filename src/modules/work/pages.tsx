import Link from "next/link";
import { warsawDate } from "@/lib/domain";
import { ProgressCard } from "@/modules/care/views";
import {
  getWorkQueue,
  getFollowUp,
  getProgressForReview,
  getFollowUpArchive,
} from "./queries";
import { WorkQueueView, FollowUpView, FollowUpArchiveView } from "./views";
import { workFilter, workPage } from "./types";
export async function WorkQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const search = await searchParams,
    filter = workFilter(search.filter),
    page = workPage(search.page);
  return (
    <WorkQueueView
      {...await getWorkQueue(filter, page)}
      filter={filter}
      page={page}
      today={warsawDate(new Date())}
    />
  );
}
export async function FollowUpPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params,
    page = workPage((await searchParams).page);
  return (
    <FollowUpView
      {...await getFollowUp(id, page)}
      page={page}
      today={warsawDate(new Date())}
    />
  );
}
export async function ProgressReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const progress = await getProgressForReview((await params).id);
  return (
    <div className="stack">
      <Link className="ghost-button" href="/admin/work?filter=progress">
        ← Odpowiedzi do przeczytania
      </Link>
      <article className="card pad">
        <ProgressCard progress={progress} role="admin" showDog />
      </article>
    </div>
  );
}
export async function FollowUpArchivePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; dog?: string }>;
}) {
  const search = await searchParams,
    page = workPage(search.page);
  return (
    <FollowUpArchiveView
      {...await getFollowUpArchive(search.dog, page)}
      page={page}
      dogId={search.dog}
    />
  );
}
