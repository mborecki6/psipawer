# Lokalne kopie danych i plików

Stan: 03.10.2026. Narzędzie dotyczy wyłącznie przygotowanego lokalnego Supabase w Lima. Wykonuje kopię i próbne odtworzenie w osobnych zasobach; nie zastępuje działającej bazy. [Tryb pracy lokalnej](LOCAL-DEVELOPMENT.md).

## Wykonanie i sprawdzenie

Przy działającym lokalnym stosie, z katalogu projektu:

```sh
pnpm local:backup create
```

Polecenie wypisuje identyfikator kopii. Sprawdź ją osobno:

```sh
pnpm local:backup verify IDENTYFIKATOR_KOPII
```

Kopia jest w ignorowanym `.local/backups/IDENTYFIKATOR_KOPII/`. Nie trzeba zatrzymywać ani zastępować aplikacji. Na czas spójnego zapisu skrypt wstrzymuje procesy lokalnych usług poza bazą, po czym je wznawia. W tym krótkim czasie aplikacja może czekać na odpowiedź. Nie uruchamiaj równolegle testów, migracji, procesu przypomnień, resetu ani innych operacji zapisu przez bezpośrednie połączenie SQL. Zwykły odczyt przez administratora nie stanowi problemu.

`verify` tworzy własną wewnętrzną sieć Docker oraz osobne kontenery i wolumeny. Nie publikuje portów, nie montuje danych źródłowych i nie ma drogi do zewnętrznych usług ani źródłowej sieci Supabase. Usługi Auth, REST i Storage łączą się tylko z odtworzoną bazą. Poczta jest dodatkowo skierowana na nieistniejący host; verifier nie wywołuje zaproszeń ani resetowania hasła. Własne zasoby są usuwane po zakończeniu lub obsłużonym błędzie.

## Zawartość

