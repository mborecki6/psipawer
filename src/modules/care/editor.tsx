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
  CareContext,
} from "./types";
import { dateLabel } from "@/lib/domain";
import { usePersistentForm } from "@/components/use-persistent-form";
import { withFormActionRecovery } from "@/components/form-action-recovery";
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
  context,
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
  context?: CareContext;
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
  const [controlInvite, setControlInvite] = useState(
    draft?.control_invite_on || "",
  );
  const source = context || draft;
  const consultationId = source
    ? source.consultation_id || ""
    : requestedConsultation?.id || "";
  const courseId = source
    ? source.course_enrollment_id || ""
    : requestedCourse?.id || "";
  const sessionId = source
    ? source.course_session_id || ""
    : requestedSession || "";
  const fitnessId = source
    ? source.fitness_package_id || ""
    : requestedFitness?.id || "";
  const fitnessSessionId = source
    ? source.fitness_session_id || ""
    : requestedFitnessSession || "";
  const selected = consultations.find((c) => c.id === consultationId);
  const selectedCourse = courses.find((c) => c.id === courseId);
  const selectedSession = selectedCourse?.sessions.find(
    (s) => s.id === sessionId,
  );
  const selectedFitness = fitness.find((p) => p.id === fitnessId);
  const selectedFitnessSession = selectedFitness?.sessions.find(
    (s) => s.id === fitnessSessionId,
  );
  const sourceTitle = consultationId
    ? `Konsultacja · ${selected?.service_name || "Poprzednie spotkanie"}`
    : courseId
      ? `Kurs · ${selectedCourse?.title || "Poprzedni kurs"}`
      : fitnessId
        ? `Fitness · ${selectedFitness?.title || "Poprzedni pakiet"}`
        : "Ogólny plan pracy";
  const sourceScope = consultationId
    ? selected?.starts_at
      ? dateLabel(selected.starts_at)
      : "Zalecenia po konsultacji"
    : courseId
      ? sessionId
        ? selectedSession
          ? `Spotkanie ${selectedSession.ordinal} · ${dateLabel(selectedSession.starts_at)}`
          : "Poprzednie spotkanie kursu"
        : "Plan całego kursu"
      : fitnessId
        ? fitnessSessionId
          ? selectedFitnessSession
            ? `Spotkanie ${selectedFitnessSession.ordinal}${selectedFitnessSession.starts_at ? ` · ${dateLabel(selectedFitnessSession.starts_at)}` : ""}`
            : "Poprzednie spotkanie fitness"
          : "Plan całego pakietu"
        : "Zalecenia dla psa bez przypisania do konkretnej usługi.";
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
      const result = await withFormActionRecovery(savePlan)(previous, data);
      if (result.success) setDirty(false);
      return result;
    },
    {},
  );
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (!dirty) return;
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const navigating = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest("a[href]");
      if (!anchor || anchor.getAttribute("target") === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (
        !window.confirm(
          "Ten szkic ma niezapisane zmiany. Opuścić go i otworzyć inny widok?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", leaving);
    document.addEventListener("click", navigating, true);
    return () => {
      window.removeEventListener("beforeunload", leaving);
      document.removeEventListener("click", navigating, true);
    };
  }, [dirty]);

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
        {/* Changing service navigates to a separately keyed editor. These
            identifiers never change underneath this form's text/version. */}
        <input type="hidden" name="consultation_id" value={consultationId} />
        <input type="hidden" name="course_enrollment_id" value={courseId} />
        <input type="hidden" name="course_session_id" value={sessionId} />
        <input type="hidden" name="fitness_package_id" value={fitnessId} />
        <input
          type="hidden"
          name="fitness_session_id"
          value={fitnessSessionId}
        />
        <section className={styles.sourceContext} aria-label="Powiązanie planu">
          <span className={styles.sourceLabel}>Zalecenia dotyczą</span>
          <strong>{sourceTitle}</strong>
          <p>{sourceScope}</p>
        </section>
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
        <label className="field">
          <span>Zaproś opiekuna do zgłoszenia kontroli (opcjonalnie)</span>
          <input
            type="date"
            name="control_invite_on"
            value={controlInvite}
            onChange={(event) => {
              setControlInvite(event.target.value);
              setDirty(true);
            }}
          />
          <small className="field-hint">
            Po publikacji, w tym dniu o 9:00, opiekun otrzyma prośbę o
            zgłoszenie konsultacji kontrolnej. To osobne przypomnienie — nie
            ustala terminu spotkania.
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
      const result = await withFormActionRecovery(saveTemplate)(previous, data);
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
