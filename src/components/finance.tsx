import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  CirclePlus,
  Coins,
  Package,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { Empty } from "@/components/ui";
import { dateLabel, money } from "@/lib/domain";
import type {
  FinanceCharge,
  FinanceData,
  FinancePackage,
  FinancePayment,
  PackageTransaction,
} from "@/lib/finance";
import {
  purchasePackage,
  releasePackage,
  cancelPackage,
  recordPayment,
  usePackage,
  voidPayment,
} from "@/lib/data/finance-actions";
import styles from "./finance.module.css";

const paymentMethods: Record<string, string> = {
  cash: "Gotówka",
  transfer: "Przelew",
  card: "Karta",
  other: "Inna metoda",
};
const packageStatuses: Record<string, string> = {
  active: "Aktywny",
  expired: "Wygasł",
  completed: "Wykorzystany",
  cancelled: "Anulowany",
};

function shortDate(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function Details({
  title,
  children,
  icon,
}: {
  title: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <details className={styles.details}>
      <summary>
        <span>
          {icon}
          {title}
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.detailsBody}>{children}</div>
    </details>
  );
}

function NoteField({
  required = false,
  privateNote = false,
  label,
}: {
  required?: boolean;
  privateNote?: boolean;
  label?: string;
}) {
  return (
    <label className="field">
      <span>
        {label ||
          (required ? "Powód zwrotu lub korekty" : "Notatka (opcjonalnie)")}
      </span>
      <textarea
        name="note"
        rows={2}
        maxLength={2000}
        minLength={required ? 3 : undefined}
        required={required}
      />
      <small className="field-hint">
        {privateNote
          ? "Notatka organizacyjna dostępna dla behawiorysty."
          : "Opis będzie widoczny także dla opiekuna."}
      </small>
    </label>
  );
}

function PaymentForm({ charge }: { charge: FinanceCharge }) {
  return (
    <ActionForm
      action={recordPayment}
      label="Zapisz wpłatę"
      pendingLabel="Zapisuję wpłatę…"
    >
      <input type="hidden" name="target_kind" value={charge.kind} />
      <input type="hidden" name="target_id" value={charge.id} />
      <input type="hidden" name="request_id" value={crypto.randomUUID()} />
      <div className="form-grid">
        <Field
          name="amount"
          label="Otrzymana kwota (zł)"
          value={(charge.dueCents / 100).toFixed(2).replace(".", ",")}
          inputMode="decimal"
          maxLength={9}
          required
        />
        <label className="field">
          <span>Metoda płatności</span>
          <select name="method" defaultValue="transfer" required>
            <option value="transfer">Przelew</option>
            <option value="cash">Gotówka</option>
            <option value="card">Karta</option>
            <option value="other">Inna (np. BLIK)</option>
          </select>
        </label>
      </div>
      <NoteField />
    </ActionForm>
  );
}

