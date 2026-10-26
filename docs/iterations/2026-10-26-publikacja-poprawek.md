# Publikacja poprawek po audycie — 26.10.2026

## Zakres i autoryzacja

Użytkownik polecił wdrożyć przygotowane poprawki na produkcję. Nowe polecenie
rozszerza wcześniejszą zgodę wyłącznie lokalną z 18 i 23.10 o publikację kodu
oraz niezbędnych migracji. Nie uruchamia prawdziwego Tpay, symulatora w chmurze,
SMTP, zaproszeń, nowych kont ani płatnego planu Supabase.

Rozmowa z behawiorystką jest materiałem do oceny pomysłu krótkiego wprowadzenia.
Nie jest poleceniem wdrożenia kolejnej funkcji w tym samym wydaniu.

## Wersja i przygotowanie

- Końcowy kod runtime: `50a0543fae85e4e40c952ba2b316a0b1a78e956b`.
- Końcowy build: `dpl_3tLWwRqJnZNpk2BVtPmxvCntimCW`, Next.js 16.4.1,
  Zod 4.6.6, READY/production.
- Pierwszy build `dpl_9JTmUaB5f7HdNKq4FMMb2HuzB3Ta` z kodu `e0b96cc`
  służył do bramki migracji i pierwszego odbioru; potem zastąpiono go poprawką Zod.
