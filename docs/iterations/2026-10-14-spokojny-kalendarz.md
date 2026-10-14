# Spokojny kalendarz i jednoosobowa praktyka Asi

Status: użytkownik 14.10 autoryzował publikację tej iteracji („lets go na
produkcje”). Przed wydaniem domykamy reguły jednoosobowej praktyki bez zmiany
kont, uprawnień i istniejących przypisań. Użytkownik wskazał ucięte zdjęcie tła,
chaos tygodnia oraz błędne traktowanie administratora jako prowadzącego.
Jedyną behawiorystką jest Asia. Użytkownik zaakceptował lokalny kandydat z
miesiącem jako widokiem początkowym i paskiem dni z agendą w tygodniu.

## Kryteria kandydata

- AC-01: tło rozciąga się na szerokość głównej części panelu i zanika na bokach
  oraz u dołu, bez małego prostokąta. Czytelność i brak poziomego overflow
  przy 320/390/768/1440 px.
- AC-02: administrator domyślnie dostaje miesiąc. Tydzień pokazuje siedem dni
  z licznikami i chronologiczną agendę wybranej daty. Klient zachowuje listę
  całego tygodnia. Pusty dzień ma krótki komunikat.
- AC-03: link z najbliższego spotkania otwiera tydzień, właściwy dzień i
  konkretny identyfikator spotkania. Wielodniowe blokady, granice miesiąca,
  Europe/Warsaw i zmiana czasu zachowują istniejące reguły.
- AC-04: na pierwszym planie godzina, rodzaj, tytuł, miejsce i szczegóły.
  Autor oraz rzeczywiste przypisanie są zachowane w rozwijanych informacjach.
  Nie wyświetlamy Asi jako zastępczej nazwy dla UUID Mateusza.
- AC-05: osoba prowadząca jest jawnie wskazana w konfiguracji kalendarza w DB,
  sprawdzonej wobec istniejących kont kalendarza; to jedyne źródło konfiguracji.
  Lista aktywnych osób i domyślna osoba nowych formularzy nie wynikają z
  tego, kto jest autorem/administratorem. Brak konfiguracji nie zgaduje osoby.
- AC-06: istniejące UUID, null, salę i wersję formularze zachowują do czasu
  świadomej edycji. Nie przypisujemy starych spotkań automatycznie Asi.
- AC-07: osobny lokalny UUID nie dziedziczy konfiguracji chmury. Nie zmieniamy
  kont produkcyjnych, haseł ani ról. Podgląd korzysta z fikcyjnych obiektów,
  bez tworzenia dodatkowego konta testowej Asi.
- AC-08: przegląd kandydata, właściwe testy i odbiór wizualny. Przed publikacją
  trzeba rozwiązać poniższe ograniczenia backendu, zamiast uznawać sam UI
  za zmianę zasad rezerwacji.
- AC-09: nowe terminy admina prowadzi wybrana istniejąca Asia, autor pozostaje
  zalogowanym administratorem. Inny administrator lub null jako nowe przypisanie
  jest odrzucony również w bezpośrednim RPC.
- AC-10: zajęty czas jest wspólny niezależnie od historycznego UUID/null i sali.
  Równoczesne zapisy nie dopuszczają nakładek; anulowanie i granice przedziałów
  zachowują obecne reguły. Grupa to jedno wydarzenie z wieloma uczestnikami.
- AC-11: brak poprawnej prowadzącej blokuje tworzenie i zmianę rezerwacji na
  backendzie. Odczyt, anulowanie oraz zgłoszenie klienta bez rezerwacji działają.
- AC-12: aktualny uprawniony administrator może zapisać stare wydarzenie z
  jego niezmienionym UUID/null mimo utraty roli admin przez dawną osobę.
  Wyjątek nie pozwala przypisywać tej osoby do nowych wydarzeń.
- AC-13: zachowujemy dotychczasowe UUID/null, salę oraz audyt. Jawna zmiana
  przypisania dopisuje nowy ślad; nie przemianowujemy autora na prowadzącą.
- AC-14: rzeczywiste testy backendu, konkurencji i niezależny przegląd przed
  publikacją. Wydanie nie tworzy kont ani nie zmienia haseł/ról. Wykryta stara
  kolizja zatrzymuje migrację; nie przekładamy ani nie anulujemy jej automatycznie.

## Ustalenia i otwarte kwestie

