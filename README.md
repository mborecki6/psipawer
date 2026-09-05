# Psi Pawer

Pierwszy etap aplikacji do spacerów socjalizacyjnych, oparty na Next.js 16.3.4 (App Router, TypeScript) i Supabase. Zachowuje paletę, geometrię, sidebar, karty i dashboard z dostarczonego prototypu.

## Stan projektu

Zaimplementowane: logowanie magic link, sesje SSR, oddzielne role i panele, uzupełnianie profilu, psy i kwestionariusze, prywatne zdjęcia, kwalifikacja psa, notatki z widocznością, tworzenie spacerów, zgłoszenia, zaproszenia administratora, akceptacja/odrzucenie/rezerwa, anulowanie z terminem, obecności, chroniona lokalizacja, KPI z filtrami, odczyt opublikowanych Psiutków i podgląd należności.

**Supabase podłączony w środowisku roboczym (5 września 2026).** Zastosowano wszystkie cztery migracje; sprawdzenie usługi potwierdziło RLS na wszystkich 15 tabelach oraz prywatny zasób zdjęć `dog-avatars`. Lokalna konfiguracja pozostaje poza repozytorium. Build z konfiguracją Supabase zakończył się poprawnie. Do ukończenia pozostają konfiguracja adresu powrotu po logowaniu, pierwsze konto administratora i weryfikacja wysyłki maili oraz pełnego przepływu użytkownika. Ustawienia uwierzytelniania w chmurze nie zostały zmienione.

Testy PostgreSQL uruchamiają migracje i RLS lokalnie w PGlite z minimalnymi atrapami schematów Auth/Storage; nie zastępują integracji z usługą ani równoległego testu wielosesyjnego.

`/demo` to **dostarczony prototyp referencyjny**, osadzony oddzielnie od aplikacji. Ma fikcyjne dane i lokalny zapis w przeglądarce. Nie jest panelem połączonym z bazą ani mechanizmem obejścia logowania. Prawdziwe panele `/admin` i `/app` nigdy nie przechodzą na dane demo. Nie wpisuj prawdziwych danych klientów w demo.

Finanse (wpłaty, automatyczne księgowanie, pakiety), edycja/moderacja Psiutków, zainteresowania i zarządzanie relacjami mają przygotowany schemat pod kolejny etap. Ostrzeżenia o istniejących relacjach są widoczne dla admina. Lista rezerwowa nie awansuje automatycznie. Nie ma czatu, AI, automatycznych płatności ani wielofirmowości.

## Uruchomienie bez Supabase

Wymagany Node.js 22 LTS lub nowszy i pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Otwórz `http://localhost:3000/demo`. Na `/login` zobaczysz informację o braku konfiguracji. Bez połączenia z Supabase nie jest wysyłany żaden e-mail.

## Podłączenie Supabase — projekt w chmurze

1. Utwórz nowy projekt na Supabase. Zapisz jego Project URL oraz klucz **publishable**.
2. Skopiuj `.env.example` do `.env.local` i uzupełnij:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://TWOJ-PROJEKT.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=TWOJ_KLUCZ_PUBLISHABLE
   SUPABASE_SECRET_KEY=
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   Aplikacja nie wymaga secret/service_role. `SUPABASE_SECRET_KEY` jest potrzebny wyłącznie opcjonalnemu skryptowi seed/testom lokalnym. Nigdy nie umieszczaj go w kodzie przeglądarki ani w repo.

3. Zastosuj po kolei **wszystkie cztery migracje** z `supabase/migrations/` w SQL Editorze. Alternatywnie użyj Supabase CLI: `supabase link --project-ref TWOJ_REF`, potem `supabase db push`. Używaj nowego projektu dedykowanego tej aplikacji.
4. W Authentication → URL Configuration ustaw Site URL identyczny z `NEXT_PUBLIC_APP_URL` i dodaj Redirect URL `http://localhost:3000/auth/callback`. Po wdrożeniu użyj docelowej domeny HTTPS. Nie mieszaj `localhost` i `127.0.0.1`: logowanie i callback muszą korzystać z tego samego hosta, ponieważ PKCE używa cookies.

   `supabase/config.toml` służy do lokalnego środowiska deweloperskiego. Nie publikuj całego pliku do chmury przez `supabase config push`: zawiera lokalne ustawienia potwierdzania e-maili. Adresy powrotu ustaw oddzielnie, zachowując ustawienia bezpieczeństwa projektu.
