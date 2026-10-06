import Link from "next/link";
import { randomUUID } from "node:crypto";
import { ArrowUpRight, Gift, PawPrint } from "lucide-react";
import { dateLabel, money } from "@/lib/domain";
import {
  GiftClaimForm,
  GiftChangeForm,
  GiftCashRefundForm,
  GiftRedeemForm,
  GiftPrintButton,
} from "./forms";
import {
  giftStatus,
  giftLedgerLabels,
  giftHistoryLabels,
  type GiftCard,
} from "./types";
import type { getGiftCard, getGiftRedemptionData } from "./queries";
import styles from "./gifts.module.css";
const date = (value: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(`${value}T12:00:00Z`));
function Pager({
  page,
  more,
  href,
}: {
  page: number;
  more: boolean;
  href: string;
}) {
  if (page === 1 && !more) return null;
  return (
    <nav className={styles.pager} aria-label="Strony kart i historii">
      {page > 1 && (
        <Link className="ghost-button" href={`${href}?page=${page - 1}`}>
          ← Poprzednia
        </Link>
      )}
      <span>Strona {page}</span>
      {more && (
        <Link className="ghost-button" href={`${href}?page=${page + 1}`}>
          Następna →
        </Link>
      )}
    </nav>
  );
}
export function GiftListView({
  cards,
  admin,
  page,
  more,
  today,
}: {
  cards: GiftCard[];
  admin: boolean;
  page: number;
  more: boolean;
  today: string;
}) {
  const base = admin ? "/admin" : "/app";
  return (
    <div className="stack">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <Gift size={18} /> Karty podarunkowe
        </span>
        <h2>Dobry czas dla Was.</h2>
        <p className="muted">
          {admin
            ? "Wystawiaj karty po otrzymaniu wpłaty. Przypisuj je opiekunom i rozliczaj usługi z ich salda."
            : "Prezent, który wspiera Waszą wspólną drogę. Tutaj sprawdzisz saldo i historię swojej karty."}
        </p>
        {admin && (
          <Link className="primary-button" href="/admin/gifts/new">
            Wystaw kartę →
          </Link>
        )}
      </header>
      {!admin && (
        <section className="card pad stack">
          <h3>Masz kod podarunkowy?</h3>
          <p className="muted">
            Aktywuj kartę na swoim koncie. Prowadząca wykorzysta ją przy
            rozliczeniu wybranej usługi.
          </p>
          <GiftClaimForm />
        </section>
      )}
      <div className={styles.grid}>
        {cards.map((card) => (
          <Link
            className={`card pad ${styles.listCard}`}
            key={card.id}
            href={`${base}/gifts/${card.id}`}
          >
            <div className={styles.cardTop}>
              <Gift aria-hidden="true" />
              <span className={`badge ${card.usable ? "green" : "neutral"}`}>
                {giftStatus(card, today)}
              </span>
            </div>
            <h3>{card.recipient_label}</h3>
            <p className="muted">
              {card.service_name || "Na dowolną usługę Psi Pawer"}
            </p>
            <div className={styles.balance}>
              <span>Dostępne saldo</span>
              <strong>{money(card.balance_cents)}</strong>
            </div>
            <p className="muted">
              Wartość przy zakupie: {money(card.value_cents)}
            </p>
            <div className={styles.cardFoot}>
              <span>Ważna do {date(card.expires_on)}</span>
              <ArrowUpRight size={18} />
            </div>
          </Link>
        ))}
      </div>
      {!cards.length && (
        <section className="card pad">
          <h3>
            {page > 1
              ? "Brak kart na tej stronie"
              : admin
                ? "Pierwsza karta czeka na wystawienie"
                : "Tutaj pojawi się Twoja karta"}
          </h3>
          <p className="muted">
            {admin
              ? "Przygotuj kartę kwotową lub na wybraną usługę po potwierdzeniu otrzymanej wpłaty."
              : "Wklej otrzymany kod powyżej lub poproś prowadzącą o przypisanie karty."}
          </p>
        </section>
      )}
      <Pager page={page} more={more} href={`${base}/gifts`} />
    </div>
  );
}
export function GiftDetailView({
  data,
  staff,
  page,
  today,
}: {
  data: Awaited<ReturnType<typeof getGiftCard>>;
  staff: Awaited<ReturnType<typeof getGiftRedemptionData>> | null;
  page: number;
  today: string;
}) {
  const { card, code, ledger, history, sale } = data,
    admin = data.role === "admin",
    base = admin ? "/admin" : "/app";
  return (
    <div className="stack">
      <header className={styles.header} data-gift-print="hide">
        <Link className="text-button" href={`${base}/gifts`}>
          ← Karty podarunkowe
        </Link>
        <h2>Karta dla: {card.recipient_label}</h2>
        <span className={`badge ${card.usable ? "green" : "neutral"}`}>
          {giftStatus(card, today)}
        </span>
      </header>
      <section className={styles.printCard} aria-label="Karta podarunkowa">
        <div className={styles.printTop}>
          <span>
            <PawPrint size={21} /> PSI PAWER
          </span>
          <span>Karta podarunkowa</span>
        </div>
        <Gift className={styles.giftMark} size={48} aria-hidden="true" />
        <h3>
          Dobry czas.
          <br />
          Dla Ciebie i Twojego psa.
        </h3>
        <p className={styles.giftRecipient}>
          Dla: <strong>{card.recipient_label}</strong>
          <br />
          <span>Od: {card.sender_label}</span>
        </p>
        <div>
          <small>Wartość przy zakupie</small>
          <br />
          <strong className={styles.faceValue}>
            {money(card.value_cents)}
          </strong>
        </div>
        {card.balance_cents !== card.value_cents && (
          <p>
            Pozostałe saldo: <strong>{money(card.balance_cents)}</strong>
          </p>
        )}
        <p>
          {card.service_name
            ? `Do wykorzystania na: ${card.service_name}`
            : "Do wykorzystania na dowolną usługę Psi Pawer"}
        </p>
        {card.message && <blockquote>{card.message}</blockquote>}
        <div className={styles.validity}>
          Ważna do {date(card.expires_on)} włącznie
          <br />
          <small>Sześć miesięcy od zakupu: {date(card.purchased_on)}</small>
        </div>
        {admin && code && (
          <div className={styles.code}>
            <span>Kod do aktywacji na koncie opiekuna</span>
            <code>{code.match(/.{1,8}/g)?.join("-")}</code>
            <small>Przekaż go tylko obdarowanemu.</small>
          </div>
        )}
        {card.status === "cancelled" && (
          <p className="alert">Ta karta została wycofana.</p>
        )}
        <small>
          Wartość pozostaje zgodna z zakupem. Ewentualną dopłatę i termin usługi
          ustal z prowadzącą.
        </small>
      </section>
      <div className="stack" data-gift-print="hide">
        {admin && <GiftPrintButton />}
        <section className="card pad stack">
          <h3>Twoje saldo i zasady</h3>
          <dl className={styles.facts}>
            <div>
              <dt>Dostępna wartość</dt>
              <dd>{money(card.balance_cents)}</dd>
            </div>
            <div>
              <dt>Wartość przy zakupie</dt>
              <dd>{money(card.value_cents)}</dd>
            </div>
            <div>
              <dt>Termin ważności</dt>
              <dd>{date(card.expires_on)}</dd>
            </div>
            <div>
              <dt>Przeznaczenie</dt>
              <dd>{card.service_name || "Dowolna usługa"}</dd>
            </div>
          </dl>
          <p className="muted">
            Zwrot za usługę opłaconą kartą wraca na jej saldo. Nie odnawia
            terminu ważności. Karta nie rezerwuje terminu spotkania.
          </p>
          {card.is_test_price && (
            <p className="muted">Wartość robocza do testów aplikacji.</p>
          )}
        </section>
        {admin && staff && (
          <>
            <section className="card pad stack">
              <h3>Rozlicz usługę kartą</h3>
              <GiftRedeemForm
                key={card.id}
                card={card}
                charges={staff.charges}
                requestId={randomUUID()}
              />
            </section>
            <section className="card pad stack">
              <h3>Decyzje i przypisanie</h3>
              <p className="muted">
                {card.beneficiary_id
                  ? `Opiekun: ${staff.people.find((p) => p.id === card.beneficiary_id)?.full_name || "przypisane konto"}`
                  : "Karta nie jest jeszcze przypisana do konta."}
              </p>
              <GiftChangeForm
                key={card.id}
                card={card}
                people={staff.people}
                requestId={randomUUID()}
              />
            </section>
            {card.status === "cancelled" && (
              <section className="card pad stack">
                <h3>Zwrot pieniędzy za niewykorzystaną wartość</h3>
                <p className="muted">
                  Odnotuj dopiero rzeczywisty zwrot pieniędzy. Dotyczy wyłącznie
                  pozostałego salda wycofanej karty.
                </p>
                <GiftCashRefundForm
                  key={card.id}
                  card={card}
                  requestId={randomUUID()}
                />
              </section>
            )}
            {sale && (
              <section className="card pad stack">
                <h3>Potwierdzona wpłata za kartę</h3>
                <p>
                  {money(sale.amount_cents)} · {dateLabel(sale.created_at)}
                </p>
                <p className="muted">
                  Sprzedaż jest ujęta raz we wspólnych finansach. Wykorzystanie
                  karty na usługę nie tworzy drugiego wpływu.
                </p>
                {sale.note && <p>{sale.note}</p>}
                <Link className="text-button" href="/admin/finance">
                  Otwórz finanse →
                </Link>
              </section>
            )}
          </>
        )}
        <section className="card pad stack">
          <h3>Historia salda</h3>
          <ol className={styles.ledger}>
            {ledger.map((entry) => (
              <li key={entry.id}>
                <div>
                  <strong>{giftLedgerLabels[entry.kind]}</strong>
                  <time dateTime={entry.created_at}>
                    {dateLabel(entry.created_at)}
                  </time>
                  {entry.note && <p>{entry.note}</p>}
                </div>
                <b>
                  {entry.delta_cents > 0 ? "+" : "−"}
                  {money(Math.abs(entry.delta_cents))}
                </b>
              </li>
            ))}
          </ol>
          {!ledger.length && (
            <p className="muted">Brak operacji na tej stronie.</p>
          )}
        </section>
        {admin && (
          <details className="card pad">
            <summary>Historia decyzji prowadzącej</summary>
            <ol className={styles.ledger}>
              {history.map((entry) => (
                <li key={entry.id}>
                  <div>
                    <strong>
                      {giftHistoryLabels[entry.action] || "Zmiana karty"}
                    </strong>
                    <time dateTime={entry.created_at}>
                      {dateLabel(entry.created_at)}
                    </time>
                    {entry.note && <p>{entry.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}
        <Pager page={page} more={data.more} href={`${base}/gifts/${card.id}`} />
      </div>
    </div>
  );
}
