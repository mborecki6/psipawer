import Link from "next/link";
import { ActionForm, type FormAction } from "@/components/action-form";
import { dateLabel, money } from "@/lib/domain";
import type { FinanceCharge } from "@/lib/finance";
import type {
  OnlinePaymentAttempt,
  OnlinePaymentEnvironment,
  OnlinePaymentKind,
  OnlinePaymentStatus,
} from "./types";
import styles from "./payments.module.css";

const serviceLabels: Record<OnlinePaymentKind, string> = {
  registration: "Spacer",
  consultation: "Konsultacja",
  course: "Kurs",
  fitness: "PSI FITNESS",
};

const statusLabels: Record<OnlinePaymentStatus, string> = {
  creating: "Rozpoczęta",
  pending: "Oczekuje na potwierdzenie",
  uncertain: "Wynik do sprawdzenia",
  failed: "Nieudana",
  paid: "Opłacona",
  requires_review: "Wpływ do sprawdzenia",
};

const statusCopy: Record<OnlinePaymentStatus, string> = {
  creating:
    "Próba została zapisana. Sprawdź jej status przed kolejnym krokiem. Nie rozpoczynaj drugiej płatności.",
  pending:
    "Czekamy na potwierdzenie operatora. Sam powrót z bramki nie oznacza jeszcze wpłaty. Możesz sprawdzić status tej próby.",
  uncertain:
    "Nie udało się jeszcze ustalić wyniku. Zamknięcie bramki ani przerwane połączenie nie oznaczają odmowy banku. Sprawdź tę próbę przed kolejną płatnością.",
  failed:
    "Operator potwierdził niepowodzenie tej próby. Możesz wrócić do należności i rozpocząć nową płatność, jeśli nadal jest do zapłaty.",
  paid: "Wpłata została potwierdzona i zapisana w rozliczeniach. Nie płać ponownie za tę próbę.",
  requires_review:
    "Potwierdzony wpływ zachowaliśmy w historii. Nie został automatycznie przypisany do należności. Prowadząca sprawdzi rozliczenie; płatność nie przywraca zajęć i nie uruchamia automatycznego zwrotu.",
};

function allocatedReviewCopy(attempt: OnlinePaymentAttempt) {
  return attempt.review_reason === "chargeback"
    ? "Wcześniejsza wpłata wymaga uzgodnienia po zwrocie. Nie płać ponownie."
    : "Wcześniejsza wpłata pozostaje w rozliczeniach. Zmiana potwierdzenia operatora wymaga uzgodnienia; nie płać ponownie.";
}

function statusMessage(attempt: OnlinePaymentAttempt) {
  if (attempt.status === "requires_review" && attempt.payment_id)
    return allocatedReviewCopy(attempt);
  if (attempt.environment === "simulator") {
    if (attempt.status === "pending")
      return "Próba jest gotowa do lokalnej symulacji. Wybierz poniżej wynik testu. Nie połączyliśmy się z Tpay.";
    if (attempt.status === "failed")
      return "W lokalnej symulacji zapisano niepowodzenie tej próby. Możesz sprawdzić należność i rozpocząć nowy test, jeśli nadal jest do zapłaty.";
    if (attempt.status === "paid")
      return "Testowa wpłata została zapisana w lokalnych rozliczeniach. Nie pobrano prawdziwych pieniędzy. Nie płać ponownie za tę próbę.";
  }
  return statusCopy[attempt.status];
}

function reviewCopy(reason: string | null) {
  const reasons: Record<string, string> = {
    owner_changed: "Po rozpoczęciu płatności zmienił się opiekun usługi.",
    no_longer_payable:
      "Usługa nie jest już dostępna do opłacenia w pierwotnej postaci.",
    balance_changed:
      "Pozostała kwota zmieniła się, na przykład po innej odnotowanej wpłacie.",
    unbound_transaction:
      "Potwierdzenie wymaga sprawdzenia powiązania z zapisaną próbą.",
    amount_mismatch: "Potwierdzona wpłata różni się od oczekiwanej kwoty.",
    chargeback: "Operator zgłosił zwrot płatności.",
  };
  return (
    reasons[reason || ""] || "Rozliczenie wymaga sprawdzenia przez prowadzącą."
  );
}

