# Odbiór przed pierwszymi użytkownikami

Status: kod przetestowany i opublikowany; odbiór hostingu zaliczony.
Zapraszanie prawdziwych osób wymaga jeszcze produkcyjnych kopii i listy odbiorców.
Brief użytkownika z 16.10.2026: przeprowadzić najdokładniejsze
testy i wdrożyć ewentualne poprawki przed udostępnieniem aplikacji w weekend.
To autoryzacja napraw wykrytych błędów i publikacji sprawdzonego zakresu;
nie jest decyzją o nowych funkcjach, zmianie cen, usługodawcy poczty lub kontach
konkretnych klientów. Użytkownik wskazał większą grupę prawdziwych opiekunów
i ręczne, prywatne jednorazowe linki bez SMTP. Następnie doprecyzował skalę:
do 50 osób. Próba obciążenia obejmuje 50 opiekunów i jedną prowadzącą;
nie jest dowodem dowolnej skali.

## Zasady odbioru

Biznes i technika przygotowały niezależne pierwsze oceny. Koordynator przyjął
poniższe kryteria, zachowując aktualne reguły: Asia jest jedyną prowadzącą,
autor będący administratorem pozostaje organizatorem, dostępność jest wspólna
także dla dawnych UUID/null. Nie luzujemy tych zasad, aby uruchomić starsze testy.

| Kryterium | Warunek |
| --- | --- |
| AC-L01 | Uzgodnieni odbiorcy, zakres usług i sposób wejścia. Terminy i wpłaty DEMO są jednoznacznie testowe. |
| AC-L02 | Wejście nowej osoby, własne hasło, profil, ponowne logowanie i odzyskanie dostępu mają aktualny dowód. Link wygasły, użyty lub zastąpiony nie daje dostępu. Poczta rzeczywista wymaga własnego odbioru; lokalny Mailpit jej nie zastępuje. |
| AC-L03 | Anonimowy i obcy opiekun nie odczytują ani nie zmieniają cudzych danych, notatek, szkiców, zdjęć, rozliczeń i czatów przez stronę ani API. |
| AC-L04 | Dodanie psa, kwalifikacja i jej cofnięcie mają poprawny następny krok, ostrzeżenia i zachowanie historii. Zaproszenie nie daje kwalifikacji. |
| AC-L05 | Zgłoszenie, decyzja, termin, przełożenie/rezygnacja i zakończenie działają dla usług startowych. Konkurencja nie przekracza miejsc i nie tworzy częściowych zmian. Dokładna zbiórka pozostaje chroniona. |
| AC-L06 | Konteksty zaleceń są oddzielone, szkic prywatny, wersje i odpowiedzi zachowane. Dostęp do nowej odpowiedzi uwzględnia raportowanie. |
| AC-L07 | Zmiana cennika zachowuje stare warunki. Wpłaty, ponowienia i zwroty zachowują saldo; opiekun nie dopisuje wpłat. Docelowe ceny i zasady startu zatwierdza właściciel/Asia. |
| AC-L08 | Skrzynka, e-mail i push są oddzielne. Wiadomości mają właściwego odbiorcę i link, bez duplikatów. Odmowa/awaria push nie blokuje operacji. Odbiór fizycznego push jest osobną próbą. |
| AC-L09 | Prawdziwe procesy obu ról działają przy 320/390/768/1440 px, z klawiaturą, w stanach pustych i po błędzie/konflikcie. Pola nie giną i ponowienie nie dubluje skutków. |
| AC-L10 | Są aktualne dowody kopii/odtworzenia, kolejek, obserwacji błędów i wydajności. Raport rozróżnia lokalną aplikację, komponenty, hosting i fizyczne urządzenia. Kopia poza komputerem, retencja i obsługa problemów wymagają ustalenia przed prawdziwym startem. |

Techniczne uzupełnienia: każda próba odrzuca hostowaną bazę; tworzy i usuwa tylko
własne fixture. Wybór własnej prowadzącej jest jawny dla scenariusza, bez
automatycznego przypisywania każdego nowego admina. Stan primary/godzin zostaje
przywrócony, błędy sprzątania są niezaliczeniem. Historyczne testy starego
schematu pozostają oznaczone historycznie. Ciężkie E2E, SQL, load i odtworzenie
wykonujemy kolejno na lokalnej VM 2 CPU / 4 GB.

Doprecyzowanie AC-L09: wpisany lub niepotwierdzony szkic zachowuje identyfikator
operacji, źródłową publikację i warunki wersji również po scaleniu nowego RSC,
paginacji oraz zapisie innego formularza. Otrzymany sukces może wyczyścić pola
i rozpocząć kolejną świadomą operację z nowym kluczem. Zapisane wcześniej
potwierdzenie nie może nadpisać nowszej kwalifikacji ani podwoić wpłaty.

## Bieżący baseline

Punkt wyjścia: `9ef1824`, czyste drzewo. Pełne Vitest: **1226/1226 w 99 plikach**,
26,69 s. Pełny ESLint i TypeScript zaliczone. To świeży wynik 16.10, nie dawne
liczby z odbiorów MVP. Istniejący lokalny build i pełna aplikacja używają schematu
58 migracji; primary lokalnego środowiska testowego jest nieustawione.

Przed próbami zapisującymi utworzono nową spójną kopię lokalną
`d2e8a760-74c2-4cea-b262-dbe16b291f3b`. Kopia została zapisana, usługi wznowione;
odtworzenie tego egzemplarza zaliczono. Końcowy odbiór poniżej używa również
nowej kopii pełnego schematu 60 migracji. Nie resetowano źródłowej bazy.

## Ręczny dostęp bez SMTP

Niezależne propozycje biznesu i techniki wskazały małe narzędzie operacyjne
administratora z podglądem planu i prywatnym wynikiem. Nie dodajemy kolejnego
ekranu ustawień. Brak listy konkretnych odbiorców: przygotowanie i odbiór
narzędzia nie tworzy prawdziwych kont ani nie wysyła wiadomości.