function ChargeRow({
  charge,
  admin,
}: {
  charge: FinanceCharge;
  admin: boolean;
}) {
  return (
    <article className={styles.row}>
      <div className={styles.rowMain}>
        <div>
          <h3 className={styles.rowTitle}>
            <Link href={charge.href}>{charge.dogName}</Link>
            {admin && (
              <span className={styles.muted}>· {charge.guardianName}</span>
            )}
          </h3>
          <div className={styles.rowMeta}>
            <Link className={styles.textLink} href={charge.href}>
              {charge.kind === "package" && <Package aria-hidden="true" />}
              {charge.title} <ArrowUpRight aria-hidden="true" />
            </Link>
          </div>
          <div className={styles.rowMeta}>
            <span>
              <CalendarDays aria-hidden="true" />
              {charge.kind === "package"
                ? `Zakup ${shortDate(charge.date)}`
                : dateLabel(charge.date)}
            </span>
          </div>
        </div>
        <div className={styles.amount}>
          <strong>{money(charge.dueCents)}</strong>
          <span className="badge amber">Do zapłaty</span>
        </div>
      </div>
      {charge.paidCents > 0 && (
        <p className={styles.rowNote}>
          Wpłacono {money(charge.paidCents)} z {money(charge.amountCents)}.
          Pozostało {money(charge.dueCents)}.
        </p>
      )}
      {admin && charge.canPay && (
        <Details title="Rozlicz należność" icon={<Wallet aria-hidden="true" />}>
          <div
            className={
              charge.availablePackages.length ? styles.actionColumns : undefined
            }
          >
            <div>
              <h4 className={styles.actionHeading}>Otrzymana wpłata</h4>
              <p className={styles.formHint}>
                Wpisz kwotę, którą opiekun już zapłacił. Możesz odnotować także
                część należności.
              </p>
              <PaymentForm charge={charge} />
            </div>
            {charge.availablePackages.length > 0 && (
              <div>
                <h4 className={styles.actionHeading}>Wejście z pakietu</h4>
                <p className={styles.formHint}>
                  Zarezerwuj jedno dostępne wejście tego psa na ten spacer.
                </p>
                <ActionForm
                  action={usePackage}
                  label="Użyj wejścia z pakietu"
                  pendingLabel="Rezerwuję wejście…"
                >
                  <input
                    type="hidden"
                    name="registration_id"
                    value={charge.id}
                  />
                  <label className="field">
                    <span>Pakiet psa {charge.dogName}</span>
                    <select
                      name="package_id"
                      required
                      defaultValue={charge.availablePackages[0].id}
                    >
                      {charge.availablePackages.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · dostępne wejścia: {item.available}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NoteField privateNote />
                </ActionForm>
              </div>
            )}
          </div>
        </Details>
      )}
    </article>
  );
}

function NewPackageForm({ data }: { data: FinanceData }) {
  return (
    <Details
      title="Dodaj pakiet dla psa"
      icon={<CirclePlus aria-hidden="true" />}
    >
      {!data.dogs.length ? (
        <p>
          Pakiet można przypisać do istniejącego profilu psa. Opiekun najpierw
          dodaje psa w swoim panelu.
        </p>
      ) : (
        <>
          <p>
            Pakiet otrzyma własne saldo wejść i należność do rozliczenia. Wpłatę
            zapiszesz osobno po jej otrzymaniu.
          </p>
          <ActionForm
            action={purchasePackage}
            label="Utwórz pakiet"
            pendingLabel="Tworzę pakiet…"
          >
            <label className="field">
              <span>Pies i opiekun</span>
              <select name="dog_id" required defaultValue="">
                <option value="" disabled>
                  Wybierz psa
                </option>
                {data.dogs.map((dog) => (
                  <option key={dog.id} value={dog.id}>
                    {dog.name} · {dog.guardianName}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="name"
              label="Nazwa pakietu"
              placeholder="np. Cztery wspólne spacery"
              maxLength={120}
              required
            />
            <div className="form-grid">
              <label className="field">
                <span>Liczba wejść</span>
                <input
                  name="entries"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                />
              </label>
              <Field
                name="price"
                label="Cena całego pakietu (zł)"
                inputMode="decimal"
                placeholder="0,00"
                maxLength={9}
                required
              />
            </div>
            <Field
              name="expires_at"
              label="Ważny do (opcjonalnie)"
              type="datetime-local"
              hint="Termin w polskiej strefie czasowej. Puste pole oznacza pakiet bez terminu ważności."
            />
            <NoteField privateNote />
          </ActionForm>
        </>
      )}
    </Details>
  );
}

function deltaDescription(transaction: PackageTransaction) {
  return [
    transaction.available_delta
      ? `Dostępne: ${transaction.available_delta > 0 ? "+" : ""}${transaction.available_delta}`
      : "",
    transaction.reserved_delta
      ? `Zarezerwowane: ${transaction.reserved_delta > 0 ? "+" : ""}${transaction.reserved_delta}`
      : "",
    transaction.used_delta
      ? `Wykorzystane: ${transaction.used_delta > 0 ? "+" : ""}${transaction.used_delta}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function PackageCard({
  item,
  admin,
}: {
  item: FinancePackage;
  admin: boolean;
}) {
  const total = item.available + item.reserved + item.used;
  const base = admin ? "/admin" : "/app";
  return (
    <article className={styles.packageCard} id={`package-${item.id}`}>
      <div className={styles.packageHeader}>
        <div>
          <h3>{item.name}</h3>
          <p>
            <Link
              className={styles.textLink}
              href={`${base}/dogs/${item.dogId}`}
            >
              {item.dogName}
            </Link>
            {admin && ` · ${item.guardianName}`}
          </p>
        </div>
        <span
          className={`badge ${item.status === "active" ? "green" : item.status === "expired" ? "amber" : "neutral"}`}
        >
          {packageStatuses[item.status] || item.status}
        </span>
      </div>
      <div className={styles.packageBalance}>
        <strong>{item.available}</strong>
        <span>
          {item.status === "active"
            ? "dostępnych wejść"
            : "niewykorzystanych wejść"}
        </span>
      </div>
      <div className={styles.packageTrack} aria-hidden="true">
        {total > 0 && (
          <>
            <span
              className={styles.trackAvailable}
              style={{ width: `${(item.available / total) * 100}%` }}
            />
            <span
              className={styles.trackReserved}
              style={{ width: `${(item.reserved / total) * 100}%` }}
            />
            <span
              className={styles.trackUsed}
              style={{ width: `${(item.used / total) * 100}%` }}
            />
          </>
        )}
      </div>
      <dl className={styles.packageStats}>
        <div>
          <dt>Dostępne</dt>
          <dd>{item.available}</dd>
        </div>
        <div>
          <dt>Zarezerwowane</dt>
          <dd>{item.reserved}</dd>
        </div>
        <div>
          <dt>Wykorzystane</dt>
          <dd>{item.used}</dd>
        </div>
      </dl>
      <p className={styles.packageExpiry}>
        {item.expiresAt
          ? `Ważny do ${dateLabel(item.expiresAt)}`
          : "Bez terminu ważności"}
        <br />
        Cena: {money(item.priceCents)} ·{" "}
        {item.dueCents > 0
          ? `do zapłaty ${money(item.dueCents)}`
          : item.paidCents >= item.priceCents
            ? "opłacony"
            : "bez należności"}
      </p>
      {item.status === "expired" && (
        <p className={styles.rowNote}>
          Pakiet wygasł. Pozostałych wejść nie można przypisać do kolejnych
          spacerów.
        </p>
      )}
      {item.reservations.length > 0 && (
        <Details
          title="Przypisane spacery"
          icon={<CalendarDays aria-hidden="true" />}
        >
          <ol className={styles.ledger}>
            {item.reservations.map((reservation) => (
              <li key={reservation.id}>
                <strong>{reservation.title}</strong>
                <time dateTime={reservation.startsAt}>
                  {dateLabel(reservation.startsAt)}
                </time>
                {admin && reservation.canRelease && (
                  <Details title="Odłącz wejście od tego spaceru">
                    <p>
                      Pies pozostanie zapisany na spacer. Wróci należność za
                      pojedynczy udział, a wejście będzie znów dostępne w
                      pakiecie.
                    </p>
                    <ActionForm
                      action={releasePackage}
                      label="Odłącz wejście"
                      confirm="Odłączyć wejście? Pies pozostanie zapisany na spacer, a jego udział będzie znów płatny osobno."
                    >
                      <input
                        type="hidden"
                        name="registration_id"
                        value={reservation.id}
                      />
                      <NoteField required label="Powód odłączenia wejścia" />
                    </ActionForm>
                  </Details>
                )}
              </li>
            ))}
          </ol>
        </Details>
      )}
      <Details title="Historia wejść" icon={<ReceiptText aria-hidden="true" />}>
        {item.transactions.length ? (
          <ol className={styles.ledger}>
            {[...item.transactions]
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((transaction) => (
                <li key={transaction.id}>
                  <strong>{transaction.reason}</strong>
                  <p>{deltaDescription(transaction)}</p>
                  <time dateTime={transaction.created_at}>
                    {dateLabel(transaction.created_at)}
                  </time>
                </li>
              ))}
          </ol>
        ) : (
          <p>Historia zmian salda pojawi się po pierwszej operacji.</p>
        )}
      </Details>
      {admin && item.canCancel && (
        <Details title="Anuluj niewykorzystany pakiet">
          <p>
            Pakiet przestanie być dostępny, a jego należność zostanie zamknięta.
            Otrzymaną wcześniej wpłatę rozlicz osobno w historii wpłat.
          </p>
          <ActionForm
            action={cancelPackage}
            label="Anuluj pakiet"
            confirm={`Anulować pakiet „${item.name}” psa ${item.dogName}? Ta zmiana nie wykona zwrotu pieniędzy.`}
          >
            <input type="hidden" name="package_id" value={item.id} />
            <NoteField required label="Powód anulowania pakietu" />
          </ActionForm>
        </Details>
      )}
    </article>
  );
}

function PaymentRow({
  payment,
  admin,
}: {
  payment: FinancePayment;
  admin: boolean;
}) {
  const refunded = payment.status === "refunded";
  return (
    <article className={styles.row}>
      <div className={styles.rowMain}>
        <div>
          <h3 className={styles.rowTitle}>
            {payment.dogName}
            {admin && (
              <span className={styles.muted}>· {payment.guardianName}</span>
            )}
          </h3>
          <div className={styles.rowMeta}>
            <span>{payment.title}</span>
          </div>
          <div className={styles.rowMeta}>
            <span>{shortDate(payment.paidAt)}</span>
            <span>{paymentMethods[payment.method] || payment.method}</span>
          </div>
        </div>
        <div className={styles.amount}>
          <strong>{money(payment.amountCents)}</strong>
          <span
            className={`badge ${payment.status === "paid" ? "green" : refunded ? "neutral" : "amber"}`}
          >
            {refunded
              ? "Zwrot / korekta"
              : payment.status === "paid"
                ? "Wpłata zapisana"
                : "Do rozliczenia"}
          </span>
        </div>
      </div>
      {payment.note && <p className={styles.rowNote}>{payment.note}</p>}
      {payment.needsReview && (
        <p className={styles.reviewNote}>
          <strong>Do sprawdzenia: zwrot wpłaty.</strong>{" "}
          {admin
            ? "Ta wpłata dotyczy odwołanego lub nieobciążanego opłatą udziału. Ustal zwrot z opiekunem i odnotuj go po rozliczeniu."
            : "Ta wpłata dotyczy odwołanego lub nieobciążanego opłatą udziału. Sposób jej rozliczenia ustal z behawiorystą."}
        </p>
      )}
      {refunded && (
        <p className={styles.rowNote}>
          <strong>Zwrot / korekta</strong>
          {payment.refundedAt && (
            <>
              {" "}
              ·{" "}
              <time dateTime={payment.refundedAt}>
                {dateLabel(payment.refundedAt)}
              </time>
            </>
          )}
          {payment.refundNote && (
            <>
              <br />
              {payment.refundNote}
            </>
          )}
        </p>
      )}
      {admin && payment.status === "paid" && (
        <Details title="Zapisz zwrot lub popraw błędną wpłatę">
          <p>
            Ten wpis zmieni ewidencję rozliczeń. Nie wykona przelewu. Zapisz go
            dopiero po zwrocie pieniędzy lub gdy pierwotna wpłata została
            wpisana błędnie.
          </p>
          <ActionForm
            action={voidPayment}
            label="Zapisz zwrot / korektę"
            confirm={`Potwierdź: kwota ${money(payment.amountCents)} została zwrócona albo wpłata jest błędnym wpisem. Zmiana może ponownie otworzyć należność. Zapisać korektę?`}
          >
            <input type="hidden" name="payment_id" value={payment.id} />
            <NoteField required />
          </ActionForm>
        </Details>
      )}
    </article>
  );
}

export function FinanceView({
  data,
  admin,
  dueOnly = false,
}: {
  data: FinanceData;
  admin: boolean;
  dueOnly?: boolean;
}) {
  const base = admin ? "/admin" : "/app";
  return (
    <div className={styles.root}>
      <div className={styles.summary} aria-label="Podsumowanie rozliczeń">
        <Link
          className={`${styles.summaryCard} ${styles.summaryPrimary}`}
          href={`${base}/finance?filter=due#finance-due`}
        >
          <span className={styles.summaryLabel}>
            Do zapłaty <Wallet aria-hidden="true" />
          </span>
          <strong className={styles.summaryValue}>
            {money(data.totals.dueCents)}
          </strong>
          <span className={styles.summaryNote}>
            {data.charges.length
              ? `Należności do rozliczenia: ${data.charges.length}`
              : "Wszystko rozliczone"}
          </span>
        </Link>
        <Link className={styles.summaryCard} href={`${base}/finance#packages`}>
          <span className={styles.summaryLabel}>
            Dostępne wejścia <Package aria-hidden="true" />
          </span>
          <strong className={styles.summaryValue}>
            {data.totals.availableEntries}
          </strong>
          <span className={styles.summaryNote}>
            W aktywnych pakietach · zarezerwowane: {data.totals.reservedEntries}
          </span>
        </Link>
        <Link className={styles.summaryCard} href={`${base}/finance#payments`}>
          <span className={styles.summaryLabel}>
            {admin ? "Otrzymane wpłaty" : "Twoje wpłaty"}{" "}
            <Coins aria-hidden="true" />
          </span>
          <strong className={styles.summaryValue}>
            {money(data.totals.paidCents)}
          </strong>
          <span className={styles.summaryNote}>
            Suma zapisanych wpłat po korektach
          </span>
        </Link>
      </div>
      <nav className={styles.tabs} aria-label="Widok rozliczeń">
        <Link
          href={`${base}/finance`}
          aria-current={!dueOnly ? "page" : undefined}
        >
          Wszystkie rozliczenia
        </Link>
        <Link
          href={`${base}/finance?filter=due`}
          aria-current={dueOnly ? "page" : undefined}
        >
          Do zapłaty
        </Link>
      </nav>
      <section
        className={styles.section}
        id="finance-due"
        aria-labelledby="finance-due-heading"
      >
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="finance-due-heading">Do zapłaty</h2>
            <p>
              {admin
                ? "Nierozliczone spacery i pakiety. Zapisuj wpłaty po ich otrzymaniu."
                : "Twoje nierozliczone spacery i pakiety. Sposób płatności ustal z behawiorystą — otrzymane wpłaty pojawią się w tym panelu."}
            </p>
          </div>
          <span className={styles.count}>{money(data.totals.dueCents)}</span>
        </div>
        <div className={styles.sectionBody}>
          {data.charges.length ? (
            <div className={styles.list}>
              {data.charges.map((charge) => (
                <ChargeRow
                  key={`${charge.kind}-${charge.id}`}
                  charge={charge}
                  admin={admin}
                />
              ))}
            </div>
          ) : (
            <Empty
              title="Wszystko na bieżąco"
              copy={
                admin
                  ? "Nie ma teraz należności do rozliczenia."
                  : "Nie masz teraz należności do rozliczenia. Do zobaczenia na spacerze!"
              }
            />
          )}
        </div>
      </section>
      {!dueOnly && (
        <>
          <section
            className={styles.section}
            id="packages"
            aria-labelledby="packages-heading"
          >
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="packages-heading">
                  {admin ? "Pakiety spacerowe" : "Twoje pakiety"}
                </h2>
                <p>
                  Dostępne, zarezerwowane i wykorzystane wejścia. Każda zmiana
                  salda ma swoją historię.
                </p>
              </div>
              <span className={styles.count}>
                Pakiety: {data.packages.length}
              </span>
            </div>
            <div className={styles.sectionBody}>
              {data.packages.length ? (
                <div className={styles.packageGrid}>
                  {data.packages.map((item) => (
                    <PackageCard key={item.id} item={item} admin={admin} />
                  ))}
                </div>
              ) : (
                <Empty
                  title="Tu zaczną się kolejne wspólne kroki"
                  copy={
                    admin
                      ? "Dodaj pakiet wybranemu psu, aby prowadzić saldo jego wejść."
                      : "Nie masz jeszcze pakietu. Zapytaj behawiorystę o możliwość zakupu."
                  }
                />
              )}
              {admin && <NewPackageForm data={data} />}
            </div>
          </section>
          <section
            className={styles.section}
            id="payments"
            aria-labelledby="payments-heading"
          >
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="payments-heading">Historia wpłat</h2>
                <p>
                  {admin
                    ? "Wpłaty zapisane ręcznie po otrzymaniu pieniędzy oraz historia zwrotów i korekt."
                    : "Wpłaty potwierdzone przez behawiorystę. Jeśli czegoś brakuje, skontaktuj się z prowadzącą."}
                </p>
              </div>
              <ReceiptText size={23} aria-hidden="true" />
            </div>
            <div className={styles.sectionBody}>
              {data.payments.length ? (
                <div className={styles.list}>
                  {[...data.payments]
                    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
                    .map((payment) => (
                      <PaymentRow
                        key={payment.id}
                        payment={payment}
                        admin={admin}
                      />
                    ))}
                </div>
              ) : (
                <Empty
                  title="Jeszcze bez zapisanych wpłat"
                  copy="Potwierdzone wpłaty pojawią się tutaj wraz z datą, kwotą i sposobem płatności."
                />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
