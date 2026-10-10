# Obsługa pilota na Vercel i Supabase

Pilot od 06.10.2026 działa pod [psipawer.vercel.app](https://psipawer.vercel.app/login). Jest przeznaczony do walidacji MVP przez administratora, behawiorystkę i fikcyjne konta opiekunów. Kwoty i spotkania DEMO nie stanowią rzeczywistych transakcji ani rezerwacji. [Scenariusze testów](PILOT-TEST-SCENARIOS.md) opisują oba panele.

## Aktualizacja po feedbacku — 10.10.2026

Kalendarz zespołu, widok miesiąca, indywidualne godziny, sale, blokady całodniowe, ostrzeżenia o preferowanych przerwach, uproszczony kontekst planów i filtry oferty są dostępne online. Pierwszy opublikowany build tego wydania to `dpl_VdWitq7Bg5jfHXwGvv5ZicZKb5oY`, z kodu `28d6fa9`. Publiczny alias jest gotowy. Późniejszy push dokumentacji na `main` może wygenerować kolejny build; bieżący identyfikator należy sprawdzać przez `vercel inspect https://psipawer.vercel.app --json`.

Chmura ma **49 migracji**. `202610100001_calendar_team.sql` zastosowano atomowo po świeżej prywatnej kopii obejmującej Auth, Storage oraz historię migracji. Odtworzenie tej kopii i próba nowej migracji zachowały zawartość wszystkich 68 wcześniejszych tabel publicznych poza celowo zmienioną projekcją `calendar_slots`. Tę samą kontrolę wykonano po migracji produkcyjnej. Źródłowe terminy, konta, hasła, ustawienia Auth, ceny i postęp testerów są zachowane. Nie resetowano zestawu DEMO.

Końcowy odczyt potwierdził `ACTIVE_HEALTHY`, historię 49 migracji i zgodny skrót SQL nowej migracji, zachowane liczby kont i danych oraz hasła, a także aktywny harmonogram przypomnień.

32 istniejące źródła mają jawne przypisanie historyczne `legacy_unassigned`; projekcja zawiera 11 zajętych przedziałów. Migracja nie utworzyła sal i nie odgadywała prowadzących. Zespół może przypisać terminy i zdefiniować sale w ustawieniach. Harmonogram przypomnień nadal działa co pięć minut. Wysyłka SMTP, zaproszenia klientów oraz fizyczne sprzątanie zdjęć pozostają wyłączone.

Odczytowa kontrola wydania przeszła **40 stron prowadzącej i dwóch kont opiekunów**, **39 wariantów responsywności** (13 ekranów × 320/390/1440 px) oraz **16 kontroli prywatnego API**. Sprawdzono tydzień i miesiąc, 42-dniowy zakres ze zmianą czasu, wybór prowadzącego i sali, formularz całodniowego urlopu bez zapisu, filtry oferty obu ról oraz zachowanie tekstu i powiązania istniejącego szkicu. Nie było błędów skryptów ani konsoli i nie wykonano zapisów aplikacyjnych. Liczby wierszy oraz skróty 16 tabel biznesowych pozostały identyczne przed i po. Użyto istniejących kont i własnych tymczasowych sesji Auth, bez zmiany haseł. Ten sprawdzian hostingu nie powtarza lokalnych E2E z zapisami; lokalne 1017 testów i 45 unikalnych scenariuszy w dwóch przebiegach pozostają osobnym odbiorem. [Wyniki lokalne i stan produktu](PRODUCT-STATUS.md).

Dodatkowa odczytowa próba niepustego kalendarza potwierdziła przypisanie wszystkich 32 zastanych źródeł, 11 poprawnych przedziałów zajętości i 12 rzeczywistych zdarzeń zespołu w badanym oknie. Kalendarze dwóch opiekunów zawierały dokładnie ich dozwolone zdarzenia, bez prywatnych pól. Sprawdzono rzeczywiste identyfikatory spotkań, odnośnik i miesiąc z wpisami; skróty 13 tabel przed i po pozostały identyczne.

Poprzednia aktualizacja interfejsu z 09.10.2026 miała identyfikator `dpl_GRLuGPkBSLHSCgwJk49zj2MxerKJ`. Powrót aliasu do niej nie cofa nowej migracji ani danych. Przywrócenie bazy wymaga oddzielnego odtworzenia i uzgodnienia zapisów wykonanych po kopii; nie należy wykonywać go automatycznie. Poniższe datowane opisy wcześniejszych publikacji pozostają historią operacyjną.

## Środowisko i dostęp

Vercel obsługuje aplikację Next.js, a Supabase Auth, PostgreSQL i prywatny Storage. Funkcje aplikacji działają w regionie `fra1`, baza w `eu-central-1`. Zastosowano 49 migracji do `202610100001`. Rozwój lokalny ma oddzielną bazę; launchery nie przełączają jej na chmurę.

Dotychczasowe konta `mborecki6+1@gmail.com` i `asiakostrzanowska@gmail.com` mają rolę prowadzącej `admin`. Zachowano ich hasła, profile i role. Fikcyjne konta `demo.opiekun@psipawer.test` oraz `demo.opiekun2@psipawer.test` mają rolę `client`; ich prywatne hasła znajdują się w pliku przekazanym właścicielowi projektu, wykluczonym z Git i wdrożeń.

Zmienne produkcyjne obejmują dokładny adres aplikacji, URL projektu i klucz publiczny, serwerowy `SUPABASE_SECRET_KEY` oraz losowy `MAINTENANCE_SECRET`. Sekrety nie trafiają do przeglądarki. `AUTH_EMAIL_ENABLED=false` i `CLIENT_INVITATIONS_ENABLED=false` zachowują logowanie hasłem przy wyłączonej wysyłce. Nie publikuj prywatnych plików z konfiguracją, kopiami, sesjami ani hasłami.

## Powiadomienia i zdjęcia

Powiadomienia biznesowe są zapisywane transakcyjnie w skrzynkach aplikacji. Harmonogram `psi-pilot-reminders` w Supabase wykonuje `worker_process_due_reminders(50)` co pięć minut. [Operacja SQL](../supabase/operations/pilot-maintenance.sql) nie zawiera kluczy, nie wysyła e-maili i nie usuwa plików. Ostatni wynik można sprawdzić w panelu przypomnień oraz w `reminder_worker_state`; błędy i próby pozostają w kolejce.

W panelu prowadzącej ceny i godziny pracy znajdują się w **Ustawieniach**; kontrola procesu przypomnień jest dostępna przez rozwijaną **Kontrolę przypomnień**. Skrzynkę otwiera dzwonek u góry. [Mapa nawigacji](PILOT-TEST-SCENARIOS.md#gdzie-znaleźć-funkcje-w-panelu-prowadzącej) obejmuje również sekcje Zajęcia i Więcej.

Chroniony adres `/api/internal/maintenance` przyjmuje POST z autoryzacją i wykonuje wyłącznie przypomnienia. Zwraca 401 bez prawidłowego sekretu, działa tylko w środowisku produkcyjnym i odrzuca nieprawidłową konfigurację projektu.

Domyślna [poczta Supabase](https://supabase.com/docs/guides/auth/auth-smtp) obsługuje wyłącznie Auth, z ograniczeniem odbiorców do zespołu i niskim limitem wysyłki. Nie zastępuje poczty biznesowej. Fikcyjne adresy `.test` nie mają skrzynek. Wysyłkę i rzeczywiste zaproszenia uruchom po konfiguracji dostawcy i odrębnym odbiorze.

Automatyczne fizyczne usuwanie zastąpionych i niedokończonych zdjęć pozostaje wyłączone w chmurze. Operacje profilu mogą zapisywać zadania sprzątania, ale harmonogram ich nie wykonuje. Lokalny proces sprzątania jest osobnym narzędziem.

## Dane demonstracyjne

[Zestaw DEMO](../supabase/fixtures/pilot-demo.sql) wymaga dwóch potwierdzonych, oznaczonych kont Auth i istniejącej prowadzącej. Prywatne kody kart są podstawiane poza repozytorium. Skrypt wykonuje jedną transakcję, używa oznaczonych identyfikatorów i zapisuje potwierdzenie `pilot_demo_seeded`. Ponowne wykonanie nie resetuje historii ani postępu testerów. Nie uruchamiaj resetu bazy ani lokalnego seedera przeciw chmurze.

Sprawdzenie na kopii objęło podwójne wykonanie zestawu, komplet powiązań oraz zachowanie lokalnej bazy źródłowej. Odczyt chmury potwierdził cztery psy, cztery spacery, trzy konsultacje, dwa kursy, trzy pakiety fitness, dwie karty i trzy opublikowane plany. Sprawdzono 37 stron przez rzeczywiste sesje obu ról i drugiego opiekuna, logowanie hasłem, prywatność szkicu oraz odmowę odczytu i zmiany cudzych danych.

## Kopia i wycofanie zmiany

Przed pierwszą publikacją z 06.10.2026 pobrano prywatną kopię schematu i danych chmury, w tym Auth, Storage i historię migracji. Storage nie zawierał wtedy obiektów. Kopię odtworzono w izolowanej lokalnej bazie i sprawdzono 35 brakujących migracji; bazę próby usunięto po potwierdzeniu zachowania źródła. Nowszą kopię i próbę migracji 49 opisano w [aktualizacji z 10.10.2026](#aktualizacja-po-feedbacku--10102026). Kopie i dowody znajdują się w prywatnym lokalnym katalogu operacyjnym, poza Git i wdrożeniem. Kopia poza komputerem i retencja pozostają do ustalenia przed rzeczywistymi klientami.

Aktualizacja interfejsu z 09.10.2026 była wcześniejszą publikacją pod `psipawer.vercel.app`; najnowsze wydanie jest opisane powyżej. Bieżący identyfikator wdrożenia sprawdzisz przez `vercel inspect https://psipawer.vercel.app --json`; gałąź produkcyjna projektu to `main`. Poprzednia pełna wersja MVP: `dpl_3sBHXVr1H1a2MtzcGoox2PVE7dUv`. Powrót aliasu do starszego wdrożenia zmienia aplikację, nie cofa migracji ani danych. Wycofanie bazy wymaga osobnej procedury odtworzenia i uzgodnienia późniejszych zapisów; nie wykonuj go automatycznie.

Aktualizacja nawigacji z 09.10.2026 nie wymagała zmian Supabase. Odczyty przed i po tej publikacji potwierdziły zdrowy projekt, te same 48 migracji, zachowanie liczby profili oraz wpisów głównych modułów i aktywny harmonogram przypomnień co pięć minut. Prywatne katalogi `.local`, `output`, środowiska `.env*` i lokalne kompilacje są wykluczone z publikacji Vercel.

Kontrola aktualizacji z 09.10.2026 objęła 40 stron prowadzącej i dwóch opiekunów, logowanie hasłem kont DEMO, odmowę dostępu opiekuna i osoby niezalogowanej do nowych ekranów prowadzącej oraz przejścia w rzeczywistej przeglądarce. Menu, rozwijane sekcje, ustawienia i układ przy 320/390/1440 px przeszły bez błędów skryptów lub konsoli. Sprawdzono też ikonę karty. Kontrola nie zapisywała zmian w modułach ani nie wysyłała e-maili.

Przed kolejną publikacją porównaj historię migracji i użyj kompilacji oraz testów odpowiednich do zakresu. Przed zmianą bazy wykonaj nową kopię i sprawdź migracje na odtworzonej kopii. Aktualizacja samego interfejsu nie uruchamia migracji, zestawu DEMO ani resetu danych. Po publikacji potwierdź logowanie, uprawnienia, oba panele, dane i zdrowie przypomnień. Lokalne odbiory, w tym nowsze 1017 testów i 45 unikalnych E2E w dwóch przebiegach, nie zastępują pomiaru wydajności hostingu ani wspólnego odbioru użytkowego.
