# Edycja cyklu i korekty obecności

Implementacja lokalna, 03.10.2026. Migrację `202610030003_course_edits.sql` zastosowano wyłącznie w lokalnym Supabase.

## Ustawienia cyklu

W szczegółach kursu prowadząca otwiera **Edytuj nazwę i liczbę miejsc**. Może zmienić nazwę oraz limit od 1 do 50 psów z opiekunami, z powodem widocznym w historii. Kurs indywidualny zachowuje jedno miejsce. Limit nie może być niższy niż liczba przyjętych psów. Zwiększenie liczby miejsc nie przyjmuje automatycznie osób z rezerwy.

Zmiana jest dostępna w szkicu oraz aktywnym kursie. Zakończony lub odwołany cykl nie przyjmuje nowych ustawień. Edytor nie zmienia ceny całego cyklu, warunków wcześniejszych zgłoszeń, formy zajęć, czasu, terminów ani zbiórek. Terminy i zbiórki nadal zmienia się osobno przy spotkaniu. Ustawienia nie tworzą nowych generacji przypomnień.

Historia zachowuje poprzednią i nową nazwę, obie liczby miejsc, powód, autora i wersję. Aktywni zgłaszający otrzymują wiadomość w aplikacji z odnośnikiem do własnego zgłoszenia; kategoria `course_updated` nie zawiera danych prywatnego miejsca ani treści powodu. Pierwotny opiekun zgłoszenia pozostaje odbiorcą.

Każdy zapis ma identyfikator i własne potwierdzenie w `course_settings_receipts`. Dokładne ponowienie potwierdza wcześniejszy wynik także po następnych zmianach lub odwołaniu cyklu. Inny kurs, autor lub dane z tym samym identyfikatorem otrzymują odmowę. Zapis bez zmiany ustawień nie dodaje historii ani powiadomień. Kolejny udany zapis z tego samego otwartego edytora używa nowego identyfikatora i wyłącznie własnej potwierdzonej wersji.

Starsza karta nie nadpisuje nowej nazwy ani limitu; zachowuje wszystkie wpisane pola. Potwierdzenie poprzedniego zapisu znika po zmianie pól i podczas zapisu. Odnośnik **Odśwież dane** pobiera nową stronę i świeże wersje formularzy. Samo odświeżenie danych po innej akcji nie podnosi wersji edytora z niezapisanymi zmianami.

## Planowanie spotkań — aktualizacja lokalna 10.10.2026

Lokalna aktualizacja planowania z 10.10.2026: przy tworzeniu cyklu prowadząca wybiera prowadzącego i opcjonalnie salę dla wszystkich nowych spotkań. Edytor pojedynczego spotkania pozwala później zmienić jego przypisanie; każde spotkanie ma osobną wersję. Publikacja zachowuje przypisania poszczególnych spotkań. Wspólny [kalendarz zespołu](CALENDAR-MODULE.md) sprawdza kolizje i godziny pracy. Ostrzeżenie o zbyt krótkiej zalecanej przerwie wymaga jawnego potwierdzenia niezmienionych danych, bez automatycznej zmiany wersji po odrzuconym zapisie. Formularz zachowuje szkic; po własnym udanym zapisie ponowna zmiana prowadzącego lub sali wymaga odświeżenia formularza. Testy akcji obejmują nowy zapis i publikację z zachowaniem przypisań. Odbiór lokalnej migracji i całego stosu jest osobnym etapem; produkcji nie aktualizowano.

## Obecność po zakończeniu

Przy zakończonym spotkaniu prowadząca otwiera **Obecności uczestników**. Istniejące wpisy można skorygować na obecny, nieobecny lub usprawiedliwiony, z wymaganym powodem. Korekta działa także po zakończeniu całego cyklu i dla historycznie zapisanego uczestnika, który później zrezygnował. Nie tworzy obecności, której wcześniej nie zapisano, i nie dotyczy odwołanego spotkania.

Aktualny wpis otrzymuje nową wersję, a `course_attendance_corrections` zachowuje poprzednią i nową obecność, powód, autora oraz wersje. Historia kursu pokazuje korektę i poprzedni stan. Opiekun zgłoszenia otrzymuje dotychczasowe powiadomienie o zapisie obecności, prowadzące do konkretnego spotkania. Zmiana nie przelicza należności, wpłat ani zwrotów i nie odnawia przypomnienia.

Powtórzenie własnej, identycznej korekty z tej samej wersji potwierdza wcześniejszy wynik także po następnej korekcie. Konkurująca treść, autor lub powód otrzymują konflikt. Zmiana na tę samą obecność zostaje odrzucona. Opiekun ma tylko odczyt własnych korekt; nie może ich zapisywać. Po zmianie opiekuna psa historia obecności i finanse nadal należą do pierwotnego zgłaszającego, tak jak pozostała historia kursu.

## Atomowość i próby

Ustawienia blokują cykl, a następnie globalny identyfikator zapisu. Korekta blokuje cykl → spotkanie → zgłoszenie → obecność. Dzięki wspólnej blokadzie cyklu zmiana limitu i przyjęcie uczestnika sprawdzają stan po zakończeniu konkurującej operacji. Ustawienia/korekta, potwierdzenie, historia, audyt i wiadomości są jedną transakcją. Błąd powiadomienia wycofuje wszystkie te zmiany.

`tests/e2e/course-edits.spec.ts` obejmuje dwa rzeczywiste scenariusze. Przeglądarka przechodzi odmowę zmniejszenia limitu, dwa udane zapisy, starszą kartę, zakończenie spotkania, korektę, konflikt dwóch formularzy oraz następną korektę po zakończeniu cyklu. Potwierdza cenę 100 zł, brak automatycznego przyjęcia rezerwy, zachowanie generacji przypomnień i odmowę dla obcego konta. Druga próba obserwuje cztery rzeczywiste zależności blokad:

1. Zmniejszenie limitu kończy się przed czekającą akceptacją; akceptacja jest odrzucana.
2. Akceptacja kończy się przed czekającym zmniejszeniem limitu; zmniejszenie jest odrzucane.
3. Pierwsza korekta kończy się przed konkurującą treścią; druga jest odrzucana bez nowej historii.
4. Identyfikator zapisu z innego kursu czeka na wcześniejszą transakcję i zostaje odrzucony, bez zmiany drugiego kursu.

Obserwator używa `pg_blocking_pids`; obie operacje muszą rzeczywiście nakładać się w czasie. Nowe **2/2 scenariusze** przeszły w 10,1 s. Zrzuty `output/course-edits/stale-settings-390.png`, `stale-attendance-320.png` i `guardian-history-390.png` sprawdzono wizualnie. PGlite obejmuje ponowienia, brak zmiany, kurs indywidualny, stare wersje, inne role, atomowe wycofanie błędu i zmianę opiekuna. Plik bazy kursów zawiera **65 testów**; pełny zestaw ma **732 testy w 62 plikach** (15,05 s).

Wspólny przebieg zakończył się wynikiem **32/32 pełne scenariusze** (4,3 minuty), a wcześniejsze niezależne próby PostgreSQL: **76/76** (8,74 s). Końcowy odczyt potwierdził 39 migracji i brak danych nowych prób, przy zachowaniu wcześniejszych kont oraz 17 roboczych cen 100 zł. Podgląd jest gotowy i odpowiada HTTP 200.

Odbiór całej wersji i pozostały zakres: [stan produktu](PRODUCT-STATUS.md). [Powrót po rezygnacji lub odmowie](COURSE-REOPENING.md) dodano w następnej migracji. Pakiet fitness i vouchery pozostają osobnymi etapami.