function AttemptStatus({ status }: { status: OnlinePaymentStatus }) {
  return (
    <span
      className={`badge ${status === "paid" ? "green" : status === "failed" ? "neutral" : "amber"}`}
    >
      {statusLabels[status]}
    </span>
  );
}

export function OnlinePaymentTestNotice({
  environment,
}: {
  environment: OnlinePaymentEnvironment;
}) {
  if (environment === "live")
    return (
      <aside className={styles.testNotice} aria-label="Płatność Tpay">
        <strong>Płatność BLIK przez Tpay</strong>
        <p>
          Wynik wpłaty potwierdzamy u operatora. Sam powrót z bramki nie oznacza
          wpłaty.
        </p>
      </aside>
    );
  return (
    <aside className={styles.testNotice} aria-label="Testowy tryb płatności">
      <strong>
        {environment === "simulator"
          ? "Symulacja lokalna — bez połączenia z Tpay"
          : "Tryb testowy Tpay — sandbox"}
      </strong>
      <p>
        {environment === "simulator"
          ? "To lokalny test działania aplikacji. Nie pobieramy pieniędzy i nie wysyłamy płatności do Tpay."
          : "Korzystaj wyłącznie z danych testowych Tpay. Ten tryb nie służy do prawdziwych płatności."}
      </p>
    </aside>
  );
}

export function OnlinePaymentUnavailable({
  title,
  copy,
  admin = false,
  error = false,
}: {
  title: string;
  copy: string;
  admin?: boolean;
  error?: boolean;
}) {
  return (
    <div className={styles.root}>
      <Link
        className="text-button"
        href={`${admin ? "/admin" : "/app"}/finance`}
      >
        ← Rozliczenia
      </Link>
      <section
        className={`card pad ${styles.panel}`}
        role={error ? "alert" : "status"}
      >
        <h2>{title}</h2>
        <p>{copy}</p>
      </section>
    </div>
  );
}

function PaymentChargeFacts({
  charge,
  preview = false,
}: {
  charge: FinanceCharge;
  preview?: boolean;
}) {
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Pies</dt>
        <dd>{charge.dogName}</dd>
      </div>
      <div>
        <dt>Usługa</dt>
        <dd>{charge.title}</dd>
      </div>
      <div>
        <dt>Termin</dt>
        <dd>{dateLabel(charge.date)}</dd>
      </div>
      {preview && (
        <div>
          <dt>Uzgodniona kwota</dt>
          <dd>{money(charge.amountCents)}</dd>
        </div>
      )}
      {(preview || charge.paidCents > 0) && (
        <div>
          <dt>Już wpłacono</dt>
          <dd>{money(charge.paidCents)}</dd>
        </div>
      )}
      <div>
        <dt>{preview ? "Pozostało do zapłaty" : "Do zapłaty w tej próbie"}</dt>
        <dd className={styles.amount}>{money(charge.dueCents)}</dd>
      </div>
    </dl>
  );
}

export function OnlinePaymentPreviewView({
  charge,
  unresolvedAttempt,
}: {
  charge: FinanceCharge;
  unresolvedAttempt?: Pick<OnlinePaymentAttempt, "id">;
}) {
  return (
    <div className={styles.root}>
      <Link className="text-button" href="/app/finance">
        ← Rozliczenia
      </Link>
      <header className={styles.header}>
        <h2>Podgląd płatności online</h2>
        <p>Aktualne rozliczenie Twojej usługi.</p>
      </header>
      <aside className={styles.testNotice} role="status">
        <strong>Płatności online jeszcze niedostępne</strong>
        <p>
          Ten podgląd nie rozpoczyna płatności. Sposób wpłaty ustal z
          prowadzącą.
        </p>
      </aside>
      {unresolvedAttempt && (
        <aside className="alert" role="status">
          Masz wcześniejszą próbę płatności wymagającą sprawdzenia. Przed
          kolejną wpłatą{" "}
          <Link href={`/app/payments/${unresolvedAttempt.id}`}>
            sprawdź jej status →
          </Link>
        </aside>
      )}
      <section
        className={`card pad ${styles.panel}`}
        aria-labelledby="payment-summary-heading"
      >
        <h3 id="payment-summary-heading">Podsumowanie płatności</h3>
        <PaymentChargeFacts charge={charge} preview />
        <Link className="text-button" href={charge.href}>
          Zobacz usługę →
        </Link>
      </section>
    </div>
  );
}