| Kryterium | Warunek |
| --- | --- |
| AC-M01 | Plan tylko odczytuje i rozróżnia nowego klienta, istniejącego klienta i odmowę. Adresy są normalizowane, duplikaty nie mnożą operacji. |
| AC-M02 | Nowa osoba otrzymuje wyłącznie rolę client. Każdy admin i niejasny stan to twarda odmowa. Istniejący klient zachowuje UUID, hasło i dane biznesowe; wydanie linku nie zmienia profilu ani roli. |
| AC-M03 | Prywatny plik poza repozytorium i wdrożeniem, bez tokenów w zwykłym logu, bez wysyłki. Wynik wskazuje odbiorcę, przeznaczenie i termin ważności z potwierdzonej konfiguracji Auth; brak dowodu TTL jest jawny. |
| AC-M04 | GET nie aktywuje konta, świadomy POST aktywuje właściwe konto. Zużycie, wygaśnięcie i zastąpienie mają rzeczywisty test; opis nie obiecuje niesprawdzonej semantyki dostawcy. Ponowienie nie tworzy drugiego konta. |
| AC-M05 | Kontrolowane konto na telefonicznym rozmiarze: wejście, sprawdzenie adresu, własne hasło, profil, wylogowanie i ponowne logowanie. Odzyskanie istniejącego klienta zachowuje jego dane. |
| AC-M06 | Administrator przekazuje pojedynczy link właściwej osobie uzgodnionym kanałem. Rozróżnia przygotowanie linku, przekazanie i potwierdzone wejście. Bez SMTP odzyskanie wymaga sprawdzenia tożsamości i nowego prywatnego linku. |

Nowe konto używa istniejącej ścieżki zaproszenia; istniejący klient ścieżki
jednorazowego dostępu. To odrębne typy OTP. Posiadanie linku daje dostęp do
konta; nie dowodzi posiadania skrzynki. Ekran hasła pozwala przejść dalej przed
zapisem, dlatego odbiór osobno potwierdza ustawienie i logowanie hasłem.

## Znalezione problemy i otwarte bramki

- Zewnętrzne zaproszenia są celowo ograniczone kodem do lokalnej aplikacji i bazy.
  Samo ustawienie flag SMTP ich nie odblokuje. Ręczny wariant wybrany przez
  użytkownika zachowuje te ograniczenia wysyłki.
- Pełne E2E i część starszych runnerów nie przygotowują primary po migracji 58;
  najpierw dostosowujemy fixture, a nie reguły aplikacji.
- Nie uznajemy powyższego baseline za zgodę na publiczny start ani potwierdzenie
  fizycznego telefonu, rzeczywistej wysyłki i pełnego obciążenia hostingu.
- Realna próba utraty odpowiedzi po zapisie psa wykazała utratę pól oraz duplikat
  po ponowieniu. Reprodukcja ma kontrolę potwierdzonego zapisu przed przerwaniem
  odpowiedzi, trzy zrzuty i sprawdzone usunięcie wyłącznie własnych psów.
  Poprawka zachowuje sześć pól i ten sam identyfikator operacji; realne E2E
  potwierdza jeden zapis po ponowieniu oraz odmowę zmiany payloadu tego samego
  żądania. Edycja istniejącego psa zachowuje dotychczasową ścieżkę.
- Audyt zależności produkcyjnych wykazał 9 advisories. Po aktualizacji Next
  16.3.4 → 16.3.8, Sharp 0.35.4 → 0.35.5 i pośredniego source-map-js
  1.2.1 → 1.2.2 świeży `pnpm audit --prod` zgłasza 0 podatności. Sam numer
  advisory nie jest dowodem wykorzystania podatności w tej aplikacji.

## Bieżące dowody odbioru

- Produkcyjny odczyt konfiguracji: ACTIVE_HEALTHY, 58 dotychczasowych migracji,
  Asia jako primary, 0 publicznych tabel bez RLS, 0 tabel i funkcji dostępnych
  anonimowo. Kolejki due/failed 0; harmonogramy przypomnień i push aktywne.
  To odczyt, bez zmian danych i kont.
- Ręczny dostęp: 9/9 rzeczywistych lokalnych scenariuszy Auth/CLI/przeglądarki.
  Plan 50 adresów bez mutacji; nowy klient, niepotwierdzony klient po utracie
  zaproszenia, własne hasło/profil/login, istniejący klient, wygaśnięcie,
  wykorzystany token i ponowne wydanie. W tej wersji Auth stary magiclink
  po wydaniu nowszego był odrzucony; nie obiecujemy tego jako stałej semantyki
  wszystkich typów linków. Administratorzy i dane klienta zachowane, Mailpit
  0 → 0 wiadomości, własne konta usunięte. Pliki narzędzia znajdują się poza
  checkoutem; instrukcja: [Ręczny dostęp](../manual-client-access.md).
- PostgreSQL na pełnych 60 migracjach: fitness 26/26, konkurencja 76/76,
  tworzenie psa 7/7, kwalifikacja 7/7, karty 19/19, jedna prowadząca 7/7.
  Każda próba zachowuje bazę źródłową i usuwa własną etykietowaną bazę/fixture.
- Proces przypomnień: przerwanie przed i po commicie, restart bez duplikatu,
  poprawne zakończenie watch. Osobna kolejka dla 50 fikcyjnych opiekunów:
  kontrola awarii/retry i niezmienionych cudzych zadań — zaliczona.
- Kopia i odtworzenie aktualnego schematu: 137 tabel, 2 pliki, 60 migracji;
  trzy logowania, zdjęcia, kursy/fitness/karty, rozliczenia, zalecenia, wersje,
  RLS i historyczne ponowienia sprawdzone przez odtworzone API. Źródło zachowane.
  Osobno zaliczone cztery rzeczywiste przerwania kopii/restore i końcowe odtworzenie.

Niezależny review wykrył i skierował do poprawy: przywracanie primary mimo błędu
sprzątania testów, przechowywanie linków poza checkoutem oraz zmianę kluczy i
warunków szkiców przy rewalidacji kwalifikacji, odpowiedzi i częściowej wpłaty.
Wszystkie trzy przypadki zaliczyły końcowe E2E na skompilowanej aplikacji:
kwalifikacja dwóch administratorów, odpowiedź zachowana przy paginacji planów
oraz częściowa wpłata A zachowana po zapisie B na tej samej liście. Odpowiedź
HTTP przerywano dopiero po potwierdzeniu rzeczywistego commitu. Ponowienie
nie powiela notatek, odpowiedzi, wpłat ani audytu. Łącznie sześć prób transportu
i cztery dodatkowe próby psa/kalendarza/rejestracji zaliczono z zachowaniem
pełnego snapshotu 87 publicznych tabel i pięciu wcześniejszych kont.

