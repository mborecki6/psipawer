import Link from "next/link";
import type { Metadata } from "next";
import { KeyRound } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { confirmPasswordRecovery } from "@/lib/auth/recovery-actions";
import { isConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Zmiana hasła — Psi Pawer",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Recovery({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = params.token_hash;
  const valid =
    typeof token === "string" &&
    /^[A-Za-z0-9_-]{32,256}$/.test(token) &&
    !["type", "redirect", "redirect_to", "redirectTo", "next", "code"].some(
      (key) => key in params,
    ) &&
    isConfigured();
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div className="login-mail-mark" aria-hidden="true">
          <KeyRound />
        </div>
        <span className="eyebrow">ODZYSKIWANIE DOSTĘPU</span>
        <h1>Ustaw nowe hasło.</h1>
        {valid ? (
          <>
            <p>
              Potwierdź, że chcesz przejść do zmiany hasła. Na kolejnym ekranie
              sprawdzisz adres konta i wpiszesz własne hasło.
            </p>
            <ActionForm
              action={confirmPasswordRecovery}
              label="Przejdź do zmiany hasła"
              pendingLabel="Sprawdzam link…"
            >
              <input type="hidden" name="token_hash" value={token} />
            </ActionForm>
            <p className="muted">
              Link jest jednorazowy. Nie przekazuj go innym osobom.
            </p>
          </>
        ) : (
          <div className="alert red" role="alert">
            Ten link jest nieprawidłowy. Otwórz najnowszą wiadomość lub zamów
            nowy link.
          </div>
        )}
        <Link className="ghost-button" href="/forgot-password" prefetch={false}>
          Zamów nowy link
        </Link>
        <Link className="ghost-button" href="/login" prefetch={false}>
          Wróć do logowania
        </Link>
      </section>
    </main>
  );
}
