# Lokalna próba 50 kont

Stan: 03.10.2026. Pomiar dotyczy gotowej lokalnej kompilacji i rzeczywistego Supabase. Nie obejmuje hostingu, wysyłki poczty ani danych klientów. [Aktualny stan całego produktu](PRODUCT-STATUS.md).

## Powtarzalne uruchomienie

Na przygotowanym komputerze, z katalogu projektu:

```sh
pnpm local:start
pnpm local:build
# Zatrzymaj local:dev albo wcześniejszy podgląd na porcie 3000.
pnpm local:preview
```

W osobnym terminalu:

```sh
pnpm local:load
```

Launcher i próba odrzucają zdalne adresy. Test czyta wyłącznie `.env.test.local`, wymaga API `http://127.0.0.1:54321`, aplikacji `http://localhost:3000` oraz zgodnego identyfikatora i skrótu konfiguracji lokalnej kompilacji. Nie przejmuje ustawień hostingu z otoczenia ani `.env.local`. Po zmianach aplikacji trzeba ponownie zbudować i uruchomić podgląd. [Przygotowanie lokalnego stosu](LOCAL-DEVELOPMENT.md).

Podczas pomiaru nie uruchamiaj innych ciężkich testów, migracji, resetu ani procesu przypomnień. Dane próbne obejmują przyszłe spotkania; działający worker mógłby utworzyć dodatkowe powiadomienia, których ten test nie ma obsługiwać. Start i zwykłe zatrzymanie stosu zachowują wcześniejsze dane.

## Dane i zakres

Test tworzy 50 potwierdzonych kont opiekunów i jedno konto prowadzącej, wszystkie pod unikalnymi adresami `@example.test`. Każde loguje się przez rzeczywisty Auth i ma osobne cookies sesji. Losowe hasła i cookies pozostają wyłącznie w pamięci procesu; nie trafiają do raportu. Nie wysyła się zaproszeń ani wiadomości.

Historia przed mierzonymi zapisami obejmuje:

| Rekordy                                      | Liczba |
| -------------------------------------------- | -----: |
| Psy i prywatne notatki prowadzącej           |  po 50 |
| Terminy spacerów                             |    260 |
| Zgłoszenia spacerowe                         |   1050 |
| Zapisane wpłaty                              |    666 |
| Pakiety po cztery wejścia                    |     50 |
| Zakończone konsultacje z ceną roboczą 100 zł |    200 |
| Opublikowane wersje planów                   |    200 |
| Odpowiedzi o postępach                       |    400 |

Przed pomiarem wszystkie 50 sesji musi widzieć tylko własnego psa, nie odczytać planu obcego psa i nie otrzymać prywatnych notatek. Dodatkowo strona każdego opiekuna musi zawierać jego fikcyjne dane i nie zawierać znacznika innego opiekuna.

Odczyty obejmują pulpit, zalecenia własnego psa i finanse. W każdej z trzech rund liczba równoczesnych żądań opiekunów wynosi 1, 5 albo 50. Pierwsza runda wykonuje po 50 żądań na ekran; kolejne po 150. Łącznie jest **1050 mierzonych odczytów opiekunów**. Jedna sesja prowadzącej wykonuje równolegle po trzy kolejne odczyty odpowiedniego ekranu w każdej rundzie, razem **27 odczytów prowadzącej**. Nie oznacza to 50 równoczesnych prowadzących.

Trzy wstępne odczyty przygotowują ekrany przed rundami. W raporcie zachowano dla nich etykietę `cold`, ale są to pierwsze odczyty nowych danych próbnych, **nie pomiar zimnego startu serwera**. Kompilacja i serwer są już uruchomione, a aplikacja może mieć wcześniejszy ruch.

Pomiar HTTP kończy się po odebraniu pełnej odpowiedzi HTML. Sprawdzane są status, oczekiwana treść i brak komunikatu błędu przesyłanego w strumieniu. Oddzielny etap Chrome wykorzystuje te same 50 sesji i przechodzi przez 150 stron opiekunów oraz trzy prowadzącej, przy pięciu aktywnych kartach naraz i szerokościach 320/390/1440 px. Potwierdza widoczny panel, własne dane, brak cudzych danych, gotowe pole odpowiedzi, brak błędów skryptów oraz przewijania całej strony w poziomie. Jego czas obejmuje nawigację i te sprawdzenia, ale nie jest miarą Web Vitals ani 50 jednoczesnych rendererów. Pełne interakcje zapisu nadal mają osobne scenariusze E2E.

Ostatnie dwie próby wykonują po 50 równoczesnych wywołań rzeczywistego API:

