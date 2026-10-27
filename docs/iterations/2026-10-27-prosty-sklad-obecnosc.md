# Skład i obecność bez formularzowego labiryntu — lokalnie, 27.10

## Brief i uzgodnienie

Użytkownik odrzucił obecną postać selectów i rozwijanych sekcji w kursie.
Chce widocznej listy uczestników z dużymi ✓ / ✕, podobnie jak lista drużyny:
obecność i przyjęcie mają być codzienną szybką czynnością na telefonie.

Biznes i technika przed implementacją niezależnie odczytały ten sam brief
i dotychczasowe reguły. Koordynator uzgodnił zakres kursów i spacerów;
fitness zostaje poza tą iteracją, bo tam obecność jednocześnie kończy spotkanie.
Nie zmieniamy zasad i pieniędzy, tylko drogę wykonania istniejących operacji.
Przygotowanie wyłącznie lokalne; wcześniejsza zgoda na publikację dotyczyła
poprzedniego zakresu. Brak migracji, aktywacji integracji i nagrywania.

## Kryteria odbioru

| AC | Kontrakt |
| --- | --- |
| AC-01 | W otwartym spotkaniu kursu pełna lista uczestników obecności jest widoczna bez wewnętrznego rozwijania. Nie zależy od filtra/paginacji zgłoszeń; historia zakończonego spotkania używa zapisanych uczestników. |
| AC-02 | Brak rekordu oznacza „Nieoznaczono”, nigdy domyślne „Był”. Dwa duże przyciski „Był” / „Nie był” zapisują pierwszą zwykłą obecność jednym tapnięciem, bez selecta i drugiego „Zapisz”. |
| AC-03 | Czas startu, status kursu/spotkania, pełność wpisów do zakończenia i uprawnienia zachowują obecne warunki. Przed startem wyjaśnienie i brak aktywnego zapisu. |
| AC-04 | Usprawiedliwienie pozostaje jawną opcją. Korekta zakończonego kursu dotyczy istniejącego rekordu, wymaga powodu i zachowuje historię oraz należność. Bez dopisywania brakującej historycznej obecności. |
| AC-05 | Pies i status oraz „Przyjmij” / „Nie przyjmuj” są widoczne przy oczekującym zgłoszeniu, poza rozwijanymi finansami. Odmowa otwiera pole wiadomości: powód kursowy pozostaje wymagany, wiadomość spacerowa opcjonalna zgodnie z istniejącymi akcjami i SQL. Rezerwa pozostaje dostępna. |
| AC-06 | Przyjęty pies ma widoczne potwierdzenie składu; ✕ nie oznacza ukrytej rezygnacji. Rezygnacja/przywrócenie pozostają osobno nazwane z dotychczasowym powodem, ceną i historią. |
| AC-07 | Limit, wersje kursowe, kwalifikacja spacerowa, relacje psów i kalendarz zachowują dotychczasowe reguły. Bez dodawania kwalifikacji spacerowej do kursów i bez automatycznego awansu rezerwy. |
| AC-08 | Spacer: „Był” = present, „Nie był · płatne” = no_show; osobne jawne usprawiedliwienie = absent. Nie zmieniamy znaczeń. Skutek dla opłaty/wejścia widoczny przed usprawiedliwieniem/korektą, bez automatycznego zwrotu wpłaty. |
| AC-09 | Wszystkie działania wiersza zablokowane w trakcie zapisu. Brak udawania sukcesu przed odpowiedzią. Błąd, utrata odpowiedzi i konflikt zachowują wybraną operację/powód oraz czytelny wynik przy psie. |
| AC-10 | Rewalidacja innego wiersza nie zastępuje niepotwierdzonej wersji/powodu. Powtórzenie identycznej operacji nie dubluje efektów zgodnie z istniejącą DB. |
| AC-11 | Potwierdzenie przyjęcia jest dostępne także gdy wiersz znika z filtra „Do decyzji”. Spacer zachowuje płaskie stabilne klucze między grupami. |
| AC-12 | Puste stany i statusy odróżniają brak uczestników, brak oczekujących, przed startem, zapisane/korygowane oraz odwołane spotkanie. |
| AC-13 | 320/390/768/1440 px bez poziomego przewijania; cele ≥44px, tekst obok ikon, widoczny fokus, nazwy identyfikujące psa i feedback dostępny klawiaturą/czytnikiem. |
| AC-14 | Opiekun nie ma czynności admina i nie poznaje cudzego składu/danych. Szczegóły, zalecenia, finanse, przywrócenia i historia nie znikają z produktu. |
| AC-15 | Rzeczywisty odbiór lokalny obejmuje obecność, korektę, limit i odrzucenie, utratę odpowiedzi, filtrowanie, rolę opiekuna oraz telefon. Ograniczenia zapisujemy osobno; bez publikacji. |

## Własność

- Koordynator: wspólny wizualny `RosterActionButtons`, dokumentacja, integracja,
  serwer/build i prawdziwy odbiór lokalnej bazy/przeglądarki.
- Technika kursów: `src/modules/courses/forms.tsx`, `views.tsx`,
  `courses.module.css` oraz uzgodnione testy kursowe.
