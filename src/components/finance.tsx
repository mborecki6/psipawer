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
import styles from "./finance.module.css";

export function FinanceView({
  data,
  admin,
  dueOnly = false,
  search = {},
}: {
  data: FinanceData;
  admin: boolean;
  dueOnly?: boolean;
  search?: FinanceSearch;
}) {
  const base = admin ? "/admin" : "/app";
  const pages = financePages(data, search);
  return (
    <div className={styles.root}>
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
                    ? "Wpłaty zapisane ręcznie po otrzymaniu pieniędzy oraz historia zwrotów i korekt."
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