export function NewOnlinePaymentView({
  charge,
  environment,
  requestId,
  action,
}: {
  charge: FinanceCharge;
  environment: OnlinePaymentEnvironment;
  requestId: string;
  action: FormAction;
}) {
  return (
    <div className={styles.root}>
      <Link className="text-button" href="/app/finance">
        ← Rozliczenia
      </Link>
      <header className={styles.header}>
        <h2>Płatność BLIK</h2>
        <p>Sprawdź usługę i pozostałą kwotę przed rozpoczęciem płatności.</p>
      </header>
      <OnlinePaymentTestNotice environment={environment} />
      <section
        className={`card pad ${styles.panel}`}
        aria-labelledby="payment-summary-heading"
      >
        <h3 id="payment-summary-heading">Podsumowanie płatności</h3>
        <PaymentChargeFacts charge={charge} />
        <p className="muted">
          Płatność obejmuje całą pozostałą należność. Kwotę ponownie sprawdzimy
          przed rozpoczęciem.
        </p>
        <ActionForm
          action={action}
          label={
            environment === "simulator"
              ? "Rozpocznij lokalną symulację BLIK"
              : environment === "live"
                ? "Przejdź do płatności BLIK"
                : "Przejdź do testowej płatności BLIK"
          }
          pendingLabel="Rozpoczynam płatność…"
          failureMessage="Nie udało się uzyskać wyniku rozpoczęcia płatności. Sprawdź próby w rozliczeniach przed kolejną płatnością."
        >
          <input type="hidden" name="target_kind" value={charge.kind} />
          <input type="hidden" name="target_id" value={charge.id} />
          <input type="hidden" name="request_id" value={requestId} />
          <input
            type="hidden"
            name="expected_due_cents"
            value={charge.dueCents}
          />
        </ActionForm>
        <Link className="text-button" href={charge.href}>
          Zobacz usługę →
        </Link>
      </section>
    </div>
  );
}

