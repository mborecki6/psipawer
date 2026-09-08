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
  searchParams: Promise<{ activated?: string }>;
}) {
  const { user } = await requireSession(undefined, false);
  const activated = (await searchParams).activated === "1";
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div className="login-mail-mark" aria-hidden="true">
          <KeyRound />
        </div>
        <span className="eyebrow">TWOJE KONTO</span>
        <h1>{activated ? "Ustaw swoje hasło." : "Zmień swoje hasło."}</h1>
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
        <ActionForm
          action={saveOwnPassword}
          label="Zapisz hasło i przejdź dalej"
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
        <Link className="ghost-button" href="/complete-profile">
          Przejdź do moich danych →
        </Link>
      </section>
    </main>
  );
}