- Pełne Vitest po poprawkach: **1380/1380 w 107 plikach**. Późniejsza mała
  korekta blokady kwalifikacji podczas hydratacji/zapisu ma osobny przegląd,
  ESLint oraz rzeczywiste testy DOM i E2E. Build produkcyjny lokalny zaliczony.
- Rzeczywisty ReactDOM/Chrome: sześć przypadków formularzy psa i pięć przypadków
  odpowiedzi/wpłat, łącznie 11 kontroli zachowania. To testy z atrapą akcji,
  rozróżnione od opisanych wyżej pełnych prób z PostgreSQL.
- Sześć prób transportu na 320/390/768/1440 px: zachowane pola, brak poziomego
  przepełnienia, poprawna geometria formularzy i faktyczny hit-test przycisku
  oraz komunikatu po przewinięciu. Koordynator obejrzał zrzuty 390 i 1440 px.

- Pełne E2E: pierwszy przebieg **66 PASS / 2 FAIL**, 8,8 min. Dwa stare
  scenariusze wymagały adaptacji testów: wyboru kategorii i dnia w kalendarzu
  dla fitness oraz wskazania jawnego dokumentu wobec dodatkowego podglądu
  źródła odpowiedzi. Po adaptacji oba scenariusze przeszły osobne ponowienia.
  Nie ponawiano całej suite i nie zmieniano aplikacji w celu zaliczenia testu.
  Kontrole pieniędzy, prywatności i historii zachowane; niezależny review
  adaptacji nie znalazł osłabienia asercji. Po sprzątaniu pozostało pięć
  wcześniejszych kont, przywrócone primary i 87 niezmienionych publicznych
  tabel względem stanu po pełnym biegu. Względem początku zmienił się wyłącznie
  operacyjny heartbeat workera przypomnień, którego nie cofano.

- WebKit: **9/9** rzeczywistych scenariuszy — rejestracja, psa przed/po commicie,
  konflikt kwalifikacji, profil, odpowiedź do planu, wpłaty, kurs i fitness.
  Rzeczywiste dane lokalne i cleanup; to silnik przeglądarki na komputerze,
  nie dowód fizycznego iPhone’a ani doręczenia push.

## Pomiar obciążenia — otwarte AC-L10

Pierwszy kompletny pomiar aktualnej ścieżki zaleceń: 50 oddzielnych opiekunów
i jedna prowadząca, 1050 zgłoszeń, 200 konsultacji, 200 planów i 400 odpowiedzi.
Współbieżność 1 i 5 bez błędów. Przy 50: dashboard p95 **2584 ms**, finanse
**2833 ms**; care **1976 ms**, ale jeden odczyt na 150 nie zwrócił treści.
Log backendu potwierdził terminalny HTTP 502 odczytu kontekstów po ponowieniu.
Próg p95 < 2000 ms i brak błędów nie zostały zaliczone; nie obniżamy wymagań.

Jednocześnie 50 konkurencyjnych zgłoszeń dało dokładnie cztery przyjęcia
i 46 odmów, a 50 ponowień wpłaty — jedną wpłatę 100 zł. 153 renderowane strony
przeglądarki nie miały błędów/overflow i zachowały izolację. Kontrola hydratacji
runnera wymagała doprecyzowania dziedziczonego disabled przez :disabled;
po poprawce wymaga ponowienia. Wszystkie własne fixture usunięte, źródło zachowane.

Diagnoza transportu potwierdziła trzy przekroczenia limitu 512 połączeń
lokalnego Kong, resety i przedwczesne zamknięcia upstream. Jeden profilujący
przebieg dashboardu 50 miał 2773 backend fetch dla 153 stron obu ról i osiem
nieudanych odczytów Auth. Node CPU oraz opóźnienie event loop nie potwierdziły
ciężkiego renderowania; porównania SQL w roli klienta nie uzasadniły zmian RLS,
indeksów ani filtrów właściciela. Nie przenosimy lokalnego limitu 512 na hosting
produkcyjny. Zwykły preview i źródło przywrócone po diagnostyce.

Uzgodniony minimalny zakres poprawki transportu:

- AC-T01: najwyżej 48 aktywnych objętych odczytów Supabase w procesie Next;
  bez cache, deduplikacji wyników i współdzielenia tożsamości/nagłówków.
- AC-T02: slot do zakończenia odpowiedzi, zwolniony również po anulowaniu
  i błędzie; anulowane żądanie oczekujące nie może zostać później wysłane.
- AC-T03: URL, metoda, body, nagłówki, opcje, status i autoryzacja zachowane;
  brak nowego retry komend i brak zmiany zapisów na odczyty.
- AC-T04: kontrakty limitu, powolnego body, dwóch tożsamości, anulowania,
  błędu, HEAD/204 i pojedynczego wykonania mutacji.
- AC-T05: aktualny build oraz nieprofilowany pełny pilot 1/5/50 spełnia
  dotychczasowy cel i zachowuje dane; świeży niezależny przegląd kodu.

Po poprawkach semantyki transportu i harmonogramu odczytów pełny pilot z limitem
32 zakończył wszystkie kontrole bez błędów i zachował źródło. Przy 50 sesjach
opiekuna p95: dashboard 2065 ms, zalecenia 1762 ms, finanse 1499 ms; prowadząca
równolegle: 2499/1524/2056 ms. 153 strony przeglądarki miały p95 919 ms,
bez błędów i overflow; po 50 zapisach pozostały cztery przyjęcia i jedna wpłata.
Próg czasu nadal nie jest spełniony. Koordynator zatwierdził techniczne
strojenie ogranicznika z 32 do 48, bez zmiany celu <2000 ms i zera błędów;
nowy limit wymaga przeglądu oraz pełnego ponowienia pomiaru, nie zastępuje dowodu.