export function OnlinePaymentAttemptView({
  attempt,
  admin = false,
  controlsEnabled = true,
  canStart = true,
  recoverAction,
  checkAction,
  continueAction,
  simulateAction,
}: {
  attempt: OnlinePaymentAttempt;
  admin?: boolean;
  controlsEnabled?: boolean;
  canStart?: boolean;
  recoverAction?: FormAction;
  checkAction: FormAction;
  continueAction: FormAction;
  simulateAction: FormAction;
}) {
  const base = admin ? "/admin" : "/app";
  const active = ["creating", "pending", "uncertain"].includes(attempt.status);
  const canCheck =
    active ||
    (attempt.environment !== "simulator" && Boolean(attempt.transaction_id));
  return (
    <div className={styles.root}>
      <Link className="text-button" href={`${base}/finance#online-payments`}>
        ← Rozliczenia
      </Link>
      <header className={styles.header}>
        <h2>Płatność BLIK</h2>
        <p>
          {serviceLabels[attempt.target_kind]} · {attempt.id.slice(0, 8)}
        </p>
      </header>
      <OnlinePaymentTestNotice environment={attempt.environment} />
      <section
        className={`card pad ${styles.panel}`}
        aria-labelledby="payment-status-heading"
      >
        <h3 id="payment-status-heading">Status płatności</h3>
        <div role="status">
          <AttemptStatus status={attempt.status} />
          <p>{statusMessage(attempt)}</p>
        </div>
        <dl className={styles.facts}>
          <div>
            <dt>Numer próby do kontaktu</dt>
            <dd>{attempt.id}</dd>
          </div>
          {attempt.dog_name && (
            <div>
              <dt>Pies</dt>
              <dd>{attempt.dog_name}</dd>
            </div>
          )}
          {admin && attempt.guardian_name && (
            <div>
              <dt>Opiekun</dt>
              <dd>{attempt.guardian_name}</dd>
            </div>
          )}
          {attempt.service_name && (
            <div>
              <dt>Usługa</dt>
              <dd>{attempt.service_name}</dd>
            </div>
          )}
          {attempt.service_at && (
            <div>
              <dt>Termin zapisany przy rozpoczęciu</dt>
              <dd>{dateLabel(attempt.service_at)}</dd>
            </div>
          )}
          <div>
            <dt>Kwota rozpoczętej próby</dt>
            <dd>{money(attempt.amount_cents)}</dd>
          </div>
          {attempt.confirmed_amount_cents !== null && (
            <div>
              <dt>Potwierdzona kwota wpływu</dt>
              <dd className={styles.amount}>
                {money(attempt.confirmed_amount_cents)}
              </dd>
            </div>
          )}
          <div>
            <dt>Rozpoczęto</dt>
            <dd>
              <time dateTime={attempt.created_at}>
                {dateLabel(attempt.created_at)}
              </time>
            </dd>
          </div>
          {attempt.confirmed_at && (
            <div>
              <dt>Potwierdzono</dt>
              <dd>
                <time dateTime={attempt.confirmed_at}>
                  {dateLabel(attempt.confirmed_at)}
                </time>
              </dd>
            </div>
          )}
        </dl>
        {attempt.status === "requires_review" && (
          <p className={styles.reviewNote}>
            {reviewCopy(attempt.review_reason)}
          </p>
        )}
        {!controlsEnabled && canCheck && (
          <p role="status">
            Obsługa operatora dla tej próby jest obecnie niedostępna. Historia
            pozostaje dostępna; nie rozpoczynaj kolejnej płatności przed
            wyjaśnieniem wyniku.
          </p>
        )}
        {canCheck && controlsEnabled && (
          <div className={styles.actions}>
            <ActionForm
              action={checkAction}
              label="Sprawdź status płatności"
              pendingLabel="Sprawdzam status…"
              failureMessage="Nie udało się ponownie sprawdzić statusu. Zachowaliśmy dotychczasowy wynik. Spróbuj ponownie dla tej próby."
            >
              <input type="hidden" name="attempt_id" value={attempt.id} />
            </ActionForm>
            {!admin &&
              attempt.status === "pending" &&
              attempt.environment !== "simulator" &&
              attempt.checkout_url && (
                <ActionForm
                  action={continueAction}
                  label={
                    attempt.environment === "live"
                      ? "Wróć do bramki BLIK"
                      : "Wróć do testowej bramki BLIK"
                  }
                  pendingLabel="Otwieram bramkę…"
                >
                  <input type="hidden" name="attempt_id" value={attempt.id} />
                </ActionForm>
              )}
          </div>
        )}
        {!admin &&
          attempt.status === "failed" &&
          controlsEnabled &&
          canStart && (
            <Link
              className="primary-button"
              href={`/app/payments/new?kind=${attempt.target_kind}&target=${encodeURIComponent(attempt.target_id)}`}
            >
              Sprawdź należność i spróbuj ponownie
            </Link>
          )}
        {!admin && active && (
          <p>
            Jeśli bank potwierdził obciążenie, przekaż prowadzącej powyższy
            numer próby. Nie płać ponownie, dopóki wynik nie zostanie
            wyjaśniony.
          </p>
        )}
      </section>
      {admin &&
        controlsEnabled &&
        recoverAction &&
        attempt.environment !== "simulator" &&
        !attempt.transaction_id && (
          <section className={`card pad ${styles.panel}`}>
            <h3>Odzyskaj powiązanie transakcji</h3>
            <p>
              Odszukaj transakcję w panelu Tpay. Sprawdzimy jej dane u operatora
              przed zapisaniem powiązania. Sam identyfikator nie potwierdza
              wpłaty.
            </p>
            <ActionForm
              action={recoverAction}
              label="Sprawdź i powiąż transakcję"
              pendingLabel="Sprawdzam transakcję…"
            >
              <input type="hidden" name="attempt_id" value={attempt.id} />
              <label className="field">
                <span>Identyfikator transakcji Tpay</span>
                <input
                  name="transaction_id"
                  required
                  maxLength={128}
                  autoComplete="off"
                />
              </label>
            </ActionForm>
          </section>
        )}
      {!admin &&
        active &&
        controlsEnabled &&
        attempt.environment === "simulator" && (
          <section
            className={`card pad ${styles.panel}`}
            aria-labelledby="local-simulation-heading"
          >
            <h3 id="local-simulation-heading">
              Symulacja lokalna — bez połączenia z Tpay
            </h3>
            <p>
              Wybierz wynik wyłącznie dla tej lokalnej próby. Nie jest to test
              połączenia z sandboxem Tpay ani prawdziwa opłata.
            </p>
            <ActionForm
              action={simulateAction}
              label="Zapisz wynik lokalnej symulacji"
              pendingLabel="Zapisuję wynik…"
            >
              <input type="hidden" name="attempt_id" value={attempt.id} />
              <label className="field">
                <span>Wynik lokalnego testu</span>
                <select name="outcome" defaultValue="success" required>
                  <option value="success">Sukces testowej płatności</option>
                  <option value="failure">
                    Niepowodzenie testowej płatności
                  </option>
                </select>
              </label>
            </ActionForm>
          </section>
        )}
    </div>
  );
}

