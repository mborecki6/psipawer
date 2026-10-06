import Link from "next/link";
import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { authEmailOrigin } from "@/lib/auth/email-config";
import { requestPasswordRecovery } from "@/lib/auth/recovery-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Odzyskaj dostęp — Psi Pawer",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default function ForgotPassword() {
  const available = Boolean(authEmailOrigin());
  return (
    <main className="auth-page">
      <section className="card auth-card">
        <div className="login-mail-mark" aria-hidden="true">
          <Mail />
        </div>
        <span className="eyebrow">TWOJE KONTO</span>
        <h1>Nie pamiętasz hasła?</h1>
        {available ? (
          <>
            <p>
              Podaj e-mail, którego używasz w Psi Pawer. W wiadomości znajdziesz
              link do ustawienia nowego hasła.
            </p>
            <ActionForm
              action={requestPasswordRecovery}
              label="Wyślij link do zmiany hasła"
              pendingLabel="Przyjmuję prośbę…"
            >
              <Field
                name="email"
                label="Twój e-mail"
                type="email"
                autoComplete="username"
                inputMode="email"
                maxLength={254}
                required
              />
            </ActionForm>
            <p className="muted">
              Użyj najnowszej wiadomości. Przed ponowną prośbą o link odczekaj
              co najmniej minutę.
            </p>
          </>
        ) : (
          <div className="alert" role="status">
            Odzyskiwanie hasła przez e-mail nie jest jeszcze dostępne. Poproś
            prowadzącą lub osobę, która udostępniła Ci aplikację, o nowy
            jednorazowy link dostępu.
          </div>
        )}
        <Link className="ghost-button" href="/login" prefetch={false}>
          Wróć do logowania
        </Link>
      </section>
    </main>
  );
}