- Projekt Vercel: `psipawer`; publiczna domena: [psipawer.vercel.app](https://psipawer.vercel.app/login).
- Fingerprint 417 plików źródeł runtime, zasobów, konfiguracji/zależności i migracji:
  `484486a708e18417f6f6e21ef9b4fe8c76c1738263ba179cd095dd88bd044cf3`.
  Pierwszy build: `bc647b625daa02bc0dbee03f6614baa2e0edc398439e2acb3500b4d634c965c6`.
- Przed migracjami sprawdzono rzeczywisty projekt, team, READY, fingerprint
  i commit z API metadanych Vercel. Główna domena wskazywała poprzedni build;
  kandydat miał wyłącznie pomocniczy alias projektu.
- Lista 732 plików końcowego uploadu (731 w pierwszym buildzie) wykluczyła `.env*`, `.local`, lokalne buildy,
  dane, sesje i kopie. Nie eksportowano konfiguracji środowiska Vercel.

Własny wąski przegląd recenzenta: 156/156 testów PASS; brak nowych blokerów
publikacji przy wyłączonych integracjach. Pełne lokalne dowody pozostają w
[odbiorze z 23.10](2026-10-23-gotowosc-platnosci.md): 1843 testy jednostkowe,
173 PostgreSQL, 78 E2E Chromium, ukierunkowane 13/13 Chromium i WebKit,
odtworzenie DB65 i pilot 50+1. Publikacja nie oznacza ponownego wykonania
wszystkich tych prób na produkcji.

## Kopia i migracje

Świeża prywatna kopia `5e7e5799-5ae7-4c7e-b000-135e055c780c`:
schemat 855 772 B, dane 947 308 B, role 431 B, manifest SHA-256.
Obejmuje public/Auth/Storage metadata/historię migracji. Produkcyjny Storage
miał zero obiektów; nie pominięto istniejących bajtów plików.
Kopia jest lokalna i nie zastępuje regularnych kopii poza komputerem.

Kopię odtworzono w osobnej oznakowanej bazie. Zachowano 87 wcześniejszych
tabel, credentials i metadata Auth, identities, Storage oraz efektywne
uprawnienia i 92 polityki RLS. Próba pięciu migracji 61–65 przeszła atomowo;
SQL w ledgerze zgodny ze źródłami, nowe ustawienia wyłączone, nowe kolejki puste.
Eksport ról zachowano, lecz nie stosowano go do współdzielonego lokalnego
klastra. Nie uruchamiano kopii jako usługi Auth. Po próbie usunięto własną bazę;
92 tabele lokalnego źródła, Auth i Storage pozostały bez zmian.

Produkcja otrzymała te same pięć migracji w jednej transakcji z kontrolą
dokładnej wcześniejszej historii, blokadą ledgeru i limitami oczekiwania.
Końcowy odczyt potwierdził **65 migracji**, zgodny SQL, zachowane 87 tabel,
konta, hasła, identities, Storage, konfigurację Auth i istniejące harmonogramy.
Projekt ACTIVE_HEALTHY; brak uprawnień anon i tabel publicznych bez RLS.

Końcowy odczyt 26.10, 14:32 UTC: PASS. Porównanie po własnych sesjach odbioru
rozróżnia dane biznesowe od
technicznych znaczników czasu: jedyną zmianą wcześniejszych tabel publicznych
jest heartbeat istniejącego `reminder_worker_state`. Hasła, role, metadata
użytkowników, pełne identities i Storage zachowane; liczba kont nadal cztery.
Nie twierdzimy, że cały Auth jest identyczny: odnotowano `last_sign_in_at`
i `updated_at` czterech użytkowników oraz `recovery_sent_at` jednego własnego
administratora. Ostatnia data pokrywa się z wygenerowaniem magiclink w końcowym
odbiorze. [Kod Supabase Auth](https://github.com/supabase/auth/blob/master/internal/api/mail.go)
używa tej samej gałęzi dla magiclink/recovery i zapisuje to pole także dla
magiclink. Nie jest to dowód resetu hasła ani wysłania recovery e-maila.
Techniczne liczniki Auth zmieniły się: sessions 9→13, refresh_tokens 20→24,
mfa_amr_claims 9→13; konta, identities i flow_state zachowały swoje liczby.
Pierwszy ścisły wynik porównania przy migracji zachowano oddzielnie.

## Wyłączone integracje

Dziewięć jawnych produkcyjnych flag ustawiono na `false`: Auth e-mail i hosted,
zaproszenia, business SMTP i hosted, nowe Tpay i hosted/live/reconciliation.
Zmiana dotyczyła wyłącznie tych flag; nie pobierano ani nie zmieniano pozostałych
sekretów. W DB `online_payment_settings.enabled=false` oraz
`business_email_settings.enabled=false`. Próby, potwierdzenia operatora i outbox
pozostają puste. Nie kopiowano lokalnego symulatora ani nie tworzono nowych
harmonogramów płatności/poczty. Dotychczasowe przypomnienia i Web Push zachowane.

## Odbiór produkcyjny

Po promocji gotowego buildu koordynator potwierdza główny alias i wykonuje
odczytowy odbiór obu ról z własnymi tymczasowymi sesjami istniejących kont.
Formularze są oglądane, bez zapisów; wysyłka i checkout nie są uruchamiane.
Pierwszy odbiór po odzyskaniu Data API: 38/41 wariantów UI PASS, trzy warianty
zaproszeń zatrzymane na niejednoznacznym selektorze testu (h1 i h2 o tej samej
nazwie). Doprecyzowanie selektora h2 i osobne ponowienie dały 3/3 PASS przy
320/390/1440 px. Aplikacja nie wymagała tej korekty. Pierwotny raport zachowano
bez zmiany wyników; łącznie sprawdzono 41 różnych wariantów. Trzy odmowy
endpointów PASS: nieuprawnione workery 401, wyłączony webhook 503.
Bez błędów JavaScript i prób zapisów biznesowych; SDK potwierdziło wylogowanie
obu własnych sesji odbioru.

**Końcowy odbiór po aktualizacji Zod: 41/41 wariantów UI i 3/3 endpointy
PASS w jednym nowym pełnym przebiegu.** Sprawdzono oba panele i odmowy
uprawnień przy 320/390/1440 px, przewijanie, klawiaturę i menu. Nie było
błędów JavaScript ani prób zapisów; obie własne sesje wylogowano. Osobny
prywatny katalog wyników `zod-hosted` zachowuje wcześniejsze raporty.
Alias API Vercel potwierdził przypisanie głównej domeny do końcowego buildu.

### Dodatkowa poprawka bezpieczeństwa zależności

Świeży audyt produkcyjnych zależności wykrył wysokie zgłoszenie
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
dla używanego Zod 4.5.4. Opis dotyczy nadmiernego zużycia pamięci podczas
walidacji dużych kolekcji; nie odtworzono ataku na aplikację. Podniesiono Zod
do poprawionej wersji 4.6.6, wraz z lockfile i zależnym peerem narzędzi lint.
Ponowny pełny zestaw: **129 plików, 1843 testy PASS**, TypeScript i ESLint PASS;
aktualny audyt produkcyjny: **0 zgłoszeń**. Niezależny wąski przegląd i własne
97/97 testów recenzenta także PASS. To osobne przebiegi z 26.10,
nie dopisanie wyników do testów z 23.10. Poprawka otrzymała osobny build,
bez kolejnych migracji i zmian przełączników integracji.

### Wykryty problem infrastruktury i odzyskanie dostępności

Pierwszy przebieg zatrzymał się przed otwarciem paneli na REST `PGRST303`
(`JWT issued at future`). Istniejący secret key działał w Auth Admin, lecz nie
w Data API. Osobna próba istniejącego konta DEMO potwierdziła ten sam błąd
dla świeżego JWT (`iat` zgodne z zegarem, sesja wylogowana). Trzy odczyty REST
i wariant z samym `apikey` potwierdziły trwałość błędu. Zegary klienta, HTTP
i bazy były zgodne; rzeczywisty `pg_stat_activity.application_name` wskazał
**PostgREST 14.5**. To mocno odpowiada znanej klasie błędu cache czasu,
nie stanowi jednak dowodu dokładnej przyczyny procesu bez telemetrii dostawcy.

Oficjalny [incydent Supabase](https://status.supabase.com/incidents/6q5902p2xd9f)
opisuje stale time cache i zaleca docelowo aktualizację projektu.
[Changelog PostgREST](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md)
wskazuje poprawkę w 14.18/16.3; [PR 5208](https://github.com/PostgREST/postgrest/pull/5208)
usuwa zależność walidacji od tego cache. Nie zmieniano walidacji JWT, zegarów,
kluczy ani konfiguracji Auth.

Po poinformowaniu użytkownika wykonano **jeden kontrolowany restart całego
projektu** przez udokumentowane `POST /v1/projects/{ref}/restart`. Nie ma
udokumentowanego restartu samego PostgREST. Przed restartem sprawdzono kopię,
odtworzenie, 65 migracji, puste kolejki, wyłączniki i brak aktywnych transakcji
Data API; zapisano fingerprint danych. Nie kupowano planu i nie resetowano DB.
Po restarcie odczyt REST wrócił do HTTP 200, projekt ACTIVE_HEALTHY.

Wersja **pozostała 14.5**: odzyskanie dostępności nie oznacza trwałego wdrożenia
poprawki. Przed zapraszaniem prawdziwych klientów pozostaje aktualizacja wersji
projektu, osobna od planu Pro. Odczyt eligibility 26.10: obecnie
`supabase-postgres-17.6.1.166`, dostępne `supabase-postgres-17.11.0.003`
(ten sam główny PostgreSQL 17, kanał GA), eligible=true; brak zgłoszonych
ostrzeżeń, validation errors, unsupported extensions i obiektów do usunięcia.
API szacuje czas operacji na **1 godzinę**. To estymata platformy, nie wynik
przeprowadzonej aktualizacji; potrzebne osobno uzgodnione okno i odbiór.
Nie wykonano upgrade. [Procedura dostawcy](https://supabase.com/docs/guides/platform/upgrading).

## Krótkie wprowadzenie — propozycja do kolejnej iteracji

Potrzeba jest zasadna: nowy opiekun powinien wiedzieć, gdzie rozpocząć zapis,
co oznacza zgłoszenie i gdzie otrzyma pomoc. Obecny ekran „Poznajmy się” zbiera
dane kontaktowe. Na pustym pulpicie „Wybierz usługę” ma mniejszą wagę niż
własny kalendarz. Przewodnik warto więc połączyć z czytelnym pierwszym krokiem
na pulpicie i wyraźnym rozróżnieniem Oferty od potwierdzonych spotkań.

Propozycja czterech krótkich kroków:

1. **Poznajmy Was.** To Wasze miejsce na zajęcia i pracę z Asią. Dodaj profil
   psa, jeśli jeszcze nie ma go w „Moje psy”.
2. **Zacznij od Oferty.** Wybierz „Indywidualne” lub „Grupowe”, potem usługę.
   Przy niej zobaczysz, jak zgłosić psa na zajęcia albo ustalić termin.
3. **Sprawdź, co dalej.** Po wysłaniu sprawdź status zgłoszenia. Część zapisów
   czeka na decyzję Asi; wybrane spacery przyjmują automatycznie. Potwierdzony
   termin znajdziesz w Kalendarzu.
4. **Pomoc jest blisko.** Dzwonek otwiera wiadomości w aplikacji. Potrzebujesz
   pomocy z wyborem lub zapisem? Napisz do Asi przez WhatsApp.

Pierwsze zwykłe wejście po wymaganym profilu; „Pomiń”, „Wstecz”, „Dalej”,
możliwość powrotu przez „Jak zacząć”. Końcowa akcja: „Dodaj psa” albo
„Przejdź do Oferty”, zależnie od istniejącego profilu. Bez przerywania wejścia
bezpośrednio do konkretnego zgłoszenia i bez pokazywania prowadzącej przewodnika
opiekuna. Trwałe jednorazowe pokazanie na wszystkich urządzeniach wymaga
osobnej decyzji o zapisie stanu i odbioru uprawnień; nie ma go w tym wydaniu.

Film Asi może być opcjonalnym powitaniem wewnątrz aplikacji: uruchamiany
świadomie, z napisami i równoważnym tekstem. Bez autoplay i blokowania wejścia.
Tekst powinien wystarczyć do zrozumienia zapisów także bez nagrania.
Nie obiecujemy terminu odpowiedzi, automatycznych zaleceń, SMTP, push ani
płatności, zanim odpowiedni kanał nie zostanie odebrany i uruchomiony.

Otwarta propozycja, bez implementacji: akceptacja treści przez Asię i decyzja,
czy obecnym testerom jednorazowo zaproponować przewodnik. Proponowany późniejszy
odbiór: trzy nowe osoby samodzielnie odnajdują właściwy początek zapisu.