5. Włącz logowanie e-mail / magic link i możliwość samodzielnej rejestracji opiekunów. Zachowaj szablon magic link używający `{{ .ConfirmationURL }}`, aby Supabase przekierowało do callbacku PKCE z parametrem `code`. Na produkcji skonfiguruj własny SMTP i limity wysyłki w Supabase.
6. Uruchom ponownie serwer po zmianie środowiska. Otwórz adres z `NEXT_PUBLIC_APP_URL` i zaloguj się własnym e-mailem. Nowe konto zawsze otrzymuje rolę `client`, niezależnie od metadanych rejestracji.
7. Uzupełnij profil. Rolę behawiorysty nadaj ręcznie według poniższej instrukcji.

## Pierwsze konto behawiorysty

Utwórz konto w Authentication → Users lub zaloguj się przez aplikację. Skopiuj jego UUID, a następnie wykonaj jako administrator projektu w SQL Editorze:

```sql
update public.user_roles set role = 'admin'
where user_id = 'UUID_TWOJEGO_KONTA';
```

Nie istnieje publiczna rejestracja administratorów. Konto klienta zostaw z `role = 'client'`. Po ponownym wejściu admin trafia do `/admin`, klient do `/app`; oba konta muszą uzupełnić profil. Aplikacja nie oferuje formularza zmiany ról.

## Lokalny Supabase i dane demonstracyjne

Wymagany Docker i Supabase CLI:

```sh
supabase start
supabase db reset
```

Ustaw lokalne URL/klucze zwrócone przez CLI w `.env.local`. Lokalny panel jest dostępny pod `http://localhost:54323`, skrzynka Inbucket pod `http://localhost:54324`. `seed.sql` celowo nie tworzy użytkowników Auth. Opcjonalny skrypt tworzy ich kontrolowanie przez administracyjne API, a następnie dodaje fikcyjne psy, spacery, zgłoszenia, relacje i Kluskę w Psiutkach:

```sh
PSI_ALLOW_DEMO_SEED=yes node --env-file=.env.local scripts/seed-demo.mjs
```

Uruchamiaj go tylko w osobnym projekcie testowym. Skrypt używa `SUPABASE_SECRET_KEY`, nie wypisuje tokenów ani haseł. Każde uruchomienie tworzy nowe konta `@example.test`; lokalne linki logowania odczytasz w Inbucket. Po testach lokalne dane możesz usunąć przez `supabase db reset`.

## Reguły bezpieczeństwa

- `src/proxy.ts` odświeża sesję, lecz każda operacja i odczyt ponownie weryfikują użytkownika. Chronione layouty są dynamiczne. RLS jest ostateczną granicą dostępu.
- Osobne `user_roles` z zakazem publicznego zapisu. Profil opiekuna nie zawiera edytowalnej roli.
- Psy mają niezmienne przez klienta `guardian_id` i kwalifikację. Zwykłe aktualizacje są ograniczone grantami kolumnowymi. Krytyczna zmiana kwestionariusza ustawia `needs_review`, nie zdejmuje zawieszenia ani obowiązku konsultacji.
- Dokładna lokalizacja jest w osobnej tabeli `walk_private_details`. RLS ujawnia ją wyłącznie adminowi i opiekunowi zaakceptowanego psa. Opiekun nie widzi obcych zgłoszeń ani składu grupy.
- Zapisy i decyzje wykonują transakcyjne funkcje SQL. Blokada rekordu spaceru, unikalność `(walk_id, dog_id)` i trigger pojemności zabezpieczają limit także poza UI. Zakwalifikuj psa przed akceptacją. Automatyczny tryb przyjmuje wyłącznie zakwalifikowane psy.
- Autor, czas i historia decyzji są przechowywane. Obecność jest niezależna od statusu zgłoszenia. Kwoty to całkowite grosze, terminy to `timestamptz`, a czas biznesowy to `Europe/Warsaw`.
- Zdjęcia trafiają do prywatnego bucketu `dog-avatars`, z ograniczeniami typu, rozmiaru i własności; dostęp przez krótkotrwały podpisany URL. Publiczne Psiutki nie korzystają z prywatnego bucketu ani danych kontaktowych.
- Moduły finansowe na etapie pierwszym są tylko do odczytu; księgowanie pakietów wymaga przyszłych audytowanych funkcji, a saldo będzie liczone z `package_transactions`.

