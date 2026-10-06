import Link from "next/link";
import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { acceptInvitation } from "@/lib/auth/invitation-actions";
import { isConfigured } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Zaproszenie — Psi Pawer",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};
export default async function Invitation({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await searchParams;
  const token = p.token_hash;
  const valid =
    typeof token === "string" &&
    /^[A-Za-z0-9_-]{32,256}$/.test(token) &&
    !["type", "redirect", "redirect_to", "redirectTo", "next", "code"].some(
      (key) => key in p,
    ) &&
    isConfigured();
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <span className="eyebrow">ZAPROSZENIE DO PSI PAWER</span>
        <h1>Witaj. Zacznijmy od Twojego konta.</h1>
        {valid ? (
          <>
            <p>
              Przyjmij zaproszenie, ustaw własne hasło i uzupełnij dane. Potem
              dodasz profil swojego psa.
            </p>
            <ActionForm
              action={acceptInvitation}
              label="Przyjmij zaproszenie"
              pendingLabel="Otwieram konto…"
            >
              <input type="hidden" name="token_hash" value={token} />
            </ActionForm>
            <p className="muted">
              Link jest jednorazowy i przeznaczony tylko dla Ciebie.
            </p>
          </>
        ) : (
          <p className="alert red" role="alert">
            Ten link jest nieprawidłowy. Otwórz najnowszą wiadomość albo poproś
            prowadzącą o nowe zaproszenie.
          </p>
        )}
        <Link className="ghost-button" href="/login" prefetch={false}>
          Mam już konto — zaloguj się
        </Link>
      </section>
    </main>
  );
}
