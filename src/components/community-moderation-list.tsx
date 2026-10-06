"use client";
import { useState, type ReactNode } from "react";
import styles from "./community.module.css";

// Keep a reviewed card in place for this visit so its action feedback and open
// editor survive the server refresh. Previously it moved to another parent and
// React discarded the successful action's state.
export function CommunityModerationList({
  cards,
}: {
  cards: { id: string; pending: boolean; content: ReactNode }[];
}) {
  const [initialPending] = useState(
    () => new Set(cards.filter((card) => card.pending).map((card) => card.id)),
  );
  const [showOthers, setShowOthers] = useState(false);
  const secondary = cards.filter(
    (card) => !card.pending && !initialPending.has(card.id),
  ).length;
  return (
    <>
      {secondary > 0 && (
        <button
          type="button"
          className="ghost-button"
          aria-expanded={showOthers}
          onClick={() => setShowOthers((value) => !value)}
        >
          {showOthers
            ? "Ukryj pozostałe wizytówki"
            : `Pozostałe wizytówki (${secondary})`}
        </button>
      )}
      <div className={styles.catalog}>
        {cards.map((card) => (
          <div
            key={card.id}
            hidden={
              !showOthers && !card.pending && !initialPending.has(card.id)
            }
          >
            {card.content}
          </div>
        ))}
      </div>
    </>
  );
}