## Sprawdzenie projektu

```sh
pnpm lint
pnpm test
pnpm build
pnpm start
```

Testy jednostkowe i testy rzeczywistych polityk PostgreSQL/RLS działają bez Supabase. Pokrywają własność, role, prywatne notatki/lokalizację, storage, duplikaty, akceptację, pojemność, odwołanie, kwestionariusz i strefę czasową.

Pełny Playwright flow jest w `tests/e2e/registration.spec.ts`: dwa konta logują się rzeczywistymi magic linkami odczytanymi z lokalnego Inbucket, opiekun tworzy psa, admin kwalifikuje psa i tworzy spacer, opiekun zgłasza psa, admin akceptuje, a lokalizacja staje się widoczna. Test tworzy i sprząta własne rekordy. Wymaga lokalnego Supabase, uruchomionej aplikacji z tym samym środowiskiem i przeglądarki Playwright:

```sh
pnpm exec playwright install chromium
node --env-file=.env.local node_modules/@playwright/test/cli.js test
```

Bez lokalnego Supabase test jest oznaczany jako pominięty. Wysyłka poczty i Auth nie są symulowane jako sukces. Weryfikacja WebMCP nie była dostępna; opcjonalna nawigacja WebMCP nie wpływa na bezpieczeństwo ani podstawowe działanie aplikacji.

## Wdrożenie

To pełna aplikacja Next.js z serwerem, nie eksport statyczny. Wdróż ją na hostingu obsługującym Next.js/Node (np. standardowy runtime Node lub Vercel). Ustaw publiczne zmienne środowiskowe **przed buildem**, a potem popraw URL aplikacji i callback w Supabase. Nie używaj static export ani publicznego hostingu katalogu `.next`. Przy własnym serwerze Node uruchom `pnpm build`, a następnie `pnpm start`; zachowaj katalogi `public`, `.next` i zależności produkcyjne.

Nie opublikowano wdrożenia produkcyjnego. Sites wymaga formatu Cloudflare Worker lub statycznego eksportu; ten projekt zachowuje wymagany Next.js z jego serwerem. Dostosowanie hostingu nie powinno zastępować aplikacji samym prototypem.

## Źródła i dalsze prace

Wzorem jest dostarczony `PSI_PAWER_CODEX_HANDOFF.md`; prototyp w `public/reference/prototype.html` został odseparowany od aplikacji i ma zneutralizowane dane kontaktowe. Lockup marki jest zgodny z wariantem zastępczym z dokumentu; docelowy oryginalny asset logo można podmienić po jego dostarczeniu. Dokumentacja: [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs).

Po podłączeniu Supabase: uruchom pełny flow i test konkurencyjnych akceptacji na dwóch niezależnych połączeniach, sprawdź zdjęcia/SMTP, zatwierdź wygląd rzeczywistych paneli na komputerze i telefonie, następnie wdrażaj. Etap drugi: wpłaty i pakiety, moderacja i zainteresowania Psiutków, edycja relacji, zmiana/odwołanie całego terminu oraz paginacja danych przy większej skali.
