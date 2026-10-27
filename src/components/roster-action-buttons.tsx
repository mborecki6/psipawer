"use client";

import { Check, Minus, X } from "lucide-react";
import styles from "./roster-action-buttons.module.css";

export type RosterButtonChoice = {
  value: string;
  label: string;
  tone: "positive" | "negative" | "neutral";
  disabled?: boolean;
  type?: "submit" | "button";
};

/** Presentation only: the domain form owns its action, version and feedback. */
export function RosterActionButtons({
  name,
  participantName,
  label,
  choices,
  selectedValue,
  disabled = false,
  busy = false,
  onChoose,
  className = "",
}: {
  name: string;
  participantName: string;
  label: string;
  choices: RosterButtonChoice[];
  selectedValue?: string | null;
  disabled?: boolean;
  busy?: boolean;
  onChoose?: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`${styles.choices} ${className}`}
      role="group"
      aria-label={`${label}: ${participantName}`}
      aria-busy={busy}
    >
      {choices.map((choice) => {
        const Icon =
          choice.tone === "positive"
            ? Check
            : choice.tone === "negative"
              ? X
              : Minus;
        const selected = selectedValue === choice.value;
        return (
          <button
            key={choice.value}
            type={choice.type ?? "submit"}
            name={name}
            value={choice.value}
            className={`${styles.choice} ${styles[choice.tone]} ${selected ? styles.selected : ""}`}
            disabled={disabled || busy || choice.disabled}
            aria-label={`${choice.label}: ${participantName}`}
            aria-pressed={selected}
            onClick={
              choice.type === "button" && onChoose
                ? () => onChoose(choice.value)
                : undefined
            }
          >
            <Icon size={21} strokeWidth={2.5} aria-hidden="true" />
            <span>{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}
