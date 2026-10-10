# Lokalny rozwój produktu

Rozwój i codzienne testy korzystają z oddzielnego lokalnego Supabase. Decyzja użytkownika z 18.09.2026 wymagała lokalnego odbioru oraz nowej zgody przed publikacją; późniejsze zgody objęły MVP i aktualizację po feedbacku z 10.10.2026. Ta wersja jest opublikowana z 49 migracjami. [Aktualny stan hostingu i operacje](VERCEL-SUPABASE-PILOT.md#aktualizacja-po-feedbacku--10102026). Lokalnych launcherów, testów ani seederów nadal nie kierujemy do chmury; nowe etapy nie są publikowane automatycznie przez sam lokalny odbiór.

## Lokalny odbiór MVP — 03.10.2026

**Nowsza iteracja 10.10.2026:** lokalny schemat ma 49 migracji do `202610100001_calendar_team.sql`. Obejmuje kalendarz zespołu, sale, własne godziny, preferowane przerwy, miesiąc i całodniowe blokady oraz uproszczony kontekst planu i ofertę. Po lokalnym odbiorze i późniejszej zgodzie użytkownika tę samą wersję zastosowano w chmurze; historia produkcyjna również ma 49 migracji. [Lokalny zakres i odbiór](PRODUCT-STATUS.md#pierwsza-lokalna-iteracja-po-feedbacku--10102026) oraz [osobna kontrola publikacji](PRODUCT-STATUS.md#publikacja-aktualizacji-po-feedbacku--10102026). Wyniki poniżej opisują wcześniejszy odbiór MVP.

Lokalny MVP jest gotowy do wspólnych testów: **971/971 testów w 73 plikach**, **45/45 pełnych E2E** (6,2 minuty), TypeScript i ESLint. Baza ma **48 migracji**; podgląd ma zgodny manifest i odpowiada HTTP 200. [Próba 50 kont](PILOT-LOAD.md) objęła 1050 odczytów opiekunów, 27 prowadzącej, 153 rzeczywiste strony Chrome, 50 zapisów na cztery miejsca i 50 ponowień jednej wpłaty. Lokalny cel p95 HTTP poniżej 2 s został spełniony.

[Kolejka](REMINDERS-MODULE.md#kolejka-50-opiekunów-i-pełne-wycofanie-wielu-odbiorców--03102026) dostarczyła 250 zadań bez duplikatów i cofnęła całe dostarczenie zespołu po błędzie drugiego odbiorcy. [Kopia 48 migracji](LOCAL-BACKUPS.md#bieżący-wynik-03102026) odtworzyła cały schemat, 119 tabel, 15 832 wiersze i zdjęcia, z zachowanym logowaniem i nowymi zapisami przez API.

Końcowy odczyt potwierdził wszystkie wcześniejsze wiersze publiczne, pięć kont, cztery psy, trzy spacery, 17 cen roboczych 100 zł i zajętość. Własne dane prób usunięto. Znacznik przypomnień celowo odzwierciedla rzeczywiste uruchomienia. Godziny są nadal wyłączone i przerwy zerowe. [Zakres i przygotowania do live](PRODUCT-STATUS.md#przed-dołączeniem-prawdziwych-klientów) rozdzielają lokalny odbiór od przyszłego hostingu, poczty, harmonogramu i kopii poza komputerem.

## Wcześniejsze etapy

Wcześniejszy etap 47 migracji 03.10.2026: [ustawienia kalendarza](CALENDAR-MODULE.md) mają prywatny stały tydzień i przerwy, domyślnie wyłączone, kontrolę już umówionych terminów i konfliktów dwóch edytorów. Lokalnie zastosowano `202610030010` oraz poprawkę API `202610030011`; odbiór tego etapu objął **47 migracji**. Przeszło 967 testów, 42 pełne E2E, osiem prób osobnej bazy z sześcioma obserwowanymi blokadami, kompilacja, TypeScript i ESLint. [Kopia 47 migracji](LOCAL-BACKUPS.md#wcześniejszy-wynik-kalendarza-z-47-migracjami) odtworzyła 119 tabel i 15 193 wiersze, w tym prywatne ustawienia i siedem dni; nowy zapis przerw i ponowienie działały przez odtworzone API. Źródło i własne sprzątanie sprawdzono; podgląd działa. Pozostały zakres wskazuje [stan produktu](PRODUCT-STATUS.md).

Wcześniejszy etap 03.10.2026: lokalnie zastosowano `202610030009_gift_cards.sql`; odbiór tego etapu objął **45 migracji**. [Karty podarunkowe](GIFT-CARDS-MODULE.md) obejmują oba panele, aktywację, personalizację i PDF, saldo, pięć źródeł należności oraz częściowe zwroty. Końcowo przeszło 941/941 testów w 73 plikach i 40/40 pełnych E2E (5,4 minuty), kompilacja z TypeScript i ESLint. Osobna baza przeszła 19/19 prób z 18 obserwowanymi zależnościami blokad. [Odtworzenie kopii 45 migracji](LOCAL-BACKUPS.md#wcześniejszy-wynik-kart-z-45-migracjami) sprawdziło 117 tabel i 14 582 wiersze, logowania, zdjęcia oraz dwie karty z rozliczeniami i ponowieniami. Własne dane i zasoby usunięto, wszystkie wcześniejsze konta, psy, spacery i ceny zachowano; podgląd działa. Nie zmieniano produkcji.

Wcześniejszy etap 03.10.2026: lokalnie zastosowano `202610030008_fitness_care.sql`, wcześniej sprawdzoną w osobnej bazie. Odbiór tego etapu objął **44 migracje**. Zalecenia mają jawny pakiet i opcjonalne spotkanie fitness, szkic pozostaje prywatny, a publikacja po spotkaniu wymaga jego zakończenia. Przeszło 862 testów w 68 plikach, 26 prób osobnej bazy i 76 dotychczasowych prób PostgreSQL. Końcowa kompilacja przeszła 39/39 pełnych E2E (5,2 minuty). Zachowano identyfikatory pięciu wcześniejszych kont, czterech psów i trzech spacerów; 17 aktywnych usług nadal ma ceny robocze 100 zł. Dane własnych prób fitness usunięto, podgląd działa. Niepusta kopia tego schematu została odtworzona: 109 tabel, 13 958 wierszy, zachowane logowania i zdjęcia, dwa pakiety fitness z ośmioma spotkaniami oraz 22 historyczne ponowienia bez duplikatów. [Dokładny zakres i granice](LOCAL-BACKUPS.md#wcześniejszy-wynik-fitness-z-44-migracjami). Produkcji nie zmieniano.

Testy logiki, danych, uprawnień i interfejsu pozostają częścią każdej zmiany. Końcowy odbiór objął połączony proces obu ról; ograniczamy liczbę wdrożeń, nie odkładamy wykrywania błędów do końca projektu.

## Izolacja

- `next dev` przyjmuje tylko bazę pod `localhost`, `127.0.0.1` lub `[::1]`. Wspólna konfiguracja blokuje klientów Supabase zarówno na serwerze, jak i w przeglądarce przed połączeniem z chmurą. Strona logowania informuje o braku lokalnej bazy.
- Istniejąca `.env.local` nie została zmieniona. Dane lokalne trafiają do ignorowanej `.env.development.local`, którą Next wczytuje wcześniej.
- `scripts/local-env.mjs` korzysta wyłącznie z `supabase status`, odrzuca zdalny URL i zapisuje lokalne ustawienia bez drukowania kluczy. Klucz administracyjny lokalnego stosu trafia do `.env.test.local` oraz serwerowej `.env.development.local` dla lokalnego adaptera zaproszeń. Oba pliki mają uprawnienia `0600`; klucz nie jest zmienną publiczną.
- Seed demonstracyjny i scenariusze E2E odrzucają zdalne adresy. Zmienne publiczne nie są wystarczającą ochroną samodzielnego skryptu SQL: nie używamy komend z `--linked`, `--db-url` ani `supabase db push` podczas tej fazy.
- Blokada dotyczy trybu development. Build i `next start` korzystają z konfiguracji produkcyjnej, dlatego do lokalnego sprawdzania builda należy jawnie przekazać **lokalne** zmienne. Nie uruchamiać starego builda zawierającego adres bazy w chmurze.

## Pełne środowisko na tym komputerze

19.09.2026 uruchomiono rzeczywisty lokalny Supabase: PostgreSQL 17, Auth, API, Storage, Studio i skrzynkę Mailpit. Wszystkie 23 migracje aplikacji wykonały się poprawnie. Narzędzia są w ignorowanej `.local/tools`: Lima 2.2.0, Docker CLI 29.8.1 i Supabase CLI 2.117.0. Nie wymagają logowania do projektu w chmurze.

02.10.2026 lokalnie zastosowano także `202610020001`–`202610020006`: historię zaproszeń, poprawne rozpoznawanie ustawienia osobistego hasła, archiwum niewysłanych szkiców, przyspieszenie polityk odczytu oraz jawne uzgodnienie brakującej ceny starszej konsultacji i zachowanie statusu rzeczywistego zwrotu spaceru po późniejszej korekcie obecności. Łącznie baza ma **29 migracji**. Migracja `202610020004` zmienia wyłącznie odczyty i dodaje indeks zgłoszeń psa; nie zmienia dostępu do dokładnej lokalizacji. `202610020005` nie uzupełnia automatycznie żadnych historycznych cen; udostępnia prowadzącej wersjonowaną operację z historią, audytem i powiadomieniem w aplikacji. `202610020006` porządkuje statusy zwolnionych należności z rzeczywistym zwrotem i bez pozostawionej wpłaty; nie zmienia wpisów, kwot ani historii rozliczeń. Nie resetowano danych ani nie zastosowano zmian w chmurze.

Lima uruchamia natywną maszynę macOS/Apple Silicon, ograniczoną do **2 rdzeni, 4 GB RAM i dysku 24 GB**. Udostępniony jest tylko katalog `supabase/`. Porty sieci testowej wiążą się z localhost. Dodatkowe usługi analityczne, Edge Runtime i pooler nie są uruchamiane; używane w aplikacji Auth, REST i Storage działają.

Z katalogu projektu:

```sh
pnpm local:start
pnpm local:dev
```

`local:start` uruchamia maszynę i bazę, sprawdza prywatną sieć oraz przygotowuje pliki lokalnych ustawień. `local:dev` sprawdza oba adresy i jawnie przekazuje lokalne klucze do procesu Next.js. Dzięki temu istniejące zmienne środowiska lub `.env.local` nie wybierają bazy w chmurze. Nie uruchamiaj Next.js przez `node --env-file=...`: obecna wersja Next przekazuje ten argument do `NODE_OPTIONS` procesu potomnego, co Node odrzuca.

Stan i zatrzymanie środowiska:

```sh
pnpm local:status
pnpm local:stop
```

Najpierw zakończ proces aplikacji klawiszami Ctrl+C. `local:stop` zachowuje dane i zatrzymuje maszynę, zwalniając jej pamięć. Logi uruchomienia są prywatne (`0600`) w `.local/`; mogą zawierać lokalne klucze, więc nie należy ich publikować. Polecenie status pokazuje wyłącznie adresy usług.

- Aplikacja: <http://localhost:3000>
- Studio lokalnej bazy: <http://localhost:54323>
- Lokalna skrzynka testowa: <http://localhost:54324>

Helper konfiguracji ustawia `AUTH_EMAIL_ENABLED=true` oraz lokalne zaproszenia. Poczta trafia do lokalnej skrzynki; nie do prawdziwych adresatów. W konfiguracji Auth `enable_signup=false` blokuje publiczne zakładanie kont, a `auth.email.enable_signup=true` pozostawia włączonego dostawcę e-mail/hasło dla kont istniejących i zaproszonych. Ustawienie obu flag na false wyłącza również logowanie hasłem — wykrył to pierwszy rzeczywisty test API. Zmiany konfiguracji lub szablonów Auth wymagają zatrzymania i ponownego uruchomienia stosu, bez resetowania danych.

## Konta i testy

Utworzono trzy fikcyjne konta (jedna prowadząca, dwóch opiekunów), cztery psy i trzy terminy spacerów. Każde konto ma odrębne losowe hasło. Dane dostępowe są w ignorowanym `.local/accounts.json` z uprawnieniami `0600`. Nie kopiuj ich do dokumentacji ani repozytorium. Seed odmawia nadpisania istniejącego zestawu; szczegóły w [module zaproszeń](INVITATIONS-MODULE.md).

Po uruchomieniu aplikacji:

```sh
pnpm local:e2e
```

Testy używają tej samej jawnej lokalnej konfiguracji, jednego procesu i domyślnie zainstalowanego Chrome. Inną przeglądarkę Playwright można wybrać przez `PSI_E2E_BROWSER_CHANNEL`. Testy tworzą własne fikcyjne konta; nie używają danych dostępowych kont demonstracyjnych.

01.10.2026 cztery rzeczywiste scenariusze przeszły poprawnie także na gotowej lokalnej kompilacji: spacer z decyzją, konsultacja z zaleceniami, pełna ścieżka zaproszonego opiekuna na telefonie i prywatne zdjęcia przez Storage API. Scenariusz zaproszenia obejmuje teraz również dodanie psa, konsultację, plan, odpowiedź i ponowne odczytanie planu po odzyskaniu hasła — na tej samej tożsamości. Wiadomości i pliki testowe są usuwane według własnych identyfikatorów po próbie. Uruchamiaj ciężkie testy SQL i przeglądarkę kolejno. Czasy kompilacji w development nie są pomiarem wydajności produktu.

02.10.2026 cały zestaw **pięciu E2E przeszedł poprawnie w 1,4 minuty**. Nowy scenariusz [przypomnień](REMINDERS-MODULE.md) uruchamia prawdziwy lokalny proces przez API, sprawdza dwóch równoczesnych dostawców, zmianę i odwołanie terminu, zaległy kontakt, pięć błędów oraz ręczne wznowienie z telefonu. Wymaga także lokalnego socketu Docker i `psql` kontenera; poza tą maszyną trzeba przygotować równoważne środowisko przed jego uruchomieniem. Wcześniejsze zadania kolejki są blokowane tylko na czas wywołania i sprawdzane pod kątem braku zmian. Wprowadzono trwałe potwierdzenie wznowienia, poprawę szerokości przycisku i osobny wiersz nagłówka na ekranach do 360 px. Sprawdzono widoki 320/390/768/1440 px i wszystkie wcześniejsze E2E po zmianie wspólnego nagłówka.

Kolejny przebieg tego dnia obejmował **sześć E2E, wszystkie poprawne w 1,4 minuty**. [Zaproszenia](INVITATIONS-MODULE.md) mają dodatkowy test historii, rzeczywistego wygaśnięcia i zastępowania linków. Wymaga lokalnego socketu Docker jak test przypomnień; zmienia znaczniki czasu jedynie własnego fikcyjnego konta. Wspólny pomocnik `local-mail.ts` pobiera tylko wiadomości `psi-e2e-…@example.test`, a przy ponowieniu odrzuca identyfikatory wcześniejszych wiadomości. Tokeny nie są zapisywane w raportach ani trace. Test wykrył hasło techniczne generowane przez Auth i doprowadził do poprawienia etapu aktywacji. Zestaw Vitest: 502 testy w 50 plikach, poprawnie.

## Zdjęcia i lokalne sprzątanie

Migracje `202610020008_avatar_lifecycle.sql`, `202610020009_avatar_cleanup_paths.sql` i `202610020010_avatar_upload_reservations.sql` zostały zastosowane wyłącznie w lokalnej bazie 02.10.2026. Baza ma 33 migracje. Aplikacja sprząta zastąpione pliki przez Storage API; SQL przechowuje odłączone klucze i ich ponowienia, bez usuwania danych ze schematu dostawcy. Druga migracja odrzuca niepoprawne klucze, które mogłyby zatrzymywać partię zadań. Trzecia rejestruje nowe przesłanie przed wysłaniem danych i zamyka je atomowo po zapisie zdjęcia. [Opis zachowania i ograniczeń](../README.md#zdjęcia-psów-i-psiutków).

`pnpm local:avatar-cleanup` przetwarza jednorazowo do 20 gotowych zadań. Nie odczytuje `.env.local`, odrzuca adresy zdalne, nie wypisuje kluczy, ścieżek zdjęć ani podpisanych adresów. Nie jest uruchamiany w tle. Po błędzie zadanie otrzymuje termin ponowienia od 30 sekund do godziny; polecenie można uruchomić ponownie po tym terminie.

Przed odczytem partii proces przenosi do kolejki do 20 rejestrów wygasłych przesłań. Wygaśnięcie następuje po 30 minutach; ponowienie rejestracji zachowuje pierwotny termin. Zamknięcie następuje przy dołączeniu pliku albo jawnym porzuceniu przesłania. Proces czeka na tę samą blokadę klucza co zapis zdjęcia, następnie ponownie czyta rejestr i odwołania. Nie trzyma blokady wiersza rejestru przed blokadą klucza. Chroni to przed wzajemnym zakleszczeniem zapisu i sprzątania oraz przed usunięciem zdjęcia zapisanego podczas oczekiwania. Nie dodano skanowania wcześniejszych plików ani automatycznego harmonogramu.

Rzeczywisty E2E sprzątania tworzy własne pliki przez Storage API i używa niezależnych transakcji PostgreSQL. Potwierdza cztery oczekiwania na blokady: dwie zmiany z tej samej starej karty, dołączenie przed niepewnym sprzątaniem, wycofanie klucza przed dołączeniem oraz usunięcie przed konkurującą wymianą. Próba przerwania żądania usunięcia, opóźnionego ponowienia i dwóch procesów sprawdza ukończenie bez duplikowania wpisu. W tym scenariuszu wynik odczytu kolejki jest ograniczany do własnych kluczy testu; inne zadania i pliki nie biorą udziału w próbie.

W tym etapie przeszło 603/603 testów w 57 plikach (12,12 s), 21/21 pełnych E2E we wspólnym przebiegu (3,8 minuty) i 76/76 niezależnych scenariuszy PostgreSQL (9,04 s). Po ostatniej walidacji ścieżek i ustabilizowaniu przewijania przed zrzutami ponownie przeszły 3/3 E2E zdjęć (15,8 s). Zrzuty 320, 390 i 1440 px sprawdzono wizualnie. Build, TypeScript i ESLint przeszły; cztery identyczne, automatycznie wygenerowane kopie typów w `.next-local/types` usunięto przed końcową kontrolą TypeScript. Testy nie używały kont ani plików produkcji.

Końcowy odczyt potwierdził 32 migracje, zachowanie pięciu wcześniejszych kont, brak kont prób współbieżności, psów prób zdjęć, pozostawionych wpisów ich sprzątania i materiałów testowej biblioteki. Katalog ma 17 aktywnych usług po robocze 100 zł. Manifest podglądu jest gotowy i zgodny z identyfikatorem kompilacji; lokalne logowanie odpowiada HTTP 200.

Po dodaniu rejestru przesłań: **622/622 testy w 58 plikach** (16,38 s), build z TypeScript i ESLint zmienionego kodu przeszły. **4/4 rzeczywiste E2E zdjęć** (19,3 s) obejmują nowy `tests/e2e/avatar-upload-recovery.spec.ts`: brak kontynuacji po rejestracji bez danych i po wysłaniu danych, wygaśnięcie, sprzątanie pięciu własnych kluczy przez Storage API oraz ochronę dwóch zapisanych zdjęć. Trzy wyścigi mają potwierdzone oczekiwanie bazy: zapis → wygaśnięcie, wygaśnięcie → późny zapis i dwa procesy wygaszające ten sam rejestr. Upływ czasu jest symulowany wyłącznie dla własnych rekordów próby; nie zatrzymywano procesu Supabase ani rzeczywistej aplikacji w połowie przesyłania. Osobne testy operacji aplikacji sprawdzają oczekiwanie na rejestrację i utratę odpowiedzi. Testy nie korzystają z produkcji.

Po tych sprawdzeniach **22/22 pełne E2E** przeszły we wspólnym przebiegu (3,6 minuty). Odczyt rzeczywistej bazy potwierdził 33 migracje, pięć kont, zero rejestrów przesłań, wpisów sprzątania i psów nowej próby. Brak metadanych zdjęć odwołujących się do nieistniejących psów; pliki własnej próby usunięto przez Storage API. Katalog pozostał z 17 aktywnymi usługami po robocze 100 zł. Podgląd ma gotowy manifest zgodny z kompilacją, a logowanie odpowiada HTTP 200. Wcześniejsze 76 prób PostgreSQL, pomiar 50 kont i odtworzenie kopii są odrębnymi historycznymi przebiegami.

## Rdzeń kursów w lokalnej bazie — wcześniejszy etap

Migracja `202610020011_courses.sql` została zastosowana wyłącznie lokalnie. Baza ma 34 migracje. [Zakres rdzenia i pozostałe panele](SERVICES-MODULE.md#rdzeń-cyklu-kursu) obejmują cykl, cenę za całość, zgłoszenia, decyzje, obecności i ochronę terminów przez dotychczasową wspólną tabelę kalendarza. Nowy typ kursu nie jest jeszcze zwracany przez odczyt kalendarza lub pulpit; nie ma jeszcze panelu kursów. Nie uruchamiano zewnętrznych wiadomości, integracji płatności ani wdrożenia.

W tym etapie przeszło **635/635 testów w 59 plikach** (13,68 s), **23/23 rzeczywiste scenariusze Auth/API/przeglądarki** (3,8 minuty) oraz ponownie **76/76 wcześniejszych prób PostgreSQL** (8,89 s). Nowy `tests/e2e/courses-domain.spec.ts` jest próbą API i niezależnych transakcji, bez przejścia formularzy kursu: sprawdza prywatność, kwotę całego cyklu, ostatnie miejsce, zamknięcie przy zgłoszeniu, odwołanie przy decyzji oraz obie kolejności kolizji publikacji i blokady. Wszystkie pięć oczekiwań na konkretną blokadę potwierdza obserwator. TypeScript i ESLint przeszły; usunięto wyłącznie cztery identyczne kopie automatycznie wygenerowanych typów, które ponownie pojawiły się w katalogu kompilacji.

Końcowy odczyt potwierdził pięć kont i brak kursów, spotkań, zgłoszeń, zajętych terminów oraz psów własnej próby. Nie pozostały rejestry przesłań ani zadania zdjęć. Wszystkie 17 usług ma nadal robocze 100 zł; sześć wariantów kursowych ma osobne oznaczenie formy indywidualnej lub grupowej. Podgląd z wcześniejszej kompilacji jest gotowy, identyfikator zgadza się z manifestem, a logowanie odpowiada HTTP 200. Zmieniono schemat, modele i testy; kod działających ekranów pozostaje bez zmian.

## Panele kursów i kalendarz

Po rdzeniu dodano lokalne panele `/admin/courses` i `/app/courses`, tworzenie cyklu oraz połączenie z katalogiem, wspólnym kalendarzem i odnośnikiem najbliższego spotkania. Migracja `202610020012_course_calendar.sql` została zastosowana wyłącznie lokalnie; łącznie jest 35 migracji. [Opis formularzy i zakres](SERVICES-MODULE.md#panele-kursów-i-kalendarz).

Przeszło **650/650 testów w 60 plikach** (14,35 s), **25/25 rzeczywistych scenariuszy** we wspólnym przebiegu (3,9 minuty) i **76/76 istniejących niezależnych prób PostgreSQL** (9,10 s). Po poprawie pustego widoku wyboru psa oraz skrótów do zgłoszeń wykonano nowy build i powtórzono **2/2** scenariusze kursów (17,9 s). Nowy test przeglądarkowy `tests/e2e/courses-journey.spec.ts` przechodzi oba panele i zachowane stare formularze; obejmuje także odmowę zgłoszenia z nieaktualnym harmonogramem bez zmiany wyboru psa. W drugiej próbie tylko własny rekord pierwszego spotkania otrzymuje czas w przeszłości, aby sprawdzić obecności i zakończenie. Zrzuty końcowych danych przy 320/390/1440 px i dwie karty szczegółów sprawdzono wizualnie; ekran ładowania nie jest uznawany za odbiór widoku.

Build z TypeScript, ESLint zmienionego kodu i kontrola różnic przeszły. Odczyt bazy potwierdził 35 migracji, pięć wcześniejszych kont, brak kursów i psów własnych prób oraz 17 aktywnych usług po robocze 100 zł. Podgląd ma gotowy manifest zgodny z identyfikatorem kompilacji; logowanie odpowiada HTTP 200. Został uruchomiony z nowymi panelami. Nie stosowano migracji ani wdrożeń w chmurze. Finanse i powiadomienia kursów pozostają kolejnym etapem.

Końcowa kontrola typów ponownie wykryła cztery kopie z przyrostkiem ` 2.ts` w `.next-local/types`. Porównano każdą bajt po bajcie z plikiem bez przyrostka; wszystkie były identyczne. Usunięto wyłącznie te kopie wygenerowanych plików, po czym kontrola typów przeszła. Nie zmieniano zakresu kontroli, źródeł aplikacji ani plików użytkownika; przyczyna ponownego pojawiania się kopii pozostaje nieustalona.

## Rozliczenia kursów

Migracja `202610020013_course_finance.sql` została zastosowana wyłącznie lokalnie. Baza ma 36 migracji. Szczegóły kursu pokazują należność, wpłaty po zwrotach, historię częściowych zwrotów i uzgodnienie kwoty po rezygnacji. Kursy są również we wspólnych finansach; odnośnik otwiera wybrane zgłoszenie niezależnie od strony listy. [Zasady ewidencji i granice operacji](SERVICES-MODULE.md#rozliczenia-kursów).

Przeszło **684/684 testów w 62 plikach** (14,82 s), w tym 29 testów bazy kursów. **27/27 rzeczywistych scenariuszy Auth/API/przeglądarki** przeszło we wspólnym przebiegu (4,0 minuty), a dotychczasowe **76/76 prób PostgreSQL** po zmianie wspólnej ewidencji (8,88 s). Testy wykonują się kolejno z ograniczeniem liczby procesów; nie są pomiarem hostingu lub obciążenia 50 osób.

Nowy `tests/e2e/course-finance.spec.ts` obejmuje dwie próby. Pierwsza korzysta z prawdziwego Auth/PostgREST i niezależnych połączeń PostgreSQL. Obserwator potwierdza sześć zależności blokad: dwie wpłaty ponad należność, ponowne użycie jednego klucza dla innej należności, rezygnację przy wpłacie, dwa uzgodnienia z tej samej wersji, dwie części zwrotu ponad pozostałą wpłatę oraz uzgodnienie konkurujące ze zwrotem. Sprawdza końcowe kwoty, zachowanie pierwotnych wpłat, dokładne ponowienia po późniejszych operacjach i izolację opiekunów. Pięć wcześniejszych wyścigów domeny kursów pozostaje w `courses-domain.spec.ts`.

Druga próba prowadzi oba panele przez wpłaty 40 + 60 zł, rezygnację, uzgodnienie 30 zł oraz rzeczywiste wpisy zwrotów 20 + 50 zł. Starsze uzgodnienie i nadmierny zwrot są odrzucane bez utraty kwoty i notatki. Po własnym zapisie potwierdzenie pozostaje widoczne, a ponowny wpis wymaga wczytania salda. Test wykrył odnośnik wykonujący tylko nawigację do fragmentu zamiast odświeżenia formularza; poprawka jest sprawdzana zmianą identyfikatora żądania i nową pozostałą kwotą po pierwszej wpłacie. Przelewy nie są wykonywane; cała próba wykorzystuje fikcyjne konta i zapisy ewidencji.

Po końcowym dopracowaniu położenia rozliczenia poniżej przyklejonego nagłówka oraz oznaczenia rozliczonej kwoty wykonano nowy build i ponowiono próbę formularzy. Zrzuty sekcji przy 320, 390 i 1440 px znajdują się w `output/course-finance/`; długie karty są przechwytywane przy zwiększonej wysokości okna, aby rzeczywisty nagłówek nie zakrył treści. Test sprawdza brak przewijania strony w poziomie przy standardowej wysokości 844 px i widoczność karty poniżej nagłówka przed przechwyceniem. Kontrola dotyczy układu tych szerokości, nie całej aplikacji na każdym urządzeniu.

Końcowy scenariusz formularzy przeszedł ponownie w 8,3 s (9,2 s z uruchomieniem), a sześć testów widoków po doprecyzowaniu oznaczenia „Rozliczone”. Zrzuty sprawdzono wizualnie; nagłówek nie zakrywa treści. Końcowy odczyt potwierdził 36 migracji, pięć wcześniejszych kont, zero kursów, zgłoszeń, ich wpłat, zwrotów, uzgodnień i psów własnej próby. Nie pozostały rejestry przesłań ani zadania zdjęć. Wszystkie 17 usług pozostało aktywnych po robocze 100 zł. Build z TypeScript, ESLint zmienionego kodu i kontrola różnic przeszły. Manifest podglądu zgadza się z kompilacją; lokalne logowanie odpowiada HTTP 200.

Końcowa osobna kontrola typów ponownie wykryła cztery kopie z przyrostkiem ` 2.ts` w `.next-local/types`. Wszystkie porównano z kanonicznymi plikami przed usunięciem; były identyczne. Po usunięciu wyłącznie tych wygenerowanych kopii kontrola typów przeszła. Przyczyna ich odtwarzania nadal nie jest ustalona.

Powiadomienia i przypomnienia dodano w kolejnym etapie opisanym poniżej; zalecenia kursów pozostają do zbudowania. Nie stosowano migracji w chmurze, nie publikowano aplikacji i nie zmieniano katalogowych cen 17 usług.

## Powiadomienia i przypomnienia kursów

03.10.2026 migracja `202610030001_course_notifications.sql` została zastosowana tylko lokalnie, po przejściu testów wszystkich migracji. Historia kursów tworzy wiadomości o zgłoszeniach, decyzjach, spotkaniach, obecnościach i rozliczeniach. Kursowe wpłaty i zwroty nie powielają ogólnych wiadomości z audytu. Skrzynka zachowuje opiekuna zgłoszenia również po zmianie profilu psa; lista nie udostępnia wtedy nowej prywatnej nazwy psa.

Przyjęte zgłoszenie ma trwałe źródło i zadanie dla każdego przyszłego spotkania. Przełożenie wymienia tylko jego oczekującą generację, rezygnacja i odwołanie wycofują przyszłe zadania, a zmiana finansowa nie powoduje ponownego przypomnienia. Zmiany ograniczają synchronizację do właściwego spotkania lub zgłoszenia. [Zasady](REMINDERS-MODULE.md#przypomnienia-spotkań-kursowych).

Przeszło **702/702 testów w 62 plikach** (31,37 s). Jest wśród nich 44 testów bazy kursów, z 15 nowymi próbami skrzynki i przypomnień. Próba 50 uczestników jednego opiekuna zachowuje 250 zadań dla pięciu spotkań; partie 13 + 13 + 24 dostarczają dokładnie 50 pierwszych spotkań i pozostawiają 200 przyszłych. To dowód kompletności źródeł i limitów partii w PGlite, bez twierdzenia o przepustowości 50 niezależnych sesji na hostingu.

Nowy `tests/e2e/course-notifications.spec.ts` korzysta z prawdziwego lokalnego Auth, PostgREST, PostgreSQL i przeglądarki. Potwierdza pominięcie cyklu podczas niezatwierdzonego przełożenia, dwie równoczesne transakcje dostarczania bez dodatkowej wiadomości, rezygnację czekającą na dostarczenie oraz pominięcie niezatwierdzonej rezygnacji. Dwa oczekiwania między konkretnymi procesami bazy są potwierdzone przez obserwatora blokad; dwa pominięcia źródła wynikają z aktywnych transakcji i odpowiedzi procesu. Wcześniejsze zadania lokalnej bazy są blokowane na czas próby i porównywane przed i po niej, bez zmiany ich statusów.

Oba panele otwierają konkretne zgłoszenie i spotkanie z identyfikatorów zapisanych w wiadomości. Rzeczywisty test telefonu sprawdza zmianę prywatnej zbiórki przyjętego opiekuna, brak przypomnienia dla osoby rezerwowej i brak przewijania w bok przy 320 px. Zrzuty `output/course-notifications/guardian-meeting-320.png` i `staff-reminder-390.png` sprawdzono wizualnie. Źródła bazy i kolejki nie kopiują powodów, danych wpłat ani miejsc spotkań. Sam proces tworzy wyłącznie wiadomość w aplikacji; nie uruchomiono harmonogramu ani SMTP.

Scenariusz po poprawieniu etykiety odnośnika w teście przeszedł w 3,6 s (4,2 s z uruchomieniem). Lokalna kompilacja z TypeScript i ESLint zmienionego kodu przeszły. Osobna kontrola typów ponownie wykryła cztery identyczne kopie ` 2.ts`; porównano wszystkie przed usunięciem wyłącznie kopii i powtórzono kontrolę z powodzeniem. Przyczyna odtwarzania tych wygenerowanych plików nadal wymaga osobnego sprawdzenia.

**28/28 scenariuszy** przeszło następnie we wspólnym przebiegu (4,3 minuty), a **76/76 dotychczasowych niezależnych prób PostgreSQL** po zmianie wspólnych powiadomień (9,40 s). Końcowy odczyt potwierdził 37 migracji, trzy konta demonstracyjne i dwa wcześniejsze konta z 19.09, zero nowych kont z tego dnia oraz zero kursów, zgłoszeń, wpłat kursowych, źródeł/przypomnień kursowych i ich wiadomości. Nie pozostały rejestry przesłań ani zadania zdjęć. Wszystkie 17 usług zachowało aktywność i robocze ceny 100 zł. Podgląd ma gotowy manifest zgodny z identyfikatorem kompilacji; logowanie odpowiada HTTP 200.

Po tym etapie dodano zalecenia kursów opisane poniżej. Pozostałe procesy wymienione w [stanie produktu](PRODUCT-STATUS.md) i odbiór całej wersji pozostają do wykonania. Nie stosowano zmian w chmurze ani wdrożenia.

## Zalecenia uczestników kursu

03.10.2026 migracja `202610030002_course_care.sql` została zastosowana wyłącznie lokalnie, po przejściu testów migracji. Prowadząca przygotowuje plan całego cyklu albo prywatny szkic po konkretnym spotkaniu; publikacja zaleceń po spotkaniu wymaga jego zakończenia. Przy uczestniku jest lista wersji i odnośniki do właściwego źródła. Jeden wspólny szkic psa zmienia powiązanie tylko przez świadomy wybór. [Zasady, prywatność i kolejność blokad](COURSE-CARE.md).

Końcowy przebieg: **718/718 testów w 62 plikach** (15,18 s), w tym 53 testy bazy kursów; **30/30 rzeczywistych scenariuszy Auth/API/przeglądarki** we wspólnym przebiegu (4,2 minuty); **76/76 dotychczasowych niezależnych prób PostgreSQL** po zmianie wspólnego zapisu planów (8,33 s). Nowy `tests/e2e/course-care.spec.ts` osobno przeszedł w 9,4 s: panele obu ról, prywatność szkicu, dwie publikacje z zachowaną historią, konflikt starszej karty, wymagane zakończenie spotkania oraz zmiana opiekuna bez przekazania starego zgłoszenia. Druga próba obserwuje trzy rzeczywiste zależności blokad: obie kolejności publikacji i rezygnacji oraz ponowienie zgłoszenia konkurujące z publikacją.

Zrzuty `output/course-care/private-meeting-draft-390.png`, `guardian-course-320.png` i `guardian-publication-390.png` sprawdzono wizualnie; nie ma przewijania w bok. W teście przesunięto w przeszłość wyłącznie własny rekord pierwszego spotkania, bez zmiany zegara serwera. Lokalny build, końcowy TypeScript, ESLint zmienionego kodu i kontrola różnic przeszły. Cztery wygenerowane kopie typów ponownie porównano z oryginałami i usunięto wyłącznie identyczne kopie przed końcową kontrolą typów; przyczyna ich powstawania pozostaje do sprawdzenia.

Końcowy odczyt potwierdził **38 migracji**, pięć zachowanych wcześniejszych kont i obecność wszystkich trzech kont demonstracyjnych; nie ma nowych kont prób z tego dnia. Nie pozostały kursy, spotkania, zgłoszenia, kursowe szkice/publikacje, wpłaty, źródła przypomnień, zadania ani wiadomości. Rejestry przesłań i kolejka sprzątania zdjęć są puste. Wszystkie **17 usług** pozostało aktywnych po robocze **100 zł**. Manifest podglądu jest gotowy i zgodny z identyfikatorem kompilacji; lokalne logowanie odpowiada HTTP 200. Podgląd pozostaje uruchomiony. Nie stosowano migracji ani wdrożenia w chmurze.

## Edycja ustawień i korekty obecności kursów

03.10.2026 migracja `202610030003_course_edits.sql` została zastosowana wyłącznie lokalnie. Prowadząca zmienia nazwę i liczbę miejsc z powodem, bez przeliczania ceny, zmiany terminów lub generacji przypomnień. Limit nie może być mniejszy od liczby przyjętych psów; rezerwa wymaga osobnej decyzji. Zakończone spotkanie ma korekty istniejących obecności, także po zakończeniu cyklu. Powód, poprzedni i nowy stan pozostają w historii. [Dokładne zasady](COURSE-EDITS.md).

Przeszło **732/732 testy w 62 plikach** (15,05 s), w tym 65 testów bazy kursów; **32/32 rzeczywiste scenariusze** we wspólnym przebiegu (4,3 minuty) i **76/76 dotychczasowych niezależnych prób PostgreSQL** (8,74 s). Nowe dwa E2E sprawdzają oba panele, zachowanie formularzy po konflikcie, dwa zapisy z jednego edytora, korekty przed i po zakończeniu cyklu oraz cztery obserwowane zależności blokad. Zrzuty 320/390 px sprawdzono wizualnie. Build, TypeScript i ESLint przeszły. Osiem wygenerowanych kopii typów ` 3.ts` i ` 4.ts` porównano z oryginałami przed usunięciem wyłącznie identycznych kopii; końcowa kontrola typów przeszła, a końcowy skan nie znalazł nowych kopii. Przyczyna powstawania kopii pozostaje nieustalona.

Końcowy odczyt potwierdził **39 migracji**, pięć wcześniejszych kont i wszystkie trzy konta demonstracyjne; zero nowych kont prób z tego dnia, kursów, spotkań, zgłoszeń, potwierdzeń ustawień, korekt obecności, kursowych planów/szkiców, wpłat, przypomnień, źródeł i wiadomości. Rejestry przesłań i kolejka zdjęć są puste. Wszystkie 17 usług pozostało aktywnych po robocze 100 zł. Manifest podglądu jest gotowy i zgodny z kompilacją; logowanie odpowiada HTTP 200. Produkcji nie zmieniano.

## Ponowna decyzja i powrót do kursu

03.10.2026 migrację `202610030004_course_reopening.sql` zastosowano wyłącznie lokalnie, po testach logiki i uprawnień. Prowadząca wraca do decyzji po odmowie lub świadomie przywraca udział po rezygnacji przed pierwszym spotkaniem. Cena całego cyklu pozostaje pierwotna; przywrócenie zachowuje wpłaty, częściowe zwroty, plany i historyczne uzgodnienia. Wymaga rzeczywistego miejsca i powodu. Zmiana opiekuna wyklucza powrót historycznego zgłoszenia. [Reguły i historia](COURSE-REOPENING.md).

Końcowy przebieg: **745/745 testów w 62 plikach** (15,25 s), w tym 76 testów bazy kursów; **34/34 rzeczywiste scenariusze** we wspólnym przebiegu (4,5 minuty) i **76/76 dotychczasowych niezależnych prób PostgreSQL** (8,16 s). Nowe dwa E2E osobno przeszły w 8,3 s. Obejmują cenę 100 zł, rozliczenie 40 − 10 + 70 zł, brak miejsc, starszą kartę z zachowanym powodem, zachowany plan, ponowną decyzję bez miejsca i osiem obserwowanych zależności blokad. Powrót pozostaje chroniony w obu kolejnościach akceptacji, odwołania cyklu i zwrotu; dokładne ponowienie i zmiana opiekuna są osobnymi próbami.

Pełne zrzuty 320/390 px i osobne formularze sprawdzono wizualnie. Fragment długiej karty rozliczenia wyłącza na czas samego zdjęcia stałą nawigację i jej przejście, które Chrome powielał wewnątrz fragmentu; pełny zrzut zachowuje rzeczywistą nawigację. Po zmianie wyłącznie sposobu wykonania tego zdjęcia przeglądarkowy przebieg ponownie przeszedł w 6,8 s. Nie zmieniano z tego powodu kodu aplikacji. Build, TypeScript, ESLint i kontrola różnic przeszły. Końcowy skan nie znalazł powtórzonych wygenerowanych typów. Podgląd ma gotowy manifest zgodny z kompilacją; lokalne logowanie odpowiada HTTP 200 i pozostaje uruchomione.

Końcowy odczyt potwierdził **40 migracji**, pięć wcześniejszych kont i wszystkie trzy konta demonstracyjne. Nie ma nowych kont prób z tego dnia, kursów, spotkań, zgłoszeń, potwierdzeń ustawień/powrotu, korekt, kursowych planów/szkiców, wpłat, przypomnień, źródeł ani wiadomości. Rejestry przesłań i kolejka zdjęć są puste. Wszystkie 17 usług pozostało aktywnych po robocze 100 zł. Wcześniejsza pełna kopia 27 migracji nie stanowi dowodu odtworzenia aktualnego schematu 40 migracji. Odbiór całego produktu i pozostałe procesy pozostają aktywne. Nie stosowano zmian w chmurze.

### Odtworzenie bieżących danych 03.10.2026

Rozszerzony `pnpm local:backup-test` potwierdził **103 tabele / 8011 wierszy, pełny schemat i wszystkie 40 migracji** w osobnych zasobach. Zachowane hasła trzech fikcyjnych kont i dwa zdjęcia sprawdzono przez odtworzone Auth/API/Storage. Dwa niepuste kursy obejmują wpłatę 100 zł, uzgodnienie 30 zł, zwrot 70 zł, przywrócenie za pierwotną cenę, korektę obecności, publikacje dla cyklu i spotkania, prywatny szkic, odpowiedź do starszego planu i pięć oczekujących przypomnień. Niezakończone przesłanie zachowuje rezerwację i brak pliku. Kolejna wpłata, zmiana nazwy i korekta działają przez odtworzone API, a historyczne ponowienia nie cofają nowszych zmian.

Próba zakończyła się poprawnie wraz ze sprzątaniem. Porównanie wszystkich wcześniejszych tabel `public` przed i po potwierdziło zgodność liczby oraz skrótu każdego wiersza. Pozostało pięć kont, cztery psy, 40 migracji i 17 usług po robocze 100 zł; brak danych własnych kursów, rezerwacji i kolejki zdjęć. Dziewięć źródłowych usług działa, reguły połączeń są zgodne, blokada zwolniona, zasoby odtworzenia usunięte i localhost:3000 odpowiada HTTP 200. Osiem testów granic kopii, kontrola składni i ESLint przeszły; pełny wcześniejszy odbiór 745/34/76 pozostaje osobnym przebiegiem. [Identyfikatory, szczegóły i granice](LOCAL-BACKUPS.md#wcześniejszy-wynik-03102026--40-migracji).

## Równoczesne operacje w rzeczywistej bazie

Wcześniejszy pełny odbiór 02.10.2026: **541/541 testów Vitest w 54 plikach**, **8/8 rzeczywistych E2E w 48,7 s**, lokalny build z TypeScript oraz ESLint zmienionego kodu. Nowe scenariusze obejmują trzy niezależnie stronicowane listy finansów, bezpośrednie otwarcie pakietu i należności poza pierwszą stroną, odmowę dostępu do obcych danych, odrzucenie zmienionego JWT oraz odebranie roli w już otwartej sesji. Układ finansów sprawdzono przy 320/390/768/1440 px. Przebieg niezależnych transakcji zakończył się wynikiem **19/19**, w 2,08 s z 21 potwierdzonymi oczekiwaniami na blokadę.

Przy uruchomionym lokalnym stosie na tym komputerze:

```sh
pnpm local:concurrency
```

Test `tests/local/postgres-concurrency.mjs` otwiera osobne połączenia PostgreSQL 17.6 przez jawny socket Docker projektu i kontener `supabase_db_psi-pawer`. Nie czyta plików `.env`, nie przyjmuje adresu bazy i nie korzysta z domyślnego kontekstu Docker. Aplikacja i przeglądarka nie muszą działać. Tworzy własne konta `@example.test` bez hasła/logowania oraz fikcyjne rekordy; sprzątanie odbywa się według identyfikatorów tego uruchomienia, bez resetu bazy. Błąd sprzątania powoduje niepowodzenie testu.

Operacje biznesowe wykonują się z rolą `authenticated`, tożsamością odpowiedniego konta oraz izolacją `read committed`. Uprzywilejowane połączenie służy do utworzenia/usunięcia fixture'ów i obserwacji blokad. Pierwsza transakcja zachowuje blokadę po wykonaniu operacji; druga próbuje zapisać zmianę. Trzecie połączenie potwierdza w `pg_stat_activity` i `pg_blocking_pids`, że to właśnie pierwsza blokuje drugą. Dopiero wtedy pierwsza zatwierdza zapis. Numery osobnych procesów bazy są wypisywane w wyniku.

02.10.2026 po dodaniu archiwum: **19/19 scenariuszy przeszło w 2,18 s**, łącznie 21 potwierdzonych zależności blokad:

- ostatnie miejsce przy automatycznym zapisie dwóch opiekunów i przy dwóch decyzjach prowadzącej;
- powtórzona akceptacja bez kolejnej decyzji i powiadomienia;
- powtórzenie tej samej wpłaty, różne wpłaty na tę samą należność i ten sam identyfikator użyty dla innej należności;
- akceptacja/odwołanie oraz wpłata/odwołanie w obu kolejnościach zatwierdzenia;
- spacer i blokada na ten sam czas w obu kolejnościach;
- ostatnie wejście z pakietu dla dwóch spacerów oraz powtórzenie przypisania i odwołania bez podwójnego zwrotu;
- powtórzenie publikacji zaleceń bez dodatkowego planu, kontaktu kontrolnego i powiadomienia oraz konflikt różnych treści tej samej wersji.
- archiwizacja i rozpoczęcie wysyłki zaproszenia w obu kolejnościach oraz powtórzenie archiwizacji i przywrócenia bez dodatkowej wersji lub audytu.

Sprawdzono końcowe statusy, należności, sumy wpłat, wpisy audytu, powiadomienia, rezerwacje pakietu i odpowiednie zadania przypomnień. To próba transakcji w bazie, nie test logowania/PostgREST ani pomiar obciążenia 50 sesji. Testy API i przeglądarki pozostają osobnym poziomem odbioru.

Po rozszerzeniu o konsultacje 02.10.2026: **32/32 próby w 3,38 s**, 34 potwierdzone zależności blokad. Nowe przypadki obejmują wpłaty i korekty, odwołanie, przełożenie oraz konflikt dwóch konsultacji na jeden termin. Saldo, historia, audyt, powiadomienia i przypomnienia pozostały zgodne. Nie obejmuje to jeszcze wszystkich operacji finansowych ani współbieżności procesu przypomnień. Osobny rzeczywisty E2E `tests/e2e/consultation-finance.spec.ts` przeszedł na lokalnej kompilacji w 13,4 s; sprawdza cały opisany [przebieg rozliczenia i uprawnienia](CONSULTATION-FINANCE.md). Własne dane obu prób usunięto. Pozostałe osiem E2E pochodzi z wcześniejszego przebiegu na tej samej kompilacji; w tym etapie nie zmieniano kodu aplikacji.

Po rozszerzeniu o rozliczenia spacerów 02.10.2026: **48/48 niezależnych prób w 7,85 s**, z 50 potwierdzonymi zależnościami blokad. Dziesięć nowych przypadków obejmuje wpłatę i rezygnację w obu kolejnościach, wpłatę lub zwrot i usprawiedliwienie nieobecności, korektę zużycia zwróconego wejścia konkurującą z nowym przydziałem oraz powtórzenia obecności bez podwójnej zmiany salda lub audytu. Próba wykryła zależny od kolejności status zwolnionej należności po rzeczywistym zwrocie; migracja `202610020006` zachowuje `refunded` w obu kolejnościach. Ponowne obciążenie nadal wymaga nowej wpłaty.

Trzy rzeczywiste scenariusze `tests/e2e/walk-finance.spec.ts` prowadzą oba konta przez kwalifikację, zgłoszenie, akceptację, częściowe wpłaty, zwroty, korekty obecności, pakiet, rezygnacje i odwołanie organizatora. Osobny przypadek wykorzystuje zwrócone wejście w innym spacerze, sprawdza atomową odmowę korekty bez utraty formularza, a następnie uzgodnione odłączenie i skuteczne ponowienie. API niezależnie potwierdza stan ewidencji i odmowy dostępu. Przesunięcie czasu dotyczy wyłącznie własnych fikcyjnych spacerów; nie zmienia wcześniejszych terminów. Sprzątanie obejmuje także spacer zapisany przed niepowodzeniem nawigacji i jest obowiązkowym warunkiem powodzenia testu.

Po rozszerzeniu o edycję spacerów 02.10.2026: **56/56 niezależnych prób w 7,01 s**, z 58 potwierdzonymi zależnościami blokad. Osiem nowych przypadków sprawdza zmniejszenie limitu konkurujące z przyjęciem psa, dwóch edytorów z tą samą wersją, zmianę terminu konkurującą z odwołaniem organizatora oraz przesunięcie w najbliższe 24 godziny konkurujące z rezygnacją opiekuna. Zmiana daty nie zamienia bezpłatnej rezygnacji przyjętego wcześniej psa w płatną. Pojemność, prywatna zbiórka, audyt, powiadomienia, zajęty czas i przypomnienia pozostają zgodne. Wersja edytora zachowuje pełną precyzję znacznika PostgreSQL; nie przechodzi przez obcinający ją obiekt JavaScript Date.

Po rozszerzeniu o kontakty i odpowiedzi 02.10.2026: **70/70 prób w 9,19 s**, z 72 potwierdzonymi zależnościami blokad. Czternaście nowych przypadków sprawdza konflikty i powtórzenia przełożenia, zakończenie konkurujące ze zmianą daty, nową publikację konkurującą z zamknięciem lub wznowieniem starego kontaktu, powtórzenia i konflikty odpowiedzi, ponowiony przegląd oraz publikację konkurującą z odpowiedzią do poprzednich zaleceń. Historia, audyt, powiadomienia i kolejka przypomnień pozostają zgodne, a pierwotny plan jest niezmienny. Wszystkie własne dane usunięto. [Pełny zakres odbioru kontaktów](WORK-MODULE.md).

## Podgląd gotowej kompilacji i pomiary

02.10.2026 zastosowano wyłącznie lokalnie migrację `202610020007_care_template_retries.sql`; baza ma teraz 30 migracji. Ponowienie tego samego zapisu materiału przez jego autora potwierdza wcześniejszą operację, bez nowej wersji lub audytu. Nowe niezależne próby dodania/edycji materiałów przeszły wraz z całym zestawem: **76/76 w 9,12 s**. Obejmują identyczne ponowienia, konkurujące treści w obu kolejnościach i spóźnione ponowienie dodania po edycji. [Zakres biblioteki, personalizacji i prywatności](CARE-MODULE.md#biblioteka-i-personalizacja).

Po dodaniu uzgodnienia brakującej ceny 02.10.2026: **570/570 testów w 55 plikach**, **10/10 rzeczywistych E2E** we wspólnym przebiegu (około 1,5 minuty), **38/38 niezależnych prób PostgreSQL** w 4,09 s z 40 potwierdzonymi zależnościami blokad. Nowy `tests/e2e/consultation-legacy-price.spec.ts` sprawdza formularz obu ról, powiadomienie, cenę 175,50 zł, wpłatę i zakończenie opłaconego spotkania, wraz z zachowaniem terminu wypełnionego przed zapisem ceny i odmową dostępu przez API. Po końcowej korekcie tekstu i nowej kompilacji ten scenariusz osobno przeszedł ponownie w 10,4 s. Układ 320/390 px sprawdzono po wczytaniu strony. Własne dane usunięto, katalog pozostał po robocze 100 zł. [Dokładny zakres i ograniczenia](CONSULTATION-FINANCE.md).

Po poprawieniu rozliczeń spacerów 02.10.2026: **580/580 testów w 56 plikach** (35,04 s), **13/13 rzeczywistych E2E** we wspólnym przebiegu (2,5 minuty), lokalny build z TypeScript oraz ESLint zmienionego kodu. Przegląd zrzutów wykrył łamanie etykiet salda pakietu w środku słów przy 320 px. Po zmianie układu na wiersze etykieta–liczba, nowej kompilacji i uruchomieniu podglądu **4/4 scenariusze spacerów i stronicowanych finansów** przeszły w 1,1 minuty. Sprawdzono wizualnie końcowy układ i formularz błędu przy 320/390 px. Końcowy odczyt potwierdził 29 migracji, zachowanie pięciu wcześniejszych kont, brak psów nowych prób i kont współbieżności, 17 aktywnych usług po robocze 100 zł oraz odpowiedź HTTP 200 lokalnego logowania. Podgląd działa na localhost:3000. Produkcji nie zmieniano; wcześniejsze pomiary 50 kont i odtworzenia kopii pozostają osobnymi przebiegami.

Po odbiorze rezerwy, decyzji i edycji spacerów 02.10.2026: **16/16 pełnych E2E** we wspólnym przebiegu (2,9 minuty), lokalny build z TypeScript oraz ESLint zmienionego kodu. Trzy scenariusze `tests/e2e/walk-decisions-edit.spec.ts` sprawdzają decyzje obu ról, prywatność zbiórki, pojemność, zmianę terminu i korzystniejszy termin rezygnacji, powiadomienia, przypomnienia, konflikt kalendarza i starej karty, kopiowanie ustawień oraz zapisy automatyczne i na zaproszenie. Wspólny `walk-journey.ts` przygotowuje izolowane konta, kwalifikację i wolne terminy także dla trzech dotychczasowych scenariuszy finansów. Operacje biznesowe odbywają się przez panele; niezależne odczyty API sprawdzają wynik i granice dostępu.

Opiekun widzi wyjaśnienie przy oczekującym, rezerwowym i odrzuconym zgłoszeniu. Sześć końcowych zrzutów 320/390 px sprawdzono wizualnie, łącznie z zachowanymi polami po odmowie przyjęcia i zapisu starej karty. Końcowy odczyt potwierdził 29 migracji, pięć zachowanych wcześniejszych kont, zero psów nowych testów i kont współbieżności oraz 17 aktywnych usług po robocze 100 zł. Lokalny manifest jest gotowy i zgodny z kompilacją; logowanie na localhost:3000 odpowiada HTTP 200. W tym etapie nie dodawano migracji ani nie wykonywano wdrożenia; wcześniejszy zestaw 580 testów, próba 50 kont i kopie pozostają odrębnym dowodem.

Do testów gotowej aplikacji służy oddzielny lokalny build, bez publikacji:

```sh
pnpm local:build
# Zatrzymaj local:dev klawiszami Ctrl+C, jeśli działa na porcie 3000.
pnpm local:preview
# W osobnym terminalu:
pnpm local:e2e
```

`local:build` sprawdza lokalne adresy i przekazuje te same ustawienia co lokalne testy. Zapisuje kompilację w ignorowanym `.next-local/`, osobno od zwykłego `.next/`. `local:preview` uruchamia ją na `http://localhost:3000`, dzięki czemu lokalne linki Auth nadal prowadzą do właściwej aplikacji. Zatrzymanie następuje przez Ctrl+C.

Manifest `.local/preview-build.json` zawiera identyfikator kompilacji i skrót konfiguracji publicznej; nie zapisuje kluczy. Start odrzuca brak manifestu, niedokończony build, inny identyfikator lub zmianę adresów/publicznego klucza. Niepowodzenie lub przerwanie builda wymaga ponownej kompilacji. Zmiany kodu nie pojawiają się automatycznie w podglądzie: ponownie wykonaj build i uruchom podgląd. Do bieżącej edycji wróć do `pnpm local:dev` po zatrzymaniu podglądu. Nie uruchamiaj obu serwerów na tym samym porcie.

Po uruchomieniu gotowej kompilacji można osobno wykonać `pnpm local:load`. Próba tworzy 50 fikcyjnych opiekunów i jedną prowadzącą, sprawdza ich rzeczywiste sesje, pełne odpowiedzi HTML, izolację oraz równoczesne zapisy. Raport trafia do prywatnego `.local/pilot-load/`, a własne dane są usuwane w końcowym sprzątaniu. Nie uruchamiaj równocześnie ciężkich testów, procesu przypomnień ani resetu bazy.

Ostatnia próba 02.10.2026 zakończyła się bez błędów i z potwierdzonym sprzątaniem: przy 50 równoczesnych sesjach p95 wyniosło **1,12 s dla pulpitu, 0,94 s dla zaleceń i 1,08 s dla finansów**. Odczyty prowadzącej także zmieściły się w 2 s. Pomiar nie obejmuje renderowania w przeglądarce, pobierania skryptów ani wydajności hostingu. [Dokładny zakres, raporty i ograniczenia](PILOT-LOAD.md).

Po poprawieniu formularzy planu i kontaktu 02.10.2026: **18/18 rzeczywistych E2E we wspólnym przebiegu** (3,2 minuty), lokalny build z TypeScript i ESLint zmienionego kodu. Dwa nowe scenariusze `tests/e2e/care-followups.spec.ts` prowadzą obie role przez cały cykl kontaktu oraz odpowiedź do wcześniejszego planu. Obejmują zachowanie pól po błędzie i ze starej karty, wstrzymanie skryptów przed gotowością formularza, prywatność historii i przypomnień, powiadomienia, archiwum, ponowienia API i jawny przegląd jednej odpowiedzi przy pozostawieniu drugiej w kolejce. Poprawka utrzymuje widoczne potwierdzenie pierwszej publikacji i zapobiega resetowi listy działań po odmowie przełożenia. Nie stosowano migracji ani wdrożenia w chmurze; wcześniejszy zestaw 580 testów, pomiar 50 kont i kopie pozostają osobnymi przebiegami.

Po końcowym uproszczeniu karty odpowiedzi, nowym buildzie i starcie podglądu **2/2 E2E kontaktów i odpowiedzi** ponownie przeszły w 17,9 s. Sprawdzono pozostały odnośnik do planu i stan obu odpowiedzi. Przegląd siedmiu zrzutów 320/390/1440 px oraz końcowej karty odpowiedzi potwierdził czytelny układ. Pomocnik zrzutów czeka na widok i gotowe formularze oraz przewija na początek przed przechwyceniem całej strony. Odczyt końcowy potwierdził 29 migracji, pięć kont, zero psów nowych prób i kont współbieżności, 17 aktywnych usług po robocze 100 zł i odpowiedź HTTP 200 logowania. Manifest podglądu jest gotowy, zgodny z identyfikatorem kompilacji i obejmuje zmienione źródła. Lokalny podgląd pozostaje uruchomiony.

## Reguły fitness w osobnej bazie

`pnpm local:fitness-domain` sprawdza reguły migracji `202610030005` we własnej oznaczonej bazie PostgreSQL. Sam test nie stosuje migracji w bazie podglądu i nie korzysta z rzeczywistego Auth ani wysyłki. **13/13 prób** (3,08 s), **13 obserwowanych zależności blokad**, usunięcie własnej bazy i zachowanie źródła potwierdzone. Pierwszy odbiór obejmował 770/770 testów, w tym 25 prób fitness w PGlite, oraz 76/76 dotychczasowych prób PostgreSQL.

Po dodaniu paneli obu ról, wejścia z oferty oraz wspólnego kalendarza i finansów przeszło **810/810 testów w 66 plikach** (16,27 s). Migrację `202610030005` zastosowano wyłącznie lokalnie; podgląd ma 41 migracji. Rzeczywiste E2E przez Auth/API i przeglądarkę obejmują zgłoszenie, cztery spotkania, obecności i korekty, spotkanie zastępcze, rezygnację, należność 30 zł, częściowy zwrot 70 zł i przywrócenie pełnej wcześniejszej ceny. Ze starej karty termin jest odrzucany bez utraty pól. Oba scenariusze fitness przeszły; po zastosowaniu migracji również **76/76 prób PostgreSQL** (8,69 s). To wcześniejszy odbiór paneli; dalszy etap skrzynek i kolejki opisano poniżej. [Zakres i dowody](FITNESS-MODULE.md).

Końcowa kompilacja paneli fitness przeszła 36/36 wszystkich E2E aplikacji we wspólnym przebiegu (4,8 minuty). Test sprzątania zdjęć jawnie ustala gotowość wyłącznie własnych fikcyjnych zadań według czasu bazy; przerwanie, odroczone ponowienie i dwóch pracowników przeszło także 20 kolejnych powtórzeń (23,9 s).

Kolejny etap fitness: migracja `202610030006` jest również zastosowana wyłącznie lokalnie, po 824/824 testach w 66 plikach i 13/13 próbach odrębnej bazy. Podgląd ma **42 migracje**. Kolejka obejmuje decyzję, brakujące terminy, zaległą obecność, zakończenie pakietu oraz uzgodnienie i zwrot po rezygnacji. Skrzynki prowadzą do właściwego pakietu, spotkania lub rozliczenia i nie zapisują prywatnych notatek/miejsc. Dwa rozszerzone E2E przez rzeczywiste Auth/API i przeglądarkę przeszły w 18,1 s; ponownie przeszło 76/76 prób PostgreSQL (9,03 s). W tym wcześniejszym etapie przypomnienia i powiązania zaleceń fitness pozostawały do przygotowania. Poprzednie odtworzenie 40 migracji nie obejmuje fitness.

## Kopie i odtworzenie

`pnpm local:backup create` zapisuje bazę, lokalną konfigurację i rzeczywiste pliki Storage w prywatnym `.local/backups/`. `pnpm local:backup verify IDENTYFIKATOR` odtwarza je wyłącznie do własnych, odseparowanych zasobów i porównuje dane. `pnpm local:backup-test` dodatkowo sprawdza zachowane hasła, role, izolację, zdjęcia i niepuste kursy z finansami, planami oraz obecnością; wykonuje też nowe zapisy i historyczne ponowienia tylko w odtworzeniu. Ostatnia rzeczywista próba objęła 103 tabele i 40 migracji, trzy logowania i dwa zdjęcia, zakończone poprawnie wraz ze sprzątaniem. [Instrukcja i granice kopii](LOCAL-BACKUPS.md).

`pnpm local:backup-recovery` sprawdza cztery rzeczywiste przerwania SIGTERM/SIGKILL oraz końcowe odtworzenie. Odzyskanie źródła wykonuje `pnpm local:backup recover ID_KOPII`; sprzątanie przerwanej próby odtworzenia — `pnpm local:backup recover-restore ID_KOPII ID_ODTWORZENIA`. Narzędzia odmawiają odzyskiwania żywego procesu. Trwałej blokady źródła nie usuwamy ręcznie ani nie obchodzimy przez reset bazy. Próby korzystają z własnych procesów i zasobów lokalnego stosu, bez wysyłki wiadomości.

## Inny komputer i nowe migracje

Pomocnik maszyny dotyczy przygotowanego środowiska macOS/Apple Silicon i wymaga wymienionych plików narzędzi w `.local/tools`. Na innym komputerze można użyć standardowego Docker oraz Supabase CLI, a następnie `supabase start`, `pnpm local:env` i `pnpm local:dev`. Instalacja: [Lima](https://lima-vm.io/docs/installation/), [lokalny Supabase](https://supabase.com/docs/guides/local-development). Pobrane wydania Lima i Supabase zweryfikowano względem sum SHA-256 publikowanych w ich oficjalnych wydaniach; Docker CLI pobrano z oficjalnego serwera Docker.

Pierwszy start odtwarza migracje. Nowe migracje stosuje się wyłącznie przez `supabase migration up --local`, z kontekstem Docker wskazującym lokalną maszynę. `supabase db reset --local` usuwa lokalne dane — nie jest krokiem codziennego uruchomienia. Nie używamy `--linked`, `db push` ani adresu hostowanej bazy.

## Kolejność dalszej pracy

1. Lokalne konta obu ról, przykładowe psy, lokalna skrzynka i pełny test sesji.
2. Zaproszenie, aktywacja, odzyskanie hasła i prosty start opiekuna.
3. Połączenie pulpitu z konsultacjami, planami i sprawami do obsłużenia.
4. Kontakt kontrolny, powiadomienia w aplikacji i kolejka wysyłkowa do lokalnej skrzynki.
5. Dopracowanie formularzy, mobilnego układu, stanów pustych i błędów całej aplikacji.
6. Odbiór pełnego MVP, uprawnień i obciążenia 50 fikcyjnych użytkowników.

Pierwszy lokalny moduł planów i postępów oraz konsultacje są opisane w [CARE-MODULE.md](CARE-MODULE.md) i [CONSULTATIONS-MODULE.md](CONSULTATIONS-MODULE.md). Funkcje odłożone w planie MVP (m.in. AI, WhatsApp, operator płatności, wiele praktyk) nie zostały automatycznie dodane do zakresu.

Kolejny moduł lokalny: [usługi i cennik](SERVICES-MODULE.md), migracja `202609180003`. Panel prowadzącej edytuje ceny w bazie, a zgłoszenia konsultacji zachowują cenę z chwili zgłoszenia. Katalog nie wymaga aktualizowania kodu przy każdej zmianie kwoty.

19.09.2026: dodano [wspólny kalendarz i blokady czasu](CALENDAR-MODULE.md), migracja `202609190001`. Pulpit uwzględnia najbliższy spacer lub konsultację. [Stan całego produktu i pozostałe warunki odbioru](PRODUCT-STATUS.md).

19.09.2026: dodano [sprawy prowadzącej i kontakty kontrolne](WORK-MODULE.md), migracja `202609190002`. Daty opublikowanych planów stają się zadaniami; szkice pozostają prywatne i nie tworzą zadań. Pełny lokalny stos uruchomiono w kolejnym etapie opisanym powyżej.

19.09.2026: dodano [rozliczenia konsultacji](CONSULTATION-FINANCE.md), migracja `202609190003`, oraz [odzyskanie hasła](ACCESS-RECOVERY.md). Odzyskanie dostępu przeszło później pełne E2E z lokalnym Auth i Mailpit. Rzeczywiste częściowe wpłaty, zmiana terminu, rezygnacja i zwroty konsultacji zostały następnie sprawdzone przez oba panele, wraz z niezależnymi próbami współbieżności opisanymi wyżej. Historyczne kwoty i pozostałe procesy są nadal wymienione w [stanie produktu](PRODUCT-STATUS.md).

19.09.2026: dodano [skrzynkę powiadomień](NOTIFICATIONS-MODULE.md), migracja `202609190004`. Do działania nie wymaga SMTP. Pełny zestaw migracji przetestowano w PGlite; pełny lokalny stos uruchomiono w kolejnym etapie opisanym powyżej.

19.09.2026: dodano [kolejkę przypomnień w aplikacji](REMINDERS-MODULE.md), migracja `202609190005`. Po przygotowaniu lokalnego stosu można uruchamiać `pnpm local:reminders` albo `pnpm local:reminders:watch`. Skrypt odrzuca adresy zdalne i nie czyta produkcyjnej `.env.local`. Nie uruchomiono usługi w tle ani harmonogramu hostingu.

19.09.2026: dodano [panel zaproszeń i aktywację](INVITATIONS-MODULE.md), migracja `202609190006`. Helper konfiguracji włącza lokalne zaproszenia i udostępnia lokalny klucz wyłącznie serwerowemu adapterowi; adresy zdalne są odrzucane. Nowy szablon zaproszenia wymaga ponownego uruchomienia lokalnego Auth po zmianie konfiguracji. Nie wysłano zaproszeń ani nie zmieniono chmury.

## Odczyty i przypomnienia fitness — 03.10.2026

Sporadyczne HTTP 502 zostało zarejestrowane przy odczycie listy pracy i skrzynki. Cztery stabilne odczyty list/liczników pracy i powiadomień mogą ponowić wyłącznie 502, najwyżej raz; nie dotyczy to zapisów ani Auth. 838/838 testów, 37/37 pełnych E2E i pięć powtórzeń po 96 autoryzowanych odczytów przeszło przed kolejnym rozszerzeniem. Dwa odczyty w powtórzeniach faktycznie otrzymały 502 i powiodły się po ponowieniu. Przyczyna źródłowa bramy nie została ustalona.

Migracja `202610030007_fitness_reminders.sql`, zastosowana wyłącznie lokalnie, podłącza każde umówione spotkanie aktywnego pakietu do trwałej kolejki. Zmiana terminu, rezygnacja i zmiana opiekuna wycofują nieaktualne zadania. Finanse nie tworzą drugiego przypomnienia. Podgląd ma **43 migracje**. Odbiór reguł: **849/849 testów w 68 plikach** (17,30 s), **19/19 prób odrębnej bazy** (4,78 s, 15 zależności blokad) i **76/76 wcześniejszych prób PostgreSQL** (8,79 s). Baza próbna usunięta, dane źródła zachowane. Build, TypeScript i ESLint przeszły; najnowszy odbiór paneli jest zapisany w [module fitness](FITNESS-MODULE.md).
