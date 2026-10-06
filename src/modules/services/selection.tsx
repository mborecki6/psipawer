"use client";
import { useState, useId } from "react";
import { money } from "@/lib/domain";
import { serviceTime, type Service } from "./types";
import { useHydrated } from "@/components/use-hydrated";
export function ConsultationServicePicker({
  services,
  serviceId,
}: {
  services: Service[];
  serviceId?: string;
}) {
  const hydrated = useHydrated();
  const [options] = useState(services);
  const [selected, setSelected] = useState(
    options.find((s) => s.id === serviceId)?.id ||
      options.find((s) => s.id === "60000000-0000-4000-8000-000000000010")
        ?.id ||
      options[0]?.id ||
      "",
  );
  const id = useId();
  const current = options.find((s) => s.id === selected);
  if (!current)
    return <p>Brak dostępnych usług. Skontaktuj się z prowadzącą.</p>;
  return (
    <div className="stack-sm">
      <div className="field">
        <label htmlFor={id}>Wybierz usługę</label>
        <select
          id={id}
          name="service_id"
          value={selected}
          disabled={!hydrated}
          onChange={(e) => setSelected(e.target.value)}
          required
        >
          {options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <input type="hidden" name="service_version" value={current.version} />
      <div className="alert">
        <div>
          <strong>
            {money(current.price_cents)} {current.price_unit}
          </strong>
          <p>
            {serviceTime(current)} ·{" "}
            {current.meeting_mode === "online" ? "Online" : "Na miejscu"}
          </p>
          {current.is_test_price && <small>Cena robocza do testów.</small>}
          <p>
            Ta kwota zostanie zachowana przy zgłoszeniu. Płatność ustalisz z
            prowadzącą.
          </p>
        </div>
      </div>
    </div>
  );
}

export function WalkServiceFields({
  services,
  initial,
  editing,
  hasRegistrations,
}: {
  services: Service[];
  initial: { type?: string; price_cents?: number; duration_minutes?: number };
  editing: boolean;
  hasRegistrations: boolean;
}) {
  const hydrated = useHydrated();
  const [options] = useState(services);
  const preferred =
    options.find((s) => s.id === "60000000-0000-4000-8000-000000000013") ||
    options[0];
  const [selected, setSelected] = useState(
    initial.type || editing ? "" : preferred?.id || "",
  );
  const [values, setValues] = useState({
    type: initial.type || preferred?.name || "",
    price:
      initial.price_cents !== undefined
        ? String(initial.price_cents / 100)
        : preferred
          ? String(preferred.price_cents / 100)
          : "",
    duration_minutes: String(
      initial.duration_minutes ?? preferred?.duration_minutes ?? 60,
    ),
  });
  const id = useId();
  const field = (name: keyof typeof values) => ({
    id: `${id}-${name}`,
    name,
    disabled: !hydrated,
    value: values[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setValues((v) => ({ ...v, [name]: e.target.value })),
  });
  return (
    <>
      {!editing && options.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-service`}>Uzupełnij z cennika</label>
          <select
            id={`${id}-service`}
            value={selected}
            disabled={!hydrated}
            onChange={(e) => {
              const s = options.find((s) => s.id === e.target.value);
              setSelected(e.target.value);
              if (s)
                setValues({
                  type: s.name,
                  price: String(s.price_cents / 100),
                  duration_minutes: String(s.duration_minutes || 60),
                });
            }}
          >
            <option value="">Własne ustawienia terminu</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {money(s.price_cents)}
              </option>
            ))}
          </select>
          <small>
            Uzupełnia nazwę, cenę i czas. Liczbę miejsc ustal przy terminie
            {selected === "60000000-0000-4000-8000-000000000015"
              ? " — dla duetu wybierz 2."
              : "."}
          </small>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-duration_minutes`}>
          Czas trwania w minutach
        </label>
        <input
          {...field("duration_minutes")}
          type="number"
          min={15}
          max={480}
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-type`}>Rodzaj spaceru</label>
        <input {...field("type")} required maxLength={100} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-price`}>Cena za psa (zł)</label>
        <input
          {...field("price")}
          type="number"
          min={0.01}
          max={10000}
          step="0.01"
          readOnly={hasRegistrations}
          required
        />
        <small>
          Cena zapisana przy tym terminie. Zmiany cennika jej nie nadpisują.
        </small>
      </div>
    </>
  );
}
