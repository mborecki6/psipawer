# Psi Pawer

Pierwszy etap aplikacji do spacerów socjalizacyjnych, oparty na Next.js 16.3.4 (App Router, TypeScript) i Supabase. Zachowuje paletę, geometrię, sidebar, karty i dashboard z dostarczonego prototypu.

## Stan projektu

Zaimplementowane: logowanie magic link, sesje SSR, oddzielne role i panele, uzupełnianie profilu, psy i kwestionariusze, prywatne zdjęcia, kwalifikacja psa, notatki z widocznością, tworzenie spacerów, zgłoszenia, zaproszenia administratora, akceptacja/odrzucenie/rezerwa, anulowanie z terminem, obecności, chroniona lokalizacja, KPI z filtrami, odczyt opublikowanych Psiutków, rozliczenia i pakiety z historią operacji.

**Supabase podłączony w środowisku roboczym (5 września 2026).** Zastosowano migracje podstawy oraz aktualizacje obsługi spacerów; sprawdzenie usługi potwierdziło RLS na wszystkich 15 tabelach oraz prywatny zasób zdjęć `dog-avatars`. Lokalna konfiguracja pozostaje poza repozytorium. Build z konfiguracją Supabase zakończył się poprawnie. Konto administratora jest utworzone, a publiczny callback zweryfikowano 8 września. Do ukończenia pozostają konfiguracja SMTP i weryfikacja pełnego przepływu użytkownika. Potwierdzanie e-maili pozostaje włączone.

Testy PostgreSQL uruchamiają migracje i RLS lokalnie w PGlite z minimalnymi atrapami schematów Auth/Storage; nie zastępują integracji z usługą ani równoległego testu wielosesyjnego.

`/demo` to **dostarczony prototyp referencyjny**, osadzony oddzielnie od aplikacji. Ma fikcyjne dane i lokalny zapis w przeglądarce. Nie jest panelem połączonym z bazą ani mechanizmem obejścia logowania. Prawdziwe panele `/admin` i `/app` nigdy nie przechodzą na dane demo. Nie wpisuj prawdziwych danych klientów w demo.

Edycja/moderacja Psiutków, zainteresowania i zarządzanie relacjami mają przygotowany schemat pod kolejny etap. Ostrzeżenia o istniejących relacjach są widoczne dla admina. Lista rezerwowa nie awansuje automatycznie. Nie ma czatu, AI, automatycznych płatności ani wielofirmowości.

## Wersja internetowa do testów

Adres: https://psipawer.vercel.app — opublikowano na Vercel 5 września 2026. Publiczny formularz logowania odpowiada poprawnie; wejście do panelu administratora bez sesji przekierowuje na logowanie. Supabase URL i klucz publishable są zapisane w konfiguracji hostingu, bez klucza administratora.

Pełne logowanie testerów wymaga własnej wysyłki SMTP: domyślna poczta Supabase obsługuje tylko adresy członków organizacji. Publiczny callback `https://psipawer.vercel.app/auth/callback` jest zapisany w Supabase Auth. Nie potwierdzono jeszcze pełnego logowania przez pocztę.

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

3. Zastosuj po kolei **wszystkie migracje** z `supabase/migrations/` w SQL Editorze. Alternatywnie użyj Supabase CLI: `supabase link --project-ref TWOJ_REF`, potem `supabase db push`. Używaj nowego projektu dedykowanego tej aplikacji.
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
- Finanse można zmieniać wyłącznie przez audytowane funkcje administratora. Saldo pakietu wynika z `package_transactions`; zapis wpłaty ma klucz idempotencji i blokadę należności zapobiegającą nadpłacie. Klient odczytuje wyłącznie swoje rozliczenia.

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

Wersja internetowa działa na Vercel. Sites wymaga formatu Cloudflare Worker lub statycznego eksportu; ten projekt zachowuje wymagany Next.js z jego serwerem. Dostosowanie hostingu nie powinno zastępować aplikacji samym prototypem.

## Źródła i dalsze prace

