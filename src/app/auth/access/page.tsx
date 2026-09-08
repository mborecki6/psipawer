import Link from "next/link";
import type { Metadata } from "next";
import { KeyRound, PawPrint } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { activateAccess } from "@/lib/auth/access-actions";
import { isConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Otwórz swoje konto — Psi Pawer",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Access({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = params.token_hash;
  const valid =
    typeof token === "string" &&
    /^[A-Za-z0-9_-]{32,256}$/.test(token) &&
    !["type", "redirect", "redirect_to", "redirectTo", "next"].some(
      (key) => key in params,
    ) &&
    isConfigured();
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div className="brand auth-brand">
          <div className="brand-mark" aria-hidden="true">
            <PawPrint />
          </div>
          <div className="brand-copy">
            <strong>Psi Pawer</strong>
            <span>Dobry początek wspólnych spacerów</span>
          </div>
        </div>
        <div className="login-mail-mark" aria-hidden="true">
          <KeyRound />
        </div>
        <span className="eyebrow">TWÓJ DOSTĘP</span>
        <h1>Witaj w Psi Pawer.</h1>
        {valid ? (
          <>
            <p>
              Otwórz swoje konto, a następnie ustaw własne hasło. Przy kolejnych
              wizytach zalogujesz się e-mailem i hasłem.
            </p>
            <ActionForm
              action={activateAccess}
              label="Otwórz konto i ustaw hasło"
              pendingLabel="Otwieram konto…"
            >
              <input type="hidden" name="token_hash" value={token} />
            </ActionForm>
            <p className="muted">
              To jednorazowy dostęp do konta. Nie przekazuj tego linku innym
              osobom.
            </p>
          </>
        ) : (
          <div className="alert red" role="alert">
            Ten link dostępu jest nieprawidłowy. Poproś o nowy link lub zaloguj
            się swoim hasłem.
          </div>
        )}
        <Link className="ghost-button" href="/login" prefetch={false}>
          Mam już hasło — przejdź do logowania →
        </Link>
      </section>
    </main>
  );
}
