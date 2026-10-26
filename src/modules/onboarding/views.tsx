"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookmarkCheck,
  CalendarCheck,
  Check,
  Compass,
  Dog,
  Footprints,
  HeartHandshake,
  House,
  Pencil,
  Route,
  Sprout,
  Sun,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { signOut } from "@/lib/auth/actions";
import { saveOnboarding } from "./actions";
import {
  onboardingEditorStep,
  onboardingStart,
  onboardingStepError,
} from "./model";
import type {
  OnboardingAnswers,
  OnboardingRecord,
  OnboardingStep,
} from "./types";
import styles from "./onboarding.module.css";

const photographs = {
  welcome: {
    src: "/brand/asia-outdoors-clean.webp",
    alt: "Asia podczas zajęć na świeżym powietrzu",
  },
  dog: {
    src: "/brand/training-reward-clean.webp",
    alt: "Asia i pies podczas wspólnych zajęć w plenerze",
  },
  goal: {
    src: "/brand/training-play-clean.webp",
    alt: "Asia bawi się z psem na trawie",
  },
  style: {
    src: "/brand/training-walk-clean.webp",
    alt: "Asia spaceruje z psem na smyczy",
  },
} as const;

type RequiredField = "age" | "goal" | "format";
type Choice = {
  value: string;
  label: string;
  detail?: string;
  icon?: ReactNode;
};

