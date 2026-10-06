"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { saveCalendarSettings, type BlockState } from "./actions";
import type { CalendarSettings } from "./types";
import styles from "./calendar.module.css";

const days = [
  "Poniedziałek",
  "Wtorek",
  "Środa",
  "Czwartek",
  "Piątek",
  "Sobota",
  "Niedziela",
];
function timeLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
export function CalendarSettingsEditor({
  initial,
}: {
  initial: CalendarSettings;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const prefix = useId();
  const error = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState({
    ...initial,
    before_minutes: String(initial.before_minutes),
    after_minutes: String(initial.after_minutes),
  });
  const [state, action, pending] = useActionState(
    async (previous: BlockState, form: FormData) => {
      const next = await saveCalendarSettings(previous, form);
      return { ...next, version: next.version ?? previous.version };
    },
    { version: initial.version },
  );
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return (
    <form
      ref={form}
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
    >
      <input type="hidden" name="expected_version" value={state.version} />
      <input
        type="hidden"
        name="hours_enabled"
        value={String(values.hours_enabled)}
      />
      <input type="hidden" name="week" value={JSON.stringify(values.week)} />
      <fieldset className={styles.fields} disabled={!hydrated || pending}>
        <legend className="sr-only">Godziny pracy i przerwy</legend>
        <p className="muted">
          Przerwy rezerwują czas na przygotowanie lub dojazd przy spacerach,
          konsultacjach, kursach i fitness. Wpisane spotkania zachowują swoją
          godzinę.
        </p>
        {(["before_minutes", "after_minutes"] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`${prefix}-${key}`}>
              {key === "before_minutes"
                ? "Przerwa przed spotkaniem (min)"
                : "Przerwa po spotkaniu (min)"}
            </label>
            <input
              id={`${prefix}-${key}`}
              name={key}
              type="number"
              min={0}
              max={120}
              required
              value={values[key]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [key]: e.target.value }))
              }
            />
          </div>
        ))}
        <label className={styles.dayToggle}>
          <input
            type="checkbox"
            checked={values.hours_enabled}
            onChange={(e) =>
              setValues((v) => ({ ...v, hours_enabled: e.target.checked }))
            }
          />{" "}
          Pilnuj godzin pracy
        </label>
        <p className="muted">
          Stały tydzień w czasie polskim. Całe spotkanie wraz z przerwami musi
          zmieścić się w godzinach jednego dnia. Urlop lub wyjątkową przerwę
          dodaj jako blokadę czasu.
        </p>
        <div className={styles.workingWeek}>
          {values.week.map((day) => (
            <div key={day.weekday} className={styles.workingDay}>
              <label className={styles.dayToggle}>
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      week: v.week.map((d) =>
                        d.weekday === day.weekday
                          ? { ...d, enabled: e.target.checked }
                          : d,
                      ),
                    }))
                  }
                />{" "}
                {days[day.weekday - 1]}
              </label>
              {day.enabled ? (
                <div className={styles.hourPair}>
                  {(["start_minute", "end_minute"] as const).map((key) => (
                    <div className="field" key={key}>
                      <label htmlFor={`${prefix}-${day.weekday}-${key}`}>
                        {key === "start_minute" ? "Od" : "Do"}
                        <span className="sr-only">
                          {" "}
                          · {days[day.weekday - 1]}
                        </span>
                      </label>
                      <select
                        id={`${prefix}-${day.weekday}-${key}`}
                        value={day[key]}
                        onChange={(e) =>
                          setValues((v) => ({
                            ...v,
                            week: v.week.map((d) =>
                              d.weekday === day.weekday
                                ? { ...d, [key]: Number(e.target.value) }
                                : d,
                            ),
                          }))
                        }
                      >
                        {Array.from(
                          { length: 96 },
                          (_, n) => (n + (key === "end_minute" ? 1 : 0)) * 15,
                        ).map((min) => (
                          <option key={min} value={min}>
                            {timeLabel(min)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <small className="muted">Dzień wolny</small>
              )}
            </div>
          ))}
        </div>
      </fieldset>
      {state.error && !pending && (
        <div className="alert red" role="alert" ref={error} tabIndex={-1}>
          {state.error}
        </div>
      )}
      {state.success && !pending && (
        <div className="alert green" role="status">
          {state.success}
        </div>
      )}
      <p className="muted">
        Zapis sprawdzi także już umówione terminy. Jeśli któreś nie pasują,
        zobaczysz komunikat i ustawienia pozostaną bez zmiany.
      </p>
      <button className="primary-button" disabled={!hydrated || pending}>
        {!hydrated
          ? "Przygotowuję formularz…"
          : pending
            ? "Sprawdzam i zapisuję…"
            : "Zapisz rytm pracy"}
      </button>
    </form>
  );
}