export function OnlinePaymentAttempts({
  attempts,
  admin,
}: {
  attempts: OnlinePaymentAttempt[];
  admin: boolean;
}) {
  const base = admin ? "/admin" : "/app";
  return (
    <section
      className={`card pad ${styles.panel}`}
      id="online-payments"
      aria-labelledby="online-payments-heading"
    >
      <h2 id="online-payments-heading">Próby płatności BLIK</h2>
      <p className="muted">
        Ostatnie 20 prób oraz wszystkie nierozstrzygnięte próby i wpływy
        wymagające sprawdzenia. Potwierdzone i rozliczone wpłaty są także w
        historii wpłat.
      </p>
      {attempts.length ? (
        <ol className={styles.attempts}>
          {attempts.map((attempt) => (
            <li key={attempt.id}>
              <div className={styles.attemptTop}>
                <Link
                  className={styles.attemptLink}
                  href={`${base}/payments/${attempt.id}`}
                >
                  {serviceLabels[attempt.target_kind]} ·{" "}
                  {attempt.dog_name ? `${attempt.dog_name} · ` : ""}
                  {attempt.service_name ||
                    serviceLabels[attempt.target_kind]} ·{" "}
                  {attempt.id.slice(0, 8)}
                </Link>
                <strong>
                  {money(
                    attempt.status === "requires_review"
                      ? (attempt.confirmed_amount_cents ?? attempt.amount_cents)
                      : attempt.amount_cents,
                  )}
                </strong>
              </div>
              {admin && attempt.guardian_name && (
                <p className="muted">{attempt.guardian_name}</p>
              )}
              <div className={styles.attemptMeta}>
                <AttemptStatus status={attempt.status} />
                <time dateTime={attempt.created_at}>
                  {dateLabel(attempt.created_at)}
                </time>
              </div>
              {attempt.status === "requires_review" && (
                <p className={styles.reviewNote}>
                  {reviewCopy(attempt.review_reason)}{" "}
                  {attempt.payment_id
                    ? allocatedReviewCopy(attempt)
                    : "Wpływ zachowany do sprawdzenia, bez automatycznego rozliczenia lub zwrotu."}
                </p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nie rozpoczęto jeszcze płatności BLIK.</p>
      )}
    </section>
  );
}