function RadioGroup({
  name,
  legend,
  options,
  value,
  onChange,
  disabled,
  invalid,
  single = false,
}: {
  name: RequiredField;
  legend: string;
  options: Choice[];
  value: string | null;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid: boolean;
  single?: boolean;
}) {
  return (
    <fieldset
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? "onboarding-error" : undefined}
    >
      <legend>{legend}</legend>
      <div className={`${styles.options} ${single ? styles.single : ""}`}>
        {options.map((option) => (
          <label className={styles.choice} key={option.value}>
            <input
              type="radio"
              required
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              {option.icon}
              <strong>{option.label}</strong>
              {option.detail && <small>{option.detail}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Onboarding({
  record: initialRecord,
  edit = false,
}: {
  record: OnboardingRecord;
  edit?: boolean;
}) {
  const [record, setRecord] = useState(initialRecord);
  const [answers, setAnswers] = useState(initialRecord.answers);
  const [step, setStep] = useState<OnboardingStep>(
    initialRecord.completed_at && !edit
      ? "plan"
      : onboardingEditorStep(initialRecord),
  );
  const [paused, setPaused] = useState(
    initialRecord.paused && (!initialRecord.completed_at || edit),
  );
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<RequiredField | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const locked = pending || conflict;
  const start = onboardingStart(answers);
  const index = (["dog", "goal", "style"] as OnboardingStep[]).indexOf(step);
  const photoStep = step === "plan" ? "welcome" : step;
  const photo = photographs[photoStep];

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [step, paused]);

  useEffect(() => {
    if (!error) return;
    if (invalid)
      form.current
        ?.querySelector<HTMLInputElement>(`input[name="${invalid}"]`)
        ?.focus();
    else errorMessage.current?.focus();
  }, [error, invalid]);

  function update<K extends keyof OnboardingAnswers>(
    key: K,
    value: OnboardingAnswers[K],
  ) {
    setAnswers((current) => ({ ...current, [key]: value }));
    if (invalid === key) {
      setInvalid(null);
      setError(null);
    }
  }

  function persist(
    nextStep: OnboardingStep,
    { pause = false, complete = false } = {},
  ) {
    if (saving.current || locked) return;
    saving.current = true;
    setError(null);
    setInvalid(null);
    startTransition(async () => {
      try {
        const result = await saveOnboarding({
          revision: record.revision,
          answers,
          step: nextStep,
          paused: pause,
          complete,
        });
        if (!result.ok) {
          setError(result.error);
          setConflict(Boolean(result.conflict));
          return;
        }
        setRecord(result.record);
        setAnswers(result.record.answers);
        setStep(
          result.record.current_step === "plan" && !result.record.completed_at
            ? onboardingEditorStep(result.record)
            : result.record.current_step,
        );
        setPaused(result.record.paused);
      } catch {
        setError(
          "Nie udało się potwierdzić zapisu. Twoje odpowiedzi są nadal tutaj. Sprawdź połączenie i spróbuj ponownie.",
        );
      } finally {
        saving.current = false;
      }
    });
  }

  function next() {
    const validation = onboardingStepError(step, answers);
    if (validation) {
      setError(validation.message);
      setInvalid(validation.field);
      return;
    }
    const nextStep = {
      welcome: "dog",
      dog: "goal",
      goal: "style",
      style: "plan",
      plan: "plan",
    } as const;
    persist(nextStep[step], { complete: step === "style" });
  }

  const back = { dog: "welcome", goal: "dog", style: "goal" } as const;
  const headingProps = { ref: heading, tabIndex: -1 } as const;

  return (
    <div className={styles.page} data-step={photoStep}>
      <div className={styles.window}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              src="/brand/psi-pawer-logo.png"
              alt="Psi Pawer"
              width={86}
              height={60}
              unoptimized
            />
            <span>Wasz start</span>
          </div>
          <nav className={styles.account} aria-label="Obsługa konta">
            <Link href="/profile">Profil</Link>
            <Link href="/account/security">Hasło i konto</Link>
            <form action={signOut}>
              <button type="submit">Wyloguj</button>
            </form>
          </nav>
        </header>
        <div className={styles.grid}>
          <aside className={styles.rail} aria-label="Zajęcia z Asią">
            <Image
              key={photo.src}
              className={styles.portrait}
              src={photo.src}
              alt={photo.alt}
              fill
              sizes="(max-width: 620px) 100vw, (max-width: 1264px) 43vw, 520px"
              loading="eager"
            />
          </aside>
          <main className={styles.content}>
            {index >= 0 && !paused && (
              <div className={styles.stepper}>
                <div className={styles.stepLabels}>
                  <strong>
                    {["Poznajmy Was", "Wasz kierunek", "Po Waszemu"][index]}
                  </strong>
                  <span>Krok {index + 1} z 3</span>
                </div>
                <div
                  className={styles.track}
                  role="progressbar"
                  aria-label="Krok wprowadzenia"
                  aria-valuemin={1}
                  aria-valuemax={3}
                  aria-valuenow={index + 1}
                >
                  {[0, 1, 2].map((part) => (
                    <span
                      className={part <= index ? styles.filled : ""}
                      key={part}
                    />
                  ))}
                </div>
              </div>
            )}
            <form
              ref={form}
              className={styles.flow}
              noValidate
              aria-busy={pending}
              onSubmit={(event) => {
                event.preventDefault();
                if (!paused && step !== "plan") next();
              }}
            >
              {paused ? (
                <section className={`${styles.stage} ${styles.paused}`}>
                  <div className={styles.successMark}>
                    <BookmarkCheck aria-hidden="true" />
                  </div>
                  <p className={styles.kicker}>Możesz wrócić do tego później</p>
                  <h1 {...headingProps}>Wasz początek poczeka.</h1>
                  <p className={styles.lead}>
                    Odpowiedzi są zapisane. Wrócisz do nich po zalogowaniu,
                    także na innym urządzeniu.
                    {!record.completed_at &&
                      " Do panelu przejdziesz po krótkim wprowadzeniu."}
                  </p>
                  <button
                    className={styles.primary}
                    type="button"
                    disabled={locked}
                    onClick={() => persist(step)}
                  >
                    Wznów wprowadzenie <ArrowRight aria-hidden="true" />
                  </button>
                  {record.completed_at && (
                    <Link className={styles.textButton} href="/app">
                      Wróć do mojego panelu
                    </Link>
                  )}
                </section>
              ) : step === "welcome" ? (
                <section className={`${styles.stage} ${styles.welcome}`}>
                  <p className={styles.kicker}>3 kroki · około 2 min</p>
                  <h1 {...headingProps}>Zacznijmy od Was.</h1>
                  <p className={styles.lead}>
                    Kilka odpowiedzi i Wasz pierwszy krok będzie jasny.
                  </p>
                  <div className={styles.welcomeList}>
                    {[
                      [Dog, "Twój pies"],
                      [Compass, "Wasze potrzeby"],
                      [Route, "Wasza karta startu"],
                    ].map(([Icon, label]) => {
                      const Mark = Icon as typeof Dog;
                      return (
                        <div
                          className={styles.welcomeItem}
                          key={label as string}
                        >
                          <span>
                            <Mark aria-hidden="true" />
                          </span>
                          <strong>{label as string}</strong>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    className={styles.primary}
                    type="submit"
                    disabled={locked}
                  >
                    Poznajmy się <ArrowRight aria-hidden="true" />
                  </button>
                </section>
              ) : step === "dog" ? (
                <section className={styles.stage}>
                  <p className={styles.kicker}>Zacznijmy od Was</p>
                  <h1 {...headingProps}>Kto jest po drugiej stronie smyczy?</h1>
                  <p className={styles.lead}>
                    Opowiedz o jednym psie. Do pozostałych wrócisz później w
                    „Moje psy”.
                  </p>
                  <div className={styles.fields}>
                    <div>
                      <label
                        className={styles.label}
                        htmlFor="onboarding-dog-name"
                      >
                        Jak ma na imię? <span>Opcjonalnie</span>
                      </label>
                      <input
                        className={styles.input}
                        id="onboarding-dog-name"
                        name="dogName"
                        value={answers.dogName}
                        onChange={(event) =>
                          update("dogName", event.target.value)
                        }
                        placeholder="np. Kluska"
                        maxLength={40}
                        autoComplete="off"
                        disabled={locked}
                        aria-describedby="onboarding-name-hint"
                      />
                      <p className={styles.hint} id="onboarding-name-hint">
                        Możesz uzupełnić imię później. Kartę psa dodasz osobno.
                      </p>
                    </div>
                    <RadioGroup
                      name="age"
                      legend="Na jakim jest etapie życia?"
                      value={answers.age}
                      disabled={locked}
                      invalid={invalid === "age"}
                      onChange={(value) =>
                        update("age", value as OnboardingAnswers["age"])
                      }
                      options={[
                        {
                          value: "puppy",
                          label: "Szczeniak",
                          detail: "Poznajemy świat",
                        },
                        {
                          value: "adult",
                          label: "Dorosły pies",
                          detail: "Nasza codzienność",
                        },
                        {
                          value: "senior",
                          label: "Senior",
                          detail: "Własne tempo",
                        },
                        {
                          value: "unknown",
                          label: "Jeszcze nie wiem",
                          detail: "Ustalimy później",
                        },
                      ]}
                    />
                  </div>
                </section>
              ) : step === "goal" ? (
                <section className={styles.stage}>
                  <p className={styles.kicker}>Wasz najważniejszy kierunek</p>
                  <h1 {...headingProps}>Co chcesz teraz ułatwić?</h1>
                  <p className={styles.lead}>
                    Wybierz jedną rzecz, która dziś jest najważniejsza. Nic nie
                    musi być opisane idealnie.
                  </p>
                  <div className={styles.fields}>
                    <RadioGroup
                      name="goal"
                      legend="Najważniejsza potrzeba"
                      value={answers.goal}
                      disabled={locked}
                      invalid={invalid === "goal"}
                      onChange={(value) =>
                        update("goal", value as OnboardingAnswers["goal"])
                      }
                      options={[
                        {
                          value: "walks",
                          label: "Spokojniejsze spacery",
                          icon: <Footprints aria-hidden="true" />,
                        },
                        {
                          value: "home",
                          label: "Codzienność w domu",
                          icon: <House aria-hidden="true" />,
                        },
                        {
                          value: "puppy",
                          label: "Start ze szczeniakiem",
                          icon: <Sprout aria-hidden="true" />,
                        },
                        {
                          value: "activity",
                          label: "Wspólna aktywność",
                          icon: <Sun aria-hidden="true" />,
                        },
                        {
                          value: "relationship",
                          label: "Lepsze porozumienie",
                          icon: <HeartHandshake aria-hidden="true" />,
                        },
                        {
                          value: "unknown",
                          label: "Pomóżcie mi wybrać",
                          icon: <Compass aria-hidden="true" />,
                        },
                      ]}
                    />
                    <div>
                      <label className={styles.label} htmlFor="onboarding-note">
                        Co chcesz opowiedzieć Asi? <span>Opcjonalnie</span>
                      </label>
                      <textarea
                        className={styles.input}
                        id="onboarding-note"
                        name="note"
                        value={answers.note}
                        onChange={(event) => update("note", event.target.value)}
                        maxLength={240}
                        placeholder="Jedna sytuacja z Waszej codzienności…"
                        disabled={locked}
                        aria-describedby="onboarding-note-hint"
                      />
                      <p className={styles.hint} id="onboarding-note-hint">
                        To Twoja prywatna notatka do omówienia z Asią. Nie jest
                        do niej wysyłana.
                      </p>
                    </div>
                  </div>
                </section>
              ) : step === "style" ? (
                <section className={styles.stage}>
                  <p className={styles.kicker}>Po Waszemu</p>
                  <h1 {...headingProps}>Jak chcecie zacząć?</h1>
                  <p className={styles.lead}>
                    Dopasujmy pierwszy krok do Waszych preferencji. Szczegóły
                    współpracy ustalicie z Asią.
                  </p>
                  <div className={styles.fields}>
                    <RadioGroup
                      name="format"
                      legend="Jaka forma najbardziej Ci odpowiada?"
                      value={answers.format}
                      disabled={locked}
                      invalid={invalid === "format"}
                      single
                      onChange={(value) =>
                        update("format", value as OnboardingAnswers["format"])
                      }
                      options={[
                        {
                          value: "individual",
                          label: "Indywidualnie z Asią",
                          detail: "Przestrzeń na naszą sytuację",
                        },
                        {
                          value: "group",
                          label: "W grupie",
                          detail: "Wspólne zajęcia i nowe doświadczenia",
                        },
                        {
                          value: "unknown",
                          label: "Jeszcze nie wiem",
                          detail: "Chcę poznać możliwości",
                        },
                      ]}
                    />
                    <div className={styles.inlineFields}>
                      <div>
                        <label
                          className={styles.label}
                          htmlFor="onboarding-collaboration"
                        >
                          Etap współpracy <span>Opcjonalnie</span>
                        </label>
                        <select
                          className={styles.input}
                          id="onboarding-collaboration"
                          name="collaboration"
                          value={answers.collaboration}
                          onChange={(event) =>
                            update(
                              "collaboration",
                              event.target
                                .value as OnboardingAnswers["collaboration"],
                            )
                          }
                          disabled={locked}
                        >
                          <option value="unknown">Do ustalenia</option>
                          <option value="new">Dopiero zaczynamy</option>
                          <option value="after">Jesteśmy po spotkaniu</option>
                        </select>
                      </div>
                      <div>
                        <label
                          className={styles.label}
                          htmlFor="onboarding-rhythm"
                        >
                          Nasz rytm <span>Opcjonalnie</span>
                        </label>
                        <select
                          className={styles.input}
                          id="onboarding-rhythm"
                          name="rhythm"
                          value={answers.rhythm}
                          onChange={(event) =>
                            update(
                              "rhythm",
                              event.target.value as OnboardingAnswers["rhythm"],
                            )
                          }
                          disabled={locked}
                        >
                          <option value="unknown">Jeszcze szukamy rytmu</option>
                          <option value="short">Wolimy małe kroki</option>
                          <option value="more">Lubimy działać szerzej</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                <section className={styles.stage}>
                  <div className={styles.successMark}>
                    <Check aria-hidden="true" />
                  </div>
                  <p className={styles.kicker}>Z Twoich odpowiedzi</p>
                  <h1 {...headingProps}>{start.heading}</h1>
                  <p className={styles.lead}>{start.lead}</p>
                  <div className={styles.tags}>
                    {start.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className={styles.next}>
                    <p className={styles.kicker}>
                      Na początek · jeden prosty krok
                    </p>
                    <h2>{start.title}</h2>
                    <p>
                      {start.copy} {start.rhythm}
                    </p>
                    <Link
                      className={styles.textButton}
                      href={start.href}
                      prefetch={false}
                    >
                      {start.action} <ArrowRight aria-hidden="true" />
                    </Link>
                    {/* A new request reads the newly completed record in the session gate. */}
                    <a className={styles.primary} href="/app">
                      Przejdź do mojego panelu <ArrowRight aria-hidden="true" />
                    </a>
                  </div>
                  <details className={styles.following}>
                    <summary>Co dalej? Dwa kolejne kroki</summary>
                    <ul>
                      <li>
                        <Dog aria-hidden="true" />
                        <span>
                          <Link href="/app/dogs">
                            Uzupełnij kartę psa w „Moje psy”.
                          </Link>{" "}
                          To miejsce na informacje przydatne we współpracy.
                        </span>
                      </li>
                      <li>
                        <CalendarCheck aria-hidden="true" />
                        <span>
                          Po zgłoszeniu sprawdź jego status. Potwierdzony termin
                          znajdziesz w{" "}
                          <Link href="/app/calendar">Kalendarzu</Link>.
                        </span>
                      </li>
                    </ul>
                  </details>
                  {answers.note.trim() && (
                    <p className={styles.note}>
                      Twoja prywatna notatka do omówienia z Asią: „
                      {answers.note.trim()}”
                    </p>
                  )}
                  <p className={styles.footnote}>
                    To Wasza karta startu w aplikacji. Nie jest diagnozą ani
                    indywidualnym planem pracy z psem — ten przygotujecie z
                    Asią.
                  </p>
                  <button
                    className={styles.textButton}
                    type="button"
                    disabled={locked}
                    onClick={() => persist("dog")}
                  >
                    <Pencil aria-hidden="true" /> Zmień odpowiedzi
                  </button>
                </section>
              )}
              {error && (
                <div
                  className={styles.error}
                  id="onboarding-error"
                  role="alert"
                  ref={errorMessage}
                  tabIndex={-1}
                >
                  <p>{error}</p>
                  {conflict && (
                    <button
                      className={styles.button}
                      type="button"
                      onClick={() => window.location.reload()}
                    >
                      Wczytaj aktualne odpowiedzi
                    </button>
                  )}
                </div>
              )}
              {index >= 0 && !paused && (
                <footer className={styles.footer}>
                  <div className={styles.actions}>
                    <button
                      className={styles.button}
                      type="button"
                      disabled={locked}
                      onClick={() => persist(back[step as keyof typeof back])}
                    >
                      <ArrowLeft aria-hidden="true" /> Wstecz
                    </button>
                    <button
                      className={styles.primary}
                      type="submit"
                      disabled={locked}
                    >
                      {pending
                        ? "Zapisuję…"
                        : step === "style"
                          ? "Przygotuj mój start"
                          : "Dalej"}
                      <ArrowRight aria-hidden="true" />
                    </button>
                  </div>
                  <div className={styles.later}>
                    <button
                      className={styles.textButton}
                      type="button"
                      disabled={locked}
                      onClick={() => persist(step, { pause: true })}
                    >
                      Zapisz i dokończ później
                    </button>
                  </div>
                </footer>
              )}
              <p
                className={styles.sr}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {pending
                  ? "Zapisuję odpowiedzi…"
                  : paused
                    ? "Wprowadzenie zapisane i wstrzymane."
                    : step === "plan"
                      ? "Wasza karta startu jest gotowa."
                      : index >= 0
                        ? `Krok ${index + 1} z 3.`
                        : ""}
              </p>
            </form>
          </main>
        </div>
      </div>
    </div>
  );
}
