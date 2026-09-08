import { warsawDateTimeInput } from "@/lib/time";
import type { Walk } from "@/lib/data/types";
import { filterWalks } from "@/lib/walk-filters";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSnapshot } from "@/lib/data/queries";
import { requireSession } from "@/lib/auth/session";
import { Badge, WalkRow, Empty } from "./ui";
import { ActionForm, Field } from "./action-form";
import {
  registerDog,
  decideRegistration,
  cancelRegistration,
  cancelWalk,
  markAttendance,
  createWalk,
  updateWalk,
  inviteDog,
} from "@/lib/data/actions";
import { dateLabel, money, labels, transitions } from "@/lib/domain";
import { uuid } from "@/lib/validation/schemas";
export async function WalksList({ filter = "upcoming" }: { filter?: string }) {
  const { walks, registrations, role } = await getSnapshot();
  const base = role === "admin" ? "/admin" : "/app";
  const selected = filterWalks(walks, registrations, filter);
  return (
    <div className="stack">
      <nav className="filter-tabs" aria-label="Filtry spacerów">
        {[
          ["upcoming", "Nadchodzące"],
          ...(role === "admin"
            ? [
                ["pending", "Do decyzji"],
                ["today", "Dzisiaj"],
                ["next-six", "Najbliższe 6"],
              ]
            : []),
          ["completed", "Zakończone"],
          ["cancelled", "Odwołane"],
        ].map(([key, label]) => (
          <Link
            className={`filter-tab ${filter === key ? "active" : ""}`}
            key={key}
            href={`${base}/walks?filter=${key}`}
            aria-current={filter === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <article className="card">
        <div className="card-head">
          <h2>
            {selected.length} {selected.length === 1 ? "termin" : "terminów"}
          </h2>
          <span className="muted">Czas: Europe/Warsaw</span>
        </div>
        <div className="card-body">
          <div className="list">
            {selected.map((w) => (
              <div key={w.id}>
                <WalkRow
                  walk={w}
                  base={base}
                  accepted={
                    role === "admin"
                      ? registrations.filter(
                          (r) => r.walk_id === w.id && r.status === "accepted",
                        ).length
                      : undefined
                  }
                  pending={
                    role === "admin"
                      ? registrations.filter(
                          (r) => r.walk_id === w.id && r.status === "pending",
                        ).length
                      : undefined
                  }
                />
                {role === "client" && (
                  <div className="walk-meta">
                    <Badge status={w.booking_mode} />
                    {registrations
                      .filter((r) => r.walk_id === w.id)
                      .map((r) => (
                        <Badge key={r.id} status={r.status} />
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {!selected.length && (
            <Empty
              title="Brak terminów w tym widoku"
              copy="Wybierz inny filtr lub wróć tutaj później."
            />
          )}
        </div>
      </article>
    </div>
  );
}
export async function WalkDetail({ id }: { id: string }) {
  if (!uuid.safeParse(id).success) notFound();
  const { db, role } = await requireSession();
  const snapshot = await getSnapshot();
  const walk = snapshot.walks.find((w) => w.id === id);
  if (!walk) notFound();
  const base = role === "admin" ? "/admin" : "/app";
  const regs = snapshot.registrations.filter((r) => r.walk_id === id);
  const { data: location, error } = await db
    .from("walk_private_details")
    .select("exact_location,map_url,instructions")
    .eq("walk_id", id)
    .maybeSingle();
  if (error) throw new Error("Nie udało się pobrać lokalizacji.");
  const eligible = snapshot.dogs.filter(
    (d) =>
      !regs.some((r) => r.dog_id === d.id) &&
      !["suspended", "not_eligible", "consultation_required"].includes(
        d.status,
      ),
  );
  const relationResult =
    role === "admin"
      ? await db
          .from("dog_relations")
          .select("*")
          .in("level", ["caution", "block"])
      : { data: [], error: null };
  if (relationResult.error)
    throw new Error("Nie udało się odczytać relacji psów.");
  const acceptedIds = new Set(
    regs.filter((r) => r.status === "accepted").map((r) => r.dog_id),
  );
  const conflicts =
    relationResult.data?.filter(
      (r) =>
        regs.some((a) => a.dog_id === r.dog_a) &&
        regs.some((a) => a.dog_id === r.dog_b) &&
        (acceptedIds.has(r.dog_a) || acceptedIds.has(r.dog_b)),
    ) || [];
  return (
    <div className="stack">
      <Link className="ghost-button" href={`${base}/walks`}>
        ← Wszystkie spacery
      </Link>
      {role === "admin" && (
        <div className="walk-meta">
          {!["cancelled", "completed"].includes(walk.status) &&
            new Date(walk.starts_at) > new Date() && (
              <Link
                className="secondary-button"
                href={`/admin/walks/${id}/edit`}
              >
                Edytuj spacer
              </Link>
            )}
          <Link className="ghost-button" href={`/admin/walks/new?copy=${id}`}>
            Utwórz podobny termin →
          </Link>
        </div>
      )}
      {walk.change_note && walk.status !== "cancelled" && (
        <div className="alert" role="status">
          <strong>Aktualizacja terminu</strong>
          <p className="preserve-lines">{walk.change_note}</p>
          {role === "admin" && (
            <p>
              Poinformuj zgłoszonych opiekunów o zmianie — wysyłka
              automatycznych powiadomień nie jest jeszcze podłączona.
            </p>
          )}
        </div>
      )}
      <article className="card hero-card">
        <div className="hero-content">
          <span className="hero-eyebrow">{walk.type}</span>
          <h2>{dateLabel(walk.starts_at)}</h2>
          <p>
            {walk.public_location} · {walk.duration_minutes} min ·{" "}
            {money(walk.price_cents)}
          </p>
          <div className="walk-meta">
            <Badge status={walk.status} />
            <Badge status={walk.booking_mode} />
            {role === "admin" && (
              <span>
                {acceptedIds.size} / {walk.capacity} miejsc
              </span>
            )}
          </div>
        </div>
      </article>
      {walk.status === "cancelled" && (
        <div className="alert red" role="status">
          <strong>Spacer został odwołany przez organizatora.</strong>
          <p className="preserve-lines">{walk.cancellation_reason}</p>
          <p>
            Jeśli spacer był już opłacony, skontaktuj się z prowadzącą w sprawie
            rozliczenia.
          </p>
        </div>
      )}
      {role === "admin" &&
        !["cancelled", "completed"].includes(walk.status) &&
        new Date(walk.starts_at) > new Date() && (
          <details className="card pad">
            <summary>Odwołaj cały spacer</summary>
            <p>
              Wszystkie aktywne zgłoszenia zostaną odwołane bez opłaty za późną
              rezygnację. Powód będzie widoczny dla opiekunów. Poinformuj
              uczestników osobiście — automatyczna wysyłka powiadomień nie jest
              jeszcze podłączona.
            </p>
            <ActionForm action={cancelWalk} label="Potwierdź odwołanie spaceru">
              <input type="hidden" name="walk_id" value={walk.id} />
              <Field
                name="reason"
                label="Powód odwołania dla uczestników"
                required
              />
              <label>
                <input type="checkbox" name="confirmed" value="yes" required />{" "}
                Potwierdzam odwołanie wszystkich aktywnych zgłoszeń.
              </label>
            </ActionForm>
          </details>
        )}
      <div className="dashboard-grid">
        <div className="stack">
          <article className="card pad">
            <h2>Przed spacerem</h2>
            <p className="preserve-lines">
              {walk.info || "Prowadząca uzupełni informacje organizacyjne."}
            </p>
            <p className="muted">
              Bezpłatne odwołanie najpóźniej {walk.cancellation_deadline_hours}{" "}
              godz. przed rozpoczęciem. Zgłoszenie w trybie akceptacji nie jest
              jeszcze rezerwacją.
            </p>
          </article>
          <article className="card pad">
            <h2>Miejsce spotkania</h2>
            {location ? (
              <>
                <p className="preserve-lines">{location.exact_location}</p>
                <p className="preserve-lines">{location.instructions}</p>
                {/^https:\/\//.test(location.map_url) && (
                  <a
                    className="secondary-button"
                    href={location.map_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Otwórz mapę ↗
                  </a>
                )}
              </>
            ) : (
              <div className="alert">
                Dokładną lokalizację zobaczysz po zaakceptowaniu Twojego psa.
              </div>
            )}
          </article>
          {role === "admin" && conflicts.length > 0 && (
            <article className="card pad">
              <h3>Uwaga na skład</h3>
              {conflicts.map((r) => (
                <div className="alert red" key={r.id}>
                  <strong>
                    {snapshot.dogs.find((d) => d.id === r.dog_a)?.name} +{" "}
                    {snapshot.dogs.find((d) => d.id === r.dog_b)?.name}:{" "}
                    {r.level === "block" ? "nie łączyć" : "ostrożnie"}
                  </strong>
                  <p>{r.note}</p>
                </div>
              ))}
            </article>
          )}
        </div>
        <article className="card pad">
          <h2>
            {role === "admin" ? "Zgłoszenia i skład" : "Twoje zgłoszenia"}
          </h2>
          {role === "client" &&
            walk.status === "open" &&
            walk.booking_mode !== "invite" &&
            new Date(walk.starts_at) > new Date() &&
            (eligible.length ? (
              <ActionForm action={registerDog} label="Zgłoś psa">
                <input type="hidden" name="walk_id" value={id} />
                <label className="field">
                  <span>Wybierz swojego psa</span>
                  <select name="dog_id">
                    {eligible.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  {walk.booking_mode === "automatic"
                    ? "Przy wolnym miejscu zgłoszenie zostanie zaakceptowane automatycznie."
                    : "Prowadząca sprawdzi profil psa i dobierze skład grupy."}
                </p>
              </ActionForm>
            ) : (
              <p className="muted">
                Wszystkie dostępne psy mają już zgłoszenie lub wymagają
                konsultacji.{" "}
                <Link href="/app/dogs">Przejdź do profili psów →</Link>
              </p>
            ))}
          {role === "client" && walk.booking_mode === "invite" && (
            <p>
              Ten spacer jest dostępny wyłącznie na zaproszenie prowadzącej.
            </p>
          )}
          {role === "admin" &&
            new Date(walk.starts_at) > new Date() &&
            ["open", "full"].includes(walk.status) &&
            snapshot.dogs.some((d) => !regs.some((r) => r.dog_id === d.id)) && (
              <ActionForm action={inviteDog} label="Dodaj zgłoszenie">
                <input type="hidden" name="walk_id" value={id} />
                <label className="field">
                  <span>Zaproś psa / dodaj zgłoszenie</span>
                  <select name="dog_id">
                    {snapshot.dogs
                      .filter((d) => !regs.some((r) => r.dog_id === d.id))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
              </ActionForm>
            )}
          <div className="stack registration-list">
            {(
              [
                "pending",
                "accepted",
                "waitlisted",
                "rejected",
                "withdrawn",
                "cancelled_on_time",
                "cancelled_late",
              ] as const
            ).flatMap((status) =>
              regs
                .filter((r) => r.status === status)
                .map((r) => (
                  <section className="registration-card" key={r.id}>
                    <div className="section-title">
                      <Link href={`${base}/dogs/${r.dog_id}`}>
                        <strong>
                          {snapshot.dogs.find((d) => d.id === r.dog_id)?.name ||
                            "Profil psa"}{" "}
                          →
                        </strong>
                      </Link>
                      <Badge status={r.status} />
                    </div>
                    <p className="muted">
                      Płatność: {labels[r.payment_status]}
                      {r.status === "accepted"
                        ? ` · Obecność: ${r.attendance === "pending" ? "do oznaczenia" : labels[r.attendance]}`
                        : ""}
                    </p>
                    {r.status === "accepted" && r.cancellation_free_until && (
                      <p className="alert">
                        Po zmianie terminu możesz odwołać bez opłaty do{" "}
                        {dateLabel(
                          new Date(
                            Math.min(
                              Date.parse(r.cancellation_free_until),
                              Date.parse(walk.starts_at),
                            ),
                          ).toISOString(),
                        )}
                        .
                      </p>
                    )}
                    {r.decision_note && (
                      <p className="preserve-lines">{r.decision_note}</p>
                    )}
                    {role === "admin" &&
                      !["cancelled", "completed"].includes(walk.status) &&
                      new Date(walk.starts_at) > new Date() &&
                      transitions[r.status].filter((s) => s !== "withdrawn")
                        .length > 0 && (
                        <ActionForm
                          action={decideRegistration}
                          label="Zapisz decyzję"
                          confirm="Zapisać decyzję? Opiekun zobaczy nowy status zgłoszenia."
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <label className="field">
                            <span>Decyzja</span>
                            <select name="status">
                              {transitions[r.status]
                                .filter((s) => s !== "withdrawn")
                                .map((s) => (
                                  <option key={s} value={s}>
                                    {labels[s]}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <Field
                            label="Wiadomość dla opiekuna (opcjonalna)"
                            name="note"
                            maxLength={2000}
                          />
                        </ActionForm>
                      )}
                    {role === "admin" &&
                      r.status === "accepted" &&
                      new Date(walk.starts_at) <= new Date() && (
                        <ActionForm
                          action={markAttendance}
                          label="Zapisz obecność"
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <label className="field">
                            <span>Obecność</span>
                            <select
                              name="attendance"
                              defaultValue={r.attendance}
                            >
                              {["pending", "present", "absent", "no_show"].map(
                                (s) => (
                                  <option key={s} value={s}>
                                    {s === "pending"
                                      ? "Do oznaczenia"
                                      : labels[s]}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                        </ActionForm>
                      )}
                    {role === "client" &&
                      ["pending", "accepted", "waitlisted"].includes(
                        r.status,
                      ) &&
                      new Date(walk.starts_at) > new Date() && (
                        <ActionForm
                          action={cancelRegistration}
                          label="Odwołaj zgłoszenie"
                          confirm={
                            r.cancellation_free_until
                              ? "Odwołać zgłoszenie? Przy rozliczeniu uwzględnimy Twój termin bezpłatnej rezygnacji po zmianie spaceru."
                              : `Odwołać zgłoszenie? Jeśli do spaceru zostało mniej niż ${walk.cancellation_deadline_hours} godz., zaakceptowane miejsce będzie podlegać opłacie.`
                          }
                        >
                          <input type="hidden" name="id" value={r.id} />
                        </ActionForm>
                      )}
                  </section>
                )),
            )}
          </div>
          {!regs.length && <p className="muted">Jeszcze bez zgłoszeń.</p>}
        </article>
      </div>
    </div>
  );
}
export type WalkFormValues = Partial<Walk> & {
  exact_location?: string;
  map_url?: string;
  instructions?: string;
};
export function NewWalk({
  initial = {},
  editing = false,
  hasRegistrations = false,
}: {
  initial?: WalkFormValues;
  editing?: boolean;
  hasRegistrations?: boolean;
}) {
  return (
    <article className="card pad form-card">
      <h2>{editing ? "Edytuj spacer" : "Nowy spacer"}</h2>
      <p className="muted">
        Godzinę podaj według czasu polskiego (Europe/Warsaw).
      </p>
      {hasRegistrations && (
        <div className="alert">
          Są już zgłoszenia. Cena, tryb zapisów i liczba godzin na bezpłatne
          odwołanie są zachowane. Limit miejsc nie może być mniejszy od
          zaakceptowanego składu.
        </div>
      )}
      <ActionForm
        action={editing ? updateWalk : createWalk}
        label={editing ? "Zapisz zmiany spaceru" : "Utwórz spacer"}
      >
        {editing && (
          <>
            <input type="hidden" name="id" value={initial.id} />
            <input type="hidden" name="updated_at" value={initial.updated_at} />
          </>
        )}
        <div className="form-grid">
          <Field
            label="Termin (czas polski)"
            name="local_start"
            value={
              initial.starts_at ? warsawDateTimeInput(initial.starts_at) : ""
            }
            type="datetime-local"
            required
          />
          <Field
            label="Czas trwania w minutach"
            name="duration_minutes"
            type="number"
            value={initial.duration_minutes ?? 60}
            required
          />
          <Field
            label="Ogólna lokalizacja"
            name="public_location"
            value={initial.public_location}
            required
          />
          <Field
            label="Rodzaj spaceru"
            name="type"
            value={initial.type ?? "Spacer socjalizacyjny"}
            required
          />
          <Field
            label="Cena za psa (zł)"
            name="price"
            readOnly={hasRegistrations}
            type="number"
            value={initial.price_cents ? initial.price_cents / 100 : 60}
            required
          />
          <Field
            label="Liczba miejsc"
            name="capacity"
            type="number"
            value={initial.capacity ?? 4}
            required
          />
          <label className="field">
            <span>Tryb zapisów</span>
            {hasRegistrations && (
              <input
                type="hidden"
                name="booking_mode"
                value={initial.booking_mode}
              />
            )}
            <select
              disabled={hasRegistrations}
              name="booking_mode"
              defaultValue={initial.booking_mode ?? "approval"}
            >
              <option value="approval">Po akceptacji</option>
              <option value="automatic">
                Automatyczne — zakwalifikowane psy
              </option>
              <option value="invite">Tylko na zaproszenie</option>
            </select>
          </label>
          <Field
            label="Termin odwołania — godzin przed spacerem"
            name="cancellation_deadline_hours"
            readOnly={hasRegistrations}
            type="number"
            value={initial.cancellation_deadline_hours ?? 24}
            required
          />
        </div>
        <label className="field">
          <span>Informacje dla opiekunów</span>
          <textarea name="info" defaultValue={initial.info} maxLength={4000} />
        </label>
        <h3>Prywatne szczegóły spotkania</h3>
        <p className="muted">
          Zobaczą je tylko opiekunowie zaakceptowanych psów.
        </p>
        <Field
          label="Dokładne miejsce zbiórki"
          name="exact_location"
          value={initial.exact_location}
          required
        />
        <Field
          label="Link do mapy (https://)"
          name="map_url"
          type="url"
          value={initial.map_url}
        />
        <label className="field">
          <span>Wskazówki dotarcia</span>
          <textarea
            name="instructions"
            maxLength={2000}
            defaultValue={initial.instructions}
          />
        </label>
        {editing && (
          <Field
            name="change_note"
            label="Co się zmienia? Informacja dla opiekunów"
            maxLength={2000}
            required
          />
        )}
      </ActionForm>
    </article>
  );
}
