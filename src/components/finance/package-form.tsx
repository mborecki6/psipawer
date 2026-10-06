import { CirclePlus } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import type { FinanceData } from "@/lib/finance";
import { purchasePackage } from "@/lib/data/finance-actions";
import { Details, NoteField } from "./ui";

export function NewPackageForm({ data }: { data: FinanceData }) {
  return (
    <Details
      title="Dodaj pakiet dla psa"
      icon={<CirclePlus aria-hidden="true" />}
    >
      {!data.dogs.length ? (
        <p>
          Pakiet można przypisać do istniejącego profilu psa. Opiekun najpierw
          dodaje psa w swoim panelu.
        </p>
      ) : (
        <>
          <p>
            Pakiet otrzyma własne saldo wejść i należność do rozliczenia. Wpłatę
            zapiszesz osobno po jej otrzymaniu.
          </p>
          <ActionForm
            action={purchasePackage}
            label="Utwórz pakiet"
            pendingLabel="Tworzę pakiet…"
          >
            <label className="field">
              <span>Pies i opiekun</span>
              <select name="dog_id" required defaultValue="">
                <option value="" disabled>
                  Wybierz psa
                </option>
                {data.dogs.map((dog) => (
                  <option key={dog.id} value={dog.id}>
                    {dog.name} · {dog.guardianName}
                  </option>
                ))}
              </select>
            </label>
            <Field
              name="name"
              label="Nazwa pakietu"
              placeholder="np. Cztery wspólne spacery"
              maxLength={120}
              required
            />
            <div className="form-grid">
              <label className="field">
                <span>Liczba wejść</span>
                <input
                  name="entries"
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  required
                />
              </label>
              <Field
                name="price"
                label="Cena całego pakietu (zł)"
                inputMode="decimal"
                placeholder="0,00"
                maxLength={9}
                required
              />
            </div>
            <Field
              name="expires_at"
              label="Ważny do (opcjonalnie)"
              type="datetime-local"
              hint="Termin w polskiej strefie czasowej. Puste pole oznacza pakiet bez terminu ważności."
            />
            <NoteField privateNote />
          </ActionForm>
        </>
      )}
    </Details>
  );
}
