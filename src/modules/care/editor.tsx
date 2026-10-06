"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { savePlan, saveTemplate, type CareEditorState } from "./actions";
import type {
  CareDraft,
  CareTemplate,
  CareConsultation,
  CareCourse,
  CareFitness,
} from "./types";
import { dateLabel } from "@/lib/domain";
import { usePersistentForm } from "@/components/use-persistent-form";
import { useHydrated } from "@/components/use-hydrated";
import styles from "./care.module.css";

export function CareEditorDisclosure({
  initiallyOpen,
  openForConsultation,
  label,
  children,
}: {
  initiallyOpen: boolean;
  openForConsultation?: string;
  label: string;
  children: ReactNode;
}) {
  // The first save/publication changes server props but must not close the
  // editor and hide its confirmation. Native toggles retain the user's choice.
  const [initialOpen] = useState(initiallyOpen);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (openForConsultation && details.current) details.current.open = true;
  }, [openForConsultation]);
  return (
    <details className={styles.disclosure} open={initialOpen} ref={details}>
      <summary>{label}</summary>
      {children}
    </details>
  );
}

export function CareEditor({
  dogId,
  draft,
  templates,
  consultations = [],
  requestedConsultation = null,
  courses = [],
  requestedCourse = null,
  requestedSession,
  fitness = [],
  requestedFitness = null,
  requestedFitnessSession,
}: {
  dogId: string;
  draft: CareDraft | null;
  templates: CareTemplate[];
  consultations?: CareConsultation[];
  requestedConsultation?: CareConsultation | null;
  courses?: CareCourse[];
  requestedCourse?: CareCourse | null;
  requestedSession?: string;
  fitness?: CareFitness[];
  requestedFitness?: CareFitness | null;
  requestedFitnessSession?: string;
}) {
  const hydrated = useHydrated();
  // Keep the version associated with the editor contents, even if another
  // action refreshes server props while this user has unsaved changes.
  const [initialVersion] = useState(draft?.version || 0);
  const form = usePersistentForm();
  const bodyId = useId();
  const [title, setTitle] = useState(draft?.title || "");
  const [body, setBody] = useState(draft?.body || "");
  const [followUp, setFollowUp] = useState(draft?.follow_up_on || "");
  const [consultationId, setConsultationId] = useState(
    draft ? draft.consultation_id || "" : requestedConsultation?.id || "",
  );
  const selected = consultations.find((c) => c.id === consultationId);
  const [courseId, setCourseId] = useState(
    draft ? draft.course_enrollment_id || "" : requestedCourse?.id || "",
  );
  const [sessionId, setSessionId] = useState(
    draft ? draft.course_session_id || "" : requestedSession || "",
  );
  const selectedCourse = courses.find((c) => c.id === courseId);
  const selectedSession = selectedCourse?.sessions.find(
    (s) => s.id === sessionId,
  );
  const [fitnessId, setFitnessId] = useState(
    draft ? draft.fitness_package_id || "" : requestedFitness?.id || "",
  );
  const [fitnessSessionId, setFitnessSessionId] = useState(
    draft ? draft.fitness_session_id || "" : requestedFitnessSession || "",
  );
  const selectedFitness = fitness.find((p) => p.id === fitnessId);
  const selectedFitnessSession = selectedFitness?.sessions.find(
    (s) => s.id === fitnessSessionId,
  );
  const cannotPublish =
    (Boolean(consultationId) && selected?.status !== "completed") ||
    (Boolean(courseId) &&
      (!selectedCourse ||
        (Boolean(sessionId) && selectedSession?.status !== "completed"))) ||
    (Boolean(fitnessId) &&
      (!selectedFitness ||
        (Boolean(fitnessSessionId) &&
          selectedFitnessSession?.status !== "completed")));
  const [templateId, setTemplateId] = useState("");
  const [dirty, setDirty] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: CareEditorState, data: FormData) => {
      const result = await savePlan(previous, data);
      if (result.success) setDirty(false);
      return result;
    },
    {},
  );
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  function useTemplate() {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    if (
      (title || body) &&
      !window.confirm(
        "Zastąpić tytuł i treść edytowanego planu wybranym materiałem?",
      )
    )
      return;
    setTitle(template.title);
    setBody(template.body);
    setDirty(true);
  }
  return (
    <form
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
      ref={form}
    >
      <input type="hidden" name="dog_id" value={dogId} />
      <input
        type="hidden"
        name="expected_version"
        value={state.version ?? initialVersion}
      />
      <fieldset disabled={!hydrated || pending} className={styles.fields}>
        {requestedConsultation &&
          consultationId !== requestedConsultation.id && (
            <div className="alert">
              <p>
                Otwarty szkic ma inne powiązanie. Jego treść pozostaje
                zachowana. Możesz świadomie przypisać ją do spotkania:{" "}
                {requestedConsultation.service_name || "Konsultacja"}
                {requestedConsultation.starts_at &&
                  ` · ${dateLabel(requestedConsultation.starts_at)}`}
                .
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setConsultationId(requestedConsultation.id);
                  setCourseId("");
                  setSessionId("");
                  setFitnessId("");
                  setFitnessSessionId("");
                  setDirty(true);
                }}
              >
                Powiąż ten szkic z wybranym spotkaniem
              </button>
            </div>
          )}
        {requestedCourse &&
          (courseId !== requestedCourse.id ||
            sessionId !== (requestedSession || "")) && (
            <div className="alert">
              <p>
                Otwarty szkic ma inne powiązanie. Zachowasz treść i możesz
                przypisać ją do kursu: {requestedCourse.title}
                {requestedSession
                  ? ` · spotkanie ${requestedCourse.sessions.find((s) => s.id === requestedSession)?.ordinal}`
                  : " · cały cykl"}
                .
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setConsultationId("");
                  setCourseId(requestedCourse.id);
                  setSessionId(requestedSession || "");
                  setFitnessId("");
                  setFitnessSessionId("");
                  setDirty(true);
                }}
              >
                Powiąż ten szkic z wybranym kursem
              </button>
            </div>
          )}
        {requestedFitness &&
          (fitnessId !== requestedFitness.id ||
            fitnessSessionId !== (requestedFitnessSession || "")) && (
            <div className="alert">
              <p>
                Otwarty szkic ma inne powiązanie. Zachowasz treść i możesz
                przypisać ją do pakietu: {requestedFitness.title}
                {requestedFitnessSession
                  ? ` · spotkanie ${requestedFitness.sessions.find((s) => s.id === requestedFitnessSession)?.ordinal}`
                  : " · cały pakiet"}
                .
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setConsultationId("");
                  setCourseId("");
                  setSessionId("");
                  setFitnessId(requestedFitness.id);
                  setFitnessSessionId(requestedFitnessSession || "");
                  setDirty(true);
                }}
              >
                Powiąż ten szkic z wybranym pakietem fitness
              </button>
            </div>
          )}
        <label className="field">
          <span>Konsultacja, której dotyczą zalecenia</span>
          <select
            name="consultation_id"
            value={consultationId}
            onChange={(event) => {
              setConsultationId(event.target.value);
              if (event.target.value) {
                setCourseId("");
                setSessionId("");
                setFitnessId("");
                setFitnessSessionId("");
              }
              setDirty(true);
            }}
          >
            <option value="">Bez powiązania z konsultacją</option>
            {consultationId && !selected && (
              <option value={consultationId}>
                Poprzednie powiązanie — wybierz dostępną konsultację
              </option>
            )}
            {consultations
              .filter(
                (c) =>
                  c.status === "scheduled" ||
                  c.status === "completed" ||
                  c.id === consultationId,
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.service_name || "Konsultacja"}
                  {c.starts_at ? ` · ${dateLabel(c.starts_at)}` : ""}
                  {c.status === "completed"
                    ? " · zakończona"
                    : c.status === "scheduled"
                      ? " · umówiona"
                      : " · niedostępna"}
                </option>
              ))}
          </select>
          <small>
            Wybierz jedno powiązanie. Dla ogólnego planu pozostaw wszystkie
            wybory puste.
          </small>
        </label>
        {(courses.length > 0 || courseId) && (
          <>
            <label className="field">
              <span>Kurs, którego dotyczą zalecenia</span>
              <select
                name="course_enrollment_id"
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  setSessionId("");
                  if (event.target.value) {
                    setConsultationId("");
                    setFitnessId("");
                    setFitnessSessionId("");
                  }
                  setDirty(true);
                }}
              >
                <option value="">Bez powiązania z kursem</option>
                {courseId && !selectedCourse && (
                  <option value={courseId}>
                    Poprzedni kurs — wybierz dostępne powiązanie
                  </option>
                )}
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <small>
                Wybierz jedno powiązanie. Pozostaw wybory puste dla ogólnego
                planu.
              </small>
            </label>
            {courseId && (
              <label className="field">
                <span>Zakres zaleceń kursowych</span>
                <select
                  name="course_session_id"
                  value={sessionId}
                  onChange={(event) => {
                    setSessionId(event.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="">Cały kurs — plan pracy</option>
                  {sessionId && !selectedSession && (
                    <option value={sessionId}>
                      Poprzednie spotkanie — wybierz dostępne powiązanie
                    </option>
                  )}
                  {(selectedCourse?.sessions || [])
                    .filter(
                      (s) => s.status !== "cancelled" || s.id === sessionId,
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        Spotkanie {s.ordinal} · {dateLabel(s.starts_at)} ·{" "}
                        {s.status === "completed"
                          ? "zakończone"
                          : s.status === "scheduled"
                            ? "zaplanowane"
                            : "odwołane"}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </>
        )}
        {(fitness.length > 0 || fitnessId) && (
          <>
            <label className="field">
              <span>Pakiet fitness, którego dotyczą zalecenia</span>
              <select
                name="fitness_package_id"
                value={fitnessId}
                onChange={(event) => {
                  setFitnessId(event.target.value);
                  setFitnessSessionId("");
                  if (event.target.value) {
                    setConsultationId("");
                    setCourseId("");
                    setSessionId("");
                  }
                  setDirty(true);
                }}
              >
                <option value="">Bez powiązania z fitness</option>
                {fitnessId && !selectedFitness && (
                  <option value={fitnessId}>
                    Poprzedni pakiet — wybierz dostępne powiązanie
                  </option>
                )}
                {fitness.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <small>
                Plan może dotyczyć całego pakietu albo jednego spotkania.
              </small>
            </label>
            {fitnessId && (
              <label className="field">
                <span>Zakres zaleceń fitness</span>
                <select
                  name="fitness_session_id"
                  value={fitnessSessionId}
                  onChange={(event) => {
                    setFitnessSessionId(event.target.value);
                    setDirty(true);
                  }}
                >
                  <option value="">Cały pakiet — plan pracy</option>
                  {fitnessSessionId && !selectedFitnessSession && (
                    <option value={fitnessSessionId}>
                      Poprzednie spotkanie — wybierz dostępne powiązanie
                    </option>
                  )}
                  {(selectedFitness?.sessions || [])
                    .filter(
                      (s) =>
                        ["scheduled", "completed"].includes(s.status) ||
                        s.id === fitnessSessionId,
                    )
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        Spotkanie {s.ordinal}
                        {s.starts_at
                          ? ` · ${dateLabel(s.starts_at)}`
                          : ""} ·{" "}
                        {s.status === "completed"
                          ? "zakończone"
                          : s.status === "scheduled"
                            ? "umówione"
                            : "niedostępne"}
                      </option>
                    ))}
                </select>
              </label>
            )}
          </>
        )}
        {cannotPublish && (
          <p className="alert">
            {fitnessId
              ? selectedFitness &&
                selectedFitnessSession?.status === "scheduled"
                ? "Możesz przygotować szkic. Zalecenia po spotkaniu fitness opublikujesz po jego zakończeniu."
                : "To powiązanie fitness nie jest dostępne. Wybierz inny pakiet, spotkanie lub ogólny plan pracy."
              : courseId
                ? selectedCourse && selectedSession?.status === "scheduled"
                  ? "Możesz przygotować szkic. Zalecenia po tym spotkaniu opublikujesz po jego zakończeniu."
                  : "To powiązanie kursowe nie jest dostępne. Wybierz inny kurs, spotkanie lub ogólny plan pracy."
                : selected?.status === "scheduled"
                  ? "Możesz przygotować szkic. Publikacja zaleceń po konsultacji będzie dostępna po oznaczeniu spotkania jako zakończonego."
                  : "Ta konsultacja nie jest dostępna. Wybierz inne spotkanie lub ogólny plan pracy."}
          </p>
        )}
        {templates.length > 0 && (
          <div className={styles.templatePicker}>
            <label className="field">
              <span>Zacznij od materiału z biblioteki</span>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
              >
                <option value="">Wybierz materiał…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={!templateId}
              onClick={useTemplate}
            >
              Użyj materiału
            </button>
          </div>
        )}
        <label className="field">
          <span>Tytuł planu</span>
          <input
            name="title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setDirty(true);
            }}
            required
            minLength={3}
            maxLength={160}
            placeholder="Np. Nasz plan na najbliższe dni"
          />
        </label>
        <div className="field">
          <label htmlFor={bodyId}>Zalecenia dla opiekuna</label>
          <textarea
            id={bodyId}
            name="body"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setDirty(true);
            }}
            required
            minLength={3}
            maxLength={20000}
            rows={12}
            placeholder="Zapisz cel, konkretne kroki i wskazówki dla tego psa."
          />
        </div>
        <label className="field">
          <span>Termin kontaktu kontrolnego (opcjonalnie)</span>
          <input
            type="date"
            name="follow_up_on"
            value={followUp}
            onChange={(event) => {
              setFollowUp(event.target.value);
              setDirty(true);
            }}
          />
          <small className="field-hint">
            Data pojawi się przy planie i utworzy zadanie kontaktu kontrolnego
            dla prowadzącej.
          </small>
        </label>
        <p className="muted">
          Szkic widzi tylko zespół prowadzący. Publikacja udostępni opiekunowi
          treść z tego formularza jako nową wersję.
        </p>
        <div className={styles.actions}>
          <button
            type="submit"
            name="intent"
            value="draft"
            className="secondary-button"
          >
            {!hydrated
              ? "Przygotowuję formularz…"
              : pending
                ? "Zapisywanie…"
                : "Zapisz szkic"}
          </button>
          <button
            type="submit"
            name="intent"
            value="publish"
            className="primary-button"
            disabled={cannotPublish}
          >
            {pending ? "Zapisywanie…" : "Opublikuj dla opiekuna"}
          </button>
        </div>
      </fieldset>
      {state.error && (
        <div className="alert red" role="alert" tabIndex={-1} ref={errorRef}>
          {state.error}
          {state.fields && (
            <ul>
              {Object.values(state.fields)
                .flat()
                .map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
            </ul>
          )}
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        {state.success && !state.error && (
          <p className="alert green" role="status">
            {state.success}
          </p>
        )}
        {dirty && <p className="muted">Masz niezapisane zmiany.</p>}
      </div>
    </form>
  );
}

export function TemplateEditor({
  template,
  newId,
}: {
  template?: CareTemplate;
  newId?: string;
}) {
  const hydrated = useHydrated();
  const [id, setId] = useState(template?.id || newId || "");
  const bodyId = useId();
  const [version, setVersion] = useState(template?.version || 0);
  const [title, setTitle] = useState(template?.title || "");
  const [body, setBody] = useState(template?.body || "");
  const errorRef = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState(
    async (previous: CareEditorState, data: FormData) => {
      const result = await saveTemplate(previous, data);
      if (result.success) {
        if (template) setVersion(result.version!);
        else {
          setId(crypto.randomUUID());
          setVersion(0);
          setTitle("");
          setBody("");
        }
      }
      return result;
    },
    {},
  );
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);
  return (
    <form
      action={action}
      className="form-stack"
      aria-busy={!hydrated || pending}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="expected_version" value={version} />
      <fieldset disabled={!hydrated || pending} className={styles.fields}>
        <label className="field">
          <span>Tytuł materiału</span>
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={3}
            maxLength={160}
          />
        </label>
        <div className="field">
          <label htmlFor={bodyId}>Treść materiału</label>
          <textarea
            id={bodyId}
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            required
            minLength={3}
            maxLength={20000}
            rows={10}
          />
        </div>
        <button className="primary-button" type="submit">
          {!hydrated
            ? "Przygotowuję formularz…"
            : pending
              ? "Zapisywanie…"
              : template
                ? "Zapisz materiał"
                : "Dodaj do biblioteki"}
        </button>
      </fieldset>
      {state.error && (
        <div className="alert red" role="alert" tabIndex={-1} ref={errorRef}>
          {state.error}
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        {state.success && !state.error && (
          <p className="alert green" role="status">
            {state.success}
          </p>
        )}
      </div>
    </form>
  );
}
