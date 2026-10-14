import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ActionForm, Field } from "@/components/action-form";
import { requireSession } from "@/lib/auth/session";
import { updateOwnProfile } from "@/modules/profile/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Twój profil — Psi Pawer",
  robots: { index: false, follow: false, nocache: true },
};

export default async function Profile() {
  const { user, profile, role } = await requireSession(undefined, false);
  const panelHref = role === "admin" ? "/admin" : "/app";

  return (
    <main className="auth-page">
      <section className="card auth-card">
        <Link className="ghost-button" href={panelHref}>
          <ArrowLeft size={16} aria-hidden="true" />
          Wróć do panelu
        </Link>
        <h1>Twój profil</h1>
        <p>Tu możesz zmienić swoje dane i okolicę spacerów.</p>
        <ActionForm
          action={updateOwnProfile}
          label="Zapisz zmiany"
          pendingLabel="Zapisuję zmiany…"
        >
          <Field
            name="full_name"
            label="Imię i nazwisko"
            value={profile.full_name || ""}
            autoComplete="name"
            maxLength={120}
            hint="Ta nazwa jest widoczna w Twoim panelu."
            required
          />
          <Field
            name="phone"
            label="Telefon"
            type="tel"
            value={profile.phone || ""}
            maxLength={20}
            required
          />
          <Field
            name="area"
            label="Okolica (np. Wrocław, Krzyki)"
            value={profile.area || ""}
            maxLength={120}
            required
          />
          <Field
            name="email"
            label="E-mail do logowania"
            type="email"
            value={user.email || ""}
            hint="Adres logowania pozostaje bez zmian."
            readOnly
          />
        </ActionForm>
        <Link className="ghost-button" href={panelHref}>
          Anuluj i wróć do panelu
        </Link>
      </section>
    </main>
  );
}
