"use client";
import {
  useActionState,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
} from "react";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
const FieldErrors = createContext<Record<string, string[]>>({});
export type ActionState = {
  error?: string;
  success?: string;
  fields?: Record<string, string[]>;
};
export type FormAction = (
  previous: ActionState,
  data: FormData,
) => Promise<ActionState>;
export function ActionForm({
  action,
  children,
  label = "Zapisz",
  pendingLabel = "Proszę czekać…",
  className = "",
  confirm,
}: {
  action: FormAction;
  children: React.ReactNode;
  label?: string;
  pendingLabel?: string;
  className?: string;
  confirm?: string;
}) {
  const keepValuesOnReset = useRef(false);
  const formElement = useRef<HTMLFormElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, data: FormData) => {
      const result = await action(previous, data);
      // React resets uncontrolled fields even when a resolved action returns an
      // application error. Cancel that reset so corrections don't erase edits.
      keepValuesOnReset.current = Boolean(
        result.error ||
        Object.values(result.fields || {}).some((errors) => errors.length),
      );
      return result;
    },
    {},
  );
  const fieldMessages = Object.values(state.fields || {}).flat();
  const hasError = Boolean(state.error || fieldMessages.length);

  useEffect(() => {
    const form = formElement.current;
    function retainFailedSubmission(event: Event) {
      if (keepValuesOnReset.current) event.preventDefault();
    }
    // React suppresses synthetic events during its reset commit; the native
    // listener can still cancel the browser reset before it clears the fields.
    form?.addEventListener("reset", retainFailedSubmission);
    return () => form?.removeEventListener("reset", retainFailedSubmission);
  }, []);

  useEffect(() => {
    if (
      state.error ||
      Object.values(state.fields || {}).some((errors) => errors.length)
    ) {
      errorSummary.current?.focus();
    }
  }, [state]);

  return (
    <form
      ref={formElement}
      action={formAction}
      className={`form-stack ${className}`}
      aria-busy={pending}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FieldErrors.Provider value={state.fields || {}}>
        {children}
      </FieldErrors.Provider>
      {hasError && (
        <div
          role="alert"
          className="alert red form-feedback"
          tabIndex={-1}
          ref={errorSummary}
        >
          <CircleAlert aria-hidden="true" />
          <div>
            {state.error || "Sprawdź zaznaczone pola."}
            {fieldMessages.length > 0 && (
              <ul>
                {fieldMessages.map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <div aria-live="polite" aria-atomic="true" className="form-status">
        {state.success && !hasError && (
          <div role="status" className="alert green form-feedback">
            <CircleCheck aria-hidden="true" />
            <div>{state.success}</div>
          </div>
        )}
      </div>
      <span aria-live="polite" className="sr-only" aria-atomic="true">
        {pending ? pendingLabel : ""}
      </span>
      <button
        className="primary-button action-submit"
        type="submit"
        disabled={pending}
      >
        {pending && (
          <LoaderCircle className="button-spinner" aria-hidden="true" />
        )}
        {pending ? pendingLabel : label}
      </button>
    </form>
  );
}
export function Field({
  label,
  name,
  type = "text",
  value,
  required = false,
  maxLength,
  autoComplete,
  inputMode,
  placeholder,
  hint,
  readOnly = false,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  maxLength?: number;
  autoComplete?: InputHTMLAttributes<HTMLInputElement>["autoComplete"];
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  hint?: string;
  readOnly?: boolean;
}) {
  const errors = useContext(FieldErrors)[name];
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const descriptionIds = [hint ? hintId : "", errors?.length ? errorId : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        id={fieldId}
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        readOnly={readOnly}
        maxLength={maxLength}
        autoComplete={
          autoComplete ??
          (type === "email" ? "email" : type === "tel" ? "tel" : undefined)
        }
        inputMode={inputMode}
        placeholder={placeholder}
        autoCapitalize={type === "email" || type === "url" ? "none" : undefined}
        spellCheck={type === "email" || type === "url" ? false : undefined}
        step={type === "number" ? "any" : undefined}
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={descriptionIds || undefined}
      />
      {hint && (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
      )}
      {errors?.length ? (
        <small className="field-error" id={errorId}>
          {errors.join(" ")}
        </small>
      ) : null}
    </div>
  );
}
