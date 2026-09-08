export const dynamic = "force-dynamic";
import { requireSession } from "@/lib/auth/session";
import { saveProfile } from "@/lib/auth/actions";
import { ActionForm, Field } from "@/components/action-form";
export default async function Page() {
  const { profile } = await requireSession(undefined, false);
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <h1>Poznajmy się.</h1>
        <p>Podaj dane kontaktowe i ogólną okolicę, w której spacerujesz.</p>
        <ActionForm action={saveProfile} label="Zapisz i przejdź dalej">
          <Field
            name="full_name"
            label="Imię i nazwisko"
            value={profile.full_name || ""}
            required
          />
          <Field
            name="phone"
            label="Telefon"
            type="tel"
            value={profile.phone || ""}
            required
          />
          <Field
            name="area"
            label="Okolica (np. Wrocław, Krzyki)"
            value={profile.area || ""}
            required
          />
        </ActionForm>
      </section>
    </main>
  );
}
