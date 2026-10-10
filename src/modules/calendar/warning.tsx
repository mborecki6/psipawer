"use client";
import { useEffect, useId, useRef } from "react";
import type { ActionState } from "@/components/action-form";

export function CalendarWarning({
  warning,
  pending = false,
}: {
  warning?: ActionState["calendarWarning"];
  pending?: boolean;
}) {
  const summary = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (warning) summary.current?.focus();
  }, [warning]);
  if (!warning) return null;
  return (
    <div className="alert yellow" role="alert" tabIndex={-1} ref={summary}>
      <p>{warning.message}</p>
      {warning.details?.length ? (
        <ul>
          {warning.details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <input
        type="hidden"
        name="calendar_confirmation"
        value={warning.signature}
      />
      <label
        htmlFor={id}
        style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
      >
        <input
          id={id}
          name="confirm_short_break"
          type="checkbox"
          value="true"
          required
          disabled={pending}
          style={{ flex: "0 0 18px", width: 18, marginTop: 3 }}
          key={warning.signature}
        />
        <span>Sprawdziłem przerwę i chcę zapisać ten termin.</span>
      </label>
    </div>
  );
}
