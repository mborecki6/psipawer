# Psi Pawer

Aplikacja do organizacji spacerów socjalizacyjnych i pracy behawiorysty. Stos: Next.js App Router, TypeScript, React, Supabase Auth/PostgreSQL/Storage. Wygląd zachowuje ciepłą paletę i układ dostarczonego prototypu.

## Zakres pilota i stan wdrożenia

Obecny pilot jest przeznaczony dla administratora i behawiorystki. Oboje korzystają z roli `admin`; aplikacja ma również rolę `client` i panel opiekuna, ale zapraszanie klientów oraz konfiguracja SMTP są odłożone. Ograniczony skład pilota jest zasadą organizacyjną, nie dodatkową rolą ani automatyczną listą dozwolonych kont.

Podstawową metodą logowania jest e-mail i hasło. Pierwszy dostęp można nadać przez jednorazowy link aktywacyjny, bez wysyłania poczty z aplikacji. Nie ma publicznej rejestracji administratorów ani formularza zmiany ról.

**Wersja pilota działa pod [psipawer.vercel.app](https://psipawer.vercel.app/login).** Migracje do `202609080009` zastosowano w docelowej bazie. Kompilacja produkcyjna, ESLint i 145 testów zakończyły się poprawnie. Transakcyjne testy rzeczywistego Supabase potwierdziły zgody, moderację, wzajemność propozycji, prywatność, audyt relacji i odrzucanie nieaktualnych zmian spaceru; dane testowe wycofano. Publiczne logowanie odpowiada, a chronione strony przekierowują niezalogowane osoby do formularza.

Listy psów, spacerów i zgłoszeń pobierają wszystkie strony wyników, także po przekroczeniu limitu pojedynczej odpowiedzi API. Ostrzeżenia o relacjach uwzględniają aktywne zgłoszenia. Komunikaty zmiany i odwołania spaceru sprawdzono również na telefonie przy szerokości 320 i 390 px.

Nadal pozostają przygotowanie dostępu behawiorystki i pełne sprawdzenie aktywacji, ustawienia hasła oraz prawdziwego uploadu zdjęć z sesji testowej. Nie są one oznaczone jako ukończone przez testy z atrapami. SMTP i klienci pozostają poza bieżącym pilotem.

## Moduły aplikacji

| Obszar | Zakres |
| --- | --- |
| Konta | Sesje SSR, logowanie hasłem, jednorazowa aktywacja, ustawienie własnego hasła, uzupełnianie profilu, role administratora i opiekuna. |
| Psy | Profile, kwestionariusze, kwalifikacja, prywatne zdjęcia i notatki o określonej widoczności. |
| Spacery | Tworzenie, edycja i kopiowanie przyszłych terminów, zgłoszenia, zaproszenia, decyzje administratora, rezerwa, rezygnacje, odwołanie terminu i obecności. |
| Rozliczenia | Należności, częściowe wpłaty, zwroty/korekty, pakiety wejść, rezerwacja i odłączenie wejścia, anulowanie niewykorzystanego pakietu oraz historia. |
| Relacje psów | Prywatne oceny par, notatki, data ostatniego spotkania, historia zmian i ostrzeżenia przy planowaniu grup. |
| Psiutki | Wizytówki społecznościowe, osobne zdjęcia i zgody, moderacja, ukrywanie profili, zainteresowania i ocena wzajemnych propozycji przez behawiorystę. |

Panele działają pod `/admin` i `/app`. Finanse znajdują się pod odpowiednim `/finance`, Psiutki pod `/community`, a zarządzanie prywatnymi relacjami wyłącznie pod `/admin/relations`.

### Zasady spacerów i zgłoszeń

- Akceptacja sprawdza kwalifikację psa oraz pojemność grupy. Lista rezerwowa nie awansuje automatycznie.
- Edytować można przyszły termin. Nieaktualna wersja formularza jest odrzucana, a limit nie może spaść poniżej zaakceptowanego składu. Po pierwszym zgłoszeniu cena, tryb zapisów i liczba godzin bezpłatnej rezygnacji pozostają zablokowane.
- Przy przesunięciu terminu istniejące zaakceptowane zgłoszenie zachowuje korzystniejszy termin bezpłatnej rezygnacji, przed faktycznym rozpoczęciem spaceru. Opis zmiany jest widoczny opiekunowi.
- Kopia spaceru wymaga nowej daty; nie przenosi uczestników ani rozliczeń.
- Odwołanie przyszłego spaceru wymaga powodu. Atomowo zamyka aktywne zgłoszenia, usuwa niezapłacone należności związane z odwołanym terminem i zwraca odpowiednie wejścia z pakietów. Zapisane wpłaty pozostają w historii; odwołanie nie wykonuje zwrotu pieniędzy.
- Wycofane zgłoszenie lub rezygnację w terminie administrator może przywrócić do decyzji, podając powód. Nie akceptuje to psa automatycznie. Wpłaty i historia pozostają przy zgłoszeniu; pakiet trzeba wybrać ponownie. Późna rezygnacja nie podlega tej ścieżce.
- Decyzji o zgłoszeniu nie można zmieniać po rozpoczęciu spaceru; obecność można skorygować.
- Zmiana kwalifikacji psa już przyjętego na przyszły spacer wyświetla ostrzeżenie obu rolom. Nie odwołuje automatycznie rezerwacji ani nie zmienia rozliczeń. Opiekun otrzymuje prośbę o kontakt bez prywatnych notatek behawiorysty.

### Zasady rozliczeń

Aplikacja ewidencjonuje pieniądze otrzymane poza nią. Nie wykonuje płatności, przelewów ani zwrotów i nie jest systemem fakturowania. Kwoty są przechowywane jako całkowite grosze.

- Cena pakietu stanowi osobną należność. Przyznanie pakietu nie oznacza opłacenia go; aktywne wejścia mogą być używane przed pełną zapłatą.
- Wejście można przypisać zaakceptowanemu przyszłemu zgłoszeniu tego samego psa. Rezerwacja zmniejsza pulę dostępną, a obecność lub płatna nieobecność zużywa wejście.
- Rezygnacja w terminie i usprawiedliwiona nieobecność zwalniają wejście. Późna rezygnacja je zużywa; odwołanie całego terminu przez organizatora zwraca także takie wejście.
- Korekta obecności rozlicza różnicę. Ponowienie tej samej operacji nie zużywa kolejnego wejścia. Brak salda przy ponownym obciążeniu powoduje atomowe odrzucenie zmiany.
- Ważność pakietu jest sprawdzana przy nowym przydziale. Wejście zarezerwowane przed wygaśnięciem można później rozliczyć.
- Błędny przydział można odłączyć przed spacerem z obowiązkowym powodem, przywracając pojedynczą należność. Niewykorzystany i niezarezerwowany pakiet można anulować z powodem.
- Wpłaty mogą być częściowe. Klucz idempotencji oraz blokada należności chronią przed ponowieniem i nadpłatą. Korekta/zwrot odwraca cały wpis i wymaga powodu; zmianę kwoty wykonuje się przez odwrócenie błędnego wpisu i zapis właściwego.
- Wpłaty wymagające sprawdzenia po odwołaniu lub zmianie rozliczenia są oznaczane. Rzeczywisty zwrot należy wykonać oddzielnie.

Opiekun widzi własne należności, pakiety, wpłaty, powody korekt i historię wejść. Wewnętrzne notatki przyznania/przypisania pakietu pozostają w audycie administratora. Pobieranie finansów odbywa się stronicami, aby uniknąć cichego obcięcia historii przez limit API.

### Relacje i Psiutki

Prywatna ocena relacji dotyczy pary psów niezależnie od kolejności ich wyboru. Zapis wymaga notatki, sprawdza wersję wcześniejszej oceny i nie pozwala podać przyszłej daty ostatniego spotkania. Oceny oraz ich historia są dostępne wyłącznie administratorowi. Nie są publikowane w Psiutkach.

Wizytówka Psiutka jest osobnym zestawem treści, widocznym po zatwierdzeniu dla zalogowanych użytkowników. Nie należy wpisywać telefonu, dokładnego adresu, danych zdrowotnych ani prywatnych zaleceń. Opiekun może tworzyć i edytować wyłącznie własną wizytówkę; administrator moderuje treść, ale nie edytuje cudzej wizytówki jako właściciel.

Każdy zapis wymaga jawnej zgody i ponownego sprawdzenia. Zmiana opisu lub zdjęcia wycofuje publikację do czasu moderacji. Ukrycie przez właściciela cofa zgodę; ukrycie przez administratora pozostawia zgodę, lecz usuwa profil z katalogu. Moderacja odrzucenia przekazuje opiekunowi wskazówki do poprawy.

Zdjęcia społecznościowe trafiają do osobnego prywatnego zasobu `community-avatars`. Nie są kopiowane z dokumentacji psa. Upload przyjmuje JPG, PNG lub WebP do 1,5 MB i 16 megapikseli; serwer sprawdza i przetwarza obraz do WebP, ogranicza rozmiar oraz usuwa metadane EXIF/GPS. Właściciel może także usunąć zdjęcie z wizytówki przy zapisie.

Zainteresowanie wymaga własnej opublikowanej wizytówki i nie może dotyczyć drugiego psa tego samego opiekuna. Wzajemna propozycja trafia do oceny behawiorysty. Po zmianie lub ukryciu profilu wymagane jest ponowne potwierdzenie zainteresowania aktualnymi treściami. Wycofanie propozycji nie omija aktywnej negatywnej oceny pary. Zgłoszenie zainteresowania zapisuje dane w aplikacji — nie wysyła wiadomości do innych osób.

## Instalacja i środowisko

Wymagane: Node.js 22 lub nowszy oraz pnpm. Zależności są określone w `package.json` i `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
```

Uzupełnij lokalnie poniższe zmienne. W repozytorium nie zapisuj danych kont, haseł, kluczy ani linków z tokenami.

| Zmienna | Zastosowanie |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Adres projektu Supabase. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publiczny klucz publishable projektu, używany wraz z sesją i RLS. |
| `NEXT_PUBLIC_APP_URL` | Dokładny adres aplikacji, lokalnie `http://localhost:3000`, na hostingu domena HTTPS. |
| `SUPABASE_SECRET_KEY` | Opcjonalny klucz administracyjny wyłącznie dla narzędzi w odizolowanym środowisku testowym. Runtime aplikacji go nie wymaga. |

```sh
pnpm dev
```

Skrypt deweloperski nasłuchuje na interfejsie lokalnym. Otwórz adres zgodny z `NEXT_PUBLIC_APP_URL`. Po zmianie zmiennych uruchom serwer ponownie. Nie mieszaj `localhost` i `127.0.0.1` podczas logowania: sesja i starszy callback PKCE korzystają z cookies konkretnego hosta.

Bez konfiguracji Supabase dostępny jest tylko `/demo` oraz informacja o braku konfiguracji logowania. `/demo` to odseparowany prototyp referencyjny z fikcyjnymi danymi i lokalnym zapisem przeglądarki. Nie wpisuj tam danych klientów. Panele `/admin` i `/app` nie przełączają się na dane demo i nie obchodzą logowania.

## Baza danych i migracje

Użyj projektu Supabase przeznaczonego dla tej aplikacji. Dla istniejącej bazy sprawdź historię migracji i kopię bezpieczeństwa przed aktualizacją. Zastosuj wszystkie brakujące pliki z `supabase/migrations/` w kolejności nazw; nie wykonuj ponownie migracji już zapisanej w historii.

```sh
supabase login
supabase link --project-ref IDENTYFIKATOR_PROJEKTU
supabase migration list
supabase db push
```

Nie wklejaj danych uwierzytelniających CLI do repozytorium. Alternatywą jest kontrolowane wykonanie SQL przez administratora projektu, z zachowaniem kolejności i spójnej historii migracji.

| Migracje | Zakres |
| --- | --- |
| `202609050001`–`202609050004` | Podstawa, role, RLS, operacje spacerów, tabele dalszych modułów i prywatne zdjęcia psów. |
| `202609080001` | Odwołanie przyszłego spaceru i powiązane rozliczenia. |
| `202609080002` | Edycja terminu, wersjonowanie i ochrona warunków zgłoszeń. |
| `202609080003` | Spójność zgłoszeń, kwalifikacji i rezygnacji. |
| `202609080004` | Finanse, wpłaty, korekty i operacje pakietów. |
| `202609080005` | Kontrolowane przywracanie zgłoszeń do decyzji. |
| `202609080006` | Zgody i moderacja Psiutków, zainteresowania oraz osobne zdjęcia społecznościowe. |
| `202609080007` | Audytowany zapis prywatnych relacji psów i ochrona przed nadpisaniem oceny. |
| `202609080008` | Rosnące wersje wizytówek i zainteresowań także przy kolejnych zapisach w jednej transakcji. |
| `202609080009` | Rosnące wersje profili, psów, spacerów i kwestionariuszy; odrzucenie nieaktualnej edycji również w tej samej transakcji. |

Migracja `202609080006` wycofuje publikację wcześniejszych wizytówek bez udokumentowanej zgody i odłącza stare ścieżki zdjęć. Wymagana jest ponowna deklaracja właściciela i moderacja. To celowa zmiana, którą należy uwzględnić przed aktualizacją istniejących danych.

`supabase/config.toml` dotyczy lokalnego środowiska: zawiera lokalne adresy oraz wyłączone lokalnie potwierdzanie e-maili. **Nie wysyłaj całego pliku do chmury przez `supabase config push`.** W chmurze ustaw osobno Site URL zgodny z `NEXT_PUBLIC_APP_URL` i dozwolony callback `/auth/callback`, zachowując potwierdzanie e-maili oraz właściwe limity Auth. Uruchomienie samodzielnej rejestracji klientów i SMTP wymaga osobnego etapu.

### Lokalny Supabase i dane testowe

Lokalny stos wymaga Dockera i Supabase CLI:

```sh
supabase start
supabase db reset
```

`db reset` usuwa dane lokalnej bazy i odtwarza ją z migracji. Nie używaj resetu zdalnej bazy pilota. W `.env.local` ustaw dane lokalnego stosu zwrócone przez CLI. Studio działa pod `http://localhost:54323`, a lokalna skrzynka pod `http://localhost:54324`.

`supabase/seed.sql` nie tworzy kont Auth. Opcjonalny `scripts/seed-demo.mjs` tworzy fikcyjne konta i przykładowe rekordy przez administracyjne API:

```sh
PSI_ALLOW_DEMO_SEED=yes node --env-file=.env.local scripts/seed-demo.mjs
```

Skrypt wolno uruchamiać tylko w jednorazowym projekcie testowym. Wymaga lokalnego klucza administracyjnego, a kolejne uruchomienie tworzy kolejne dane. To pomocniczy seed, nie test procesu zgody/moderacji ani narzędzie do zakładania kont pilota. Konta seeda nie mają ustawionego hasła; dostęp wymaga osobnej konfiguracji testowej.

## Dostęp dla administratora i behawiorystki

1. Administrator projektu tworzy lub wybiera właściwe konto Supabase Auth. Tożsamość i uprawnienia należy ustalić przed nadaniem dostępu. Nowe konto otrzymuje domyślnie rolę `client`, niezależnie od metadanych rejestracji.
2. Dla konta uprawnionego do prowadzenia aplikacji administrator projektu ustawia rolę po UUID:

   ```sql
   update public.user_roles
   set role = 'admin'
   where user_id = 'UUID_UPRAWNIONEGO_KONTA';
   ```

3. Jeśli konto nie ma własnego hasła, uprawniony administrator generuje jednorazowy dostęp przez administracyjne API Supabase Auth typu `magiclink`. Hash weryfikacyjny należy przekazać w prywatnym linku do `/auth/access` jako parametr `token_hash`. Link jest poświadczeniem dostępu: nie zapisuj go w logach, repozytorium, zrzutach ani publicznych materiałach.
4. Wejście metodą GET wyświetla przycisk potwierdzenia i **nie zużywa tokenu**. Dopiero wysłanie formularza weryfikuje jednorazowy dostęp, tworzy sesję i kieruje do `/account/security`. Cel przekierowania jest stały; parametry zmieniające typ lub cel aktywacji są odrzucane.
5. Użytkownik ustawia własne hasło długości 12–128 znaków i uzupełnia wymagany profil. Kolejne logowanie odbywa się na `/login` hasłem. Zmiana hasła dotyczy wyłącznie konta aktualnej, zweryfikowanej sesji.

Strona aktywacji ma `no-store`, `no-referrer` i wyłączone indeksowanie. Wygaśnięty lub wykorzystany dostęp wymaga nowego linku od administratora. Generowanie takich linków jest operacją administracyjną poza publicznym interfejsem aplikacji; klucz administracyjny nie jest potrzebny w jej runtime.

Starszy kod logowania pocztą i callback PKCE pozostają w repozytorium, lecz formularz wysyłania linków nie jest obecnie udostępniony na `/login`. Włączenie poczty dla klientów wymaga konfiguracji dostawcy SMTP, adresów powrotu, limitów i oddzielnego testu dostarczania wiadomości.

## Dostęp i prywatność danych

- `src/proxy.ts` odświeża sesję. Odczyty i Server Actions ponownie sprawdzają użytkownika i rolę. Chronione layouty są dynamiczne, a RLS i granty bazy stanowią granicę dostępu również poza interfejsem.
- Rola jest przechowywana w osobnym `user_roles`. Klient nie może zmieniać własnej roli, właściciela psa ani kwalifikacji. Istotna zmiana kwestionariusza ustawia `needs_review`, bez zdejmowania zawieszenia lub obowiązku konsultacji.
- Dokładna lokalizacja znajduje się w `walk_private_details`. Dostęp mają administrator i opiekun zaakceptowanego psa. Klient nie otrzymuje cudzych zgłoszeń, prywatnych notatek ani składu grupy.
- Operacje zapisów, decyzji i finansów wykonują transakcyjne funkcje SQL. Blokady, unikalność zgłoszenia i kontrola pojemności nie zależą wyłącznie od UI. Zmiany zachowują autora, czas oraz audyt.
- `dog-avatars` i `community-avatars` są oddzielnymi prywatnymi zasobami. Podpisy zdjęć społecznościowych są ważne 60 sekund; obrazy są pobierane od razu. Ukrycie blokuje nowe podpisy, ale nie cofa wcześniej pobranego obrazu ani jeszcze ważnego podpisu.
- Finanse klienta ograniczają się do jego psów. Prywatne relacje psów są dostępne tylko administratorowi; publiczne treści Psiutków nie zastępują dokumentacji behawioralnej.
- Daty bazy mają typ `timestamptz`, a formularze i reguły terminów korzystają z `Europe/Warsaw`.
- Nieudany zapis formularza zachowuje wpisane dane, wybory i plik. Komunikat błędu otrzymuje fokus; poprawny zapis zachowuje normalne resetowanie formularza.

## Sprawdzanie projektu

```sh
pnpm lint
pnpm test
pnpm build
```

Vitest obejmuje domenę, walidację, widoki danych, zdjęcia i obsługę dostępu oraz migracje i rzeczywiste polityki SQL uruchamiane w PGlite. Testy bazy obejmują m.in. role, własność, prywatność, pojemność, edycję i odwołanie spacerów, przywracanie zgłoszeń, finanse, relacje oraz Psiutki. PGlite używa minimalnych atrap schematów Auth/Storage; nie zastępuje testu usługi Supabase ani konkurencyjnych operacji na niezależnych połączeniach. Testy Auth z atrapami nie dowodzą działania rzeczywistej sesji lub dostarczania poczty.

Scenariusz Playwright w `tests/e2e/registration.spec.ts` wymaga jednorazowego lokalnego Supabase po wszystkich migracjach oraz uruchomionej aplikacji korzystającej z tego samego środowiska. Ustaw lokalnie `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` i `NEXT_PUBLIC_APP_URL`; adresy muszą wskazywać lokalny stos. Test tworzy potwierdzone konta administratora i klienta z losowymi hasłami, loguje je formularzem, przechodzi od utworzenia psa do akceptacji zgłoszenia i ujawnienia lokalizacji, a następnie sprząta własne dane. SMTP i Inbucket nie są wymagane dla tego scenariusza.

```sh
pnpm exec playwright install chromium
node --env-file=.env.local node_modules/@playwright/test/cli.js test
```

Bez wymaganego lokalnego środowiska scenariusz jest pomijany. Pominięcie nie oznacza poprawnego przejścia testu. Przegląd wyglądu z fikcyjnymi danymi i atrapami akcji służy sprawdzeniu układu oraz dostępności; działanie operacji należy sprawdzać oddzielnie na bazie i w rzeczywistej sesji.

## Wdrożenie i ograniczenia

Projekt wymaga runtime Next.js/Node, np. Vercel lub własnego serwera. Nie jest eksportem statycznym. Publiczne zmienne środowiskowe ustaw przed buildem, a adresy Auth dostosuj do docelowej domeny. Hosting musi obsługiwać serwerowe przetwarzanie zdjęć przez `sharp`. Przy własnym serwerze po `pnpm build` uruchom `pnpm start`; zachowaj `.next`, `public` i zależności produkcyjne. Domyślny skrypt startuje na interfejsie lokalnym, więc udostępnienie na zewnątrz wymaga odpowiedniego proxy.

Końcowa kontrola aktualizacji powinna objąć zgodność migracji, logowanie obu kont pilota, jednorazową aktywację i ponowne logowanie hasłem, ograniczenia ról, zapis w modułach spacerów/finansów/relacji/Psiutków oraz widoki na komputerze i telefonie. Nie należy na podstawie samego builda ogłaszać gotowości wysyłki poczty lub wdrożenia klientów.

Znane ograniczenia:

- SMTP, zapraszanie klientów i samodzielne odzyskiwanie dostępu przez pocztę są odłożone. Dostęp pilota obsługuje administrator.
- Brak automatycznych powiadomień, WhatsApp, czatu, AI, płatności online, faktur i wielofirmowości. Kontakt, ustalanie spotkań i zwroty pieniędzy odbywają się poza aplikacją.
- Zmiana spaceru lub jego odwołanie zapisuje informację, ale nie wysyła jej automatycznie uczestnikom.
- Nie ma automatycznego awansu rezerwy. Kwalifikację, ostrzeżenia relacji i propozycje wspólnych spotkań ocenia behawiorysta.
- Nie ma jeszcze paginacji interfejsu dla dużego katalogu. Pobieranie wielu stron API chroni kompletność danych, ale nie zastępuje optymalizacji dla większej skali.
- Odłączenie zdjęcia z wizytówki nie usuwa automatycznie wcześniejszych obiektów Storage. Polityka sprzątania plików wymaga osobnego wdrożenia.
- Opcjonalna nawigacja WebMCP nie zastępuje autoryzacji i nie jest warunkiem działania paneli. Jej integrację należy sprawdzić w obsługującym ją środowisku.

Prototyp referencyjny znajduje się w `public/reference/prototype.html`. Docelowy oryginalny plik logo można podmienić po jego dostarczeniu. Zasady pracy z zainstalowaną wersją Next.js opisuje `AGENTS.md`; przed zmianą kodu czytaj odpowiednie lokalne przewodniki w `node_modules/next/dist/docs/`.
