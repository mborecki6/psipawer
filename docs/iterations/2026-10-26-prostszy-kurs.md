# Prostsza codzienna obsługa kursu — lokalnie, 26.10.2026

Brief użytkownika: wiele widoków ma zbyt dużo zmiennych; wskazany ekran
administracyjny kursu pokazuje pięć pełnych kart spotkań obok warunków
i zarządzania cyklem. Zakres tej iteracji: ten ekran i zasada dalszego
upraszczania. Bez publikacji, DB, zmian zasad zapisów, obecności i pieniędzy.
Wcześniejsza lokalna iteracja zaleceń pozostaje osobnym, zachowanym diffem.

Niezależne propozycje biznesu i techniki uzgodniono następująco:

| ID | Kryterium |
| --- | --- |
| AC-01 | Kompaktowy adminowy nagłówek kursu. Spotkania i uczestnicy są główną pracą; warunki, ustawienia i historia nie zajmują stałej prawej kolumny. Układ klienta pozostaje dotychczasowy. |
| AC-02 | Domyślnie rozwinięte jedno spotkanie, pozostałe jako wiersze z numerem, datą i statusem. Wybór: trwające zaplanowane, następnie najbliższe przyszłe zaplanowane, przy ich braku ostatnie zaległe zaplanowane lub ostatnie chronologicznie. Zaległe zaplanowane spotkania mają widoczny sygnał do uzupełnienia, bez automatycznej zmiany statusu. |
| AC-03 | Bezpośrednie wejście i ponowne kliknięcie otwierają właściwe spotkanie dla #spotkanie-UUID i #spotkanie-numer. Kotwice zgłoszeń, rozliczeń, wpłat, zaleceń i historii nadal docierają do widocznej treści. Filter/page/history/plans/enrollment i wyjście z focus zachowują działanie. |
| AC-04 | Obecności są łatwo dostępne w wybranym spotkaniu. Zmiana terminu i zakończenie/odwołanie są pod „Opcje spotkania”. Wszystkie dotychczasowe blokady, historyczni uczestnicy i wymagane powody pozostają. Otwarcie sekcji niczego nie zapisuje. |
| AC-05 | Warunki i ustawienia cyklu oraz historia są zwinięte po głównej pracy. Paginowana historia otwiera swoją sekcję. Treści o skutkach odwołania i osobnym uzgodnieniu rozliczeń pozostają przy właściwej akcji. |
| AC-06 | Formularze nie są odmontowywane przy zwijaniu. Zachowują tekst i wersję także po odświeżeniu props. Nowy błąd, ostrzeżenie kalendarza i potwierdzenie ujawniają przodków przed fokusem; ręczne zwinięcie po zakończonej akcji jest respektowane. |
| AC-07 | Zgłoszenia, ich decyzje, zalecenia i rozliczenia zachowują istniejącą prezentację i dane. Ostrzeżenia finansowe nie są chowane ani zamieniane w niepełny globalny licznik. Nie nazywamy „Do zapłaty” zaległością bez reguły terminu płatności. |
| AC-08 | Działają pusty/roboczy/otwarty/zakończony/odwołany kurs, brak przyszłych spotkań, długie nazwy i klawiatura. Przy 320/390/768/1440 px bez poziomego przewijania. Typowy pierwszy ekran pokazuje termin i miejsce wybranego spotkania; wszystkie pozostałe terminy można szybko przejrzeć. |

Właściciel UI: agent techniczny — `src/modules/courses/views.tsx`,
`courses.module.css`, `forms.tsx` i nowy komponent ujawniania sekcji w tym module.
Koordynator: fixtures, testy i dokumentacja. Recenzent: świeży kontekst,
AC i faktyczny diff nowej iteracji, bez edycji aplikacji.

## Zasada dla kolejnych widoków

Najpierw bieżąca sprawa i jej najczęstsza czynność, potem potrzebne szczegóły,
na końcu konfiguracja i historia. Jedna główna rzecz do zrobienia na ekranie;
pełne możliwości dostępne w kontekście, bez wielokrotnego powtarzania danych.
Wyjątki wymagające reakcji pozostają widoczne. Samo zwinięcie formularzy
nie wystarcza, jeśli nadal pokazujemy naraz wiele równorzędnych obszarów.

