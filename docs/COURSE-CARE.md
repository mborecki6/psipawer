# Kursy i zalecenia dla uczestnika

Implementacja lokalna, 03.10.2026. Migracja `202610030002_course_care.sql` jest zastosowana wyłącznie w lokalnym Supabase. Nie zmieniano produkcji, cen katalogowych ani zewnętrznej poczty.

## Proces pracy

W szczegółach przyjętego zgłoszenia prowadząca wybiera **Przygotuj plan całego kursu** albo **Przygotuj zalecenia po spotkaniu**. Plan całego cyklu można publikować podczas kursu. Szkic po konkretnym spotkaniu można przygotować wcześniej, ale jego publikacja wymaga zakończenia tego spotkania. Zakończenie spotkania nie publikuje szkicu automatycznie.

Przy psie pozostaje jeden wspólny szkic. Otwarcie go z innego kursu, spotkania lub konsultacji zachowuje zapisane powiązanie i treść. Osobny przycisk pozwala świadomie przypisać szkic do nowego źródła. W formularzu wybiera się konsultację albo kurs; plan bez obu powiązań pozostaje ogólnym planem pracy. Link zawierający jednocześnie konsultację i kurs nie wybiera źródła za prowadzącą.

Każda publikacja ma własny adres i zachowuje kurs, zgłoszenie oraz opcjonalne spotkanie. Przy zgłoszeniu obie role widzą listę publikacji dla właściwego psa, po pięć na stronę. Stronicowanie jest niezależne dla uczestników: liczne edycje jednego planu nie ukrywają planów pozostałych psów. Lista zawiera tytuł, wersję, datę i zakres, bez treści planu. Opiekun otwiera konkretną publikację albo pełny plan pracy i postępy psa. Dotychczasowa skrzynka powiadomień otrzymuje jeden wpis o publikacji.

## Dostęp i trwałość

- Szkic i fakt jego istnienia są dostępne tylko zespołowi. Opiekun nie otrzymuje biblioteki ani list wyboru źródeł.
- Nowe powiązanie wymaga przyjętego zgłoszenia aktualnego opiekuna psa i aktywnego lub zakończonego kursu. Zgłoszenie rezerwowe, odrzucone lub odwołane nie przyjmuje nowych zaleceń kursowych. Odwołane spotkanie również nie przyjmuje nowego szkicu ani publikacji.
- Złożone klucze obce pilnują zgodności psa, zgłoszenia, kursu, praktyki i spotkania. Nie można wskazać spotkania innego kursu ani zapisać jednocześnie źródła kursowego i konsultacji.
- Historia zaleceń korzysta z dotychczasowych praw do psa. Po zmianie opiekuna poprzedni opiekun traci dostęp do planów, a nowy dostaje historię pracy psa. Zgłoszenie kursowe i jego finanse pozostają przy pierwotnym zgłaszającym. Nowy opiekun nie otrzymuje niedostępnego odnośnika do tego zgłoszenia.
- Zmiana źródła kolejnego szkicu, późniejsza rezygnacja lub zmiana opiekuna nie przepisuje wcześniejszych publikacji. Nie przypisujemy źródeł do dawnych planów na podstawie domysłów.
- Dokładne ponowienie własnej publikacji rozpoznaje wersję źródłową, autora, tytuł, treść, datę kontaktu i całe powiązanie. Potwierdza wcześniejszą publikację także po późniejszej zmianie stanu, bez nowej wersji lub powiadomienia. Inna treść z tej samej starej karty otrzymuje konflikt; wszystkie wpisane pola pozostają w formularzu.
- Zapis planu nie zmienia wersji zgłoszenia, należności ani generacji przypomnienia kursowego. Szkic, publikacja, kontakt kontrolny, zdarzenie i audyt zapisują się atomowo. Błąd powiadomienia wycofuje całą publikację.

## Współbieżność

Zapis kursowych zaleceń blokuje praktykę, psa (`NO KEY UPDATE`), cykl (`SHARE`), opcjonalne spotkanie i zgłoszenie (`SHARE`). Blokada psa serializuje wszystkie jego plany. Jest zgodna z blokadą `KEY SHARE` używaną przez klucze obce zmian kursu, dzięki czemu odwołanie nie czeka cyklicznie na publikację. Zgłoszenie na kurs nadal blokuje psa przed cyklem. Zapis ogólnego planu i planu konsultacji zachowuje dotychczasową kolejność.

Trzy próby na niezależnych połączeniach PostgreSQL w `tests/e2e/course-care.spec.ts` potwierdzają rzeczywiste oczekiwania na blokady:

1. Publikacja rozpoczęta przed rezygnacją kończy się pierwsza; późniejsza rezygnacja zachowuje historyczny plan.
2. Rezygnacja rozpoczęta przed nową publikacją kończy się pierwsza; publikacja otrzymuje odmowę bez nowego planu.
3. Ponowienie już przyjętego zgłoszenia kończy się przed czekającą publikacją; pozostaje jedno zgłoszenie i jedna nowa publikacja.

Obserwator sprawdza zależności na serwerze przez `pg_blocking_pids`; samo równoczesne uruchomienie obietnic nie jest dowodem wyścigu.

## Weryfikacja

Nowe próby bazy obejmują publikację planu całego kursu, prywatny szkic przed spotkaniem, zakończenie, niezmienne ponowienia, niepoprawne powiązania, rezerwę, odwołanie, zmianę opiekuna, osobne strony publikacji, odmowę bezpośredniego zapisu oraz atomowe wycofanie błędu powiadomienia. Plik bazy kursów zawiera 53 testy. Dotychczasowe wywołania `save_care_plan` z sześcioma lub siedmioma argumentami są nadal obsługiwane przez jedną funkcję z domyślnymi końcowymi argumentami.

Rzeczywisty scenariusz przeglądarkowy przechodzi panele obu ról: kurs → prywatny szkic → publikacja całego cyklu → konflikt starszej karty → świadoma zmiana źródła → obecność i zakończenie spotkania → publikacja zaleceń → historyczne wersje i przejścia do źródeł. Sprawdza brak dostępu obcego konta i zmianę opiekuna. Przeszły **2/2 scenariusze** w 9,4 s. Zrzuty w `output/course-care/` sprawdzono wizualnie przy 320 i 390 px, z kontrolą przewijania w bok.

Weryfikacja pełnej wersji i stan dalszych prac: [stan produktu](PRODUCT-STATUS.md). [Edycję ustawień i korekty obecności](COURSE-EDITS.md) dodano w następnej migracji. [Ponowną decyzję po odmowie i przywrócenie po rezygnacji](COURSE-REOPENING.md) dodano w kolejnej migracji. Pakiet fitness i vouchery pozostają osobnymi etapami.
