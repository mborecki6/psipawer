"use client";
import { useActionState, createContext, useContext, useId } from "react";
const FieldErrors = createContext<Record<string, string[]>>({});
import { useFormStatus } from "react-dom";
export type ActionState = {
  error?: string;
  success?: string;
  fields?: Record<string, string[]>;
};
export type FormAction = (
  previous: ActionState,
  data: FormData,
) => Promise<ActionState>;
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="primary-button" type="submit" disabled={pending}>
      {pending ? "Zapisuję…" : label}
    </button>
  );
}
export function ActionForm({
  action,
  children,
  label = "Zapisz",
  className = "",
  confirm,
}: {
  action: FormAction;
  children: React.ReactNode;
  label?: string;
  className?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form
      action={formAction}
      className={`form-stack ${className}`}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FieldErrors.Provider value={state.fields || {}}>
        {children}
      </FieldErrors.Provider>
      {state.error && (
        <div role="alert" className="alert red">
          {state.error}
          {state.fields && (
            <ul>
              {Object.values(state.fields)
                .flat()
                .map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
            </ul>
          )}
        </div>
      )}
      {state.success && (
        <div role="status" className="alert green">
          {state.success}
        </div>
      )}
      <Submit label={label} />
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
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  maxLength?: number;
}) {
  const errors = useContext(FieldErrors)[name];
  const errorId = useId();
  return (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        maxLength={maxLength}
        step={type === "number" ? "any" : undefined}
        aria-invalid={Boolean(errors?.length)}
        aria-describedby={errors?.length ? errorId : undefined}
      />
      {errors?.length ? (
        <small className="field-error" id={errorId}>
          {errors.join(" ")}
        </small>
      ) : null}
    </label>
  );
}