Kolejne kandydatury do osobnego odbioru: pakiet fitness (podobny układ cyklu),
szczegół konsultacji (oddzielenie obsługi spotkania od rozliczeń/ustawień)
oraz rozliczenia uczestnika (saldo i potrzebna czynność przed pełną historią).
Nie rozszerzamy tej iteracji na te moduły bez osobnej implementacji i odbioru.

## Wykonanie i odbiór

Admin ma jedną kolumnę i kompaktowy nagłówek. Każde spotkanie jest krótkim
wierszem; początkowo otwarte jest jedno, a przeglądarka grupuje rozwinięcia.
Obecności pozostają osobno, edycja terminu i zakończenie/odwołanie są pod
„Opcje spotkania”. Po zgłoszeniach znajdują się „Warunki i ustawienia cyklu”
oraz „Historia kursu”; zmiana statusu ma własne rozwinięcie.

Lokalny komponent `course-disclosure.tsx` zachowuje DOM dzieci i początkowy
wybór przy odświeżeniu props. Kotwice otwierają właściwy wiersz i przodków
innych celów, także przy ponownym kliknięciu tego samego hasha. Nowy wynik
akcji ujawnia przodków przed fokusem. Zachowane powody, wersje, blokady
i wartości formularzy. Poprawiono wyjście z focus: „Pokaż wszystkie zgłoszenia”
usuwa `enrollment`, zachowując pozostałe parametry.

| Kontrola | Wynik |
| --- | --- |
| Reguły i PostgreSQL/Vitest | 112/112 w 5 plikach: kursy, finanse, prezentacja kwot i odzyskiwanie formularzy. |
| Rzeczywiste komponenty Chrome | 64/64 warianty: 8 stanów × 2 role × 320/390/768/1440 px, bez overflow i błędów JS. Dodatkowo klawiatura, UUID/numer/same hash, historia i wpłata, zachowanie wersji, błąd/sukces po zwinięciu podczas zapisu. |
| Lokalny Next/Supabase Chromium | 11/11 scenariuszy: 7 przeglądarkowych i 4 rzeczywiste próby blokad/API. Tworzenie, rezerwa, zmiany, obecności, korekty, zalecenia, finansowanie/zwroty, powroty i nowy układ. |
| Lokalny Next/Supabase WebKit | 3/3: nowy układ z hashem i odświeżeniem po zapisie, konflikt ustawień/korekta obecności, obsługa spotkania i zakończenie cyklu. |
| TypeScript, ESLint, Prettier, build, diff | PASS. |

Nowy E2E wstrzymuje prawdziwy request Next Action, zwija sekcję i dopiero wtedy
pozwala na zapis. Potwierdzenie i konflikt otwierają właściwe sekcje, a zapis
innego formularza nie usuwa przygotowanej nazwy, treści ani wersji. Użyty
kontrolny link same-hash jest elementem fixture, nie nowym przyciskiem produktu.
Początkowo znalazł się pod sidebar; przeniesiono go do treści testowej. Stary
test reducerów wymagał uwzględnienia użytego hooka `useLayoutEffect` w istniejącej
atrapie Reacta. W harnessie Vite dodano bundlowanie React DOM i kontrolę
przepływu Next. To dostosowania testów, nie poprawki reguł biznesowych.

Niezależny recenzent nie zgłosił potwierdzonych uwag po własnym porównaniu
czterech plików ze stanem bazowym, AC, billing/care, routingiem i źródłami
odnośników. Wykonał osobno ESLint i diff-check. Jego odbiór był źródłowy;
interakcje i mutacje lokalnych fikcyjnych danych sprawdził koordynator,
który zachowuje odrębne dowody. Konta i dane własnych E2E posprzątano.
Raport, zrzuty oraz wyniki są w ignorowanym `.local/course-simplify-20261026/`.

Stan: implementacja, niezależny przegląd i lokalny odbiór zakończone.
Zmiana nie została opublikowana. Nie zmieniano SQL, produkcji, kwot ani integracji;
obie bazy pozostają przy 66 migracjach. Wcześniejszy lokalny diff care zachowano.
