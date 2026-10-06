import Link from "next/link";
import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { saveOwnPassword } from "@/lib/auth/access-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Hasło do konta — Psi Pawer",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Security({
  searchParams,
}: {
  searchParams: Promise<{
    activated?: string;
    recovered?: string;
    updated?: string;
  }>;
}) {
  const { user, profile, role } = await requireSession(undefined, false);
  const search = await searchParams;
  const activated = search.activated === "1",
    recovered = search.recovered === "1",
    updated = search.updated === "1";
  const next =
    profile?.full_name && profile?.phone && profile?.area
      ? role === "admin"
        ? "/admin"
        : "/app"
      : "/complete-profile";
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div className="login-mail-mark" aria-hidden="true">
          <KeyRound />
        </div>
        <span className="eyebrow">TWOJE KONTO</span>
        <h1>
          {updated
            ? "Hasło zostało zapisane."
            : recovered
              ? "Ustaw nowe hasło."
              : activated
                ? "Ustaw swoje hasło."
                : "Zmień swoje hasło."}
        </h1>
        {recovered && !updated && (
          <div className="alert green" role="status">
            Link został potwierdzony. Teraz wybierz nowe hasło do swojego konta.
          </div>
        )}
        {activated && (
          <div className="alert green" role="status">
            Konto zostało otwarte. Ustaw hasło, aby kolejne logowanie było
            proste.
          </div>
        )}
        <p>
          Zalogowano jako <strong>{user.email}</strong>. Hasło ustawiasz
          wyłącznie dla tego konta.
        </p>
        {!updated && (
          <ActionForm
            action={saveOwnPassword}
            label="Zapisz nowe hasło"
            pendingLabel="Zapisuję hasło…"
          >
            <Field
              name="password"
              label="Nowe hasło"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              hint="Od 12 do 128 znaków. Możesz użyć dłuższej frazy lub hasła z menedżera haseł."
            />
            <Field
              name="confirm_password"
              label="Powtórz nowe hasło"
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
            />
          </ActionForm>
        )}
        {updated && (
          <p role="status">
            Przy kolejnej wizycie zalogujesz się swoim e-mailem i nowym hasłem.
          </p>
        )}
        <Link
          className={updated ? "primary-button" : "ghost-button"}
          href={next}
        >
          {next === "/complete-profile"
            ? "Uzupełnij moje dane"
            : "Przejdź do mojego panelu"}
        </Link>
      </section>
    </main>
  );
}