- Technika spacerów: `src/components/walks.tsx`, `walks.module.css`, nowy
  klientowy formularz szybkich działań spaceru i uzgodnione testy spacerowe.
- Recenzent: wymagania i faktyczny diff, bez zmian aplikacji/testów.

## Stan

Implementacja i lokalny odbiór zakończone. Następnie użytkownik osobno polecił
wdrożenie: kod `2d0b1bd` jest opublikowany; 18 sprawdzeń UI online i trzy odmowy
endpointów PASS. [Publikacja i ograniczenia](2026-10-27-publikacja-prostego-skladu.md).

## Przegląd i reguły

Pierwsza niezależna recenzja wskazała trzy problemy trwałości stanu kursu:
oddzielny formularz rezygnacji zachowywał starą wersję po szybkim przyjęciu,
lokalne potwierdzenie odmowy blokowało ponowne przyjęcie po przywróceniu,
a utrata odpowiedzi i rewalidacja drugiego wiersza usuwały niepotwierdzoną
decyzję z aktywnego filtra. Autor poprawił je, a ponowna niezależna recenzja
zamknęła uwagi źródłowo i jednostkowo. Odbiór przeglądarkowy obejmuje również
powrót wiersza na inny filtr, dokładny powód i wybór akcji podczas ponowienia
oraz widoczność nowego błędu limitu po poprzednim sukcesie. Same wcześniejsze
zielone testy nie zamykały uwag.

W AC-05 doprecyzowano istniejącą różnicę po sprawdzeniu akcji i migracji:
kurs wymaga powodu odmowy, spacer dopuszcza pustą opcjonalną wiadomość
(`decideRegistration`, `decide_registration`). Nie dodajemy nowego obowiązku
do spaceru w ramach zmiany interfejsu.

## Kontrole koordynatora

- Pełne **2106 testów jednostkowych / 150 plików PASS**, build lokalny,
  TypeScript i pełny ESLint PASS. Cztery testy transportu SMTP używają wyłącznie
  lokalnego serwera atrapowego; rzeczywista wysyłka pozostaje wyłączona.
- Wstępny odbiór: dwa scenariusze nowego kursowego rosteru i dziewięć różnych
  scenariuszy spacerów PASS (decyzje, limity, kwalifikacja, finanse, wejścia
  z pakietu, prywatność i utrata odpowiedzi).
- W nowym scenariuszu spacerowym poprawiono przygotowanie drugiego psa do
  bieżącej, wersjonowanej kwalifikacji; nie obchodzono ochrony produkcyjnej.
  Helper utraty odpowiedzi uwzględnia feedback przy wierszu i osobny przycisk
  dokładnego ponowienia. Nie zastępuje prawdziwej odpowiedzi biznesowej:
  wysyła żądanie, dowodzi zatwierdzenia w DB i dopiero wtedy gubi odpowiedź HTTP.
- Dostosowano stary test przywrócenia kursu do istniejącej zwiniętej historii
  opiekuna: test otwiera historię przed sprawdzeniem zachowanego zdarzenia.
- Końcowo **25 różnych scenariuszy Chromium PASS**: 17 przypadków końcowego
  builda (kursy, korekty, pieniądze, powroty i nowy spacerowy roster) oraz osiem
  wcześniejszych regresji spacerów przed kosmetyczną korektą odstępów. Samą
  korektę odstępów sprawdzono nowym scenariuszem w końcowym buildzie obu silników.
  Po naprawieniu adapterów testowych powtarzano tylko dotyczące ich przypadki.
- **6 różnych scenariuszy WebKit PASS**: pięć nowych kursowych i jeden spacerowy.
  Test klawiatury stosuje natywny Option+Tab na macOS WebKit, zgodnie z już
  istniejącym helperem płatności; zwykły Tab domyślnie pomija tam przyciski.
- 320/390/768/1440 px: rzeczywiste zrzuty, brak poziomego przewijania, cele
  przycisków ≥44px, widoczny fokus. To emulacja szerokości w Chromium/WebKit,
  nie odbiór na fizycznym telefonie Asi ani test konkretnego czytnika ekranu.
- Po czyszczeniu własnych fixture’ów **93 tabele lokalne mają identyczne
  liczności i hashe** jak przed rozpoczęciem zadania. Porównanie pośrednie także
  bez różnic. Nie aktualizowano prawdziwych kont, produkcji, operatora i wysyłki.
- Lokalny generator ponownie pozostawił cztery kopie plików typów z sufiksem
  ` 2.ts`. Koordynator potwierdził zgodność bajtową z oryginałami i przeniósł
  wyłącznie te kopie do prywatnego archiwum `.local/`. Końcowy TypeScript PASS;
  nie zmieniano konfiguracji ani zakresu sprawdzania typów.

Dowody pozostają w prywatnym `.local/roster-20261027/`: logi builda/unit/lint/typów,
przekliku Chromium i WebKit, zrzuty oraz porównanie 93 tabel. Podgląd działa na
`http://localhost:3000/admin/courses`; wersja produkcyjna także działa na głównej
domenie po późniejszym poleceniu użytkownika. Zmiany nie wymagają migracji. Głos pozostaje
jawnym placeholderem, a rzeczywisty operator, SMTP i zaproszenia wyłączone.
