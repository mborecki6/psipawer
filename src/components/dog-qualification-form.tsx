"use client";

import { useId, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { ActionForm, type ActionState } from "./action-form";
import { usePersistentForm } from "./use-persistent-form";
import { useHydrated } from "./use-hydrated";
import { setDogStatus } from "@/lib/data/actions";
import { dogStatuses } from "@/lib/validation/schemas";
import { labels } from "@/lib/domain";

type DogStatus = (typeof dogStatuses)[number];

function QualificationFields({
  hydrated,
  children,
}: {
  hydrated: boolean;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <fieldset
      className="form-stack"
      disabled={!hydrated || pending}
      style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
    >
      {children}
    </fieldset>
  );
}

export function DogQualificationForm({
  dogId,
  requestId,
  status,
  version,
}: {
  dogId: string;
  requestId: string;
  status: DogStatus;
  version: number;
}) {
  const hydrated = useHydrated();
  const id = useId();
  const formRef = usePersistentForm();
  // Revalidating another form must not give an existing decision draft a newer
  // precondition or request key. Only its acknowledged save starts a new draft.
  const [draft, setDraft] = useState(() => ({
    dogId,
    requestId,
    expectedStatus: status,
    expectedVersion: version,
    status,
    note: "",
  }));

  async function save(previous: ActionState, data: FormData) {
    data.set("dog_id", draft.dogId);
    data.set("request_id", draft.requestId);
    data.set("expected_status", draft.expectedStatus);
    data.set("expected_qualification_version", String(draft.expectedVersion));
    const result = await setDogStatus(previous, data);
    if (result.success && !result.error) {
      const acknowledgedVersion = result.qualificationVersion;
      if (
        result.qualificationStatus === undefined ||
        !dogStatuses.includes(result.qualificationStatus) ||
        typeof acknowledgedVersion !== "number" ||
        !Number.isInteger(acknowledgedVersion) ||
        acknowledgedVersion <= draft.expectedVersion
      )
        return {
          error:
            "Nie udało się potwierdzić kwalifikacji. Spróbuj ponownie w tym formularzu.",
        };
      setDraft({
        dogId: draft.dogId,
        requestId: crypto.randomUUID(),
        expectedStatus: result.qualificationStatus,
        expectedVersion: acknowledgedVersion,
        status: result.qualificationStatus,
        note: "",
      });
    }
    return result;
  }

  return (
    <ActionForm action={save} label="Zapisz kwalifikację" disabled={!hydrated}>
      <input
        ref={(input) => {
          formRef.current = input?.form ?? null;
        }}
        type="hidden"
        name="dog_id"
        value={draft.dogId}
      />
      <input type="hidden" name="request_id" value={draft.requestId} />
      <input
        type="hidden"
        name="expected_status"
        value={draft.expectedStatus}
      />
      <input
        type="hidden"
        name="expected_qualification_version"
        value={draft.expectedVersion}
      />
      <QualificationFields hydrated={hydrated}>
        <div className="field">
          <label htmlFor={`${id}-status`}>Status</label>
          <select
            id={`${id}-status`}
            name="status"
            value={draft.status}
            onChange={(event) => {
              const next = event.target.value as DogStatus;
              setDraft((current) => ({ ...current, status: next }));
            }}
          >
            {dogStatuses.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-note`}>
            Powód / zalecenia (notatka prywatna)
          </label>
          <textarea
            id={`${id}-note`}
            name="note"
            value={draft.note}
            onChange={(event) => {
              const next = event.target.value;
              setDraft((current) => ({ ...current, note: next }));
            }}
            required
            minLength={3}
            maxLength={8000}
          />
        </div>
      </QualificationFields>
    </ActionForm>
  );
}
