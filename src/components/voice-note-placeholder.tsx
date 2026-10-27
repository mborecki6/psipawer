"use client";

import { useId, useState } from "react";
import styles from "./voice-note-placeholder.module.css";

export function VoiceNotePlaceholder() {
  const [expanded, setExpanded] = useState(false);
  const messageId = useId();

  return (
    <div className={styles.placeholder}>
      <button
        type="button"
        className={styles.button}
        aria-expanded={expanded}
        aria-controls={messageId}
        onClick={() => setExpanded((current) => !current)}
      >
        <strong>Notatka głosowa</strong>
        <span className={styles.status}>Wkrótce</span>
      </button>
      <p id={messageId} className={styles.message} hidden={!expanded}>
        Nagrywanie i transkrypcja pojawią się tutaj później. Teraz nic się nie
        nagrywa.
      </p>
    </div>
  );
}