Wzorem jest dostarczony `PSI_PAWER_CODEX_HANDOFF.md`; prototyp w `public/reference/prototype.html` został odseparowany od aplikacji i ma zneutralizowane dane kontaktowe. Lockup marki jest zgodny z wariantem zastępczym z dokumentu; docelowy oryginalny asset logo można podmienić po jego dostarczeniu. Dokumentacja: [Next.js Proxy](https://nextjs.org/docs/app/getting-started/proxy), [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs).

Po podłączeniu Supabase: uruchom pełny flow i test konkurencyjnych akceptacji na dwóch niezależnych połączeniach, sprawdź zdjęcia/SMTP, zatwierdź wygląd rzeczywistych paneli na komputerze i telefonie, następnie wdrażaj. Etap drugi: moderacja i zainteresowania Psiutków, edycja relacji, zarządzanie statusem całego terminu oraz paginacja danych przy większej skali.

## Aktualizacja 8 września — odwołanie terminu

Behawiorysta może odwołać przyszły spacer z jego szczegółów. Powód i potwierdzenie są obowiązkowe. Baza atomowo zamyka aktywne zgłoszenia, usuwa niezapłacone należności tych zgłoszeń i zwraca zarezerwowane wejścia z pakietów. Wpłaty pozostają w historii — odwołanie nie oznacza wykonania zwrotu pieniędzy. Powód jest widoczny w szczegółach odwołanego spaceru; uczestników należy powiadomić osobno. Odwołanie rozpoczętego terminu jest blokowane. Testy: 35 zakończonych poprawnie, lint i build poprawne.

## Edycja terminów i jakość formularzy

Behawiorysta może edytować przyszły spacer lub utworzyć kolejny na podstawie wcześniejszego. Kopia wymaga nowej daty i nie przenosi uczestników ani rozliczeń. Edycja zapisuje opis zmiany dla klientów; zapis z nieaktualnej karty jest odrzucany, a limit nie może spaść poniżej zaakceptowanego składu. Po pierwszym zgłoszeniu cena, tryb zapisów i liczba godzin bezpłatnego odwołania pozostają zablokowane. Przy przesunięciu terminu istniejące zaakceptowane zgłoszenia zachowują korzystniejszy termin bezpłatnej rezygnacji (przed faktycznym rozpoczęciem spaceru). Opiekun widzi ten termin w swoim zgłoszeniu.

Decyzji o zgłoszeniu nie można zmieniać po rozpoczęciu spaceru; obecność nadal można skorygować. Odwołanie przez organizatora usuwa także niezapłacone opłaty za wcześniejszą późną rezygnację. Zapisane wpłaty i zwroty pozostają w historii. Wysyłka wiadomości do uczestników nadal wymaga konfiguracji zewnętrznego dostawcy.

Ekran logowania ma układ dopasowany do telefonu i komputera. Nieudany zapis formularza zachowuje tekst, wybory i wybrany plik; błędy otrzymują fokus. Nie promujemy fikcyjnego demo na skonfigurowanej stronie logowania. Kontrola: 48 testów jednostkowych/SQL, lint i build przeszły. Zachowanie formularzy sprawdzono dodatkowo w izolowanym teście prawdziwej przeglądarki. Widok logowania obejrzano przy szerokości 390 px i na komputerze. Nie jest to jeszcze potwierdzenie pełnego procesu logowania przez e-mail ani wszystkich ekranów na rzeczywistych kontach.

Do pełnego pilotażu pozostają: konfiguracja poczty i próba od logowania po rezerwację, edycja relacji psów, moderacja Psiutków oraz przegląd rzeczywistych paneli z behawiorystą. Przywracanie zgłoszeń w kontrolowanej ścieżce administratora i ostrzeżenia kwalifikacji opisano niżej. Te punkty nie są oznaczone jako ukończone przez same testy podstawy.


## Rozliczenia i pakiety

`/admin/finance` pozwala przydzielać pakiety, odnotowywać wpłaty częściowe i pełne oraz rezerwować wejście dla zaakceptowanego przyszłego zgłoszenia tego samego psa. `/app/finance` pokazuje opiekunowi jego należności, salda i historię. Cena pakietu jest osobną należnością — przydzielenie pakietu nie oznacza otrzymania pieniędzy. Aplikacja prowadzi ewidencję środków otrzymanych poza nią; nie wykonuje przelewów i nie jest systemem fakturowania.

- Rezerwacja przenosi jedno wejście z dostępnych do zarezerwowanych. Obecność i płatna nieobecność je zużywają. Usprawiedliwiona nieobecność zwalnia wejście i niezapłaconą należność.
- Odwołanie w terminie zwraca wejście; późne odwołanie je zużywa. Odwołanie całego spaceru przez organizatora zwraca również wejście zużyte wskutek wcześniejszej późnej rezygnacji.
- Korekta obecności przelicza tylko różnicę; ponowienie tej samej operacji nie pobiera kolejnego wejścia. Przy braku wejścia cofnięcie usprawiedliwienia jest atomowo odrzucane.
- Ważność pakietu jest sprawdzana przy nowym przydziale. Wejście zarezerwowane przed wygaśnięciem można później rozliczyć.
- Błędnie przypisane wejście można odłączyć przed spacerem z obowiązkowym powodem, przywracając pojedynczą należność. Niewykorzystany i niezarezerwowany pakiet można anulować z wpisem do historii.
- Korekta lub zwrot wpłaty wymaga powodu, zachowuje oryginalną kwotę, metodę i datę oraz przelicza należność. Operacja dotyczy całego wpisu; korektę kwoty wykonuje się przez odwrócenie błędnego wpisu i zapis właściwego. Pieniądze zwraca się poza aplikacją. Otrzymane wpłaty za odwołane zdarzenia są oznaczone do sprawdzenia.

Notatki wpłat, powody zwrotów oraz historia wejść są widoczne opiekunowi. Wewnętrzne notatki przyznania/przypisania pakietu trafiają do audytu administratora. Dane finansowe są pobierane stronicami, aby uniknąć cichego obcięcia historii przez domyślny limit API.

## Odzyskiwanie zgłoszeń i widoczne ostrzeżenia

Po wycofaniu lub rezygnacji w terminie behawiorysta może przywrócić zgłoszenie do decyzji, podając powód. Nie akceptuje to psa automatycznie: kwalifikacja i pojemność są sprawdzane ponownie przy akceptacji. Wpłaty i historia pozostają powiązane z tym samym zgłoszeniem; poprzedni pakiet trzeba ponownie wybrać w rozliczeniach. Późne rezygnacje nie mają tej opcji ze względu na istniejące rozliczenie.

Zmiana kwalifikacji psa już przyjętego na przyszły spacer wyświetla ostrzeżenie w pulpitach i szczegółach obu ról. Prowadząca otrzymuje linki do profilu i zgłoszenia, a klient prośbę o kontakt bez prywatnych notatek. Ostrzeżenie nie odwołuje samodzielnie rezerwacji i nie zmienia pieniędzy — decyzja pozostaje u behawiorysty.


Kontrola aktualizacji rozliczeń: 89 testów jednostkowych/SQL przeszło, podobnie lint i kompilacja produkcyjna. Migracje `202609080004` i `202609080005` zastosowano w podłączonej bazie 8 września. Dodatkowy test na rzeczywistym Supabase potwierdził zakup pakietu, idempotentną częściową wpłatę, rezerwację, rezygnację, przywrócenie, odpięcie pakietu, anulowanie, korektę wpłaty i izolację dwóch opiekunów. Cała transakcja wraz z fikcyjnymi kontami została wycofana. To test operacji bazy, nie pełnego logowania przez e-mail ani wielu równoległych sesji.

Widoki finansów oraz ostrzeżenia/formularz przywrócenia sprawdzono w izolowanej przeglądarce z rzeczywistymi komponentami i fikcyjnymi danymi przy szerokościach 1440, 390 i 320 px, również z długim imieniem psa. Brak poziomego przewijania; klient nie otrzymuje formularzy administratora. W tej kontroli wizualnej akcje były atrapami — ich działanie sprawdzają oddzielne testy bazy. Błąd pobrania panelu zachowuje jego nawigację, a ponowienie faktycznie pobiera dane ponownie.
