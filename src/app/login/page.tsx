import Link from "next/link";
import type { Metadata } from "next";
import { CalendarDays, HeartHandshake, Mail, PawPrint } from "lucide-react";
import { isConfigured } from "@/lib/supabase/config";
import { ActionForm, Field } from "@/components/action-form";
import { signIn } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Zaloguj się — Psi Pawer",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = isConfigured();
  const error = (await searchParams).error;
  return (
    <main className="auth-page login-page">
      <div className="login-shell">
        <header className="brand auth-brand login-brand">
          <div className="brand-mark" aria-hidden="true">
            <PawPrint strokeWidth={1.7} />
          </div>
          <div className="brand-copy">
            <strong>Psi Pawer</strong>
            <span>zamieniam problemy w wyzwania</span>
          </div>
        </header>
        <div className="login-layout">
          <section className="login-intro" aria-labelledby="login-heading">
            <span className="eyebrow">DOBRZE CIĘ WIDZIEĆ</span>
            <h1 id="login-heading">
              Małe kroki.
              <br />
              Wielki psi pawer.
            </h1>
            <p className="login-lead">
              Twoje psy, wspólne spacery i spokojniejsza codzienność — w jednym
              miejscu.
            </p>
            <ul className="login-benefits">
              <li>
                <span className="login-benefit-icon" aria-hidden="true">
                  <PawPrint />
                </span>
                <div>
                  <strong>Każdy pies ma swoją historię</strong>
                  <span>Profil, potrzeby i postępy Twojego psa.</span>
                </div>
              </li>
              <li>
                <span className="login-benefit-icon" aria-hidden="true">
                  <CalendarDays />
                </span>
                <div>
                  <strong>Więcej wspólnych spacerów</strong>
                  <span>Terminy, zgłoszenia i informacje o spotkaniach.</span>
                </div>
              </li>
              <li>
                <span className="login-benefit-icon" aria-hidden="true">
                  <HeartHandshake />
                </span>
                <div>
                  <strong>Ze wsparciem behawiorysty</strong>
                  <span>Wskazówki, do których możesz wrócić.</span>
                </div>
              </li>
            </ul>
          </section>
          <section
            className="card auth-card login-card"
            aria-labelledby="sign-in-heading"
          >
            <div className="login-mail-mark" aria-hidden="true">
              <Mail strokeWidth={1.6} />
            </div>
            <span className="eyebrow">TWOJE KONTO</span>
            <h2 id="sign-in-heading">Wejdź do swojego panelu.</h2>
            <p className="login-card-intro">
              Podaj e-mail, którego używasz w Psi Pawer.
            </p>
            {error && (
              <div className="alert red" role="alert">
                {error === "role"
                  ? "Nie udało się odczytać uprawnień konta. Skontaktuj się z prowadzącą."
                  : "Link wygasł lub został już wykorzystany. Poproś o nowy link."}
              </div>
            )}
            {configured ? (
              <ActionForm
                action={signIn}
                label="Wyślij link do logowania"
                pendingLabel="Wysyłam link…"
                className="login-form"
              >
                <Field
                  name="email"
                  label="Twój e-mail"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="np. imie@email.pl"
                  hint="Bez zapamiętywania hasła. Wyślemy Ci jednorazowy link do logowania."
                  required
                />
              </ActionForm>
            ) : (
              <div className="alert">
                Logowanie jest w przygotowaniu. Możesz obejrzeć podgląd
                aplikacji na fikcyjnych danych.
              </div>
            )}
            <div className="login-help">
              <strong>Pierwszy raz w Psi Pawer?</strong>
              <p>
                Zaloguj się swoim e-mailem. Przy pierwszym wejściu utworzymy
                konto opiekuna i pomożemy uzupełnić profil.
              </p>
            </div>
            {!configured && (
              <Link className="ghost-button" href="/demo">
                Zobacz podgląd na fikcyjnych danych →
              </Link>
            )}
            <p className="login-role-note">
              Opiekun i behawiorysta logują się w tym samym miejscu.
            </p>
          </section>
        </div>
        <footer className="login-footer">
          Z troską o psy. Z myślą o ich opiekunach.
        </footer>
      </div>
    </main>
  );
}
