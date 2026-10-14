import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { isConfigured, isRemoteDevelopment } from "@/lib/supabase/config";
import { ActionForm, Field } from "@/components/action-form";
import { signInWithPassword } from "@/lib/auth/access-actions";
import { authEmailOrigin } from "@/lib/auth/email-config";
import { Brand, brandSlogan } from "@/components/brand";
import styles from "./login.module.css";

export const metadata: Metadata = {
  title: "Zaloguj się — Psi Pawer",
};

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const configured = isConfigured();
  const recoveryAvailable = Boolean(authEmailOrigin());
  const error = (await searchParams).error;
  return (
    <main className={`auth-page ${styles.page}`}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Brand showSlogan={false} className={styles.brand} />
          <p>Twój pies. Wasza wspólna droga.</p>
        </header>
        <div className={styles.layout}>
          <section className={styles.intro} aria-labelledby="login-heading">
            <span className="eyebrow">DOBRZE CIĘ WIDZIEĆ</span>
            <h1 id="login-heading">{brandSlogan}</h1>
            <p className={styles.lead}>
              Wspólne spotkania, wskazówki i postępy Twojego psa — blisko
              Ciebie, ze wsparciem Asi.
            </p>
            <div className={styles.photo}>
              <Image
                src="/brand/joanna-and-dogs.webp"
                alt="Asia z Psi Pawer ze swoimi dwoma owczarkami na łące"
                fill
                sizes="(max-width: 800px) calc(100vw - 32px), (max-width: 1200px) 50vw, 560px"
                fetchPriority="high"
              />
            </div>
            <div className={styles.guide}>
              <Image
                src="/brand/joanna-portrait.webp"
                alt=""
                width={48}
                height={48}
              />
              <div>
                <strong>Asia · Psi Pawer</strong>
                <span>Razem zadbamy o spokojniejszą codzienność.</span>
              </div>
            </div>
          </section>
          <section
            className={`card auth-card login-card ${styles.card}`}
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
              <>
                <ActionForm
                  action={signInWithPassword}
                  label="Zaloguj się"
                  pendingLabel="Loguję…"
                  className="login-form"
                >
                  <Field
                    name="email"
                    label="Twój e-mail"
                    type="email"
                    autoComplete="username"
                    inputMode="email"
                    placeholder="np. imie@email.pl"
                    required
                  />
                  <Field
                    name="password"
                    label="Hasło"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                  />
                </ActionForm>
                <Link className="ghost-button" href="/forgot-password">
                  Nie pamiętam hasła
                </Link>
                <details className="login-help">
                  <summary className="ghost-button">
                    {recoveryAvailable
                      ? "Nie dotarła wiadomość?"
                      : "Potrzebujesz linku dostępu?"}
                  </summary>
                  <p>
                    {recoveryAvailable
                      ? "Sprawdź folder spam i adres e-mail. Otwórz najnowszy link. Jeśli wiadomość nadal nie dotarła, skontaktuj się z prowadzącą."
                      : "Podczas testów poproś o nowy jednorazowy link dostępu osobę, która udostępniła Ci aplikację. Pozwoli Ci ustawić nowe hasło. Automatyczne linki e-mail będą dostępne po uruchomieniu poczty."}
                  </p>
                </details>
              </>
            ) : (
              <div className="alert">
                {isRemoteDevelopment()
                  ? "Pracujemy lokalnie. Połączenie z bazą w chmurze jest wyłączone. Logowanie będzie dostępne po uruchomieniu lokalnej bazy testowej."
                  : "Logowanie jest w przygotowaniu. Możesz obejrzeć podgląd aplikacji na fikcyjnych danych."}
              </div>
            )}
            <div className="login-help">
              <strong>Pierwszy raz w Psi Pawer?</strong>
              <p>
                Otwórz przekazany Ci jednorazowy link dostępu i ustaw własne
                hasło. Jeśli nie masz linku, skontaktuj się z prowadzącą.
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
        <footer className={styles.footer}>
          Z troską o psy. Z myślą o ich opiekunach.
        </footer>
      </div>
    </main>
  );
}
