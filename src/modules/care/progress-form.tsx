"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, type ActionState } from "@/components/action-form";
import { useHydrated } from "@/components/use-hydrated";
import { usePersistentForm } from "@/components/use-persistent-form";
import { submitProgress } from "./actions";
import { careDate, type CarePlan } from "./types";
import styles from "./care.module.css";

type SourcePlan = Pick<
  CarePlan,
  "id" | "title" | "revision" | "body" | "published_at"
>;
const emptyResponse = { attempted: "", went_well: "", difficult: "" };

function ProgressFields({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const { pending } = useFormStatus();
  return (
    <fieldset
      disabled={!hydrated || pending}
      className="form-stack"
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      {children}
    </fieldset>
  );
}

export function ProgressForm({
  plan,
  responseId,
}: {
  plan: SourcePlan;
  responseId: string;
}) {
  const hydrated = useHydrated();
  const formRef = usePersistentForm();
  const [draft, setDraft] = useState({
    requestId: responseId,
    plan,
    locked: false,
  });
  const [values, setValues] = useState(emptyResponse);
  const source = draft.locked ? draft.plan : plan;

  function change(name: keyof typeof values, value: string) {
    // Once editing starts, neither pagination nor a newer publication can
    // relabel this response. A failed/uncertain submission stays locked even
    // if the user later clears all three fields.
    setDraft((current) =>
      current.locked ? current : { ...current, plan, locked: true },
    );
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function submit(previous: ActionState, data: FormData) {
    setDraft((current) => ({ ...current, plan: source, locked: true }));
    const result = await submitProgress(previous, data);
    if (result.success) {
      // Only an acknowledged write starts a new intentional response.
      setDraft((current) => ({
        ...current,
        requestId: crypto.randomUUID(),
        locked: false,
      }));
      setValues(emptyResponse);
    }
    return result;
  }

  return (
    <ActionForm
      action={submit}
      label="Przekaż odpowiedź prowadzącej"
      disabled={!hydrated}
    >
      <input
        type="hidden"
        name="id"
        value={draft.requestId}
        ref={(input) => {
          formRef.current = input?.form ?? null;
        }}
      />
      <input type="hidden" name="plan_id" value={source.id} />
      <p className="muted">
        Odpowiadasz do planu „{source.title}”, wersja {source.revision} z{" "}
        {careDate(source.published_at)}.
      </p>
      {source.id !== plan.id && (
        <p className="muted">
          Opublikowano nowsze zalecenia. Ten wpis nadal dotyczy wersji{" "}
          {source.revision}, przy której rozpoczęto odpowiedź.
        </p>
      )}
      <details>
        <summary>Zalecenia, których dotyczy odpowiedź</summary>
        <div className={styles.body}>{source.body}</div>
      </details>
      <ProgressFields>
        <label className="field">
          <span>Co udało się zrobić?</span>
          <textarea
            name="attempted"
            value={values.attempted}
            onChange={(event) => change("attempted", event.target.value)}
            required
            minLength={3}
            maxLength={3000}
            rows={4}
          />
        </label>
        <label className="field">
          <span>Co poszło dobrze? (opcjonalnie)</span>
          <textarea
            name="went_well"
            value={values.went_well}
            onChange={(event) => change("went_well", event.target.value)}
            maxLength={3000}
            rows={3}
          />
        </label>
        <label className="field">
          <span>Co było trudne lub wymaga wyjaśnienia? (opcjonalnie)</span>
          <textarea
            name="difficult"
            value={values.difficult}
            onChange={(event) => change("difficult", event.target.value)}
            maxLength={3000}
            rows={3}
          />
        </label>
      </ProgressFields>
    </ActionForm>
  );
}
