import { ChevronDown } from "lucide-react";
import styles from "../finance.module.css";

export function Details({
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

export function NoteField({
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
