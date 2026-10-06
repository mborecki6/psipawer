"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { uploadAvatar, removeAvatar } from "@/lib/data/actions";
import { uploadCommunityAvatar } from "@/lib/data/community-actions";
import type { AvatarState } from "@/lib/data/avatar-cleanup";
import { usePersistentForm } from "./use-persistent-form";
import { useHydrated } from "./use-hydrated";
import styles from "./avatar-editor.module.css";

export function AvatarEditor({
  scope,
  dogId,
  initialPath = null,
  initialUpdatedAt = "",
  children,
}: {
  scope: "dog" | "community";
  dogId: string;
  initialPath?: string | null;
  initialUpdatedAt?: string;
  children?: ReactNode;
}) {
  const hydrated = useHydrated();
  const form = usePersistentForm();
  const file = useRef<HTMLInputElement>(null);
  const error = useRef<HTMLDivElement>(null);
  // A server refresh caused by another form must not silently advance the
  // version of a photo already chosen in this editor.
  const [expectedPath, setExpectedPath] = useState(initialPath);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(initialUpdatedAt);
  const [state, action, pending] = useActionState(
    async (previous: AvatarState, data: FormData) => {
      const result = await (scope === "community"
        ? uploadCommunityAvatar(previous, data)
        : data.get("intent") === "remove"
          ? removeAvatar(previous, data)
          : uploadAvatar(previous, data));
      if (result.success) {
        if (result.avatarPath !== undefined) setExpectedPath(result.avatarPath);
        if (result.updatedAt) setExpectedUpdatedAt(result.updatedAt);
        if (file.current) file.current.value = "";
        const consent = form.current?.querySelector<HTMLInputElement>(
          'input[name="consent"]',
        );
        if (consent) consent.checked = false;
      }
      return result;
    },
    {},
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
      onSubmit={(event) => {
        const button = (event.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        if (
          button?.value === "remove" &&
          !window.confirm(
            "Usunąć zdjęcie z karty psa? Możesz później dodać nowe.",
          )
        )
          event.preventDefault();
      }}
    >
      <input type="hidden" name="dog_id" value={dogId} />
      {scope === "dog" ? (
        <input
          type="hidden"
          name="expected_avatar_path"
          value={expectedPath || ""}
        />
      ) : (
        <input
          type="hidden"
          name="expected_updated_at"
          value={expectedUpdatedAt}
        />
      )}
      <fieldset disabled={!hydrated || pending} className={styles.fields}>
        <legend className="sr-only">Zdjęcie psa</legend>
        <label className="field">
          <span>
            {scope === "dog"
              ? "Zdjęcie (JPG, PNG, WebP do 1,5 MB)"
              : "Zdjęcie psa"}
          </span>
          <input
            ref={file}
            type="file"
            name={scope === "dog" ? "photo" : "file"}
            accept="image/jpeg,image/png,image/webp"
            required
          />
          {scope === "community" && (
            <small className="field-hint">
              JPG, PNG lub WebP, maksymalnie 1,5 MB.
            </small>
          )}
        </label>
        {children}
        <button
          type="submit"
          name="intent"
          value="upload"
          className="primary-button"
        >
          {!hydrated
            ? "Przygotowuję formularz…"
            : pending
              ? "Zapisuję zdjęcie…"
              : scope === "dog"
                ? "Zapisz zdjęcie"
                : "Dodaj zdjęcie do sprawdzenia"}
        </button>
        {scope === "dog" && expectedPath && (
          <button
            type="submit"
            name="intent"
            value="remove"
            formNoValidate
            className="ghost-button"
          >
            Usuń zdjęcie
          </button>
        )}
      </fieldset>
      {state.error && (
        <div ref={error} tabIndex={-1} role="alert" className="alert red">
          {state.error}
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        {state.success && (
          <div role="status" className="alert green">
            {state.success}
          </div>
        )}
      </div>
    </form>
  );
}