Próba z limitem 48 także zakończyła wszystkie kontrole bez błędów i zachowała
źródło. Dashboard przy 50 sesjach: opiekun 2109 ms, prowadząca 2320 ms;
zalecenia 1343/1167 ms, finanse 1326/1692 ms. Zmiana limitu ma niezależnie
potwierdzony wyłącznie numeryczny diff, ale nadal nie zalicza AC-T05. Po dwóch
próbach wracamy do rozdzielenia czasu kolejki, nagłówków i body zamiast
kolejnego strojenia bez pomiaru. Diagnostyka pozostaje prywatna i nie jest
zaliczeniem wydania.

Niezależny review transportu wyłapał i potwierdził usunięcie czterech regresji:
retry SDK po błędzie body, późne przechwycenie argumentów, dodatkową memoizację
Next oraz pozostawienie niewysłanego strumienia po abort. Własna próba reviewera
z rzeczywistym HTTP potwierdziła zamknięcie połączenia i zwolnienie kolejki.
Osobny niezależny review usprawnień care/finance: bez uwag, własne 60 testów.
Pełne unit na tej semantyce: **1419/1419 w 110 plikach**, build i ESLint zaliczone,
świeży audyt zależności produkcyjnych: 0 podatności. Korekta limitu ma jeszcze
osobny celowany odbiór i pomiar.

Jedna dodatkowa diagnostyka rozdzieliła FIFO, nagłówki i body. Przy dashboardzie
50 sesji Auth headers p95 2628 ms i FIFO 973 ms; pozostałe REST headers 118 ms
i FIFO 544 ms. Body p95 0,12 ms; backend i pełny HTML miały niemal ten sam
czas, bez dowodu kosztownego renderu. Wystąpił jeden backendowy 502 kontekstów
zaleceń, odzyskany dotychczasowym retry; błędów końcowych stron było zero.
Instrumentacja mogła zwiększyć czasy i nie zalicza wydania. Wszystkie trzy
wygenerowane chunki przywrócono byte-exact, źródła/config/testy/build oraz
public/Auth/migracje zachowane, zwykły preview odtworzony. Przy tych fixture
węższy dashboard powinien usunąć 315 z 2472 wywołań; to uzasadniona hipoteza,
nie obietnica wyniku. Nie omijamy weryfikacji Auth, aby poprawić pomiar.

## Odczyt finansów na dashboardzie — uzgodniony zakres

Biznes i technika niezależnie wskazały ten sam kontrakt: dashboard potrzebuje
podsumowania, a pełny ekran rozliczeń nadal potrzebuje kompletnej historii.
Koordynator przyjmuje wąski odczyt podsumowania, bez nowej migracji i bez
kopiowania reguł finansowych. Wspólny dotychczasowy model oblicza wymagane
salda; wynik dashboardu ujawnia tylko pola faktycznie używane w obu widokach.
Nie może udawać pełnego `FinanceData` z niekompletną historią/kwotą wpływów.

- AC-F01: identyczne widoczne kwoty, licznik wszystkich spraw, aktywne pakiety,
  kolejność i linki dla obu ról przed/po zmianie.
- AC-F02: zachowane częściowe wpłaty, anulowania, wygaśnięcia, uzgodnienia,
  przywrócenie oraz kurs/fitness z zerową należnością wymagające działania.
- AC-F03: karty i zwroty zachowują saldo usługi; pominięte szczegóły historii
  nie mogą zmieniać wymaganego wyniku. Pełne rozliczenia zachowują wpływy i historię.
- AC-F04: pełna paginacja źródeł używanych w obliczeniach, w tym istotne wpisy
  za granicą 500/1000; bez przedwczesnego filtrowania historycznych pakietów.
- AC-F05: sesja i RLS bez zmian; klient widzi wyłącznie swoje dane, admin
  całą dotychczasową praktykę, niezależnie od autora i primary.
- AC-F06: pełne `getFinanceData()` bez ograniczeń dashboardu; ekrany historii,
  ich strony/linki i wszystkie zapisy pozostają zgodne z dotychczasowym kontraktem.
- AC-F07: awaria potrzebnego źródła nie daje fałszywego zera; zachowane stany
  puste i rzeczywisty odbiór UI, w tym 320/390 px.
- AC-F08: niezależny review, dowód liczby odczytów i pełny nieprofilowany pilot
  1/5/50 z niezmienionym progiem <2000 ms, zerem błędów i zachowaniem źródła.

Odczyt dashboardu może pominąć listy szczegółów zwrotów kurs/fitness oraz
administracyjne listy profili/sprzedaży kart/zwrotów gotówki, gdy nie wpływają
na powyższą projekcję. Sześć potrzebnych źródeł finansowych, ich filtry i
kompletność pozostają. Nie zmieniamy Auth/getUser ani nie wprowadzamy cache
weryfikacji tożsamości w celu spełnienia pomiaru.

Końcowa wersja podsumowania przeszła świeży niezależny przegląd bez uwag
(50 testów reviewera), pełne **1451 testów w 111 plikach**, ESLint i build.
Pełny odbiór przeglądarkowy: **68/68 scenariuszy**, dodatkowo **9/9 WebKit**.
Kontrola po E2E zachowała 87 tabel, pięć istniejących kont, ich odciski oraz
historię migracji; jedyna różnica to oczekiwany heartbeat `reminder_worker_state`.
Nie oznacza to odbioru fizycznego telefonu.

Nieprofilowany pilot tej wersji: zero błędów końcowych, 153 strony bez overflow,
izolacja i oba testy konkurencyjnych zapisów zaliczone, źródło zachowane.
Przy 50 sesjach p95 opiekuna dashboard/care/finance: 2007/1950/1856 ms,
a prowadzącej: 2155/2380/2359 ms. **Próg <2000 ms nadal niespełniony**;
nie zaokrąglamy wyniku do zaliczenia. Kandydat Vercel jest gotowy, ale główna
domena i produkcyjna baza pozostają na dotychczasowym wydaniu.

