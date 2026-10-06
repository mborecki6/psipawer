# Ponowna decyzja i powrót do kursu

Implementacja lokalna, 03.10.2026. Migrację `202610030004_course_reopening.sql` zastosowano wyłącznie w lokalnym Supabase, po testach logiki i uprawnień.

## Działanie obu paneli

Prowadząca otwiera zamknięte zgłoszenie i sekcję **Ponowna decyzja lub przywrócenie udziału**. Powrót wymaga powodu (3–3000 znaków), aktywnego kursu oraz czasu przed pierwszym spotkaniem. Publiczne zapisy mogą być już zamknięte. Co najmniej jedno spotkanie musi pozostać zaplanowane. Odwołany lub zakończony cykl nie przyjmuje powrotu. Po zmianie opiekuna psa lub odebraniu pierwotnemu opiekunowi roli klienta starego zgłoszenia nie można przywrócić.

Po odmowie **Wróć do decyzji o zgłoszeniu** zmienia status na oczekujący. Zachowuje pierwotną cenę, nie tworzy należności, nie zajmuje miejsca i nie tworzy przypomnienia. Przyjęcie, rezerwa lub następna odmowa są osobną decyzją. Powrót działa też bez ponownego wczytania strony po odmowie zapisanej właśnie przez prowadzącą.

Po rezygnacji **Przywróć udział na kursie** potwierdza udział i pełną pierwotnie uzgodnioną cenę cyklu. Formularz pokazuje tę kwotę przed zapisem. Operacja sprawdza rzeczywistą liczbę miejsc i nie przekracza limitu. Dotyczy też zgłoszenia wycofanego przed pierwszą decyzją; takie przywrócenie jest jawnym przyjęciem przez prowadzącą.

Opiekun widzi aktualny status, zbiórki przywróconego udziału, rozliczenie i historię z powodem. Otrzymuje powiadomienie w aplikacji prowadzące do własnego zgłoszenia. Nie może sam przywracać udziału lub ponownie rozpatrywać odmowy. Sekcja powrotu jest dostępna tylko prowadzącej.

## Rozliczenie i historia

Powrót zachowuje ten sam identyfikator zgłoszenia, opiekuna zgłoszenia, cenę i dane testowej ceny. Nie tworzy drugiej opłaty za ten sam cykl. Katalog może mieć nowszą cenę bez zmiany wcześniejszych warunków.

Przywrócenie ustawia aktualną należność na pierwotną cenę całego cyklu i zamyka obowiązywanie aktualnego uzgodnienia rezygnacji. Zachowuje jednak niezmienione potwierdzenia wcześniejszych uzgodnień, wpłaty, częściowe zwroty, plany, historię oraz obecności. Historia pokazuje należność przed i po powrocie; potwierdzenie powrotu przechowuje też poprzednią datę i autora uzgodnienia.

Przykład sprawdzony przez rzeczywistą aplikację: cena cyklu 100 zł → wpłata 40 zł → rezygnacja i uzgodnienie 30 zł → zwrot 10 zł → przywrócenie udziału z należnością 100 zł. W ewidencji pozostaje wpłata 40 zł i rzeczywisty zwrot 10 zł; opłacono netto 30 zł, więc do zapłaty pozostaje 70 zł. Kolejna wpłata 70 zł zamyka należność. Nie dopisujemy fikcyjnej wpłaty lub zwrotu.

Kolejna rezygnacja nadal wymaga osobnego uzgodnienia. Przywrócenie jest dowodem przyjęcia także dla zgłoszenia wycofanego jeszcze przed pierwszą akceptacją; późniejsze uzgodnienie może wtedy mieć kwotę dodatnią. Jawny zwrot zachowanej wpłaty jest nadal możliwy po powrocie i zwiększa brakującą kwotę. Powrót czekający na wcześniejszy zwrot otrzymuje konflikt wersji i wymaga ponownego sprawdzenia rozliczenia.

## Wersje i konkurujące operacje

`reopen_course_enrollment` sprawdza uprawnienia prowadzącej wewnątrz bazy. Blokuje psa → cykl → zgłoszenie. Ta kolejność zgadza się z nowym zgłoszeniem i publikacją zaleceń. Zmiana opiekuna nie może przejść pomiędzy kontrolą właściciela a powrotem. Limit miejsc, odwołanie i finanse rozstrzygają się przez wspólną blokadę cyklu.

