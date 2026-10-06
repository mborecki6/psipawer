import Link from "next/link";
import { money } from "@/lib/domain";
import { financeChargeHref } from "@/lib/finance-pagination";
import type { ConsultationBalance } from "@/lib/finance";

export function ConsultationBilling({
  balance: b,
  admin,
}: {
  balance: ConsultationBalance;
  admin: boolean;
}) {
  const base = admin ? "/admin" : "/app";
  const noPrice = b.agreed_price_cents === null;
  const requested = b.status === "requested";
  const cancelled = b.status === "cancelled";
  return (
    <article className="card pad" id="rozliczenie">
      <h3>Rozliczenie spotkania</h3>
      {b.needs_review ? (
        <>
          <span className="badge amber">
            Wpłata do rozliczenia po odwołaniu
          </span>
          <p>
            Zapisana wpłata: <strong>{money(b.paid_cents)}</strong>.
          </p>
          <p className="muted">
            {admin
              ? "Ustal zwrot z opiekunem. Po rozliczeniu odnotuj go w historii wpłat."
              : "Ustal z prowadzącą sposób rozliczenia tej wpłaty."}
          </p>
        </>
      ) : cancelled ? (
        <p>
          Spotkanie odwołane — brak należności. Historia wcześniejszych wpłat i
          korekt pozostaje w finansach.
        </p>
      ) : noPrice ? (
        <p className="muted">
          Starsze zgłoszenie bez ustalonej ceny.{" "}
          {admin
            ? "Uzgodnij kwotę z opiekunem i zapisz ją w formularzu poniżej."
            : "Rozliczenie wymaga uzgodnienia z prowadzącą."}
        </p>
      ) : requested ? (
        <p className="muted">
          Należność pojawi się po potwierdzeniu terminu przez prowadzącą. Samo
          zgłoszenie nie wymaga wpłaty.
        </p>
      ) : (
        <>
          <span className={`badge ${b.due_cents ? "amber" : "green"}`}>
            {b.due_cents ? "Do zapłaty" : "Opłacone"}
          </span>
          <p>
            Pozostało: <strong>{money(b.due_cents)}</strong>.
          </p>
          <p className="muted">
            Zapisane wpłaty: {money(b.paid_cents)} z{" "}
            {money(b.agreed_price_cents!)}.
          </p>
          {b.is_test_price && <p className="muted">Cena robocza do testów.</p>}
          {b.due_cents > 0 && (
            <p className="muted">
              {admin
                ? "W finansach możesz zapisać otrzymaną wpłatę, także częściową."
                : "Sposób płatności ustal z prowadzącą. Otrzymaną wpłatę odnotuje w aplikacji."}
            </p>
          )}
        </>
      )}
      {(!requested || b.paid_cents > 0) && !noPrice && (
        <Link
          className="ghost-button"
          href={
            b.due_cents > 0
              ? financeChargeHref(base, "consultation", b.id)
              : `${base}/finance#payments`
          }
        >
          {admin && b.due_cents > 0
            ? "Zapisz wpłatę w finansach"
            : "Historia i rozliczenia"}{" "}
          →
        </Link>
      )}
    </article>
  );
}