Odczyt historycznych logów dokładnie z okna tego pilota wykazał 1283 poprawne
odpowiedzi GET `/user`, z p95 samego handlera Auth 1405 ms. Nie rozdziela to
kosztu SQL, puli i JWT. Statyczna kontrola dokładnej lokalnej wersji GoTrue
v2.196.0 wskazała domyślne wyłączenie zachowywania bezczynnych połączeń przy
`ApplyConfig`; nie potwierdza jeszcze rzeczywistego churn ani jego kosztu.
Dalsza kontrola dotyczy lokalnego środowiska testów, bez omijania Auth/RLS,
zmiany progów lub zmiany konfiguracji produkcyjnej.

Kontrolowany eksperyment lokalny ma osobne kryteria: AC-I01 stałe A/B przy
50 równoległych GET, dowód churn i zapasu zasobów przed zmianą; AC-I02 tylko
liczba zachowywanych bezczynnych połączeń (48, zgodnie z ogranicznikiem), ta sama
wersja obrazu, VM i konfiguracja bezpieczeństwa; AC-I03 sekrety tylko w pamięci;
AC-I04 ten sam pilot i niezmienione progi; AC-I05 odtworzenie oryginalnego
kontenera, nazwy, adresu i aliasów po każdej ścieżce; AC-I06 własne fikcyjne konto
i zachowane dane źródłowe; AC-I07 raport odróżnia wpływ środowiska od zmiany
aplikacji. Wynik eksperymentu nie dowodzi wydajności hostowanej produkcji.

Próba A wykazała 750 nowych sesji bazy podczas 150 kontrolowanych GET Auth
(concurrency 50), brak zachowanych połączeń Auth przed/po, zero błędów,
p95 klienta 934 ms i handlera 925 ms. Dziesięć rozgrzewek oddzielała przerwa
1612 ms. Pierwszy odczyt logów obciął końcówkę okna; pełne 150 historycznych
wpisów odzyskano bez powtarzania ruchu. Konta, publiczne tabele i migracje
zachowane. W VM pozostało ok. 2,1 GB dostępnej pamięci; limit bazy 100,
20 istniejących połączeń, trzy zarezerwowane. Koordynator zatwierdził jedną
próbę B48: z dodatkowym marginesem 16 pozostaje 84 wobec 97 dostępnych miejsc.
Nie jest to zaliczenie pilota aplikacji.

Przy odtwarzaniu lokalnego kontenera nowy identyfikator endpointu oraz jawne
zarezerwowanie tego samego IPv4 w IPAM są oczekiwanymi metadanymi ponownego
podłączenia. Wymagane pozostają oryginalny kontener, obraz, konfiguracja,
sekrety, nazwa, adres, aliasy i działająca trasa; nie deklarujemy identyczności
wszystkich metadanych sieciowych. Przegląd skryptu przed użyciem wykrył bramkę
pomiaru, trwałość dziennika i odzyskiwanie własnych fixture do dopracowania.

Próba B48 zakończyła się zachowaniem danych i przywróceniem oryginalnego
Auth: identyczne ID, obraz, Config/HostConfig, sekrety, nazwa, IPv4, aliasy/DNS
oraz zdrowa trasa. Jedyna zmiana IPAM to jawna rezerwacja tego samego IPv4;
endpoint otrzymał nowy identyfikator. Wszystkie fixture usunięte, stan eksperymentu
ukończony. Trzy uwagi operacyjne oraz walidacja IPAM zostały zamknięte przez
niezależnego recenzenta przed wykonaniem.

150 GET B48 dało zero błędów i 47 nowych sesji bazy wobec 750 w A; po próbie
pozostało 48 bezczynnych połączeń. Mediana handlera spadła z 728 do 11 ms.
P95 samego klienta Auth w tej próbie z początkowym napełnianiem puli wynosiło
1025 ms wobec 934 ms w A; nie przedstawiamy tego jako poprawy każdej metryki.

Pełny pilot B48 na tym samym kodzie miał p95 opiekuna 991/783/727 ms,
a prowadzącej 1267/423/869 ms. 153 strony bez błędów przeglądarki i overflow,
konkurencja miejsc oraz ponowień wpłaty zaliczone, źródło zachowane. Jednak
**dwie z trzech odpowiedzi listy planów prowadzącej przy 50 sesjach nie zawierały
treści: pilot pozostaje niezaliczony**. Obie odpowiadają dokładnie dwóm HTTP502
`care_plan_summaries` po resetach TCP Kong→PostgREST przed nagłówkami. W tym
oknie nie było błędów limitu worker512, połączeń bazy ani Auth. Przyczyny
wewnętrznej resetów PostgREST nie ustalono. GET skrzynki postępów nie miał
końcowych 502, więc nie rozszerzamy na niego zmiany.

## Odzyskiwanie odczytu listy planów — konkretny błąd z pilota

To korekta niezawodności istniejącego odczytu, bez nowej reguły biznesowej.
RPC `care_plan_summaries` jest SELECT-only, STABLE SECURITY INVOKER. SDK
nie ponawia HTTP502 dla tego POST; identyczny odczyt może być bezpiecznie
ponowiony. Używamy dotychczasowego mechanizmu `careRead`, z kryteriami:

- AC-R01: identyczne dane, sesja, RLS, offset, limit i kolejność; zapytania
  nadal równoległe, skrzynka tylko dla admina.
- AC-R02: wyłącznie `care_plan_summaries` z wynikiem 502 i błędem dostaje jedną
  dodatkową świeżą próbę z tymi samymi argumentami; zachowany POST i komunikat
  błędu. Odmowa, SQL/500 i błąd transportu nie dostają nowego retry aplikacji.
- AC-R03: błędny/null payload nie udaje pustej listy; trwała awaria jest widoczna.
- AC-R04: logi zawierają jedynie nazwę operacji i dozwolony kod/status; bez
  nagłówków, treści, danych prywatnych i nowych retry Auth lub zapisów.
- AC-R05: testy z rzeczywistym SDK i kontrolowanym fetch, niezależny review,
  aktualny build oraz ponowny pełny pilot. Dawny niezaliczony wynik pozostaje
  w raporcie. Do walidacji poprawionego kodu używamy osobnego jawnego
  eksperymentu z tą samą pulą lokalną 48, bieżącym zapasem zasobów i odtworzeniem.