`course_reopening_receipts` ma klucz zgłoszenie + wersja wejściowa. Dokładne ponowienie własnego zapisu potwierdza pierwotny wynik także po późniejszej wpłacie, następnej zmianie lub odwołaniu cyklu. Nie zmienia aktualnego stanu i nie dodaje historii, audytu ani wiadomości. Inna treść, powód lub autor otrzymują konflikt. Potwierdzenia można tylko odczytywać przez panel prowadzącej; bezpośrednie zapisy obu ról są zabronione.

Nieudany lub konkurujący zapis zachowuje powód w formularzu. Udany zapis pozostawia potwierdzenie widoczne po odświeżeniu danych przez aplikację; przycisk nie wysyła kolejnego powrotu. Kolejną operację po innej zmianie rozpoczyna się przez **Odśwież dane**. Pies wracający do udziału otrzymuje nową generację przypomnień przyszłych spotkań, przy zachowaniu wcześniejszych zadań i bez duplikatów po ponowieniu.

Historia, stan zgłoszenia, należność, potwierdzenie, audyt, przypomnienia i powiadomienia są jedną transakcją. Błąd wiadomości dla późniejszego odbiorcy wycofuje także wcześniejszą wiadomość opiekuna i wszystkie pozostałe zmiany.

## Próby odbioru

`tests/courses-database.test.ts` zawiera 76 testów, w tym 11 przypadków powrotu: odmowa, powtarzane ponowne decyzje, rezygnacja przed akceptacją, częściowe zwroty, zachowanie planu i uzgodnienia, brak miejsc, zamknięte zapisy, rozpoczęty/odwołany kurs, utrata uprawnień, zmiana opiekuna, dokładne ponowienia i atomowe wycofanie późniejszego powiadomienia. Granica Server Action osobno wymaga prowadzącej i odrzuca fałszywą kwotę, opiekuna oraz datę rozliczenia.

`tests/e2e/course-reopening.spec.ts` przechodzi oba panele, odmowę przy braku miejsca, stare karty zachowujące powód, rozliczenie 40 − 10 + 70 zł, zachowany plan, dostęp do prywatnej zbiórki po przywróceniu i ponowną decyzję bez miejsca. Drugi scenariusz obserwuje osiem rzeczywistych zależności `pg_blocking_pids`:

1. Przywrócenie zajmuje ostatnie miejsce przed czekającą akceptacją innego psa.
2. Akceptacja zajmuje ostatnie miejsce przed czekającym przywróceniem.
3. Przywrócenie kończy się przed odwołaniem całego cyklu; końcowy udział i zadania są odwołane.
4. Odwołanie cyklu kończy się przed powrotem; powrót jest odrzucany.
5. Przywrócenie kończy się przed jawnym zwrotem zachowanej wpłaty; oba wpisy zachowują zgodne saldo.
6. Zwrot kończy się przed powrotem ze starej wersji; powrót jest odrzucany.
7. Dokładne powtórzenie czeka na pierwszy zapis i potwierdza ten sam wynik bez kolejnej wiadomości opiekuna.
8. Zmiana opiekuna blokuje powrót; stare zgłoszenie pozostaje zamknięte.

**745/745 testów w 62 plikach** przeszło w 15,25 s, **34/34 pełne scenariusze** w 4,5 minuty, a **76/76 wcześniejszych niezależnych prób PostgreSQL** w 8,16 s. Nowe dwa E2E osobno przeszły w 8,3 s. Po końcowej zmianie samego fragmentu zrzutu przeglądarkowy przebieg ponownie przeszedł w 6,8 s. Zrzuty `output/course-reopening/` przy 320/390 px sprawdzono wizualnie. Końcowy odczyt potwierdził 40 migracji, wcześniejsze konta, 17 cen po 100 zł i brak nowych danych prób. Build, TypeScript oraz ESLint przeszły.

Własne fikcyjne wpłaty, plany, kursy, psy i konta są sprzątane po próbie bez resetowania bazy. Pełny odbiór wersji i pozostały zakres: [stan produktu](PRODUCT-STATUS.md). Fitness, vouchery, dalsze próby obciążenia i procedura kopii pozostają osobnymi etapami.
