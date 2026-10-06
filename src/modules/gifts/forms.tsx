"use client";
import Link from "next/link";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePersistentForm } from "@/components/use-persistent-form";
import { useHydrated } from "@/components/use-hydrated";
import { money } from "@/lib/domain";
import type { Service } from "@/modules/services/types";
import type { FinanceCharge } from "@/lib/finance";
import type { GiftCard } from "./types";
import {
  issueGiftCard,
  changeGiftCard,
  claimGiftCard,
  refundGiftCardSale,
  redeemGiftCard,
  bindGiftService,
  type GiftActionState,
} from "./actions";
import styles from "./gifts.module.css";
type Person = { id: string; full_name: string };
type GiftAction = (
  state: GiftActionState,
  form: FormData,
) => Promise<GiftActionState>;
function GiftForm({
  action,
  children,
  label,
  base = "/admin",
  refreshHref,
  disabled = false,
  openResult = false,
}: {
  action: GiftAction;
  children: ReactNode;
  label: string;
  base?: string;
  refreshHref?: string;
  disabled?: boolean;
  openResult?: boolean;
}) {
  const [state, submit, pending] = useActionState(
    action,
    {} as GiftActionState,
  );
  const ref = usePersistentForm(),
    hydrated = useHydrated(),
    error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.error) error.current?.focus();
  }, [state]);
  return (
    <form ref={ref} action={submit} className="form-stack">
      {state.error && (
        <div ref={error} role="alert" tabIndex={-1} className="alert red">
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
      <fieldset
        className={styles.fields}
        disabled={!hydrated || pending || Boolean(state.success)}
      >
        {children}
        <button
          type="submit"
          className="primary-button"
          disabled={disabled || pending}
        >
          {pending ? "Zapisuję…" : label}
        </button>
      </fieldset>
      {state.success && state.id && openResult && (
        <Link className="ghost-button" href={`${base}/gifts/${state.id}`}>
          Otwórz kartę →
        </Link>
      )}
      {state.success && refreshHref && (
        <a className="ghost-button" href={refreshHref}>
          Wczytaj aktualne saldo i przygotuj kolejną operację →
        </a>
      )}
    </form>
  );
}
function Tokens({ card, requestId }: { card: GiftCard; requestId: string }) {
  const [original] = useState({
    id: card.id,
    version: card.version,
    key: requestId,
  });
  return (
    <>
      <input type="hidden" name="card_id" value={original.id} />
      <input type="hidden" name="expected_version" value={original.version} />
      <input type="hidden" name="request_id" value={original.key} />
    </>
  );
}
function Note({ required = false }: { required?: boolean }) {
  return (
    <label className="field">
      <span>{required ? "Powód operacji" : "Notatka (opcjonalnie)"}</span>
      <textarea
        name="note"
        rows={3}
        maxLength={2000}
        minLength={required ? 3 : undefined}
        required={required}
      />
    </label>
  );
}
export function GiftIssueForm({
  services,
  people,
  id,
  today,
}: {
  services: Service[];
  people: Person[];
  id: string;
  today: string;
}) {
  const [original] = useState({ id, services, today }),
    [chosen, setChosen] = useState(""),
    [amount, setAmount] = useState("100,00");
  const service = original.services.find((s) => s.id === chosen);
  return (
    <GiftForm
      action={issueGiftCard}
      label="Potwierdź wpłatę i wystaw kartę"
      openResult
    >
      <input type="hidden" name="id" value={original.id} />
      <label className="field">
        <span>Rodzaj karty</span>
        <select
          name="service_id"
          value={chosen}
          onChange={(e) => {
            const id = e.target.value;
            setChosen(id);
            const s = original.services.find((s) => s.id === id);
            if (s)
              setAmount((s.price_cents / 100).toFixed(2).replace(".", ","));
          }}
        >
          <option value="">Karta kwotowa — dowolna usługa</option>
          {original.services
            .filter((s) => s.active && s.kind !== "voucher")
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {money(s.price_cents)}
              </option>
            ))}
        </select>
      </label>
      <input
        type="hidden"
        name="service_version"
        value={service?.version || ""}
      />
      <label className="field">
        <span>Wartość karty (zł)</span>
        <input
          name="amount"
          inputMode="decimal"
          maxLength={9}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          readOnly={Boolean(service)}
          required
        />
        <small className="field-hint">
          {service
            ? "Wartość z ceny tej usługi w chwili wystawienia. Późniejsza zmiana ceny może wymagać dopłaty."
            : "Roboczo 100 zł. Możesz wpisać inną wartość do 10 000 zł."}
        </small>
      </label>
      <div className={styles.twoFields}>
        <label className="field">
          <span>Od kogo</span>
          <input name="sender" maxLength={120} required autoComplete="off" />
        </label>
        <label className="field">
          <span>Dla kogo</span>
          <input name="recipient" maxLength={120} required autoComplete="off" />
        </label>
      </div>
      <label className="field">
        <span>Życzenia (opcjonalnie)</span>
        <textarea name="message" rows={3} maxLength={500} />
      </label>
      <label className="field">
        <span>Konto opiekuna</span>
        <select name="beneficiary_id" defaultValue="">
          <option value="">Do aktywacji kodem przez obdarowanego</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || "Opiekun"}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.twoFields}>
        <label className="field">
          <span>Data zakupu</span>
          <input
            name="purchased_on"
            type="date"
            defaultValue={original.today}
            max={original.today}
            min="2000-01-01"
            required
          />
          <small className="field-hint">
            Ważna przez sześć miesięcy od zakupu.
          </small>
        </label>
        <label className="field">
          <span>Metoda otrzymanej wpłaty</span>
          <select name="method" defaultValue="transfer">
            <option value="transfer">Przelew</option>
            <option value="cash">Gotówka</option>
            <option value="card">Karta płatnicza</option>
            <option value="other">Inna (np. BLIK)</option>
          </select>
        </label>
      </div>
      <Note />
      <label className={styles.check}>
        <input type="checkbox" name="confirmed" required />
        <span>
          Potwierdzam, że cała wpłata za kartę została otrzymana poza aplikacją.
        </span>
      </label>
    </GiftForm>
  );
}
export function GiftClaimForm() {
  return (
    <GiftForm
      action={claimGiftCard}
      label="Aktywuj moją kartę"
      base="/app"
      openResult
    >
      <label className="field">
        <span>Kod karty podarunkowej</span>
        <input
          name="code"
          maxLength={60}
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <small className="field-hint">
          Wklej pełny kod z karty. Myślniki możesz pozostawić.
        </small>
      </label>
    </GiftForm>
  );
}
export function GiftChangeForm({
  card,
  people,
  requestId,
}: {
  card: GiftCard;
  people: Person[];
  requestId: string;
}) {
  const [intent, setIntent] = useState("");
  return (
    <GiftForm
      action={changeGiftCard}
      label="Zapisz decyzję"
      refreshHref={`/admin/gifts/${card.id}`}
    >
      <Tokens card={card} requestId={requestId} />
      <label className="field">
        <span>Działanie</span>
        <select
          name="intent"
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          required
        >
          <option value="">Wybierz działanie</option>
          {card.status === "active" ? (
            <>
              <option value="cancel">Wycofaj kartę</option>
              {card.redeemed_cents === 0 && (
                <>
                  <option value="assign">Przypisz konto opiekuna</option>
                  <option value="unassign">Usuń przypisanie</option>
                </>
              )}
            </>
          ) : (
            <option value="restore">Przywróć kartę</option>
          )}
        </select>
      </label>
      {intent === "assign" ? (
        <label className="field">
          <span>Opiekun</span>
          <select name="beneficiary_id" defaultValue="" required>
            <option value="">Wybierz konto</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || "Opiekun"}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="beneficiary_id" value="" />
      )}
      <Note required />
      <p className="muted">
        Wycofanie nie zwraca pieniędzy. Przywrócenie zachowuje poprzednie saldo
        i termin ważności. Po wykorzystaniu karta zachowuje opiekuna.
      </p>
    </GiftForm>
  );
}
export function GiftCashRefundForm({
  card,
  requestId,
}: {
  card: GiftCard;
  requestId: string;
}) {
  const [original] = useState(card);
  if (original.balance_cents <= 0)
    return <p className="muted">Nie ma niewykorzystanej wartości do zwrotu.</p>;
  return (
    <GiftForm
      action={refundGiftCardSale}
      label="Odnotuj potwierdzony zwrot pieniędzy"
      refreshHref={`/admin/gifts/${card.id}`}
    >
      <Tokens card={original} requestId={requestId} />
      <label className="field">
        <span>Zwrócona kwota (zł)</span>
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={(original.balance_cents / 100)
            .toFixed(2)
            .replace(".", ",")}
          maxLength={9}
          required
        />
      </label>
      <Note required />
      <label className={styles.check}>
        <input type="checkbox" name="confirmed" required />
        <span>Potwierdzam, że pieniądze zostały zwrócone poza aplikacją.</span>
      </label>
    </GiftForm>
  );
}
export function GiftRedeemForm({
  card,
  charges,
  requestId,
}: {
  card: GiftCard;
  charges: (FinanceCharge & {
    needsBinding: boolean;
    bindingVersion: number;
    boundServiceName: string | null;
  })[];
  requestId: string;
}) {
  const [original] = useState({ card, charges, requestId }),
    [choice, setChoice] = useState(""),
    [amount, setAmount] = useState("");
  const charge = original.charges.find((c) => `${c.kind}:${c.id}` === choice);
  const requiresBinding = charge?.needsBinding === true;
  if (!original.card.beneficiary_id)
    return (
      <p className="muted">
        Najpierw przypisz kartę opiekunowi lub przekaż kod do aktywacji.
      </p>
    );
  if (!original.card.usable)
    return (
      <p className="muted">
        Ta karta jest wycofana, po terminie albo nie ma dostępnego salda.
      </p>
    );
  if (!original.charges.length)
    return (
      <p className="muted">
        Brak należności tego opiekuna zgodnych z kartą. Najpierw przyjmij
        zgłoszenie lub utwórz właściwe rozliczenie.
      </p>
    );
  return (
    <div className="stack">
      <GiftForm
        action={redeemGiftCard}
        label="Rozlicz z salda karty"
        refreshHref={`/admin/gifts/${card.id}`}
        disabled={!charge || requiresBinding}
      >
        <Tokens card={original.card} requestId={original.requestId} />
        <label className="field">
          <span>Należność tego opiekuna</span>
          <select
            value={choice}
            onChange={(e) => {
              setChoice(e.target.value);
              const c = original.charges.find(
                (c) => `${c.kind}:${c.id}` === e.target.value,
              );
              setAmount(
                c
                  ? (Math.min(c.dueCents, original.card.balance_cents) / 100)
                      .toFixed(2)
                      .replace(".", ",")
                  : "",
              );
            }}
            required
          >
            <option value="">Wybierz należność</option>
            {original.charges.map((c) => (
              <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>
                {c.dogName} · {c.title} · {money(c.dueCents)}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="target_kind" value={charge?.kind || ""} />
        <input type="hidden" name="target_id" value={charge?.id || ""} />
        <label className="field">
          <span>Kwota z karty (zł)</span>
          <input
            name="amount"
            inputMode="decimal"
            maxLength={9}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </label>
        <Note />
        <p className="muted">
          Saldo pokryje całość lub część należności. Pozostała kwota jest
          dopłatą, którą odnotujesz osobno.
        </p>
      </GiftForm>
      {requiresBinding && charge && original.card.service_id && (
        <section className="card pad stack">
          <h4>
            {charge.bindingVersion
              ? "Sprawdź wcześniejsze powiązanie"
              : "Najpierw potwierdź usługę"}
          </h4>
          <p>
            {charge.bindingVersion
              ? `Ten spacer lub pakiet wskazuje usługę „${charge.boundServiceName}”. Skoryguj powiązanie wyłącznie wtedy, gdy było pomyłką i rozliczenie odpowiada usłudze „${original.card.service_name}”. Po pierwszym rozliczeniu dowolną kartą powiązanie pozostaje niezmienne, także po zwrocie.`
              : `Ten spacer lub pakiet ma własną nazwę. Potwierdź, że odpowiada usłudze „${original.card.service_name}”. Powiązanie zostanie zachowane przy rozliczeniu kartą.`}
          </p>
          <GiftForm
            action={bindGiftService}
            label={
              charge.bindingVersion
                ? "Skoryguj powiązanie z usługą"
                : "Potwierdź powiązanie z usługą"
            }
            refreshHref={`/admin/gifts/${card.id}`}
          >
            <input type="hidden" name="target_kind" value={charge.kind} />
            <input type="hidden" name="target_id" value={charge.id} />
            <input
              type="hidden"
              name="service_id"
              value={original.card.service_id}
            />
            <input
              type="hidden"
              name="expected_version"
              value={charge.bindingVersion}
            />
            <Note required />
          </GiftForm>
        </section>
      )}
    </div>
  );
}
export function GiftPrintButton() {
  const hydrated = useHydrated();
  return (
    <button
      className="ghost-button"
      disabled={!hydrated}
      onClick={() => window.print()}
    >
      Drukuj / zapisz jako PDF
    </button>
  );
}
