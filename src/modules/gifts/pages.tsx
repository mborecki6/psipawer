import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireSession } from "@/lib/auth/session";
import {
  giftPage,
  getGiftCards,
  getGiftCard,
  getGiftIssueData,
  getGiftRedemptionData,
} from "./queries";
import { GiftListView, GiftDetailView } from "./views";
import { GiftIssueForm } from "./forms";
import styles from "./gifts.module.css";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(
    new Date(),
  );
export async function GiftListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = giftPage((await searchParams).page),
    data = await getGiftCards(page);
  return (
    <GiftListView
      cards={data.cards}
      admin={data.role === "admin"}
      page={page}
      more={data.more}
      today={today()}
    />
  );
}
export async function GiftCardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const [{ id }, q] = await Promise.all([params, searchParams]),
    page = giftPage(q.page),
    data = await getGiftCard(id, page);
  const staff =
    data.role === "admin" ? await getGiftRedemptionData(data.card) : null;
  return (
    <GiftDetailView data={data} staff={staff} page={page} today={today()} />
  );
}
export async function GiftIssuePage() {
  await requireSession("admin");
  const data = await getGiftIssueData();
  return (
    <div className={`stack ${styles.create}`}>
      <header className={styles.header}>
        <Link className="text-button" href="/admin/gifts">
          ← Karty podarunkowe
        </Link>
        <h2>Podaruj dobry czas.</h2>
        <p className="muted">
          Karta kwotowa lub na wybraną usługę, z własnymi życzeniami. Wystaw ją
          po potwierdzeniu wpłaty.
        </p>
      </header>
      <section className="card pad">
        <GiftIssueForm {...data} id={randomUUID()} today={today()} />
      </section>
    </div>
  );
}
