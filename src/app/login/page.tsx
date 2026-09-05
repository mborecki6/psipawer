import Link from "next/link";
import { PawPrint } from "lucide-react";
import { isConfigured } from "@/lib/supabase/config";
import { ActionForm, Field } from "@/components/action-form";
import { signIn } from "@/lib/auth/actions";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = isConfigured();
  const error = (await searchParams).error;
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark">
            <PawPrint />
          </div>
          <div className="brand-copy">
            <strong>Psi Pawer</strong>
            <span>zamieniam problemy w wyzwania</span>
          </div>
        </div>
        <span className="eyebrow">DOBRZE CIĘ WIDZIEĆ</span>
        <h1>
          Małe kroki.
          <br />
          Wielki psi pawer.
        </h1>
        <p>
          Twoje psy, wspólne spacery i spokojniejsza codzienność — w jednym
          miejscu.
        </p>
        {error && (
          <div className="alert red" role="alert">
            {error === "role"
              ? "Nie udało się odczytać uprawnień konta. Skontaktuj się z prowadzącą."
              : "Link wygasł lub został już wykorzystany. Poproś o nowy link."}
          </div>
        )}
        {configured ? (
          <ActionForm action={signIn} label="Wyślij link do logowania">
            <Field name="email" label="Twój e-mail" type="email" required />
            <p className="muted">
              Nie potrzebujesz hasła. Wyślemy Ci jednorazowy link. Przy
              pierwszym logowaniu utworzymy konto opiekuna.
            </p>
          </ActionForm>
        ) : (
          <div className="alert">
            Logowanie będzie dostępne po podłączeniu bazy. Możesz już obejrzeć
            podgląd na fikcyjnych danych.
          </div>
        )}
        <Link
          className={configured ? "ghost-button" : "primary-button"}
          href="/demo"
        >
          Zobacz podgląd aplikacji →
        </Link>
      </section>
    </main>
  );
}