Poprawka `care.summaries` przeszła niezależny przegląd bez uwag:
własne 32 testy reviewera i lint. Nowe testy używają rzeczywistego SDK oraz
kontrolowanego fetch, w tym 502→200, 502→502, odmowy/SQL, null po odzyskaniu,
paginację, dwie tożsamości i brak prywatnych danych w logach.

Końcowe unit poprawionego źródła: **1468/1468 w 112 plikach**. Pierwsza próba
przy dużej równoległości i równoległym lint przeciążyła pamięć: dziewięć
niezmienionych suite DB przekroczyło 60 s w beforeAll, przed asercjami.
`vitest.config.mts` ogranicza teraz liczbę procesów do dwóch. Nie zmieniono
filtrów, timeoutów, pominięć ani asercji; niezależny przegląd tej korekty bez
uwag. Pełne powtórzenie z tym samym zestawem zaliczone w 102 s. Build zaliczony.
Pełny odbiór końcowego buildu: **63 zaliczone, 5 niezaliczonych (12,6 min)**.
Dotyczą potwierdzeń karty, odpowiedzi do zaleceń, zmiany konsultacji, nawigacji
ustawień raportowania i zapisu na spacer. Trwa analiza zachowanych śladów
oraz pojedyncza instrumentowana próba karty; nie zaliczamy ich przez powtarzanie
całego zestawu lub zmianę limitów. Po sprzątaniu zachowano pięć oryginalnych
kont, 60 migracji i zawartość 86 tabel; zmienił się wyłącznie heartbeat workera.
Nowy kandydat Vercel jest gotowy, główna domena nadal bez przełączenia.

Kryteria korekty synchronizacji, przekazane autorowi przed implementacją:

- AC-E01: nowy dokładny POST bieżącej strony z nagłówkiem Server Action,
  listener przed kliknięciem, koniec body bez błędu i HTTP2xx w istniejącym
  budżecie 15 s; później niezmieniona asercja UI 5 s. Bez przechwycenia/retry
  żądania; logi wyłącznie czasy/status, bez URL i danych formularzy.
- AC-E02: fixture nowego psa wchodzi w jawny general i czeka na końcowy URL,
  właściwy nagłówek oraz gotowy formularz. Dedykowane testy bare redirect zostają.
- AC-E03: każda publikacja helpera czeka na zakończenie nowej operacji,
  a nie poprzedni tekst sukcesu. Reguły planów i asercje pozostają.
- AC-E04: minimalne wrappery dla wskazanego submitu care, zmiany konsultacji,
  wycofania karty i zgłoszenia spaceru; bez przebudowy pozostałych scenariuszy.
- AC-E05: brak pominięć, globalnych zmian limitów, retry testów/komend,
  mockowania DB i osłabienia pieniędzy, historii, izolacji lub sprzątania.

Niezależna analiza zachowanych śladów wykazała: helper drugiej publikacji
przyjmował wcześniejszy sukces jeszcze podczas pending; przekierowanie bare
care na kontekst ogólny przerywało kolejną nawigację fixture; odpowiedź spaceru
z gotową kartą kończyła się po 5433 ms, po wygaśnięciu asercji 5 s. Dwa
niezakończone POST care/konsultacji nadal wymagają dowodu pełnego zakończenia.
Poprawiamy kolejność testu: dokładny POST założony przed kliknięciem, koniec body
w istniejącym budżecie akcji 15 s, potem dotychczasowa asercja UI 5 s; bez retry
komend, zmiany globalnych limitów i pomijania kontroli historii/pieniędzy.
Odrębna pełna instrumentowana ścieżka karty przeszła: POST 248 ms, UI 260 ms.
WebKit końcowego źródła: 9/9 zaliczone (1,7 min).

Nowa jawna próba po poprawce care: `b32011e1` zaliczyła wszystkie odczyty bez
błędów, 153 widoki z izolacją i bez overflow, limit czterech miejsc dla
50 zgłoszeń oraz pojedynczą wpłatę dla 50 ponowień. **Cel szybkości nadal
niezaliczony**: przy 50 sesjach p95 opiekuna dashboard/care/finance
3148/1594/3896 ms, prowadzącej 3731/1017/5292 ms. Przy pięciu sesjach
p95 opiekuna 312/176/731 ms. Nie przenosimy wyników lokalnej VM na hosting.
Nowy eksperyment zachował kod, pięć oryginalnych kont, dane i migracje oraz
przywrócił identyczny oryginalny Auth (ID, env, host config, IP/DNS).

Dodatkowa kontrola pełnego rzeczywistego Next patch-fetch i memoizera odkryła
regresję wrappera dla jawnego signal przy wejściu URL: dwa niezależne odczyty
mogły stać się jednym memoizowanym. Wariant Request+init ma też ograniczenie
upstream, ale wrapper nie może narzucać go poprawnemu URL+signal. Brak dowodu
związku z pięcioma powyższymi pendingami. Minimalna korekta obejmuje tylko
GET/HEAD z jawnym nie-null signal; pozostałe metody i null/brak sygnału
zachowują dotychczasowe zachowanie. Implementacja i świeży przegląd w toku.

## Korekta założenia o końcu strumienia Server Action

Pięć celowanych scenariuszy po pierwszej korekcie: karta i reporting zaliczone,
care/konsultacja/spacer nie otrzymały EOF w 15 s. Tego wyniku nie nadpisujemy.
Jedna osobna minimalna publikacja rozdzieliła user ACK od końca strumienia:
HTTP200 w 239 ms; DOM w 1/5/14 s miał aria-busy=false, nowy komunikat publikacji
i koniec pending. Odczyt w 5 s potwierdził dokładnie jedną własną publikację.
EOF nie pojawił się w 18 s, a diagnostyczny runner zgodnie z pierwotną bramką
oznaczył FAIL. Jego flaga ack=false była ustawiana dopiero po EOF; bezpośrednie
snapshoty są dowodem zaobserwowanego ACK. W tym samym momencie kontrolowany
odczyt domknięcia własnego serwera wykazał active=0/waiting=0 w FIFO.
Tymczasowy debugger został zamknięty. Nie tłumaczy to przyczyny otwartego HTTP.