| Plik                     | Zakres                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database.tar.gz`        | Fizyczna kopia całego klastra PostgreSQL wraz z wymaganym WAL: konta Auth, role i ich ustawienia, dane, schematy, uprawnienia, funkcje i migracje. |
| `database-config.tar.gz` | Lokalna konfiguracja serwera, z oryginalnymi regułami połączeń.                                                                                    |
| `storage.tar.gz`         | Cały lokalny wolumen plików Storage, także zdjęcia obu oddzielnych zasobów.                                                                        |
| `runtime.json`           | Dokładne identyfikatory obrazów i lokalne ustawienia Auth, REST, Storage oraz bazy. Zawiera poświadczenia; pozostaje prywatny.                     |
| `manifest.json`          | Stan operacji, kontrola integralności archiwów, porównanie danych i informacja o wznowieniu źródła.                                                |
| `restore-….json`         | Osobny wynik konkretnej próby odtworzenia.                                                                                                         |

Katalog ma uprawnienia `0700`, a pliki `0600`. Logi i ustawienia odtworzonych usług także pozostają prywatne; mogą zawierać dane lub poświadczenia. Nie kopiuj całego katalogu do repozytorium, wiadomości, publicznego panelu ani zgłoszenia błędu. Narzędzie nie czyta `.env.local`, nie wykorzystuje odziedziczonych kluczy chmury i odrzuca inne adresy niż ustalony lokalny stos.

Fizyczną kopię wykonuje [PostgreSQL `pg_basebackup`](https://www.postgresql.org/docs/17/app-pgbasebackup.html). Przywrócenie wymaga tej samej wersji i architektury bazy; narzędzie używa dokładnie tego samego lokalnego obrazu przez jego identyfikator i nie pobiera automatycznie nowych obrazów. To procedura dla obecnego środowiska, nie import fizycznej kopii do hostowanego Supabase.

Lokalny CLI nie udostępnia połączenia replikacyjnego przez socket. Skrypt zachowuje oryginalny plik reguł i na czas kopii dodaje wyłącznie `local replication postgres peer`: dostęp dla procesu systemowego `postgres` przez lokalny socket, bez nowej reguły TCP i bez nowego hasła. Reguła jest cofana i przeładowywana przed wznowieniem usług. Identyfikator kontenera i skróty pliku chronią przed nadpisaniem zmienionej poza skryptem konfiguracji. Kopia ustawień zawiera wersję oryginalną.

Baza przechowuje tylko metadane plików, dlatego samo odtworzenie PostgreSQL nie przywraca zdjęć. [Supabase opisuje to ograniczenie kopii bazy](https://supabase.com/docs/guides/platform/backups). Ten zestaw obejmuje osobne archiwum rzeczywistego lokalnego Storage.

## Co sprawdza odtworzenie

1. Prywatność i typ plików, kompletność zestawu oraz SHA-256 każdego archiwum i konfiguracji. Uszkodzony, niekompletny lub niedokończony zestaw jest odrzucany przed utworzeniem zasobów.
2. Manifest fizycznej kopii i WAL przez [`pg_verifybackup`](https://www.postgresql.org/docs/17/app-pgverifybackup.html), zanim ruszy odtworzony serwer. To kontrola integralności, uzupełniona rzeczywistym startem bazy.
3. Pełną treść schematu, z funkcjami, politykami i grantami, oraz liczbę i skrót wszystkich wierszy każdej tabeli użytkowej. Nie ogranicza się do kilku przykładowych rekordów ani liczby psów. Schematy systemowe PostgreSQL i stan tymczasowy nie są porównywane jako dane aplikacji.
4. Pełne drzewo plików Storage: ścieżki, rozmiary i SHA-256. Porównanie obejmuje także istniejące pliki nieprzypisane już do profilu.
5. Gotowość rzeczywistych usług Auth, REST i Storage w izolowanej sieci.

`verify` nie zna haseł użytkowników i nie deklaruje pełnego procesu logowania. Osobny scenariusz integracyjny wykonuje właśnie tę próbę:

```sh
pnpm local:backup-test
```

Tworzy trzy fikcyjne konta `@example.test` (dwóch opiekunów i prowadzącą), psa, prywatną notatkę i dwa różne zdjęcia: dokumentacji psa oraz nieopublikowanego Psiutka. Zdjęcia mają rezerwację przed przesłaniem; osobna niezakończona rezerwacja pozostaje bez pliku. Przez odtworzone Auth test loguje się zachowanymi hasłami i potwierdza tożsamości; REST sprawdza właściwe role, własność psa oraz prywatność notatek. Storage musi zwrócić identyczne bajty obu zdjęć właścicielowi i prowadzącej, a odmówić obcemu i anonimowemu kontu. Porównywana jest także pełna lista migracji z repozytorium.

Dwa fikcyjne kursy wypełniają bieżące tabele, zamiast sprawdzać jedynie pusty schemat. Pierwszy zachowuje zmianę nazwy i pojemności, wpłatę 100 zł, uzgodnienie należności 30 zł, zwrot 70 zł i przywrócenie udziału za pierwotne 100 zł, wraz z pięcioma oczekującymi przypomnieniami i wiadomością opiekuna. Drugi zachowuje zakończone spotkanie i korektę obecności. Publikacje dla całego cyklu i konkretnego spotkania, późniejszy prywatny szkic oraz odpowiedź do wcześniejszej publikacji mają nadal własne powiązania. Do przeszłości przesuwane jest wyłącznie nowo utworzone spotkanie próby; nie zmieniamy zegara serwera ani wcześniejszych terminów.

Dwa dodatkowe psy mają po pakiecie fitness z czterema spotkaniami. Aktywny pakiet zachowuje częściowy zwrot, powrót, zakończone spotkanie z korektą obecności, plan całego pakietu i spotkania, odpowiedź do wcześniejszej publikacji oraz prywatny szkic kolejnego spotkania. Drugi pakiet pozostaje po rezygnacji z uzgodnieniem 30 zł i rzeczywistym zwrotem 70 zł. Przypomnienie aktualnego spotkania jest wymagalne, lecz źródłowy proces nie jest uruchamiany.

Dwie karty podarunkowe i osobna należność fitness sprawdzają nowe saldo oraz prywatne kody. Karta 250 zł zachowuje aktywację przez opiekuna, wykorzystanie 80 zł i powrót 20 zł, z saldem 190 zł. Druga karta 100 zł jest wycofana po częściowym zwrocie pieniędzy 30 zł i zachowuje saldo 70 zł. Kopia obejmuje sprzedaż, historię, potwierdzenia i powiązane wpłaty.

Po porównaniu pełnego schematu, wszystkich wierszy i plików test wykonuje rzeczywiste zapisy tylko przez odtworzone API: zmianę nazwy kursu, dopłaty 70 zł, kolejne korekty obecności, umówienie spotkania fitness, nową publikację i przywrócenie drugiego pakietu. Dostarcza przypomnienie fitness, potwierdza właściwego odbiorcę, pojedynczą próbę, brak duplikatu i odczyt wiadomości. Ponawia wcześniejsze ustawienia, uzgodnienia, zwroty, publikacje, przywrócenia, korekty i odpowiedź opiekuna. Zachowane potwierdzenia zwracają wcześniejszy wynik bez cofania nowych zmian. Sprawdzane są odmowy dostępu obcego opiekuna, brak dostępu opiekuna do prywatnego szkicu i odmowa wykonania powrotu przez opiekuna. Niezakończone przesłanie zachowuje termin wygaśnięcia i nie tworzy zdjęcia.

W odtworzeniu karta pokrywa kolejne 20 zł należności, z których 10 zł wraca na saldo. Druga karta jest przywracana z zachowanymi 70 zł i pierwotną datą ważności. Dziewięć wcześniejszych oraz trzy nowe ponowienia nie cofają stanu ani nie powielają operacji. Opiekun nie odczytuje prywatnych kodów, sprzedaży, historii decyzji lub potwierdzeń i nie może samodzielnie wykorzystać salda; obce konto nie widzi również karty i jej wpłat.

Hasła, kody i otrzymane tokeny pozostają w pamięci próby; test nie zapisuje ich w raporcie. Same archiwa przechowują pełne prywatne dane potrzebne do odtworzenia. Test usuwa wyłącznie własne źródłowe konta, psy, kursy, pakiety fitness, karty, dane powiązane i pliki. Nie pobiera cudzych zadań sprzątania zdjęć. Końcowe porównanie liczby i skrótu wszystkich wierszy każdej tabeli `public` potwierdza zachowanie wcześniejszych danych. Wpisy audytu tworzone przez sam Auth mogą pozostać w jego technicznej historii. Nowe logowania i zapisy w odtworzeniu następują po porównaniu z kopią, więc celowo zmieniają tylko odtworzony zestaw.

## Wcześniejszy wynik 02.10.2026

Pełna próba na poprawionym narzędziu z tego dnia: kopia `b067e471-6b3f-459e-a3a6-171954913e13`, odtworzenie `724650fd-a14b-473e-a830-9f1417142aa2`, od 09:18:03 do 09:18:10 UTC.

- **87 tabel użytkowych, 2661 wierszy** i pełny schemat zgodne z kopią.
- Fizyczna integralność potwierdzona, wszystkie usługi odtworzone poprawnie.
- **3 rzeczywiste logowania**, właściwe role i odmowa odczytu obcych danych.
- **2 zdjęcia** o identycznej zawartości; dostęp właściwych kont i odmowa dla pozostałych.
- **27 migracji**, zgodnych z repozytorium.
- Własne zasoby odtworzenia i źródłowe dane próbne usunięte; usługi i oryginalne reguły źródła przywrócone.

Próby ujawniły i pozwoliły poprawić regułę replikacji, właściciela nowego katalogu bazy, zgodność zapisu ustawień z BusyBox oraz niejednoznaczny odczyt kontenera i wolumenu o tej samej nazwie. Odczyty Docker wybierają teraz jawnie typ zasobu, także podczas potwierdzania jego usunięcia. Osiem testów granic narzędzia obejmuje dodatkowo własność blokady, istniejący proces oraz odrzucenie obcych, podmienionych i powtórzonych zasobów w dzienniku odzyskiwania. Cały zestaw: **549/549 testów w 55 plikach**, TypeScript i ESLint poprawne.

## Wcześniejszy wynik 03.10.2026 — 40 migracji

Kopia `0b4af2f9-ab3e-4f58-9904-c016ed8c1a59`, odtworzenie `97ec827c-f82c-400a-ae50-d81155ce2c73`, 05:57:11–05:57:22 UTC. Raport ma `status=ready`, `checks_passed=true` i `cleanup=true`.

- **103 tabele użytkowe, 8011 wierszy** i pełny schemat zgodne z kopią; fizyczna integralność i start wszystkich odtworzonych usług potwierdzone.
- **40 migracji**, trzy rzeczywiste logowania zachowanymi hasłami i dwa zdjęcia o identycznych bajtach, z kontrolą obu ról oraz odmową dostępu obcego i anonimowego konta.
- **Dwa niepuste kursy**: wpłata, częściowy zwrot, uzgodnienie, powrót, ustawienia i potwierdzenia, korekta obecności, dwie publikacje, prywatny szkic, wcześniejsza odpowiedź, pięć oczekujących przypomnień i wiadomość opiekuna zachowane.
- Dopłata i kolejna korekta przez odtworzone API działają; wcześniejsze ponowienia nie powielają danych ani nie cofają późniejszych zmian. Źródłowe saldo, nazwa i obecność pozostają bez zmian.
- Rezerwacja niedokończonego przesłania zachowuje dokładny termin wygaśnięcia, właściwe uprawnienia i brak pliku.
- Własne dane źródłowe usunięto; wszystkie wcześniejsze tabele `public` mają zgodne liczby i skróty wierszy. Pozostało pięć kont, w tym trzy demonstracyjne, cztery psy i 17 aktywnych usług po robocze 100 zł. Brak kursów i własnych kont próby; rejestr przesłań oraz kolejka zdjęć puste.
- Dziewięć usług źródłowych działa, oryginalne reguły połączeń są zgodne, blokada źródła zwolniona i zasoby odtworzenia usunięte. Lokalny podgląd nadal odpowiada HTTP 200 i korzysta z gotowej kompilacji.

Nowy scenariusz najpierw ujawnił wielowierszowy format odczytu kontrolnego i błędną nazwę pola w samym teście. Poprawiono odczyt na JSONB i nazwę `previous_attendance`; nie zmieniano logiki produktu ani migracji. Nieudana próba również potwierdziła sprzątanie i zachowanie źródła. Końcowo przeszło osiem testów granic kopii, kontrola składni i ESLint. Wcześniejsze **745 testów, 34 E2E i 76 prób PostgreSQL** są osobnym odbiorem produktu, bez ponownego uruchamiania ich w tym etapie. Cztery próby przerwania z 02.10 pozostają odrębnym dowodem opisanym niżej.

## Bieżący wynik 03.10.2026

Kopia `2b5cc0a0-a0bc-4b7c-9b48-57bc4007ccf2`, odtworzenie `c227eb91-d508-4904-be38-01c94dfc27c3`, 15:40:27–15:40:50 UTC. Raport ma `status=ready`, `checks_passed=true` i `cleanup=true`.

- **119 tabel użytkowych, 15 832 wiersze i 48 migracji**, cały schemat i fizyczna integralność zgodne z kopią.
- Trzy logowania, dwa zdjęcia i niedokończona rezerwacja zdjęcia zachowane; właściwe role i odmowy obcego oraz anonimowego konta potwierdzone przez odtworzone Auth/API/Storage.
- Niepuste kursy, pakiety fitness i dwie karty zachowują rozliczenia, publikacje, prywatne szkice, odpowiedzi, obecności i przypomnienia. Nowe zapisy oraz historyczne ponowienia działają w odtworzeniu bez zmiany źródła.
- Prywatny tydzień kalendarza oraz ustawienia przerw zachowane. Nowy zapis 10/20 minut i ponowienie bez dodatkowego audytu przeszły przez odtworzone API; klienci nie odczytują konfiguracji.
- Własne dane i zasoby zostały usunięte. Wszystkie wcześniejsze tabele `public` mają identyczne liczby i skróty wierszy.

## Wcześniejszy wynik kalendarza z 47 migracjami

Kopia `caae9928-ba17-417f-a3a1-2ec5bd1d31b9`, odtworzenie `c1a76558-d323-44fd-9a0b-c5e3109d5346`, 14:59:49–15:00:12 UTC. Raport ma `status=ready`, `checks_passed=true` i `cleanup=true`.

- **119 tabel użytkowych, 15 193 wiersze i 47 migracji** zgodne z kopią; zachowany cały schemat oraz fizyczna integralność.
- Trzy logowania i dwa zdjęcia działają przez odtworzone Auth/Storage; niepuste kursy, fitness i dwie karty zachowują dane, rozliczenia, plany, przypomnienia oraz historyczne i nowe ponowienia.
- Prywatne ustawienia kalendarza i siedem dni tygodnia zachowane. Opiekun i obce konto nie odczytują godzin. Nowy zapis przerw 10/20 minut działa przez odtworzone API; identyczne ponowienie zwraca tę samą wersję i jeden audyt. Źródłowe ustawienia pozostają niezmienione.
- Po usunięciu własnych danych wszystkie wcześniejsze tabele `public` mają zgodne liczby i skróty wierszy. Dokładne pięć kont, cztery psy, trzy spacery, zajętość i 17 cen zachowane; własne zasoby odtworzenia usunięte. Lokalny podgląd ma gotową kompilację i odpowiada HTTP 200.

**967 testów, 42 pełne E2E oraz osiem niezależnych prób kalendarza** to osobny odbiór produktu. Odtworzenie potwierdza opisane operacje lokalnego stosu; przechowywanie kopii poza komputerem i procedura hostingu pozostają do przygotowania.

## Wcześniejszy wynik kart z 45 migracjami

Kopia `b425220e-bd87-42e0-9bf5-15bcf36d922f`, odtworzenie `d40b8ec8-61e0-4ade-822e-00d5c9dd3bac`, 13:47:03–13:47:29 UTC. Raport ma `status=ready`, `checks_passed=true` i `cleanup=true`.

- **117 tabel użytkowych, 14 582 wiersze i 45 migracji** zgodne z kopią; pełny schemat, fizyczna integralność i start odtworzonego Auth/REST/Storage potwierdzone.
- Zachowane trzy logowania, dwa zdjęcia i rezerwacja przesłania oraz dotychczasowe scenariusze niepustych kursów i fitness, w tym 22 historyczne ponowienia fitness.
- **Dwie karty z saldem, kodami, sprzedażą i częściowymi zwrotami** zachowane. Nowe wykorzystanie, powrót części wartości i przywrócenie wycofanej karty działają przez odtworzone API. Dziewięć wcześniejszych i trzy nowe ponowienia zachowują wynik bez duplikatów i bez odnowienia ważności.
- Uprawnienia kart sprawdzono przez rzeczywiste odczyty i zapis API: obce konto nie widzi salda, historii lub wpłat; opiekun nie pobiera prywatnych danych i nie wykonuje rozliczenia. Kody nie trafiają do raportu ani komunikatu nieudanej kontroli.
- Nowe operacje nie zmieniły źródłowych kart. Po usunięciu własnych danych wszystkie wcześniejsze tabele `public` mają zgodne liczby i skróty wierszy. Zachowano dokładne identyfikatory pięciu wcześniejszych kont, czterech psów, trzech spacerów i wersje 17 aktywnych usług po robocze 100 zł.
- Końcowy odczyt potwierdził oryginalny skrót reguł połączeń, dziewięć działających usług, brak blokady i zero kontenerów, wolumenów oraz sieci odtworzenia. Karty i inne własne dane próby są usunięte. Podgląd odpowiada HTTP 200 i ma zgodny identyfikator kompilacji.

Rozszerzono scenariusz kopii o własne dane kart; narzędzie fizycznej kopii i migracje nie wymagały zmian. ESLint i formatowanie pomocnika przeszły. **941 testów i 40 E2E** są osobnym odbiorem końcowego produktu na tej samej lokalnej kompilacji, przed próbą odtworzenia. Kopia poza komputerem i procedura hostingu pozostają do przygotowania.

## Wcześniejszy wynik fitness z 44 migracjami

Kopia `c4861831-76de-404e-aae4-ac08f801780d`, odtworzenie `ae6609c8-d238-4a01-b254-9ecd74993952`, 11:28:53–11:29:12 UTC. Raport ma `status=ready`, `checks_passed=true` i `cleanup=true`.

- **109 tabel użytkowych, 13 958 wierszy i 44 migracje** zgodne z kopią; pełny schemat, fizyczna integralność i start Auth/REST/Storage potwierdzone.
- Zachowane trzy logowania, dwa zdjęcia, niezakończona rezerwacja przesłania i cały wcześniejszy scenariusz dwóch niepustych kursów.
- **Dwa niepuste pakiety fitness i osiem spotkań**: częściowe zwroty, uzgodnienia, przywrócenie, korekta obecności, trzy publikacje z własnymi powiązaniami, prywatny szkic i odpowiedź do wcześniejszego planu zachowane.
- Dostarczenie i odczyt przypomnienia przez odtworzone API działają. Ponowienie dostarczenia nie tworzy drugiej wiadomości ani próby. Obcy opiekun nie odczytuje danych lub prywatnego miejsca i nie oznacza wiadomości jako przeczytanej.
- Nowa wpłata, korekta, termin, publikacja i przywrócenie działają w odtworzeniu. **22 wcześniejsze polecenia fitness** zachowują pierwotne wyniki, nie cofają nowych zmian i nie powielają wpłat, planów ani odpowiedzi.
- Źródłowe dane fitness, przypomnienia i skrzynki pozostają niezmienione przed sprzątaniem. Po usunięciu własnych danych wszystkie wcześniejsze tabele `public` mają zgodne liczby i skróty wierszy. Zachowano dokładne identyfikatory pięciu kont, czterech psów i trzech spacerów oraz 17 aktywnych usług po robocze 100 zł.
- Oryginalne reguły połączeń przywrócono, dziewięć usług działa, blokada jest zwolniona. Nie pozostały kontenery, wolumeny ani sieć tej próby. Podgląd odpowiada HTTP 200, a manifest jest zgodny z kompilacją w `.next-local`.

Pierwszy przebieg zatrzymał się przy ponowieniu odpowiedzi opiekuna: test oczekiwał HTTP 200 z JSON dla funkcji `returns void`. Sprawdzanie wymaga teraz poprawnego HTTP 204 i pustej treści, zgodnych z wynikiem `null` lokalnego klienta Supabase; osobna asercja potwierdza jeden wpis i pierwotny plan po ponowieniu. Nie zmieniano funkcji produktu, migracji ani narzędzia wykonującego fizyczną kopię. Nieudana próba również potwierdziła sprzątanie i zachowanie źródła. Osiem testów granic kopii, składnia, ESLint i formatowanie przeszły. Wcześniejsze **862 testy, 39 E2E, 26 odrębnych prób fitness i 76 wcześniejszych prób PostgreSQL** pozostają osobnym odbiorem produktu. Osobny późniejszy [odbiór procesu przypomnień](REMINDERS-MODULE.md#przerwanie-i-restart-rzeczywistego-procesu--03102026) potwierdził wymienione granice przerwania i restartu dla trzech zadań fitness. Kopia poza komputerem pozostaje do przygotowania.

## Przerwana operacja i granice

Obsłużony błąd, Ctrl+C i SIGTERM uruchamiają cofnięcie tymczasowej reguły, wznowienie źródłowych usług i sprzątanie. SIGKILL lub nagłe wyłączenie komputera omijają obsługę sygnału. Manifest zostaje zapisany przed każdą planowaną zmianą źródła, a dziennik odtworzenia przed tworzeniem każdego zasobu. Zapis prywatnego dziennika synchronizuje plik, zastępuje go przez zmianę nazwy i synchronizuje katalog. Reguły połączeń są zastępowane przez kompletny plik w tym samym katalogu, z zachowaniem właściciela i uprawnień.

Sesja PostgreSQL z [blokadą doradczą](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS) wyklucza równoczesne wykonanie kopii i odzyskiwania. Osobna trwała blokada `.local/backups/.source-lock` wskazuje identyfikator kopii i pozostaje po śmierci procesu. Nowa kopia odmawia startu do czasu odzyskania poprzedniej; nie przejmuje jej blokady ani nie wznawia jej usług. Nie usuwaj ręcznie tego pliku.

Jeśli proces wykonujący kopię już nie istnieje, lecz źródłowe usługi pozostały wstrzymane:

```sh
pnpm local:backup recover IDENTYFIKATOR_KOPII
```

Odzyskiwanie odmawia działania przy istniejącym procesie lub blokadzie innej operacji. Wznawia tylko zapisane, niezmienione kontenery tego projektu i cofa wyłącznie rozpoznaną tymczasową konfigurację. Nie uznaje przerwanej kopii za gotową. Ponowienie zakończonego odzyskiwania jest bezpieczne; wywołanie dla gotowej i posprzątanej kopii nie zmienia jej manifestu. Nigdy nie naprawiaj tego przez reset bazy lub zbiorcze usuwanie wolumenów.

Po przerwaniu **próbnego odtworzenia** użyj identyfikatora kopii i identyfikatora próby z `restore-….json`:

```sh
pnpm local:backup recover-restore IDENTYFIKATOR_KOPII IDENTYFIKATOR_ODTWORZENIA
```

Polecenie weryfikuje prywatny dziennik, śmierć pierwotnego procesu, nazwy, etykiety, identyfikatory i montaże zasobów. Usuwa wyłącznie własne kontenery, wolumeny i sieć; nie zmienia danych ani ustawień źródła. Usunięcie każdego zasobu jest osobno potwierdzane i zapisywane. Błąd obserwacji nie jest traktowany jako dowód, że zasób zniknął. Nieudane sprzątanie pozostawia dziennik do ponowienia. Zbieranie prywatnych logów jest pomocnicze i nie blokuje sprzątania.

Powtarzalna rzeczywista próba:

```sh
pnpm local:backup-recovery
```

Ostatni poprawny raport: `d5b787ad-6182-4017-ab53-eae1f614dcf2`, 09:16:14–09:16:35 UTC. Cztery potwierdzone, żywe procesy potomne testu przerwano rzeczywistymi sygnałami:

| Operacja i miejsce przerwania                                        | Sygnał  | Potwierdzony wynik                                                                                                                                                      |
| -------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kopia, osiem usług wstrzymanych i tymczasowa reguła już przeładowana | SIGTERM | Automatyczne wznowienie, oryginalne ustawienia i uprawnienia, zwolnienie blokady, odrzucenie niekompletnej kopii.                                                       |
| Kopia w tym samym stanie                                             | SIGKILL | Nowa kopia odrzucona do czasu `recover`; odzyskanie ustawień i usług, usunięcie pomocnika i blokady. Sesja rzeczywistej blokady bazy zakończyła się po śmierci procesu. |
| Odtworzenie, sieć, trzy wolumeny i dwa kontenery już utworzone       | SIGTERM | Automatyczne sprzątanie własnych zasobów; brak zmian źródła.                                                                                                            |
| Odtworzenie, baza porównana i Auth/REST/Storage gotowe               | SIGKILL | `recover-restore` usunął wyłącznie zasoby zapisanej próby; źródło pozostało bez zmian.                                                                                  |

Test potwierdził też odmowę równoczesnej kopii i odzyskiwania żywego procesu, bez zmiany jego stanu; ponowienie odzyskiwania; zachowanie poprawnego zestawu oraz jego końcowe pełne odtworzenie. Porównano identyfikatory i stan wszystkich dziewięciu źródłowych kontenerów, skrót i uprawnienia reguł połączeń, liczby kont/psów/profili/plików/usług/migracji oraz cały zbiór nazw zasobów Docker przed i po próbie. Osobny późniejszy scenariusz Auth/API/Storage sprawdził wszystkie wiersze 87 tabel, zachowane hasła i dwa zdjęcia na końcowym kodzie.

To dowód odzyskania po przerwaniu procesów w wymienionych punktach. Nie przeprowadzono utraty zasilania, awarii dysku ani przerwania w każdym możliwym miejscu przesyłania archiwum.

Te kopie są na tym samym komputerze, więc nie zapewniają ochrony przed utratą jego dysku. Przed pilotem z klientami pozostaje ustalenie retencji, zaszyfrowanej kopii poza komputerem i procedury właściwej dla docelowego hostingu. Repozytorium aplikacji, instalowane obrazy, SMTP i ustawienia domeny wymagają osobnego zachowania; nie stanowią części tej kopii danych. Nie wdrażano niczego na produkcję ani nie uruchamiano harmonogramu.
