import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { OnboardingRecord } from "./types";
import { onboardingStart } from "./model";
import styles from "./onboarding.module.css";

export function OnboardingStartCard({ record }: { record: OnboardingRecord }) {
  const start = onboardingStart(record.answers);
  return (
    <section className={styles.startCard} aria-label="Twój pierwszy krok">
      <p className={styles.kicker}>Twój kierunek · {start.goal}</p>
      <h2>{start.title}</h2>
      <p>
        {start.copy} {start.rhythm}
      </p>
      <div className={styles.startCardActions}>
        <Link className={styles.primary} href={start.href}>
          {start.action} <ArrowRight size={17} aria-hidden="true" />
        </Link>
        <Link className={styles.textButton} href="/onboarding">
          Wasza karta startu
        </Link>
      </div>
    </section>
  );
}
