# Odzyskanie dostępu do konta

Stan lokalny: 19.09.2026. Dodano proces odzyskania hasła, nie uruchamiając wysyłki do klientów ani zmian w opublikowanej aplikacji.

## Przebieg

Link **Nie pamiętam hasła** na ekranie logowania prowadzi do `/forgot-password`. Gdy poczta jest włączona, użytkownik podaje adres. Niezależnie od istnienia konta oraz wyniku dostawcy zobaczy taką samą, warunkową informację o wiadomości. Błędy SMTP i limitu wysyłki nie ujawniają, czy adres ma konto. Log aplikacji zawiera wyłącznie stałą nazwę zdarzenia, bez adresu, tokenu i treści odpowiedzi dostawcy.

Wiadomość prowadzi do `/auth/recovery?token_hash=…`. Samo otwarcie linku wyświetla przycisk potwierdzający i nie weryfikuje tokenu. Dopiero wysłanie formularza potwierdza token stałego typu `recovery`, tworzy sesję i otwiera zmianę hasła. Wygasły, wykorzystany lub niepoprawny link daje możliwość zamówienia nowego.

Ustawienie hasła wymaga aktualnej, zweryfikowanej sesji. Formularz pokazuje jej adres e-mail; nie przyjmuje identyfikatora cudzej osoby. Nowe hasło ma 12–128 znaków i wymaga powtórzenia. Po zapisie użytkownik widzi potwierdzenie i przechodzi do panelu swojej roli lub do uzupełnienia profilu, jeśli jest niekompletny.

## Konfiguracja

- `AUTH_EMAIL_ENABLED=false` jest wartością domyślną. Przy wyłączonej poczcie ekran wyjaśnia możliwość uzyskania jednorazowego dostępu od prowadzącej. Nie wywołuje wysyłki Supabase.
- `scripts/local-env.mjs` ustawia `AUTH_EMAIL_ENABLED=true` wyłącznie razem ze zweryfikowanymi lokalnymi adresami. Lokalne wiadomości trafiają do skrzynki testowej stosu, nie do prawdziwych klientów. Sam helper nie uruchamia stosu.
- W `supabase/config.toml` dodano szablon `supabase/templates/recovery.html`, dozwolone lokalne adresy odzyskania oraz wyłączono publiczną rejestrację. Nowe konta pilota będą tworzone przez zaproszenia.
- Szablon używa `{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}`. **Site URL w konfiguracji Auth musi wskazywać właściwy adres aplikacji**. Nie dopisujemy parametrów do `.RedirectTo`, który może już zawierać parametry przepływu logowania. Nie używamy automatycznie konsumowanego `.ConfirmationURL`.
- Po zmianie lokalnych szablonów/konfiguracji Auth należy ponownie uruchomić lokalne usługi. Nie jest do tego potrzebne kasowanie danych. Konfiguracji chmury ani szablonów produkcyjnych nie zmieniano.
- Przed przyszłym włączeniem poczty w chmurze trzeba oddzielnie skonfigurować SMTP, Site URL, dozwolone adresy i ten szablon oraz sprawdzić rzeczywiste dostarczenie i cały proces na kontach testowych. Samo ustawienie flagi nie konfiguruje dostawcy.

Strony linków dostępowych, odzyskiwania i zmiany hasła mają `no-referrer`, `no-store` oraz zakaz indeksowania. Nie wczytują zewnętrznych obrazów w szablonie e-mail. Docelowy adres wynika z konfiguracji serwera, a nie pól formularza ani nagłówka Host. Niezgodna para lokalnej aplikacji i zdalnej bazy blokuje rozpoczęcie wysyłki.

Limity wysyłania egzekwuje Supabase Auth; aplikacja nie ma jeszcze własnego limitera ani CAPTCHA. Interfejs sugeruje odczekanie przed ponowną prośbą. Nie obiecujemy unieważnienia wszystkich innych sesji po zmianie hasła.

## Sprawdzenie i ograniczenia

Testy autoryzacji obejmują wyłączoną pocztę, nieprawidłową konfigurację adresów, neutralne odpowiedzi dostawcy, niepoprawne i powielone pola, stały typ tokenu, GET bez zużywania tokenu, POST z potwierdzeniem oraz ekran sukcesu po zapisie. Lokalna próba HTTP z wyłączoną pocztą potwierdziła poprawne ekrany oraz nagłówki prywatności.

01.10.2026 test `tests/e2e/invitation-recovery.spec.ts` przeszedł przez rzeczywisty lokalny Auth i Mailpit: odbiór zaproszenia, aktywację, hasło, profil, konsultację i zalecenia na telefonie, nowe logowanie, odzyskanie dostępu i ponowne otwarcie tych samych zaleceń nowym hasłem. Sprawdził też odrzucenie starego hasła oraz ponownego użycia wykorzystanych linków. Dwukrotne GET każdego linku przed aktywacją nie zużyło tokenu ani nie ustawiło sesji; odpowiedzi miały `no-referrer`. Śledzenie przeglądarki jest wyłączone. Asercje przekierowania porównują bezpieczny wynik zamiast drukować aktualny URL, który może jeszcze zawierać token. Odbiorcy są fikcyjni, wiadomości pozostają lokalnie. Rzeczywiste wygaśnięcie i ponowienie zaproszenia oraz dostawca zewnętrzny wymagają odrębnej weryfikacji.

Podstawa implementacji: [Supabase — hasła](https://supabase.com/docs/guides/auth/passwords), [zmienne szablonów i ochrona przed automatycznym otwieraniem](https://supabase.com/docs/guides/auth/auth-email-templates), [lokalne szablony](https://supabase.com/docs/guides/local-development/customizing-email-templates). Sprawdzono także zachowanie użytej w projekcie biblioteki Auth JS 2.115.0.
