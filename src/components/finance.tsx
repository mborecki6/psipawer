import Link from "next/link";
import { Coins, Package, ReceiptText, Wallet } from "lucide-react";
import { Empty } from "@/components/ui";
import { money } from "@/lib/domain";
import type { FinanceData } from "@/lib/finance";
import { financePages, type FinanceSearch } from "@/lib/finance-pagination";
import { ChargeRow } from "./finance/charge-row";
import { NewPackageForm } from "./finance/package-form";
import { PackageCard } from "./finance/package-card";
import { PaymentRow } from "./finance/payment-row";
import { FinancePager } from "./finance/pagination";
import {
  OnlinePaymentAttempts,
  OnlinePaymentTestNotice,
} from "../modules/payments/views";
import type {
  OnlinePaymentAttempt,
  OnlinePaymentEnvironment,
} from "../modules/payments/types";
import styles from "./finance.module.css";

export function FinanceView({
  data,
  admin,
  dueOnly = false,
  search = {},
  onlinePayments,
}: {
  data: FinanceData;
  admin: boolean;
  dueOnly?: boolean;
  search?: FinanceSearch;
  onlinePayments?: {
    enabled: boolean;
    environment: OnlinePaymentEnvironment | null;
    walkGate: string;
    notice?: string;
    attempts: OnlinePaymentAttempt[];
  };
}) {
  const base = admin ? "/admin" : "/app";
  const pages = financePages(data, search);
  const unresolvedPayments =
    onlinePayments?.attempts.filter((attempt) =>
      ["creating", "pending", "uncertain", "requires_review"].includes(
        attempt.status,
      ),
    ).length || 0;
  return (
    <div className={styles.root}>
      {onlinePayments?.enabled &&
        onlinePayments.environment &&
        onlinePayments.environment !== "live" && (
          <OnlinePaymentTestNotice environment={onlinePayments.environment} />
        )}
      {onlinePayments &&
        !onlinePayments.enabled &&
        onlinePayments.attempts.length > 0 && (
          <p className="alert" role="status">
            Nowe płatności BLIK są obecnie wyłączone. Historia wcześniejszych
            prób pozostaje dostępna. Przed kolejną wpłatą sprawdź
            nierozstrzygnięte próby poniżej.
          </p>
        )}
      {pages.packageUnavailable && (
        <div className="alert" role="status">
          Ten pakiet nie jest dostępny na Twoim koncie. Poniżej znajdziesz
          aktualne rozliczenia.
        </div>
      )}
      {pages.chargeUnavailable && (
        <div className="alert" role="status">
          Ta należność jest już rozliczona lub niedostępna na Twoim koncie.
          Poniżej znajdziesz aktualne rozliczenia.
        </div>
      )}
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
              ? `Rozliczenia wymagające uwagi: ${data.charges.length}`
              : unresolvedPayments
                ? `Płatności do sprawdzenia: ${unresolvedPayments}`
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
            {admin
              ? "Wpływy po korektach, wraz ze sprzedażą kart"
              : "Wpłaty pieniędzy po korektach; saldo kart zobaczysz osobno"}
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
            <h2 id="finance-due-heading">
              {data.charges.some((c) => c.reviewReason)
                ? "Do zapłaty i uzgodnienia"
                : "Do zapłaty"}
            </h2>
            <p>
              {admin
                ? "Nierozliczone kursy, konsultacje, spacery i pakiety oraz uzgodnienia po rezygnacji. Zapisuj wpłaty po ich otrzymaniu."
                : onlinePayments?.enabled
                  ? onlinePayments.environment === "live"
                    ? "Twoje nierozliczone usługi i uzgodnienia po rezygnacji. Przy dostępnych usługach możesz zapłacić BLIKIEM. Pozostałe rozliczenia ustal z prowadzącą."
                    : "Twoje nierozliczone usługi i uzgodnienia po rezygnacji. Przy dostępnych usługach możesz przetestować płatność BLIK. Pozostałe rozliczenia ustal z prowadzącą."
                  : "Twoje nierozliczone usługi i uzgodnienia po rezygnacji. Sposób płatności lub zwrotu ustal z prowadzącą. Otrzymane wpłaty pojawią się w tym panelu."}
            </p>
          </div>
          <span className={styles.count}>{money(data.totals.dueCents)}</span>
        </div>
        <div className={styles.sectionBody}>
          {data.charges.length ? (
            <div className={styles.list}>
              {pages.charges.items.map((charge) => (
                <ChargeRow
                  key={`${charge.kind}-${charge.id}`}
                  charge={charge}
                  admin={admin}
                  onlinePaymentEnabled={Boolean(
                    onlinePayments?.enabled &&
                    (charge.kind !== "registration" ||
                      onlinePayments.walkGate === "accepted"),
                  )}
                  onlinePaymentEnvironment={onlinePayments?.environment}
                />
              ))}
            </div>
          ) : (
            <Empty
              title="Wszystko na bieżąco"
              copy={
                admin
                  ? "Nie ma teraz należności do rozliczenia."
                  : "Nie masz teraz należności do rozliczenia. Do zobaczenia na spotkaniu!"
              }
            />
          )}
          <FinancePager
            pages={pages}
            section="charges"
            admin={admin}
            dueOnly={dueOnly}
          />
        </div>
      </section>
      {onlinePayments &&
        (onlinePayments.enabled || onlinePayments.attempts.length > 0) && (
          <OnlinePaymentAttempts
            attempts={onlinePayments.attempts}
            admin={admin}
          />
        )}
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
                  {pages.packages.items.map((item) => (
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
              <FinancePager
                pages={pages}
                section="packages"
                admin={admin}
                dueOnly={dueOnly}
              />
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
                    ? onlinePayments?.enabled
                      ? "Potwierdzone wpłaty, w tym testowe płatności online, oraz historia zwrotów i korekt."
                      : "Wpłaty zapisane ręcznie po otrzymaniu pieniędzy oraz historia zwrotów i korekt."
                    : onlinePayments?.enabled
                      ? "Potwierdzone i rozliczone wpłaty. Jeśli czegoś brakuje, skontaktuj się z prowadzącą."
                      : "Wpłaty potwierdzone przez behawiorystę. Jeśli czegoś brakuje, skontaktuj się z prowadzącą."}
                </p>
              </div>
              <ReceiptText size={23} aria-hidden="true" />
            </div>
            <div className={styles.sectionBody}>
              {data.payments.length ? (
                <div className={styles.list}>
                  {pages.payments.items.map((payment) => (
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
              <FinancePager
                pages={pages}
                section="payments"
                admin={admin}
                dueOnly={dueOnly}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