- Zapis na spacer z limitem czterech miejsc: dokładnie cztery przyjęcia, 46 oczekiwanych odmów z powodu pojemności i cztery należności po 100 zł.
- Ponowienie tej samej wpłaty przez prowadzącą: jeden wpis na 100 zł, jeden identyfikator i brak podwójnego obciążenia.

## Bieżący wynik 03.10.2026 — 48 migracji

Raport `.local/pilot-load/c46d51f2-1426-4abe-9cb1-d1923b9d75cc.json`, 15:52:27–15:53:16 UTC: `checks_passed=true`, `target_met=true`, `cleanup=true` i `source_preserved=true`. Środowisko ma nadal lokalną bazę 2 CPU / 4 GB; kompilacja zawiera wszystkie obecne panele.

| Ekran opiekuna | p95 przy 50 równoczesnych żądaniach |
| -------------- | ----------------------------------: |
| Pulpit         |                          1258,96 ms |
| Zalecenia psa  |                           991,05 ms |
| Finanse        |                          1649,31 ms |

Wszystkie 1050 mierzonych odczytów opiekunów i 27 prowadzącej zakończyły się bez błędów. Najwolniejsze z trzech odczytów prowadzącej przy obciążeniu 50 kont wyniosły 1258,92 / 867,91 / 1830,65 ms; tak mały zbiór nie daje mocnego oszacowania statystycznego.

**153 rzeczywiste strony w Chrome** przeszły sprawdzenie widoczności, uprawnień i szerokości, bez błędu skryptów. p95 nawigacji z wymienionymi sprawdzeniami wyniosło **627,51 ms** przy maksymalnie pięciu aktywnych kartach. Nie łączymy tego wyniku z p95 żądań HTTP wykonywanych przy równoczesności 50.

50 równoczesnych zapisów zachowało cztery miejsca i 46 oczekiwanych odmów (p95 83,12 ms). 50 ponowień wpłaty zachowało jeden wpis 100 zł (p95 47,62 ms). Po sprzątaniu wszystkie wcześniejsze tabele `public`, dokładne identyfikatory kont i lista 48 migracji są zgodne z odczytem sprzed próby.

## Wcześniejszy wynik 02.10.2026

Środowisko: macOS / Apple Silicon, Node.js 24.19, Next.js 16.3.4; aplikacja działa na hoście, lokalny Supabase w Lima z **2 CPU i 4 GB RAM**. PostgreSQL 17.6. Nie jest to charakterystyka przyszłego serwera produkcyjnego.

Ostatni raport: `.local/pilot-load/4c00c4e3-5cc4-4465-85d8-1aa23a813e47.json`. Próba od 07:29:26 do 07:29:54 UTC; wszystkie sprawdzenia, cel czasowy i sprzątanie zakończyły się poprawnie. W całym zbiorze mierzonych odczytów nie wystąpił błąd.

| Ekran opiekuna | p95 przy 1 żądaniu | p95 przy 5 żądaniach | p95 przy 50 żądaniach |
| -------------- | -----------------: | -------------------: | --------------------: |
| Pulpit         |           71,44 ms |            184,94 ms |            1123,68 ms |
| Zalecenia psa  |           42,75 ms |            109,26 ms |             937,65 ms |
| Finanse        |           48,71 ms |            121,61 ms |            1084,00 ms |

Przy obciążeniu 50 opiekunów najwolniejsze z trzech odczytów prowadzącej trwały: pulpit **1228,64 ms**, plany **937,75 ms**, finanse **1100,46 ms**. Raport nazywa te wartości p95, lecz przy próbie trzech żądań są w praktyce maksimum. To za mała próbka do mocnego wniosku statystycznego o panelu prowadzącej.

Zapis na ostatnie miejsca: p95 **55,50 ms**, limit zachowany. Ponowienie wpłaty: p95 **133,72 ms**, jeden wpis. Cel pozostaje taki jak w planie MVP: p95 wszystkich mierzonych rozgrzanych odczytów oraz obu zapisów poniżej **2000 ms**, przy braku błędów i zachowaniu reguł biznesowych. Wynik jednego lokalnego przebiegu nie gwarantuje czasu odpowiedzi w innych warunkach.

Pierwszy porównywalny raport `b43382fe-86cf-47d9-8620-c15b9a817b06` miał już poprawne wyniki i sprzątanie, ale przekraczał cel: pulpit **7944,74 ms**, zalecenia **1957,92 ms**, finanse **6491,51 ms** przy 50 żądaniach. Oba przebiegi miały tę samą liczebność danych próbnych i limit zasobów bazy; ich wartości są obserwacjami konkretnych prób, a nie gwarantowanym przyspieszeniem procentowym.

