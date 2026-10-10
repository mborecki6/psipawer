# Psi Pawer

Aplikacja do organizacji spacerów socjalizacyjnych i pracy behawiorysty. Stos: Next.js App Router, TypeScript, React, Supabase Auth/PostgreSQL/Storage. Wygląd zachowuje ciepłą paletę i układ dostarczonego prototypu.

## MVP online do wspólnych testów

Od 06.10.2026 pełny MVP działa na [psipawer.vercel.app](https://psipawer.vercel.app/login), na Vercel i Supabase we Frankfurcie. Aktualizacja po feedbacku z 10.10.2026 jest opublikowana; baza ma **49 migracji** do `202610100001`. Przed tą zmianą wykonano świeżą kopię chmury z Auth, Storage i historią migracji, odtworzono ją w oddzielnej lokalnej bazie oraz sprawdzono nową migrację. Konta, hasła, terminy, ceny i postęp testerów zostały zachowane. [Przebieg publikacji i jej ograniczenia](docs/VERCEL-SUPABASE-PILOT.md#aktualizacja-po-feedbacku--10102026).

Pilot obejmuje prowadzącą, administratora i **dwa fikcyjne konta opiekunów**. [Scenariusze testów](docs/PILOT-TEST-SCENARIOS.md) obejmują profile, spacery, konsultacje, kursy, fitness, zalecenia, rozliczenia, karty, społeczność i skrzynki. Hasła testowe są przekazywane prywatnie, poza repozytorium. Wszystkie dane oznaczone DEMO są fikcyjne; wdrożenia nie resetują postępu testerów.

Od 09.10.2026 panel prowadzącej ma sześć głównych sekcji. **Zajęcia** grupują spacery, konsultacje, kursy i fitness, **Ustawienia** zawierają ceny, godziny pracy i dostęp opiekunów, a **Więcej** — karty podarunkowe, relacje psów i Psiutki. Pulpit skupia się na najbliższym spotkaniu i sprawach do obsługi; dodatkowe podsumowanie jest rozwijane. [Mapa nawigacji do testów](docs/PILOT-TEST-SCENARIOS.md#gdzie-znaleźć-funkcje-w-panelu-prowadzącej).

Logowanie odbywa się e-mailem i hasłem. Powiadomienia biznesowe trafiają do skrzynek w aplikacji, a Supabase sprawdza przypomnienia co pięć minut. Zewnętrzny SMTP, e-mailowe zaproszenia i odzyskiwanie hasła w chmurze pozostają wyłączone. Domyślna poczta Supabase obsługuje Auth z ograniczeniami odbiorców i liczby wiadomości, nie wysyła biznesowych przypomnień. Automatyczne fizyczne usuwanie nieużywanych zdjęć pozostaje wyłączone.

Lokalny odbiór 03.10.2026 objął **971 testów**, **45 pełnych scenariuszy obu ról**, próbę 50 kont oraz odtworzenie kopii bazy i zdjęć. Pomiar lokalny nie jest pomiarem wydajności hostingu. [Stan produktu](docs/PRODUCT-STATUS.md) i [obsługa wdrożenia](docs/VERCEL-SUPABASE-PILOT.md) rozdzielają te wyniki i ograniczenia pilota.

## Moduły aplikacji

### Opublikowana aktualizacja po feedbacku — 10.10.2026

Opublikowana aplikacja ma kalendarz tygodnia i miesiąca, osobny wybór prowadzącego oraz sali, całodniowe blokady i godziny pracy każdego członka zespołu. Faktyczne kolizje pozostają blokowane; krótsza preferowana przerwa wymaga potwierdzenia. Plany opieki pokazują jedno bieżące powiązanie i rozwijany wybór jego zmiany, a oferta ma filtry rodzaju zajęć. [Szczegóły kalendarza](docs/CALENDAR-MODULE.md), [opieki](docs/CARE-MODULE.md) i [oferty](docs/SERVICES-MODULE.md).

Migrację `202610100001_calendar_team.sql` zastosowano lokalnie i atomowo w chmurze. Starsze terminy są jawnie nieprzypisane; prowadzących i sal nie odgadywano. Lokalny odbiór obejmuje 1017 testów oraz 45 unikalnych scenariuszy obu ról w dwóch przebiegach. Odczytowa kontrola hostingu objęła 40 stron obu ról i dwóch opiekunów, 39 wariantów responsywności oraz 16 kontroli prywatnego API, bez błędów skryptów lub konsoli i bez zapisów w modułach. [Aktualny stan i wyniki](docs/PRODUCT-STATUS.md).

### Plany pracy i postępy

Dodano bibliotekę materiałów, prywatne szkice, publikację wersjonowanych zaleceń oraz odpowiedzi opiekunów z listą do przeczytania. Widoki znajdują się pod `/admin/care`, `/app/care` i przy kartach psów. Moduł jest dostępny w opublikowanym MVP; migracja `202609180001_care_plans.sql` jest zastosowana. [Zakres, testy i kolejność wdrożenia](docs/CARE-MODULE.md).

### Moduły opublikowanego MVP

Moduły działają w chmurze i w lokalnym środowisku. Lokalny rozwój nadal korzysta z oddzielnego Supabase, żeby nie zmieniać danych pilota.

- [Konsultacje](docs/CONSULTATIONS-MODULE.md): zgłoszenia, terminy, zmiany i historia; migracja `202609180002`.
- [Usługi i cennik](docs/SERVICES-MODULE.md): 17 wariantów po robocze 100 zł, edycja i historia cen; migracja `202609180003`.
- [Wspólny kalendarz](docs/CALENDAR-MODULE.md): spacery, konsultacje i prywatne blokady czasu z ochroną przed kolizjami; migracja `202609190001`.
- [Do zrobienia i kontakty kontrolne](docs/WORK-MODULE.md): wspólna kolejka, pełny cykl kontaktu po publikacji planu, prywatne notatki i jawny przegląd odpowiedzi; rzeczywiste E2E obu ról i niezależne próby równoczesnych zapisów; migracja `202609190002`.
- [Rozliczenia konsultacji](docs/CONSULTATION-FINANCE.md): należność po potwierdzeniu terminu, częściowe wpłaty i korekty, saldo przy spotkaniu; migracja `202609190003`.
- [Odzyskanie hasła](docs/ACCESS-RECOVERY.md): formularz prośby, potwierdzenie linku i ustawienie hasła. Poczta domyślnie wyłączona, gotowy szablon lokalny.
- [Powiadomienia w aplikacji](docs/NOTIFICATIONS-MODULE.md): prywatne skrzynki obu ról, licznik nieprzeczytanych i komunikaty o zmianach spraw; migracja `202609190004`. Bez wysyłki poza aplikację.

[Aktualny stan całego MVP oraz pozostałe warunki odbioru](docs/PRODUCT-STATUS.md).

### Podstawowe obszary

| Obszar       | Zakres                                                                                                                                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Konta        | Sesje SSR, logowanie hasłem, jednorazowa aktywacja, ustawienie własnego hasła, uzupełnianie profilu, role administratora i opiekuna.                                                                                                                            |
| Psy          | Profile, kwestionariusze, kwalifikacja, prywatne zdjęcia i notatki o określonej widoczności.                                                                                                                                                                    |
| Spacery      | Tworzenie, edycja i kopiowanie przyszłych terminów, zgłoszenia, zaproszenia, decyzje administratora, rezerwa, rezygnacje, odwołanie terminu i obecności.                                                                                                        |
| Rozliczenia  | Należności, częściowe wpłaty, zwroty/korekty, pakiety wejść, rezerwacja i odłączenie wejścia, anulowanie niewykorzystanego pakietu oraz historia. Kursy mają jawne uzgodnienie należności po rezygnacji i częściowe zwroty bez przepisywania pierwotnych wpłat. |
| Kursy        | Panele obu ról: cykl z ceną za całość, zapisy, rezerwa, decyzje, zbiórki, obecności, kalendarz, zakończenie, rezygnacja oraz rozliczenia.                                                                                                                       |
| Relacje psów | Prywatne oceny par, notatki, data ostatniego spotkania, historia zmian i ostrzeżenia przy planowaniu grup.                                                                                                                                                      |
| Psiutki      | Wizytówki społecznościowe, osobne zdjęcia i zgody, moderacja, ukrywanie profili, zainteresowania i ocena wzajemnych propozycji przez behawiorystę.                                                                                                              |

Panele działają pod `/admin` i `/app`. Finanse znajdują się pod odpowiednim `/finance`, Psiutki pod `/community`, a zarządzanie prywatnymi relacjami wyłącznie pod `/admin/relations`.

### Zasady spacerów i zgłoszeń

- Akceptacja sprawdza kwalifikację psa oraz pojemność grupy. Lista rezerwowa nie awansuje automatycznie. Przy oczekującym, rezerwowym i odrzuconym zgłoszeniu opiekun widzi krótką wskazówkę, co oznacza status i jaki jest następny krok.
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
- Korekta obecności rozlicza różnicę. Ponowienie tej samej operacji nie zużywa kolejnego wejścia. Brak salda przy ponownym obciążeniu powoduje atomowe odrzucenie zmiany; formularz zachowuje wybraną obecność i wskazuje sprawdzenie przydziałów w rozliczeniach przed ponownym zapisem.
- Ważność pakietu jest sprawdzana przy nowym przydziale. Wejście zarezerwowane przed wygaśnięciem można później rozliczyć.
- Błędny przydział można odłączyć przed spacerem z obowiązkowym powodem, przywracając pojedynczą należność. Niewykorzystany i niezarezerwowany pakiet można anulować z powodem.
- Wpłaty mogą być częściowe. Klucz idempotencji oraz blokada należności chronią przed ponowieniem i nadpłatą. Korekta/zwrot odwraca cały wpis i wymaga powodu; zmianę kwoty wykonuje się przez odwrócenie błędnego wpisu i zapis właściwego.
- Wpłaty wymagające sprawdzenia po odwołaniu lub zmianie rozliczenia są oznaczane. Rzeczywisty zwrot należy wykonać oddzielnie.
- Zapisany zwrot pozostaje widoczny także po późniejszej korekcie obecności zwalniającej należność. Przywrócenie płatnej obecności tworzy należność do ponownego rozliczenia; wcześniejszy zwrot jej nie opłaca.

Opiekun widzi własne należności, pakiety, wpłaty, powody korekt i historię wejść. Wewnętrzne notatki przyznania/przypisania pakietu pozostają w audycie administratora. Pobieranie finansów odbywa się stronicami, aby uniknąć cichego obcięcia historii przez limit API.

### Relacje i Psiutki

Prywatna ocena relacji dotyczy pary psów niezależnie od kolejności ich wyboru. Zapis wymaga notatki, sprawdza wersję wcześniejszej oceny i nie pozwala podać przyszłej daty ostatniego spotkania. Oceny oraz ich historia są dostępne wyłącznie administratorowi. Nie są publikowane w Psiutkach.

Wizytówka Psiutka jest osobnym zestawem treści, widocznym po zatwierdzeniu dla zalogowanych użytkowników. Nie należy wpisywać telefonu, dokładnego adresu, danych zdrowotnych ani prywatnych zaleceń. Opiekun może tworzyć i edytować wyłącznie własną wizytówkę; administrator moderuje treść, ale nie edytuje cudzej wizytówki jako właściciel.

Każdy zapis wymaga jawnej zgody i ponownego sprawdzenia. Zmiana opisu lub zdjęcia wycofuje publikację do czasu moderacji. Ukrycie przez właściciela cofa zgodę; ukrycie przez administratora pozostawia zgodę, lecz usuwa profil z katalogu. Moderacja odrzucenia przekazuje opiekunowi wskazówki do poprawy.

Zdjęcia społecznościowe trafiają do osobnego prywatnego zasobu `community-avatars`. Nie są kopiowane z dokumentacji psa. Upload przyjmuje JPG, PNG lub WebP do 1,5 MB i 16 megapikseli; serwer sprawdza i przetwarza obraz do WebP, ogranicza rozmiar oraz usuwa metadane EXIF/GPS. Właściciel może także usunąć zdjęcie z wizytówki przy zapisie.

Zainteresowanie wymaga własnej opublikowanej wizytówki i nie może dotyczyć drugiego psa tego samego opiekuna. Wzajemna propozycja trafia do oceny behawiorysty. Po zmianie lub ukryciu profilu wymagane jest ponowne potwierdzenie zainteresowania aktualnymi treściami. Wycofanie propozycji nie omija aktywnej negatywnej oceny pary. Zgłoszenie zainteresowania zapisuje dane w aplikacji — nie wysyła wiadomości do innych osób.

## Instalacja i środowisko

**Rozwój lokalny jest oddzielony od opublikowanego pilota.** Kolejne wdrożenia wymagają świadomej publikacji i sprawdzenia zmian bazy. `next dev` blokuje połączenia do zdalnego Supabase; [przygotowanie lokalnej bazy i kolejność prac](docs/LOCAL-DEVELOPMENT.md). Lokalnie powstały [plany i postępy](docs/CARE-MODULE.md) oraz [konsultacje indywidualne](docs/CONSULTATIONS-MODULE.md).

Wymagane: Node.js 22 lub nowszy oraz pnpm. Zależności są określone w `package.json` i `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm local:start
pnpm local:dev
```

Na tym komputerze przygotowano lokalny Supabase w maszynie Lima. `local:start` zachowuje dane i tworzy prywatną konfigurację, a `local:dev` jawnie wybiera lokalną bazę. Nie nadpisuj istniejącej `.env.local`, która może zawierać ustawienia hostingu. Przygotowanie innego komputera opisuje [instrukcja lokalna](docs/LOCAL-DEVELOPMENT.md). W repozytorium nie zapisuj danych kont, haseł, kluczy ani linków z tokenami.

| Zmienna                                | Zastosowanie                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Adres projektu Supabase.                                                                                                                                    |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publiczny klucz publishable projektu, używany wraz z sesją i RLS.                                                                                           |
| `NEXT_PUBLIC_APP_URL`                  | Dokładny adres aplikacji, lokalnie `http://localhost:3000`, na hostingu domena HTTPS.                                                                       |
| `AUTH_EMAIL_ENABLED`                   | Domyślnie `false`. `true` dopiero dla skonfigurowanej poczty; lokalny helper włącza ją dla testowej skrzynki. [Warunki](docs/ACCESS-RECOVERY.md).           |
| `CLIENT_INVITATIONS_ENABLED`           | Osobna flaga lokalnych zaproszeń, wymagająca także włączonej poczty.                                                                                        |
| `SUPABASE_SECRET_KEY`                  | Serwerowy klucz lokalnego stosu dla adaptera zaproszeń i narzędzi testowych. Nie trafia do przeglądarki. Pozostałe operacje korzystają z sesji użytkownika. |

```sh
pnpm local:dev
```

Skrypt deweloperski nasłuchuje na interfejsie lokalnym. Otwórz adres zgodny z `NEXT_PUBLIC_APP_URL`. Po zmianie zmiennych uruchom serwer ponownie. Nie mieszaj `localhost` i `127.0.0.1` podczas logowania: sesja i starszy callback PKCE korzystają z cookies konkretnego hosta.

Bez konfiguracji Supabase dostępny jest tylko `/demo` oraz informacja o braku konfiguracji logowania. `/demo` to odseparowany prototyp referencyjny z fikcyjnymi danymi i lokalnym zapisem przeglądarki. Nie wpisuj tam danych klientów. Panele `/admin` i `/app` nie przełączają się na dane demo i nie obchodzą logowania.

## Baza danych i migracje

**Pilot ma komplet 49 migracji do `202610100001_calendar_team.sql`.** Kolejne zmiany chmury wykonuj po porównaniu historii i kopii. Do rozwoju używaj poleceń lokalnych opisanych w [LOCAL-DEVELOPMENT.md](docs/LOCAL-DEVELOPMENT.md).

Użyj projektu Supabase przeznaczonego dla tej aplikacji. Dla istniejącej bazy sprawdź historię migracji i kopię bezpieczeństwa przed aktualizacją. Zastosuj wszystkie brakujące pliki z `supabase/migrations/` w kolejności nazw; nie wykonuj ponownie migracji już zapisanej w historii.

```sh
supabase login
supabase link --project-ref IDENTYFIKATOR_PROJEKTU
supabase migration list
supabase db push
```

Nie wklejaj danych uwierzytelniających CLI do repozytorium. Alternatywą jest kontrolowane wykonanie SQL przez administratora projektu, z zachowaniem kolejności i spójnej historii migracji.

| Migracje                      | Zakres                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `202609050001`–`202609050004` | Podstawa, role, RLS, operacje spacerów, tabele dalszych modułów i prywatne zdjęcia psów.                                                                                                                                                                                                                         |
| `202609080001`                | Odwołanie przyszłego spaceru i powiązane rozliczenia.                                                                                                                                                                                                                                                            |
| `202609080002`                | Edycja terminu, wersjonowanie i ochrona warunków zgłoszeń.                                                                                                                                                                                                                                                       |
| `202609080003`                | Spójność zgłoszeń, kwalifikacji i rezygnacji.                                                                                                                                                                                                                                                                    |
| `202609080004`                | Finanse, wpłaty, korekty i operacje pakietów.                                                                                                                                                                                                                                                                    |
| `202609080005`                | Kontrolowane przywracanie zgłoszeń do decyzji.                                                                                                                                                                                                                                                                   |
| `202609080006`                | Zgody i moderacja Psiutków, zainteresowania oraz osobne zdjęcia społecznościowe.                                                                                                                                                                                                                                 |
| `202609080007`                | Audytowany zapis prywatnych relacji psów i ochrona przed nadpisaniem oceny.                                                                                                                                                                                                                                      |
| `202609080008`                | Rosnące wersje wizytówek i zainteresowań także przy kolejnych zapisach w jednej transakcji.                                                                                                                                                                                                                      |
| `202609080009`                | Rosnące wersje profili, psów, spacerów i kwestionariuszy; odrzucenie nieaktualnej edycji również w tej samej transakcji.                                                                                                                                                                                         |
| `202609180001`                | Plany pracy i postępy: biblioteka, prywatne szkice, publikacje, odpowiedzi, uprawnienia i zdarzenia do przyszłej obsługi w tle. Migracja przygotowana lokalnie, jeszcze niezastosowana w chmurze.                                                                                                                |
| `202609180002`                | Konsultacje indywidualne: zgłoszenia, ustalanie terminów, zmiany, odwołania, zakończenie i historia. Wyłącznie lokalnie.                                                                                                                                                                                         |
| `202609180003`                | Katalog 17 wariantów usług Psi Pawer, robocze ceny 100 zł, panel edycji i historia cennika, zachowanie ceny wybranej przy zgłoszeniu. Wyłącznie lokalnie; [opis](docs/SERVICES-MODULE.md).                                                                                                                       |
| `202609190001`                | Wspólny kalendarz spacerów i konsultacji, prywatne blokady dostępności i ochrona przed nakładaniem terminów. Wyłącznie lokalnie; [opis](docs/CALENDAR-MODULE.md).                                                                                                                                                |
| `202609190002`                | Kolejka spraw prowadzącej i obsługa kontaktów kontrolnych po publikacji planu. Wyłącznie lokalnie; [opis](docs/WORK-MODULE.md).                                                                                                                                                                                  |
| `202609190003`                | Należności konsultacji, wspólna ewidencja wpłat i korekt, izolowane salda. Wyłącznie lokalnie; [opis](docs/CONSULTATION-FINANCE.md).                                                                                                                                                                             |
| `202609190004`                | Skrzynki powiadomień, transakcyjne tworzenie, kontrola odbiorcy i stanu przeczytania. Wyłącznie lokalnie; [opis](docs/NOTIFICATIONS-MODULE.md).                                                                                                                                                                  |
| `202609190005`                | Przypomnienia przed spotkaniami i o kontakcie kontrolnym, trwała kolejka prób, panel obsługi i lokalny worker. Wyłącznie lokalnie; [opis](docs/REMINDERS-MODULE.md).                                                                                                                                             |
| `202609190006`                | Panel zaproszeń, wersjonowanie prób, etapy aktywacji konta i uzupełnienie imienia w nowym profilu. Wyłącznie lokalnie; [opis](docs/INVITATIONS-MODULE.md).                                                                                                                                                       |
| `202609190007`                | Powiązanie szkicu i publikacji zaleceń z konkretną konsultacją. Wyłącznie lokalnie; [opis](docs/CONSULTATION-CARE.md).                                                                                                                                                                                           |
| `202610020001`                | Szczegóły zaproszenia i pełna stronicowana historia wysyłek, dostępna tylko zespołowi. Wyłącznie lokalnie; [opis](docs/INVITATIONS-MODULE.md).                                                                                                                                                                   |
| `202610020002`                | Rozróżnienie hasła technicznego Auth i hasła ustawionego po aktywacji; bez zgadywania stanu starszych kont. Wyłącznie lokalnie.                                                                                                                                                                                  |
| `202610020003`                | Archiwum i przywracanie niewysłanych szkiców zaproszeń, bez wysyłania wiadomości. Wyłącznie lokalnie.                                                                                                                                                                                                            |
| `202610020004`                | Przyspieszenie polityk odczytu przy zachowaniu zakresu widocznych danych oraz indeks zgłoszeń psa. Wyłącznie lokalnie; [pomiar](docs/PILOT-LOAD.md).                                                                                                                                                             |
| `202610020005`                | Ręczne uzgodnienie brakującej ceny starszej konsultacji; zachowane wcześniejsze kwoty, historia, audyt i powiadomienie w aplikacji. Wyłącznie lokalnie; [opis](docs/CONSULTATION-FINANCE.md#starsze-spotkanie-bez-ceny).                                                                                         |
| `202610020006`                | Zachowanie statusu rzeczywistego zwrotu spaceru niezależnie od kolejności korekty obecności; bez zmiany kwot i historii wpłat. Zastosowano wyłącznie lokalnie.                                                                                                                                                   |
| `202610020007`                | Bezpieczne ponowienia dodania i edycji materiałów przez ich autora, bez dodatkowej wersji lub audytu; stara karta z inną treścią nadal otrzymuje konflikt. Zastosowano wyłącznie lokalnie; [biblioteka i personalizacja](docs/CARE-MODULE.md#biblioteka-i-personalizacja).                                       |
| `202610020008`                | Wymiana i usuwanie zdjęć z kontrolą starej karty, ochrona aktywnych kluczy oraz trwała kolejka sprzątania przez Storage API. Zastosowano wyłącznie lokalnie.                                                                                                                                                     |
| `202610020009`                | Walidacja ścieżek zdjęć przed dodaniem zadania oraz przy odczycie partii sprzątania. Zastosowano wyłącznie lokalnie.                                                                                                                                                                                             |
| `202610020010`                | Rejestracja nowego przesłania przed wysłaniem pliku, zamknięcie po zapisaniu i sprzątanie niedokończonych przesłań po 30 minutach. Zastosowano wyłącznie lokalnie.                                                                                                                                               |
| `202610020011`                | Rdzeń kursów: cykl spotkań, cena za całość, zgłoszenia, decyzje, obecności i wspólna ochrona terminów. Zastosowano wyłącznie lokalnie. [Zakres](docs/SERVICES-MODULE.md#rdzeń-cyklu-kursu).                                                                                                                      |
| `202610020012`                | Odczyt spotkań kursowych we wspólnym kalendarzu i najbliższym spotkaniu, z dokładną zbiórką tylko dla przyjętego opiekuna i zespołu. Zastosowano wyłącznie lokalnie; [panele](docs/SERVICES-MODULE.md#panele-kursów-i-kalendarz).                                                                                |
| `202610020013`                | Wpłaty za cały kurs, jawne uzgodnienie należności po rezygnacji, częściowe zwroty z zachowaniem pierwotnych wpłat i saldo we wspólnych finansach. Zastosowano wyłącznie lokalnie; [rozliczenia](docs/SERVICES-MODULE.md#rozliczenia-kursów).                                                                     |
| `202610030001`                | Powiadomienia z historii kursu i przypomnienia każdego spotkania przyjętego uczestnika; odnośniki do konkretnego zgłoszenia i spotkania, zachowany opiekun zgłoszenia i wycofanie nieaktualnych zadań. Zastosowano wyłącznie lokalnie; [odbiór](docs/LOCAL-DEVELOPMENT.md#powiadomienia-i-przypomnienia-kursów). |
| `202610030002`                | Zalecenia uczestnika dla całego kursu lub konkretnego zakończonego spotkania, prywatny szkic, niezmienna historia publikacji i osobne strony przy uczestnikach. Zastosowano wyłącznie lokalnie; [zasady i testy](docs/COURSE-CARE.md).                                                                           |
| `202610030003`                | Edycja nazwy/limitu cyklu z zachowanymi cenami i własnym potwierdzeniem; jawne korekty obecności po zakończeniu z wcześniejszym stanem, powodem i historią. Zastosowano wyłącznie lokalnie; [zasady i testy](docs/COURSE-EDITS.md).                                                                              |
| `202610030004`                | Ponowna decyzja po odmowie i jawne przywrócenie udziału przed startem z wcześniejszą ceną, zachowanymi wpłatami/zwrotami i trwałym potwierdzeniem. Zastosowano wyłącznie lokalnie; [zasady i testy](docs/COURSE-REOPENING.md).                                                                                   |

Migracja `202609080006` wycofuje publikację wcześniejszych wizytówek bez udokumentowanej zgody i odłącza stare ścieżki zdjęć. Wymagana jest ponowna deklaracja właściciela i moderacja. To celowa zmiana, którą należy uwzględnić przed aktualizacją istniejących danych.

`supabase/config.toml` dotyczy lokalnego środowiska: zawiera lokalne adresy oraz wyłączone lokalnie potwierdzanie e-maili. **Nie wysyłaj całego pliku do chmury przez `supabase config push`.** W chmurze ustaw osobno Site URL zgodny z `NEXT_PUBLIC_APP_URL` i dozwolony callback `/auth/callback`, zachowując potwierdzanie e-maili oraz właściwe limity Auth. Uruchomienie samodzielnej rejestracji klientów i SMTP wymaga osobnego etapu.

### Lokalny Supabase i dane testowe

Na tym komputerze stos jest przygotowany. Codzienne polecenia:

```sh
pnpm local:start
pnpm local:status
pnpm local:stop
```

Start i zatrzymanie zachowują dane. `supabase db reset --local` je usuwa i nie jest elementem codziennego uruchomienia. Studio działa pod `http://localhost:54323`, a lokalna skrzynka Mailpit pod `http://localhost:54324`. Prywatną konfigurację zapisuje helper.

`supabase/seed.sql` nie tworzy kont Auth. Opcjonalny `scripts/seed-demo.mjs` tworzy fikcyjne konta i przykładowe rekordy przez administracyjne API. Odrzuca adresy inne niż lokalne. Po `pnpm local:env`:

```sh
PSI_ALLOW_DEMO_SEED=yes node --env-file=.env.test.local scripts/seed-demo.mjs
```

Skrypt tworzy trzy fikcyjne konta z osobnymi losowymi hasłami, cztery psy i przykładowe terminy. Zestaw na tym komputerze jest już utworzony; używaj go ponownie. Hasła są wyłącznie w ignorowanym `.local/accounts.json` z uprawnieniami `0600`. Seed odmawia nadpisania istniejącego manifestu. To narzędzie demonstracyjne, nie proces zakładania kont pilota ani test zgody/moderacji.

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

Strona aktywacji ma `no-store`, `no-referrer` i wyłączone indeksowanie. Wygaśnięty lub wykorzystany dostęp wymaga nowego linku od administratora. Generowanie takich linków pozostaje operacją administracyjną. Osobny lokalny panel zaproszeń używa serwerowego klucza tylko do zaproszenia w lokalnym Auth.

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

## Zdjęcia psów i Psiutków

Lokalna migracja `202610020008` dodaje wymianę i usuwanie zdjęcia z prywatnej karty psa oraz trwałą kolejkę sprzątania plików. Stara karta nie nadpisuje nowszego zdjęcia; nieudany zapis zachowuje wybrany plik i otrzymuje fokus. Własny poprawny zapis aktualizuje wersję formularza i czyści wybrany plik. Przesłanie zdjęcia Psiutka wymaga osobnej zgody, zachowuje opis wizytówki i kieruje ją do ponownej moderacji.

Oba rodzaje zdjęć są odczytywane, obracane zgodnie z orientacją, pomniejszane do maksymalnie 1200 × 1200 i zapisywane jako WebP bez EXIF/GPS. Limit przesłania wynosi 1,5 MB, a rozkodowanego obrazu 16 megapikseli. Prywatne zdjęcie nie jest kopiowane do wizytówki społeczności.

Zastąpienie, odłączenie lub usunięcie profilu zapisuje stary klucz w kolejce w tej samej transakcji. Aplikacja od razu próbuje usunąć zastąpiony plik przez Storage API. Błąd pozostawia zadanie do ponowienia; ukończenie wymaga potwierdzonego braku metadanych pliku. Aktywne zdjęcie nie podlega usuwaniu przez użytkownika, a wycofanych kluczy nie można ponownie użyć. Niepewny wynik zapisu nie upoważnia do skasowania pliku, który faktycznie został dołączony.

Migracja `202610020010` rejestruje nowe przesłanie w bazie przed wysłaniem danych do Storage. Bez potwierdzenia rejestracji aplikacja nie wysyła pliku. Zapis do karty psa lub wizytówki zamyka rejestr w tej samej transakcji; błąd audytu wycofuje również zamknięcie. Rejestr wygasa po 30 minutach bez przedłużania przez ponowienie. Proces sprzątania przenosi wygasłe, niedokończone przesłania do trwałej kolejki, także jeśli aplikacja zatrzymała się przed wysłaniem danych. Wygasłego lub wycofanego klucza nie można później dołączyć ani ponownie przesłać. Równoczesny zapis i sprzątanie używają wspólnej blokady klucza oraz ponownego odczytu stanu; poprawnie zapisane zdjęcie pozostaje używane.

```sh
pnpm local:avatar-cleanup
```

To jawny, jednorazowy proces wyłącznie dla lokalnego `.env.test.local`, najwyżej 20 plików na przebieg. Kolejka opóźnia ponowienia po błędzie; proces nie ma jeszcze harmonogramu dla docelowego hostingu. Rejestr obejmuje nowe przesłania wykonywane przez aplikację. Nie skanuje dawnych osieroconych plików ani przesłań wykonanych ręcznie przez API bez rejestracji; zachowano zgodność wcześniejszych poprawnych zdjęć.

## Sprawdzanie projektu

Po dodaniu lokalnego rdzenia kursów 02.10.2026: **635/635 testów w 59 plikach**, **23/23 rzeczywiste scenariusze Auth/API/przeglądarki** (3,8 minuty) i **76/76 wcześniejszych prób PostgreSQL**, uruchomionych ponownie po zmianie wspólnego kalendarza (8,89 s). Nowa próba kursów sprawdza API oraz pięć niezależnych wyścigów; panel kursów i jego integracje pozostają kolejnym etapem. TypeScript i ESLint zmienionych źródeł przeszły. Lokalna baza ma 34 migracje; dane własnych prób usunięto, a 17 usług pozostało po robocze 100 zł. W tym etapie kod ekranów nie został zmieniony; podgląd zachowuje poprzednią kompilację z dopracowanymi zdjęciami.

Po dodaniu [paneli kursów i kalendarza](docs/SERVICES-MODULE.md#panele-kursów-i-kalendarz): **650/650 testów w 60 plikach**, **25/25 rzeczywistych scenariuszy** we wspólnym przebiegu (3,9 minuty) i **76/76 wcześniejszych prób PostgreSQL** (9,10 s). Po dopracowaniu pustego widoku zgłoszeń i skrótów wykonano nowy build oraz ponownie dwa scenariusze kursów. Panele obu ról obejmują tworzenie cyklu, zapisy, decyzje, rezerwę, zmianę spotkania, obecności, zakończenie i odwołanie. Stare karty zachowują wpisy i nie przyjmują zmienionego harmonogramu. Kalendarz pokazuje każde spotkanie, z dokładną zbiórką tylko dla przyjętych opiekunów i zespołu. Zrzuty 320/390/1440 px sprawdzono wizualnie. Baza ma 35 migracji, pięć wcześniejszych kont, brak danych prób i 17 aktywnych usług po robocze 100 zł. Lokalny podgląd jest uruchomiony z nowymi panelami. Finanse, powiadomienia i zalecenia kursów pozostają kolejnym etapem; nie zmieniano produkcji.

Po integracji [rozliczeń kursów](docs/SERVICES-MODULE.md#rozliczenia-kursów): **684/684 testy w 62 plikach**, **27/27 rzeczywistych scenariuszy** we wspólnym przebiegu (4,0 minuty) oraz **76/76 wcześniejszych prób PostgreSQL** (8,88 s). Nowy test API potwierdza sześć zależności blokad finansowych, a formularze obu ról przechodzą wpłaty 40 + 60 zł, rezygnację, uzgodnienie 30 zł i częściowe zwroty 20 + 50 zł. Po końcowej poprawie układu i oznaczenia rozliczenia wykonano nowy build i ponownie scenariusz formularzy (8,3 s). Stare karty zachowują pola; jawne odświeżenie tworzy nowy wpis ze świeżym saldem. Zrzuty 320/390/1440 px sprawdzono wizualnie. Baza ma 36 migracji, pięć wcześniejszych kont i 17 aktywnych usług po robocze 100 zł; własne dane prób usunięto. Podgląd działa z nowej kompilacji. Powiadomienia, przypomnienia i zalecenia kursów pozostają kolejnym etapem. Wszystkie zmiany wykonano lokalnie.

Po dodaniu [powiadomień i przypomnień kursów](docs/LOCAL-DEVELOPMENT.md#powiadomienia-i-przypomnienia-kursów) 03.10.2026: **702/702 testy w 62 plikach**, **28/28 rzeczywistych scenariuszy** (4,3 minuty) i **76/76 wcześniejszych prób PostgreSQL** (9,40 s). Wiadomości otwierają konkretne zgłoszenie lub spotkanie; przyjęci uczestnicy mają przypomnienie przed każdym spotkaniem. Zmiana terminu i rezygnacja wycofują nieaktualne zadania, a finansowe zmiany nie powtarzają przypomnienia. Nowy E2E sprawdza rzeczywiste dostarczanie i rezygnację w obu kolejnościach. Zrzuty 320/390 px, build z TypeScript, ESLint i końcowy odczyt przeszły. Baza ma 37 migracji i pięć wcześniejszych kont; własne dane prób usunięto. Wszystkie 17 usług nadal ma robocze ceny 100 zł. Lokalny podgląd działa; zalecenia kursowe i pozostały pełny zakres pozostają do zbudowania.

Po integracji [zaleceń kursów](docs/COURSE-CARE.md) 03.10.2026: **718/718 testów w 62 plikach** (15,18 s), **30/30 pełnych scenariuszy** (4,2 minuty) i **76/76 wcześniejszych prób PostgreSQL** (8,33 s). Nowe scenariusze sprawdzają prywatny szkic, publikację całego cyklu podczas kursu, jawne przepisanie szkicu do spotkania, zakończenie i publikację, starą kartę bez utraty treści oraz zmianę opiekuna. Trzy rzeczywiste oczekiwania na blokady chronią publikację konkurującą z rezygnacją i ponowieniem zgłoszenia. Baza ma 38 migracji, pięć wcześniejszych kont i 17 usług po robocze 100 zł; dane własnych prób usunięto. Zrzuty 320/390 px, build z TypeScript, ESLint i końcowy odczyt przeszły. Podgląd działa z nową kompilacją. Cały produkt pozostaje w rozwoju; [pozostały zakres](docs/PRODUCT-STATUS.md).

Po dodaniu [edycji cyklu i korekt obecności](docs/COURSE-EDITS.md) 03.10.2026: **732/732 testy** (15,05 s), **32/32 pełne scenariusze** (4,3 minuty) i **76/76 wcześniejszych prób PostgreSQL** (8,74 s). Nowe scenariusze sprawdzają zmiany nazwy i limitu bez zmiany ceny lub przypomnień, starsze formularze zachowujące pola oraz historię korekt także po zakończeniu cyklu. Cztery obserwowane zależności blokad obejmują pojemność, przyjęcie, konkurujące korekty i klucz zapisu dwóch kursów. Lokalna baza ma 39 migracji; dane własnych prób usunięto, wcześniejsze konta i 17 cen po 100 zł zachowano. Build, TypeScript, ESLint, zrzuty 320/390 px i działający podgląd sprawdzono. [Pełny zakres nadal pozostaje aktywny](docs/PRODUCT-STATUS.md).

Po dodaniu [ponownej decyzji i powrotu do kursu](docs/COURSE-REOPENING.md) 03.10.2026: **745/745 testów** (15,25 s), **34/34 pełne scenariusze** (4,5 minuty) i **76/76 wcześniejszych niezależnych prób PostgreSQL** (8,16 s). Przywrócenie udziału przed startem zachowuje pierwotną cenę, wpłaty, częściowe zwroty i plany; powrót po odmowie nie zajmuje miejsca. Formularz pokazuje cenę i zachowuje powód po konflikcie. Osiem obserwowanych zależności blokad obejmuje ostatnie miejsce, odwołanie, zwrot, dokładne ponowienie i zmianę opiekuna. Lokalna baza ma 40 migracji, zachowane wcześniejsze konta i 17 roboczych cen 100 zł, bez danych własnych prób. Zrzuty 320/390 px, build, TypeScript i ESLint sprawdzono. Cały produkt pozostaje w lokalnym rozwoju; [pozostały zakres](docs/PRODUCT-STATUS.md).

Weryfikacja lokalna z 02.10.2026 po dodaniu rejestru przesłań: **622/622 testy w 58 plikach** i **22/22 pełne rzeczywiste E2E** (3,6 minuty). Wcześniej w tym etapie osobno przeszły **4/4 E2E zdjęć** (19,3 s). Nowy scenariusz obejmuje brak dalszego zapisu po rejestracji lub wysłaniu pliku, wygaśnięcie, działający Storage API i trzy potwierdzone wyścigi z niezależnymi połączeniami bazy; poprzedni E2E sprzątania obejmuje dodatkowo cztery próby zdjęć. Wcześniejszy odrębny zestaw **76/76 prób PostgreSQL** pozostaje historycznym przebiegiem. Lokalny build z TypeScript i ESLint zmienionego kodu przeszły. [Aktualny zakres dowodów i pozostałe procesy](docs/PRODUCT-STATUS.md).

```sh
pnpm lint
pnpm test
pnpm build
```

Vitest obejmuje domenę, walidację, widoki danych, zdjęcia i obsługę dostępu oraz migracje i rzeczywiste polityki SQL uruchamiane w PGlite. Testy bazy obejmują m.in. role, własność, prywatność, pojemność, edycję i odwołanie spacerów, przywracanie zgłoszeń, finanse, relacje oraz Psiutki. PGlite używa minimalnych atrap schematów Auth/Storage; nie zastępuje testu usługi Supabase ani konkurencyjnych operacji na niezależnych połączeniach. Testy Auth z atrapami nie dowodzą działania rzeczywistej sesji lub dostarczania poczty.

Scenariusze Playwright wymagają lokalnego Supabase po wszystkich migracjach i uruchomionej aplikacji. Obejmują zapis na spacer, konsultację z zaleceniami, pełną ścieżkę zaproszonego opiekuna na telefonie, prywatne zdjęcia przez Storage API, przypomnienia z rzeczywistym procesem i wznowieniem po pięciu błędach, historię zaproszeń z wygaśnięciem i zastępowaniem starszych linków, stronicowane finanse oraz ochronę sesji. Dwa procesy finansowe sprawdzają częściowe wpłaty, przełożenie, rezygnację i zwroty konsultacji oraz ręczne uzgodnienie brakującej historycznej ceny, wpłatę i zakończenie opłaconego spotkania. Trzy scenariusze spacerów sprawdzają częściowe wpłaty i zwroty, ponowne obciążenie po korekcie obecności, rezygnację w terminie i po terminie, przywrócenie zgłoszenia, odwołanie organizatora oraz rezerwacje i zużycie pakietu. Obejmują także atomową odmowę korekty, gdy zwrócone wejście przypisano już do innego spaceru, zachowanie formularza i skuteczne ponowienie po uzgodnieniu przydziału.

Trzy kolejne scenariusze sprawdzają rezerwę i ręczną akceptację po zwolnieniu miejsca, odrzucenie i ponowną decyzję, edycję oraz kopiowanie ustawień, a także zaproszenia i zapis automatyczny. Obejmują odmowę przekroczenia pojemności, kolizję kalendarza, nieaktualną kartę edycji, zachowanie wpisanych pól i korzystniejszego terminu bezpłatnej rezygnacji, aktualizację przypomnień i powiadomień oraz dostęp do dokładnej zbiórki wyłącznie po akceptacji.

Testy tworzą własne fikcyjne konta i sprzątają dane, pliki i lokalne wiadomości. Testy konsultacji dodatkowo opóźniają skrypty przeglądarki, aby sprawdzić ochronę formularzy przed utratą pól. Testy finansów zachowują pełne sumy przy 20 pozycjach na stronie i sprawdzają bezpośrednie linki oraz izolację danych. Ochrona sesji obejmuje odrzucenie zmienionego JWT i aktualną rolę przy kolejnym żądaniu. W testach zawierających linki pocztowe, tokeny lub podpisane zdjęcia śledzenie przeglądarki jest wyłączone. Testy przypomnień i wygaśnięcia zaproszeń wymagają także przygotowanych narzędzi lokalnej maszyny Lima. Pierwszy chroni wcześniejsze zadania przed przetwarzaniem, drugi zmienia znaczniki czasu wyłącznie własnego fikcyjnego konta.

```sh
pnpm local:start
# W osobnym terminalu: pnpm local:dev
pnpm local:e2e
```

Pełny E2E biblioteki sprawdza materiał, personalizację dla psa, prywatny szkic, publikację bez pośredniego zapisu, kolejne edycje i historię. Opublikowane plany zachowują wcześniejszą treść, stare karty nie nadpisują nowych zapisów, a opiekun i obce konto nie mają dostępu do biblioteki.

Osobno `pnpm local:concurrency` sprawdza 76 scenariuszy na niezależnych transakcjach PostgreSQL, z potwierdzonym oczekiwaniem na blokady. Obejmuje zaproszenia, pojemność i decyzje spacerów, wpłaty i korekty, pakiety, terminy konsultacji, publikacje planów, kontakty kontrolne, odpowiedzi oraz równoczesne zapisy materiałów biblioteki. Nie wymaga uruchomienia aplikacji ani przeglądarki. [Zakres i warunki uruchomienia](docs/LOCAL-DEVELOPMENT.md#równoczesne-operacje-w-rzeczywistej-bazie).

Launcher odrzuca brak lokalnej konfiguracji i adresy zdalne. Domyślnie używa zainstalowanego Chrome; inny kanał wybiera `PSI_E2E_BROWSER_CHANNEL`. Pominięcie testu nie oznacza poprawnego przejścia. Przegląd wyglądu z fikcyjnymi danymi i atrapami akcji jest oddzielny od sprawdzania rzeczywistego Auth, API i Storage.

Przed pomiarami wydajności użyj `pnpm local:build`, zatrzymaj `local:dev` i uruchom `pnpm local:preview`. Ten podgląd działa lokalnie na tym samym adresie i odrzuca kompilację z niezgodną konfiguracją. Nie korzysta ze zwykłego builda hostingu. Po zmianach kodu wymaga ponownego builda i restartu. [Szczegóły lokalnego podglądu](docs/LOCAL-DEVELOPMENT.md).

Osobny `pnpm local:load` tworzy 50 fikcyjnych opiekunów i jedną prowadzącą z rzeczywistymi sesjami Auth, historią zajęć i finansów. Mierzy pełne odpowiedzi HTML przy 1/5/50 równoczesnych żądaniach, sprawdza pojemność i powtórzenie wpłaty oraz sprząta własne dane. Ostatni przebieg spełnił lokalny cel p95 poniżej 2 s bez błędów. Oddzielnie sprawdza 153 rzeczywiste strony w Chrome przy maksymalnie pięciu aktywnych kartach; nie mierzy docelowego hostingu. [Zakres, wyniki i ograniczenia](docs/PILOT-LOAD.md).

`pnpm local:backup create` zapisuje pełną lokalną bazę i pliki Storage. `pnpm local:backup verify IDENTYFIKATOR` odtwarza kopię w osobnych kontenerach, bez zastępowania źródła. `pnpm local:backup-test` sprawdza zachowane hasła, uprawnienia, zdjęcia oraz niepuste kursy i pakiety fitness z rozliczeniami, planami, korektami obecności i przypomnieniami; nowe zapisy i historyczne ponowienia wykonuje wyłącznie w odtworzeniu. Najnowsza próba z 03.10 potwierdziła 119 tabel, 15 832 wiersze i wszystkie 48 migracji oraz zachowanie wcześniejszych danych po sprzątaniu. Pliki i poświadczenia pozostają prywatne w ignorowanym `.local/backups/`. [Instrukcja, wynik próby i ograniczenia](docs/LOCAL-BACKUPS.md).

Próba `pnpm local:backup-recovery` potwierdza odzyskanie po czterech rzeczywistych przerwaniach procesu kopii lub odtworzenia. Po nagłym zabiciu procesu użyj `local:backup recover ID_KOPII` albo `local:backup recover-restore ID_KOPII ID_ODTWORZENIA`. Nie usuwaj ręcznie blokady źródła; dziennik i własność zasobów są sprawdzane przed odzyskiwaniem.

[Pakiet fitness](docs/FITNESS-MODULE.md) ma lokalne panele obu ról: zgłoszenie z oferty, indywidualne terminy, obecności, korekty, spotkanie zastępcze, rozliczenie całości i częściowe zwroty. Kalendarz, finanse, kolejka, skrzynki i przypomnienia prowadzą do właściwego pakietu lub spotkania. Prowadząca przygotowuje prywatny szkic i publikuje zalecenia całego pakietu albo po zakończonym spotkaniu; wcześniejsze publikacje zachowują kontekst także po rezygnacji. Migracje `202610030005`–`202610030008` zastosowano wyłącznie lokalnie; odbiór tego etapu objął 44 migracje. Przeszło 862/862 testów w 68 plikach, 26 prób odrębnej bazy z 22 zależnościami blokad i ponownie 76/76 wcześniejszych prób PostgreSQL. Końcowa kompilacja przeszła 39/39 wszystkich E2E aplikacji (5,2 minuty), w tym cztery ścieżki fitness; układ 320/390 px i zachowanie wcześniejszych danych sprawdzono. Odtworzenie niepustej kopii 44 migracji potwierdziło zachowanie dwóch pakietów, ośmiu spotkań, rozliczeń, planów i skrzynek oraz 22 historyczne ponowienia bez duplikatów i zmian źródła. `pnpm local:reminders-test` potwierdził restart rzeczywistych procesów przed i po zatwierdzeniu oraz poprawne zakończenie trybu ciągłego, z trzema pojedynczymi dostarczeniami fitness. [Zakres próby procesu](docs/REMINDERS-MODULE.md#przerwanie-i-restart-rzeczywistego-procesu--03102026).

## Wdrożenie i ograniczenia

Projekt wymaga runtime Next.js/Node, np. Vercel lub własnego serwera. Nie jest eksportem statycznym. Publiczne zmienne środowiskowe ustaw przed buildem, a adresy Auth dostosuj do docelowej domeny. Hosting musi obsługiwać serwerowe przetwarzanie zdjęć przez `sharp`. Przy własnym serwerze po `pnpm build` uruchom `pnpm start`; zachowaj `.next`, `public` i zależności produkcyjne. Domyślny skrypt startuje na interfejsie lokalnym, więc udostępnienie na zewnątrz wymaga odpowiedniego proxy.

Końcowa kontrola aktualizacji powinna objąć zgodność migracji, logowanie obu kont pilota, jednorazową aktywację i ponowne logowanie hasłem, ograniczenia ról, zapis w modułach spacerów/finansów/relacji/Psiutków oraz widoki na komputerze i telefonie. Nie należy na podstawie samego builda ogłaszać gotowości wysyłki poczty lub wdrożenia klientów.

Znane ograniczenia:

- Zewnętrzny SMTP i zaproszenia klientów pozostają odłożone. Zaproszenie i samodzielne odzyskanie hasła są zaimplementowane oraz sprawdzane wyłącznie z lokalną skrzynką.
- Brak wysyłki e-mailowych przypomnień, WhatsApp, czatu, AI, płatności online, faktur i wielofirmowości. Skrzynka powiadomień i [kolejka terminowych przypomnień](docs/REMINDERS-MODULE.md) działają w chmurze przez harmonogram Supabase; lokalnie używają osobnego procesu. Zwroty pieniędzy odbywają się poza aplikacją.
- Zmiana spaceru lub jego odwołanie zapisuje powiadomienie dla właściwych opiekunów w aplikacji, także w chmurze. Nie wysyła e-maili ani wiadomości poza aplikację.
- Nie ma automatycznego awansu rezerwy. Kwalifikację, ostrzeżenia relacji i propozycje wspólnych spotkań ocenia behawiorysta.
- Finanse pokazują po 20 pozycji w trzech niezależnych listach, zachowując pełne sumy i historię. Pozostałe zbiorcze odczyty wymagają dalszej oceny dla większej skali; sam pomiar 50 lokalnych sesji nie dowodzi gotowości dowolnego obciążenia.
- Sprzątanie zastąpionych zdjęć i zarejestrowanych niedokończonych przesłań działa lokalnie przez trwałą kolejkę i Storage API. W chmurze automatyczne fizyczne usuwanie zdjęć jest wyłączone; pozostają dawne osierocone pliki i ręczne przesłania bez rejestracji.
- Opcjonalna nawigacja WebMCP nie zastępuje autoryzacji i nie jest warunkiem działania paneli. Jej integrację należy sprawdzić w obsługującym ją środowisku.

Prototyp referencyjny znajduje się w `public/reference/prototype.html`. Docelowy oryginalny plik logo można podmienić po jego dostarczeniu. Zasady pracy z zainstalowaną wersją Next.js opisuje `AGENTS.md`; przed zmianą kodu czytaj odpowiednie lokalne przewodniki w `node_modules/next/dist/docs/`.

Lokalny moduł zaproszeń i kont demonstracyjnych: [instrukcja i ograniczenia](docs/INVITATIONS-MODULE.md). Zaproszenia mogą trafiać wyłącznie do lokalnej skrzynki. Nie włączono wysyłki do rzeczywistych klientów.

[Karty podarunkowe](docs/GIFT-CARDS-MODULE.md) działają w obu lokalnych panelach: wartość lub konkretna usługa, personalizacja, aktywacja kodem, sześć miesięcy ważności, rozliczenie salda i częściowe zwroty. Sprzedaż jest liczona raz; użycie karty nie powiela wpływu pieniędzy. Migracja `202610030009` została zastosowana wyłącznie lokalnie; odbiór tego etapu objął 45 migracji. Końcowy odbiór: 941/941 testów w 73 plikach, 40/40 pełnych E2E, 19/19 prób osobnej bazy z 18 obserwowanymi zależnościami blokad, kompilacja z TypeScript i ESLint. Telefon 320/390 px oraz jednostronicowy PDF sprawdzono. Kopia 117 tabel i 14 582 wierszy zachowała logowania, zdjęcia i dwie karty z kodami, saldem, zwrotami oraz historycznymi ponowieniami. Wcześniejsze dane i 17 cen roboczych 100 zł zachowano; podgląd działa na localhost:3000. Automatyczne przekazanie PDF i zaproszenia klientów pozostają odłożone do konfiguracji poczty.

[Stały tydzień i przerwy](docs/CALENDAR-MODULE.md) po etapie 47 migracji są ustawiane przez prowadzącą w kalendarzu, domyślnie wyłączone. Zapis sprawdza dotychczasowe terminy i chroni przed nadpisaniem z drugiej karty. Odbiór tego etapu objął 47 migracji, 967 testów i 42 pełne E2E; późniejszy stan wskazuje odbiór produktu. Kopia 119 tabel i 15 193 wierszy zachowała także prywatne ustawienia i siedem dni, nowy zapis przez odtworzone API oraz ponowienie bez dodatkowego audytu. Dalszy zakres i warunki odbioru opisuje [stan produktu](docs/PRODUCT-STATUS.md).