Świeży recenzent potwierdził obserwacje i kod lokalnego Next/React: klient
rozwiązuje wynik Server Action przed końcem dalszego czytania Flight. Z tego
powodu rewidujemy wyłącznie niepoprawny warunek EOF w **AC-E01R**: świeży
dokładny POST2xx i potwierdzenie konkretnej nowej operacji w UI w tym samym
budżecie 15 s. Publikacja wymaga expected_version+1 i końca pending, konsultacja
nowej wersji/sukcesu, progress własnego sukcesu, spacer nowej właściwej karty,
karta nowego sukcesu jednorazowego formularza. Potem pozostają stare asercje
UI 5 s oraz pełne kontrole DB, kwot, historii i izolacji. EOF jest osobną
obserwacją, nie bramką ACK. Nie zmienia to wymagania EOF dla skończonego
wychodzącego JSON Supabase w puli, limitów wydajności ani zakazu retry komend.

Końcowa poprawka jawnego GET/HEAD signal przeszła niezależny przegląd:
30 testów transportu, macierz 36 pełnych wariantów Next i negatywna kontrola
na wcześniejszym źródle. Koordynator osobno potwierdził prawdziwe HTTP GET/HEAD
na własnym 127.0.0.1: abort po/przed nagłówkami, zachowany Response/reason,
zamknięty socket, postęp kolejki, brak dodatkowej próby i pełne sprzątanie.
Pełny unit: **1473/1473, 112 plików, 90 s**. Build i TypeScript zaliczone.
Nowy podgląd ma źródło `83a727e5`; poprzedni kandydat Vercel nie jest już
kandydatem końcowego źródła. Nowy jest przygotowywany bez przełączania domeny.

Implementacja AC-E01R przeszła świeży niezależny przegląd i własny lint
recenzenta bez uwag. Na końcowym buildzie `83a727e5` wszystkie **5/5 pełnych
celowanych scenariuszy zaliczone (1,2 min)**: care wraz ze starą publikacją,
konsultacja z konfliktem i pieniędzmi, reporting ze snapshotem i wygaśnięciem,
spacer/pakiet z rezygnacjami i obecnością, pełny obieg karty. ACK mierzonych
operacji 157–420 ms. Dalsze pierwotne kontrole pozostały i zostały wykonane.
Pełne ESLint i TypeScript po tej korekcie również zaliczone. Pokrycie to 63
scenariusze pełnego poprzedniego przebiegu oraz poprawione 5 na końcowym
buildzie; nie opisujemy tego jako nowy pełny przebieg 68/68. Oddzielnie
30 testów transportu sprawdza ostatnią gałąź kodu GET/HEAD.

Końcowy WebKit na tym samym źródle: **9/9, 27,3 s**. Po obu próbach zachowano
pięć wcześniejszych kont Auth, 60 lokalnych migracji i wszystkie 87 publicznych
tabel. Gotowy kandydat Vercel `dpl_52eSvNpLXr5GE4VQykNnffodhyYN` ma stan READY,
właściwy projekt i fingerprint `83a727e5`; nie przełączono głównej domeny.

Odizolowana próba `f1423fe4` z tym samym źródłem i kontrolowaną lokalną pulą
Auth 48 spełniła wszystkie sześć progów czasu przy 50 sesjach: opiekun
dashboard/care/finanse **855/590/652 ms**, prowadząca **1138/360/895 ms**.
Pozostaje jednak **FAIL**, ponieważ jeden odczyt care na 150 nie zwrócił
wymaganej treści po dwóch odpowiedziach 502 `dog_care_contexts`.
153 strony przeglądarki nie miały błędów ani overflow; izolacja, cztery miejsca
na 50 zgłoszeń, pojedyncza wpłata po 50 ponowieniach i cleanup zaliczone.
Oryginalny kontener Auth, konfiguracja, adresy i DNS zostały przywrócone.

