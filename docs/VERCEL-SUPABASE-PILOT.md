# Obsługa pilota na Vercel i Supabase

Pilot od 06.10.2026 działa pod [psipawer.vercel.app](https://psipawer.vercel.app/login). Jest przeznaczony do walidacji MVP przez administratora, behawiorystkę i fikcyjne konta opiekunów. Kwoty i spotkania DEMO nie stanowią rzeczywistych transakcji ani rezerwacji. [Scenariusze testów](PILOT-TEST-SCENARIOS.md) opisują oba panele.

## Środowisko i dostęp

Vercel obsługuje aplikację Next.js, a Supabase Auth, PostgreSQL i prywatny Storage. Funkcje aplikacji działają w regionie `fra1`, baza w `eu-central-1`. Zastosowano 48 migracji do `202610030012`. Rozwój lokalny ma oddzielną bazę; launchery nie przełączają jej na chmurę.

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

Przed migracją pobrano prywatną kopię schematu i danych chmury, w tym Auth, Storage i historię migracji. Storage nie zawierał obiektów. Kopię odtworzono w izolowanej lokalnej bazie i sprawdzono 35 brakujących migracji; bazę próby usunięto po potwierdzeniu zachowania źródła. Kopie i dowody znajdują się w prywatnym lokalnym katalogu operacyjnym, poza Git i wdrożeniem. Kopia poza komputerem i retencja pozostają do ustalenia przed rzeczywistymi klientami.

Aktualizacja interfejsu z 09.10.2026 działa pod `psipawer.vercel.app`. Bieżący identyfikator wdrożenia sprawdzisz przez `vercel inspect https://psipawer.vercel.app --json`; gałąź produkcyjna projektu to `main`. Poprzednia pełna wersja MVP: `dpl_3sBHXVr1H1a2MtzcGoox2PVE7dUv`. Powrót aliasu do starszego wdrożenia zmienia aplikację, nie cofa migracji ani danych. Wycofanie bazy wymaga osobnej procedury odtworzenia i uzgodnienia późniejszych zapisów; nie wykonuj go automatycznie.

Aktualizacja nawigacji nie wymagała zmian Supabase. Odczyty przed i po publikacji potwierdziły zdrowy projekt, te same 48 migracji, zachowanie liczby profili oraz wpisów głównych modułów i aktywny harmonogram przypomnień co pięć minut. Prywatne katalogi `.local`, `output`, środowiska `.env*` i lokalne kompilacje są wykluczone z publikacji Vercel.

Kontrola aktualizacji objęła 40 stron prowadzącej i dwóch opiekunów, logowanie hasłem kont DEMO, odmowę dostępu opiekuna i osoby niezalogowanej do nowych ekranów prowadzącej oraz przejścia w rzeczywistej przeglądarce. Menu, rozwijane sekcje, ustawienia i układ przy 320/390/1440 px przeszły bez błędów skryptów lub konsoli. Sprawdzono też ikonę karty. Kontrola nie zapisywała zmian w modułach ani nie wysyłała e-maili.

Przed kolejną publikacją porównaj historię migracji i użyj kompilacji oraz testów odpowiednich do zakresu. Przed zmianą bazy wykonaj nową kopię i sprawdź migracje na odtworzonej kopii. Aktualizacja samego interfejsu nie uruchamia migracji, zestawu DEMO ani resetu danych. Po publikacji potwierdź logowanie, uprawnienia, oba panele, dane i zdrowie przypomnień. Lokalne wyniki 971 testów i 45 E2E nie zastępują pomiaru wydajności hostingu ani wspólnego odbioru użytkowego.
