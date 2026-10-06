import Link from "next/link";
import {
  financePages,
  financePageLink,
  type FinanceSection,
} from "@/lib/finance-pagination";
import styles from "../finance.module.css";

export function FinancePager({
  pages,
  section,
  admin,
  dueOnly,
}: {
  pages: ReturnType<typeof financePages>;
  section: FinanceSection;
  admin: boolean;
  dueOnly: boolean;
}) {
  const current = pages[section];
  if (current.last <= 1) return null;
  const label = {
    charges: "należności",
    packages: "pakietów",
    payments: "wpłat",
  }[section];
  const href = (page: number) =>
    financePageLink(admin ? "/admin" : "/app", pages, section, page, dueOnly);
  return (
    <nav className={styles.pagination} aria-label={`Strony ${label}`}>
      <p>
        Pozycje {current.from}–{current.to} z {current.total} · strona{" "}
        {current.page} z {current.last}
      </p>
      <div>
        {current.page > 1 && (
          <Link className="ghost-button" href={href(current.page - 1)}>
            ← Poprzednie
          </Link>
        )}
        {current.page < current.last && (
          <Link className="ghost-button" href={href(current.page + 1)}>
            Następne →
          </Link>
        )}
      </div>
    </nav>
  );
}