W tym oknie lokalny Kong miał 139 resetów i 16 przedwczesnych zamknięć
PostgREST; 19 końcowych odpowiedzi 502. Nie stwierdzono limitu 512, OOM,
restartu ani wyczerpania połączeń DB. Rzeczywiste lokalne obrazy to Kong 2.8.1
i PostgREST **v14.5**, efektywna pula keepalive 60, limit 100 żądań i idle 60 s.
Oba layouty rzeczywiście wykonują HEAD licznika powiadomień. Oficjalne
[zgłoszenie Supabase CLI #6674](https://github.com/supabase/cli/issues/6674)
opisuje błąd starego Warp: HEAD zamyka socket bez `Connection: close`, przez co
Kong może ponownie użyć zamykanego połączenia. Zgodność wersji i objawów jest
silną hipotezą, ale nie dowodem przyczyny każdego lokalnego resetu. Następny
krok to mały bezpośredni pomiar HEAD oraz odwracalna próba bramki, bez kolejnego
retry aplikacji i bez zmiany kryteriów. Wszystkie wcześniejsze porażki zachowane.

Bezpośrednia lokalna sonda potwierdziła ciche EOF po HEAD: brak Content-Length
i Connection: close, zamknięcie w 0 ms; porównywalny GET i STABLE POST pozostają
otwarte po 250 ms. Pierwotne oczekiwanie 200 dla `limit=0` okazało się błędnym
założeniem sondy: count exact na niepustej tabeli prawidłowo zwraca 206. Ten
raport pozostawiono jako nieważny; poprawiono wyłącznie klasyfikację znanej
odpowiedzi częściowej, bez zmiany bodźca ani wyniku aplikacji.

Kontrolowana lokalna sekwencja 1000 par przy współbieżności 10 odtworzyła
**180/1000 POST 502 po HEAD**. Ten sam odczytowy POST po GET: **1000/1000 200**.
Nie było retry, nowych kont ani zapisów danych. Odczyt produkcyjnych metadanych
18:37 UTC potwierdził PostgREST **14.5** także na hostingu. Nie zakładamy, że
lokalna częstość błędów jest częstością produkcyjną, ale pozostawienie znanego
bodźca HEAD w aplikacji nie jest uzasadnione. Próba pool0 pozostaje odłożona;
nie zmieniono Kong ani obrazu PostgREST.

Uzgodniona korekta kompatybilności liczników:

- AC-H01: trzy liczniki HEAD (nieprzeczytane powiadomienia, otwarte zgłoszenia
  i zapisy edytowanego spaceru) używają GET count exact z `limit=0`; identyczne
  filtry, sesja, RLS, obsługa błędów i interpretacja liczby.
- AC-H02: brak pobierania wierszy; liczba zero i dodatnia, w tym większa niż
  limit listy, zachowana. Test rzeczywistego SDK obejmuje GET, limit, Prefer
  i poprawny odczyt Content-Range przy 206 oraz pustym body listy.
- AC-H03: brak nowego retry, cache, zmian puli, sygnałów, Auth, DB i uprawnień.
- AC-H04: licznik obu ról, skrzynka, panel zgłoszeń i ochrona edycji spaceru
  zachowują dotychczasowe zachowanie.
- AC-H05: świeży przegląd diffu, celowane kontrole, nowy build i ten sam pełny
  pilot 1/5/50 przy niezmienionym Kong. Oryginalny Auth przywrócony po próbie.

Korekta przeszła świeży niezależny przegląd bez uwag. Własne testy recenzenta:
10/10 z rzeczywistym SDK. Pełny unit po korekcie: **1477/1477 w 112 plikach**,
build, ESLint i TypeScript zaliczone. Zamrożone końcowe źródło `2a885394`.

Końcowy kanoniczny pilot `0a5caba7` zaliczony: **1080 odczytów bez błędów**,
wszystkie progi p95 < 2000 ms. Przy 50: opiekun dashboard/care/finanse
**576/1018/670 ms**, prowadząca równolegle **955/457/843 ms**. 153 rzeczywiście
renderowane strony miały p95 1330 ms, bez błędów i overflow. Izolacja 50 kont,
cztery przyjęcia i 46 odmów na 50 zgłoszeń, jedna wpłata 100 zł po 50 próbach,
cleanup i zachowanie źródła zaliczone. Recenzent niezależnie przeliczył artefakty
i fingerprint wszystkich 404 plików oraz zweryfikował powiązanie runu i odtworzenie.
Kong pozostał bez zmian; nadal jest to lokalna VM 2 CPU/4 GB z czasową pulą
Auth 48, przywróconą po próbie. **Nie jest to próba 50 użytkowników hostingu.**

Dodatkowy odbiór trzech rzeczywistych procesów na końcowym buildzie: **3/3,
31,2 s** — skrzynka/przypomnienia, zgłoszenie terminu obu ról i edycja spaceru
z istniejącymi zapisami, konfliktami i historią. Zachowane pięć wcześniejszych
kont i ich credential/metadata, 60 migracji oraz 87 publicznych tabel; zmienił się
wyłącznie oczekiwany heartbeat workera przypomnień.

## Publikacja 16.10

Po zaliczeniu bramki wydania wdrożono migracje 59 i 60. Kontrola starych kolumn
85 publicznych tabel, kont Auth, konfiguracji logowania i harmonogramów workera
potwierdziła zachowanie wcześniejszego stanu. Nowe RPC i qualification_version
są dostępne po odświeżeniu schematu. O 18:46 UTC wypromowano gotowy build
`dpl_4vDRicnKZDdiaucZAwHjdNzZsocr`, źródło `2a885394`, na główną domenę.
Bezpośredni odczyt aliasu potwierdził to przypisanie. Starsze kandydaty nie
zostały opublikowane. Baza produkcyjna ma teraz **60 migracji**.

Odczytowy odbiór hostingu: **28/28** kontroli na 390 i 1440 px, obie role,
kalendarz/oferta, psy, usługi, rozliczenia, care i formularze odporności.
Bez błędów strony, overflow i komend biznesowych. Sprawdzono przewijanie belki,
klawiaturę, menu, prawdziwą niepustą ofertę i dostępne kontrolki. Obejrzano
również zrzuty kalendarza administratora i mobilnej oferty. Użyto własnego
konta właściciela oraz istniejącego DEMO; obie sesje wylogowano lokalnie,
bez zmiany konta Asi, hasła i wysyłki wiadomości. Kontrola produkcji 18:48 UTC:
60 migracji, healthy, Asia primary, brak tabel bez RLS, uprawnień anon,
publicznych bucketów i zaległych/nieudanych kolejek; harmonogramy aktywne.

Płatny plan, prawdziwe zaproszenia i kopie zdjęć nie zostały włączone przy
publikacji aplikacji. Zamknięty odbiór kodu nie zastępuje tych warunków startu.

## Granice weryfikacji i wejście na weekend

Ręczne linki są gotowe operacyjnie; nie wydano ich prawdziwym klientom bez
listy odbiorców. Ważność odczytana z produkcji wynosiła 60 minut, więc link
przygotowuje się blisko chwili przekazania konkretnej osobie. Nie uruchomiono SMTP.

Odczyt Supabase Management z 16.10, 15:14 UTC: **0 dostępnych kopii bazy**,
PITR wyłączony. Użytkownik wybrał Supabase Pro od 25 USD/mies. z osobnym zabezpieczeniem zdjęć.
Organizacja ma jeden projekt. Panel rozliczeń przygotowany; przeglądarka
wymaga logowania właściciela przed końcowym podsumowaniem. Nie zmieniono
jeszcze płatnego planu ani nie wyeksportowano danych. Użytkownik odłożył
logowanie i polecił kontynuować poprawki aplikacji; nie wstrzymuje to testów.
[Dokumentacja Supabase](https://supabase.com/docs/guides/platform/backups)
wskazuje, że kopia bazy nie obejmuje zawartości Storage; zdjęcia wymagają
osobnego zabezpieczenia. [Cennik](https://supabase.com/pricing) podaje Pro
od 25 USD/miesiąc z codziennymi kopiami bazy i retencją siedmiu dni.

Próba lokalnej kopii i odtworzenia nie jest dowodem automatycznej kopii
produkcyjnych danych poza komputerem, jej retencji ani dyżuru wsparcia.
Te elementy AC-L10 pozostają do uzgodnienia przed właściwym startem. Odbiór
fizycznego telefonu i doręczenia Web Push również pozostaje osobną kontrolą;
rozmiar ekranu i silnik przeglądarki nie zastępują urządzenia.

Prywatne logi i raporty: ignorowane `.local/launch-20261016/`.
