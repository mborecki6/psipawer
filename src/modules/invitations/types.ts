export const deliveryLabels = {
  draft: "Przygotowane",
  sending: "Wysyłka w toku",
  sent: "Wysyłka przyjęta",
  failed: "Błąd wysyłki",
  uncertain: "Wynik nieznany",
};
export const accountLabels = {
  not_activated: "Oczekuje na aktywację",
  password_required: "Do ustawienia hasło",
  password_unverified: "Ustawienie hasła niepotwierdzone",
  profile_required: "Do uzupełnienia profil",
  ready: "Gotowe do korzystania",
  staff_account: "Konto zespołu",
};
export type Invitation = {
  id: string;
  email: string;
  display_name: string;
  version: number;
  delivery_status: keyof typeof deliveryLabels;
  last_attempt_at: string | null;
  last_sent_at: string | null;
  last_error_code: string | null;
  created_at: string;
  account_stage: keyof typeof accountLabels;
  can_send: boolean;
  archived_at: string | null;
  can_archive: boolean;
};
export type InvitationAttempt = {
  id: string;
  started_at: string;
  finished_at: string | null;
  outcome: Exclude<keyof typeof deliveryLabels, "draft">;
  error_code: "rejected" | "rate_limited" | "unknown_result" | null;
  author_name: string;
};
export const deliveryErrorLabels = {
  rejected:
    "Serwer nie przyjął zaproszenia. Sprawdź adres i ustawienia poczty.",
  rate_limited: "Serwer ograniczył liczbę wiadomości. Ponów próbę później.",
  unknown_result: "Brak potwierdzenia wyniku. Wiadomość mogła już dotrzeć.",
};