## Zmiany wynikające z pomiaru

- Migracja `202610020004` ogranicza powtarzanie odczytu tożsamości i sprawdzania roli w politykach SELECT. Zamiast funkcji własności wywoływanej dla każdego rekordu wykorzystuje zestaw własnych psów. Operacje zmiany danych i prywatne lokalizacje zachowują wcześniejsze zabezpieczenia.
- Test regresji porównuje widoczne identyfikatory przed i po migracji w 15 tabelach dla prowadzącej i dwóch różnych właścicieli, a także 54 kombinacje widoczności spacerów i zapisów. Odczyt anonimowy nadal jest odrzucony. Sam wynik wydajności nie stanowi dowodu równoważności uprawnień.
- Sprawdzenie sesji i wspólny odczyt danych są współdzielone tylko wewnątrz jednego żądania przez `React.cache`. Kolejne żądanie ponownie sprawdza użytkownika w Auth oraz bieżącą rolę w bazie. Profil i rola są pobierane równolegle.
- Proxy korzysta z weryfikacji JWT przez `getClaims`, zgodnie z [instrukcją Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs). Dostęp do danych nadal wymaga `getUser` i roli z bazy. E2E sprawdza odrzucenie zmienionego podpisu i odebranie uprawnień bez ponownego logowania. Chronione odpowiedzi mają `private, no-store`.
- Odczyt kalendarza korzysta z GET dla niezmieniającej danych funkcji RPC. Włącza to bezpieczne ponowienia odczytu obsługiwane przez bibliotekę. Wcześniejsze sporadyczne błędy nie pozwoliły jednoznacznie potwierdzić przyczyny sieciowej; kolejne przebiegi po zmianie były poprawne. Diagnostyka zapisuje tylko nazwę operacji oraz dozwolony kod/status, bez treści prywatnej, adresów i tokenów.
- Finanse pokazują po 20 należności, pakietów i wpłat w niezależnych listach. Pełne sumy i kompletna historia pozostają zachowane. Bezpośredni link wybiera właściwą stronę listy. Formatery kwot i dat są używane ponownie, zamiast tworzenia ich dla każdego wiersza.

Na końcowej kompilacji przeszło **541 testów Vitest**, **8 pełnych scenariuszy E2E** oraz **19 prób niezależnych transakcji PostgreSQL**. Obciążenie stanowi dodatkowy poziom weryfikacji, a nie ich zamiennik.

## Raporty, sprzątanie i ograniczenia

Raport ma uprawnienia `0600`, a nowy katalog raportów `0700`. Jest zapisywany atomowo jeszcze przed pierwszym utworzeniem konta i aktualizowany przy zmianach etapu. Zawiera identyfikator próby, liczniki, czasy, stan sprzątania i bezpieczne kategorie błędów. Nie zapisuje haseł, cookies, treści odpowiedzi ani pełnych planów SQL. Cały katalog `.local/` jest ignorowany przez Git.

Zwykłe zakończenie i obsłużony błąd uruchamiają sprzątanie według dokładnych adresów i identyfikatorów tej próby. Nie wykonuje się resetu ani zbiorczego usuwania wcześniejszych danych. Sprzątanie potwierdza brak własnych kont i psów oraz zgodność wszystkich wcześniejszych tabel `public`, identyfikatorów Auth i migracji. Raport końcowy ma `status: finished`.

Nagłe zabicie procesu lub komputera nie gwarantuje wykonania sprzątania. Wstępny raport pozwala rozpoznać unikalny prefiks adresów, ale automatyczne odzyskanie takiej próby nie zostało jeszcze dodane. Przy `status: running` po zakończeniu procesu albo `cleanup: false` najpierw ustal i usuń wyłącznie dane wskazanej próby; nie uruchamiaj resetu ani usuwania kont według samego ogólnego prefiksu.

Kod zakończenia: **0** — poprawność, sprzątanie i cel czasowy; **2** — poprawność zachowana, cel czasowy przekroczony; **1** — błąd weryfikacji lub sprzątania. Sam poprawny status HTTP nie wystarcza.

Odtworzenie kopii bazy i plików oraz pozostałe usługi mają oddzielne odbiory wskazane w [stanie produktu](PRODUCT-STATUS.md). Pozostaje pomiar docelowego hostingu. Zewnętrzny SMTP oraz zaproszenia klientów nadal są odłożone. Nie wdrażano zmian na produkcję.