Kod zastany pobiera wszystkich administratorów jako `calendar_team_members()`
oraz domyślnie wybiera autora nowych terminów. To nie odpowiada jednoosobowej
praktyce wskazanej przez użytkownika. Dotychczasowy autor i przypisanie
spotkania są jednak osobnymi danymi i nie będą przemianowane lub usuwane.

Pierwszy szkic zmieniał wyłącznie UI. Przed publikacją domknięto trzy
ograniczenia: rozdzielone scope różnych UUID, blokadę bez primary tylko w UI
oraz odrzucenie zapisu niezmienionego historycznego UUID po utracie roli admin.
Migracja `202610140001_single_practitioner.sql` wskazuje primary w DB,
egzekwuje globalne kolizje i walidację wyboru we wszystkich ścieżkach zapisu.
Historyczne UUID/null oraz autorzy pozostają rzeczywistymi danymi. Nowe
zgłoszenie opiekuna przy braku primary może powstać bez rezerwacji; pierwsze
umówienie takiego świeżego zgłoszenia wybiera później skonfigurowaną prowadzącą.
Przy odwołaniu jednego spotkania kursu zachowujemy niezmienione pozostałe sloty.
Jawna zmiana przypisania blokady dopisuje audyt także przez formularz blokady.

Lokalna baza nie ma konta z rzeczywistym adresem Asi. Automatyczna kontrola
odrzuciła tworzenie nowego konta z rolą administratora i zapisanym hasłem,
wskazując brak osobnej zgody na tę zmianę dostępu. Użytkownik potwierdził
rzeczywisty adres konta Asi: `asiakostrzanowska@gmail.com`. Nie tworzymy
alternatywnego konta; zwykłe obiekty w fixture UI nie tworzą kont ani uprawnień.

Właścicielstwo: agent techniczny — kalendarz, wybór prowadzącej, ustawienia
i fixture/testy kalendarza; koordynator — tło Shell, lokalny launcher,
konfiguracja środowiska i odbiór. Produkcja nadal używa poprzedniego wydania.

## Weryfikacja lokalnego kandydata

- 70 testów jednostkowych w 7 plikach — zaliczone (kalendarz i lokalny launcher).
- Runner kalendarza — zaliczony: wybór dnia, uprawnienia widoku opiekuna,
  historyczne UUID, brak prowadzącej, formularze oraz 52 warianty responsywne.
- TypeScript, ESLint zmienionego zakresu i `git diff --check` — zaliczone.
- Odbiór wizualny przy 320 px i zwykłym rozmiarze przeglądarki — zaliczony.
  Poprawiono kurczenie rozwiniętego filtra i prostokątną krawędź nagłówka.
- Niezależny recenzent nie znalazł dodatkowych blokad lokalnego podglądu.
  Pierwszy szkic miał trzy ograniczenia backendu; odbiór poprawek jest poniżej.

Podgląd: `http://127.0.0.1:4181/?view=week`. Zapis jest zastąpiony lokalnym
fixture; nie jest to test uwierzytelnionego konta Asi ani nowych reguł SQL.
Zrzut: `test-results/calendar-ui/week-proposal-1440.png`.

## Odbiór przed wydaniem

- Niezależny recenzent wykonał 34 testy bieżących reguł i 2 testy przejścia
  starego schematu na nowy. Brak otwartych blokerów SQL/DAL po poprawkach.
- Koordynator uruchomił pełny zestaw 99 plików: 1221 testów zaliczonych;
  jeden zastany test archiwalnego push miał kolizję milisekundowego zegara
  PGlite. Po ustaleniu jawnej chronologii fixture cała ta suite (10 testów)
  jest zaliczona. Kod dostarczania push pozostaje bez zmian.
- PostgreSQL: 7/7 testów, pięć obserwowanych zależności blokad. Jednorazowa
  syntetyczna baza usunięta; dane i migracje działającej lokalnej bazy zachowane.
- Końcowy TypeScript, ESLint i 52 warianty kalendarza w przeglądarce zaliczone.
- Preflight chmury: istniejąca Asia ma rolę admin, 33 dotychczasowe przypisania
  są unassigned, 11 aktywnych slotów i brak kolizji. Historia nie wymaga przepisywania.
- Pełny eksport rekordów produkcyjnych odrzuciła automatyczna kontrola zakresu.
  Bezpieczniejsza kopia obejmuje tylko definicje kalendarza i agregowane sumy
  kontrolne; migracja jest ćwiczona na syntetycznych rekordach, bez eksportu klientów.

Stan publikacji zostanie uzupełniony po przełączeniu Vercel i odbiorze live.
