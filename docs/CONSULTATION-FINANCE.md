# Rozliczenia konsultacji

Stan: implementacja lokalna, aktualizacja 02.10.2026. Migracje `202609190003_consultation_finance.sql` i `202610020005_legacy_consultation_price.sql` działają w lokalnym Supabase i zostały sprawdzone także na odizolowanej bazie testowej. Nie stosowano ich w chmurze. Obowiązuje [lokalny tryb pracy](LOCAL-DEVELOPMENT.md).

## Przebieg dla obu ról

1. Opiekun wybiera usługę. Zgłoszenie zachowuje nazwę i cenę z katalogu, ale nie tworzy jeszcze należności.
2. Prowadząca potwierdza termin. Uzgodniona kwota pojawia się na wspólnym ekranie **Finanse** oraz na karcie konsultacji.
3. Prowadząca zapisuje otrzymaną poza aplikacją wpłatę, także częściową. Saldo uwzględnia tylko wpłaty nieodwrócone korektą. Nie można zapisać nadpłaty ani użyć pakietu spacerowego do konsultacji.
4. Przełożenie i zakończenie konsultacji zachowują cenę i zapisane wpłaty. Zmiana cennika dotyczy nowych zgłoszeń, a nie starej należności.
5. Odwołanie usuwa niezapłaconą należność. Otrzymane pieniądze pozostają w historii z oznaczeniem wymagającym rozliczenia. Po faktycznym zwrocie prowadząca zapisuje zwrot/korektę z powodem. Aplikacja nie wykonuje przelewu.

Robocza reguła na testy: **odwołana konsultacja nie generuje opłaty za rezygnację**, niezależnie od strony odwołującej. Nie zmienia to dotychczasowych reguł późnej rezygnacji ze spaceru. Przed pilotem należy uzgodnić docelowe zasady konsultacji z prowadzącą; nie są one wyprowadzane z cennika ani regulaminu witryny.

Przykład: konsultacja 100 zł, wpłata 40 zł → pozostaje 60 zł. Odwołanie → pozostaje 0 zł, a 40 zł wymaga rozliczenia zwrotu. Korekta wpłaty 40 zł przy nadal umówionej konsultacji → ponownie pozostaje 100 zł. Korekta zachowuje oryginalny wpis i autora.

Na karcie konsultacji widać stan: zgłoszenie bez należności, do zapłaty, opłacone, odwołane lub wpłata do rozliczenia. Prowadząca przechodzi stamtąd bezpośrednio do właściwego formularza w finansach; opiekun widzi własne saldo i historię. Robocza cena ma osobne oznaczenie.

## Spójność i dostęp

### Starsze spotkanie bez ceny

Na karcie takiej konsultacji prowadząca ma formularz **Uzgodniona kwota**. Pole kwoty zaczyna puste. Prowadząca wpisuje cenę całego spotkania i uzasadnienie widoczne dla opiekuna; może oznaczyć kwotę jako roboczą do testów. Nie wybiera fikcyjnej usługi ani nie pobiera aktualnych 100 zł z katalogu.

Zapis dla umówionego lub zakończonego spotkania pozwala odnotować wpłatę w finansach. Starsze zgłoszenie nadal zaczyna wymagać wpłaty dopiero po potwierdzeniu terminu. Odwołanemu spotkaniu nie nadajemy należności. Cena już zachowana przy zgłoszeniu lub uzgodniona ręcznie pozostaje niezmieniona; formularz służy do uzupełnienia braku, nie do korekty wcześniejszych ustaleń.

`agree_consultation_price` wymaga administratora w bazie, blokuje ten sam rekord co wpłata i rezygnacja oraz zapisuje kwotę, wersję historii, autora, powód, audyt i powiadomienie w aplikacji w jednej transakcji. Kwota nie może być niższa od istniejących nieodwróconych wpłat. Dokładne ponowienie z tym samym identyfikatorem nie tworzy duplikatu nawet po późniejszej zmianie terminu lub zakończeniu spotkania. Podmienione dane albo ponowne użycie identyfikatora dla innego spotkania są odrzucane. Nie włączono wysyłki zewnętrznej.

### Wspólna ewidencja

- `payments.consultation_id` łączy wpłatę ze spotkaniem. Każdy nowy wpis ma dokładnie jeden cel: konsultację, zgłoszenie spacerowe albo zakup pakietu. Nie tworzono drugiej, niezależnej ewidencji wpłat.
- `consultation_balances` wylicza saldo w jednym zapytaniu z zachowanej ceny, statusu i wpłat. To widok z `security_invoker=true`: respektuje uprawnienia odczytu konsultacji i wpłat zalogowanej osoby. Nie omija RLS.
- Potwierdzenie terminu i pojawienie się należności są jednym skutkiem zmiany statusu. Błąd historii lub audytu wycofuje zapis; nie zostawia osobnej, osieroconej należności.
- `record_payment` i `void_payment` wymagają administratora również w bazie. Kolejność blokad dla konsultacji: spotkanie → wpłata. Odwołanie i zmiana terminu blokują ten sam rekord spotkania. Weryfikacja salda odbywa się po uzyskaniu blokady.
- Klucz żądania chroni przed podwójnym wpisem. Dokładne ponowienie odnajduje pierwotną wpłatę również po odwołaniu albo korekcie. Zmieniona kwota, metoda, opis lub cel przy tym samym kluczu są odrzucane. Nie powstaje drugi audyt.
- Baza ustala opiekuna i psa. Formularz nie może podmienić odbiorcy ani ceny konsultacji. Bezpośrednie zapisy do tabel i widoku oraz odczyt anonimowy są zablokowane.
- Dotychczasowe wywołania `record_payment` dla spacerów i pakietów pozostają obsługiwane. Nowy opcjonalny siódmy argument wskazuje konsultację; nie ma dwóch niejednoznacznych przeciążeń funkcji.
- Lista rozliczeń pobiera wszystkie strony. Nie pokazuje zera należności, jeśli zapytanie o salda zakończyło się błędem.

Interfejs pokazuje po 20 pozycji niezależnie w należnościach, pakietach i wpłatach. Liczniki oraz sumy nadal obejmują pełną historię. Link do konkretnego pakietu lub należności otwiera stronę zawierającą ten rekord; kolejne strony zachowują filtr i pozycję pozostałych list. Nieaktualny link do rozliczonej należności nie wyświetla ponownie formularza wpłaty, a obcy identyfikator nie ujawnia danych.

## Granice i odbiór

Starsze konsultacje bez zachowanej ceny nie otrzymują wymyślonej należności. Kwotę można uzupełnić opisanym formularzem po uzgodnieniu z opiekunem. Nie zmieniono ceny starych spotkań na bieżące 100 zł. Korekta już uzgodnionej ceny jest osobnym procesem; obecny formularz nie nadpisuje istniejącej kwoty.

Zwrot/korekta odwraca cały wybrany wpis, zgodnie z istniejącym modułem finansów. Częściowy zwrot jednego wpisu, operator płatności, fakturowanie, kary za rezygnację i płatności online nie zostały dodane. Nie wysyłano wiadomości do opiekunów.

Testy obejmują cały łańcuch migracji w PGlite, potwierdzenie/przełożenie/zakończenie/odwołanie konsultacji, częściowe wpłaty, nadpłatę, dokładne ponowienia, konflikt kluczy między celami, korektę, brak historycznej ceny, izolację opiekunów i rollback po błędzie. Testy widoków sprawdzają treści stanów, docelowe linki i brak formularza wpłaty dla opiekuna. Test zapytań obejmuje 1005 należności.

PGlite i testy renderowania nie zastępują próby z rzeczywistą sesją, PostgREST i osobnymi równoległymi połączeniami. Lokalny stos już działa. Pełny E2E konsultacji sprawdza wybór usługi, zachowanie ceny 100 zł, termin i publikację zaleceń. E2E finansów sprawdza 31 pozycji w każdej liście, kompletne sumy, bezpośrednie linki, izolację oraz rzeczywistą wpłatę za pakiet poza pierwszą stroną. [Próba 50 kont](PILOT-LOAD.md) dodatkowo potwierdza jedną wpłatę po 50 identycznych żądaniach dla spaceru. Cały zestaw ośmiu E2E przeszedł 02.10.2026.

02.10.2026 dodano rzeczywisty E2E `tests/e2e/consultation-finance.spec.ts`. Końcowy przebieg na lokalnej kompilacji przeszedł w **13,4 s** (14,0 s z uruchomieniem):

- W obu zalogowanych panelach: zgłoszenie za 100 zł, potwierdzenie terminu, wpłata 40 zł, zmiana terminu, dopłata 60 zł, rezygnacja opiekuna oraz dwa osobne zwroty z powodem. Wszystkie działania biznesowe wykonano przez formularze; API służyło do niezależnej kontroli wyników i uprawnień.
- Edycja ceny w panelu na 150 zł zachowała wcześniejsze 100 zł i przyjęła 150 zł dopiero dla kolejnego zgłoszenia. Zmieniano wyłącznie dodatkową fikcyjną usługę, usuniętą po próbie; 17 zaimportowanych pozycji pozostało po 100 zł.
- Stara karta konsultacji odrzuciła konkurencyjny zapis bez utraty powodu zmiany. Termin w bazie pozostał tym zatwierdzonym przez pierwszą kartę.
- Przełożenie zachowało saldo i unieważniło poprzednie przypomnienie; odwołanie usunęło rezerwację czasu i oczekujące przypomnienie. Wpłaty pozostały do rozliczenia. Zwroty nie usunęły pierwotnych wpisów ani nie odtworzyły należności za odwołane spotkanie.
- Opiekun i obce konto nie mogły skorygować wpłaty przez bezpośrednie RPC. Opiekun nie mógł zaksięgować wpłaty; obce konto nie odczytało historii, wpłat ani salda, a odczyt anonimowy został odrzucony. Powiadomienia o dwóch wpłatach, dwóch korektach i jednej zmianie terminu miały poprawne liczby.
- Układ końcowej historii sprawdzono wizualnie przy 320 i 390 px, bez przewijania całej strony w poziomie. Własne konta, psy, konsultacje, wpłaty i dodatkową usługę usunięto. Test nie wysyła wiadomości ani nie dotyka chmury.

Rozszerzony `pnpm local:concurrency` przeszedł **32/32 scenariusze w 3,38 s** i potwierdził **34 rzeczywiste zależności blokad między niezależnymi procesami PostgreSQL**. Trzynaście nowych prób dotyczy konsultacji: ponowienie częściowej wpłaty, nadpłata, wpłata/odwołanie w obu kolejnościach, korekta/nowa wpłata w obu kolejnościach, ponowienie korekty, przełożenie/rezygnacja opiekuna oraz przełożenie/wpłata w obu kolejnościach, ten sam identyfikator dla innej konsultacji i dwie konsultacje na wspólny termin. Sprawdzano salda, zachowaną cenę, historię, audyt, powiadomienia, kalendarz oraz generacje przypomnień. Własne dane próbne usunięto; TypeScript i ESLint nowych testów przeszły.

Te próby potwierdzają wymienione procesy na rzeczywistym Auth/PostgREST i w niezależnych transakcjach, nie każdą możliwą kombinację operacji. Ręczne uzgodnienie historycznej kwoty i zakończenie opłaconego spotkania mają osobny scenariusz `tests/e2e/consultation-legacy-price.spec.ts`. Docelowe zasady rezygnacji nadal wymagają uzgodnienia. Operator płatności oraz częściowy zwrot pojedynczego wpisu nie należą do obecnego zakresu.

Po dodaniu uzgodnienia historycznej ceny 02.10.2026: **570/570 testów w 55 plikach** (33,80 s), lokalny build z TypeScript i ESLint bez błędów. **10/10 rzeczywistych E2E** przeszło we wspólnym przebiegu (około 1,5 minuty). Nowy scenariusz odtworzył starsze zgłoszenie bez usługi i kwoty; przez formularze prowadzącej zapisał 175,50 zł, termin, otrzymaną wpłatę i zakończenie spotkania. Opiekun otworzył powiadomienie i widział cenę, uzasadnienie, historię oraz saldo. Bezpośrednie API odmówiło ustalenia kwoty opiekunowi, obcemu i anonimowemu kontu oraz odmówiło nadpisania już uzgodnionej ceny. Dokładne ponowienie po zakończeniu spotkania zachowało jedną historię i audyt.

Ten sam E2E potwierdza pustą początkową kwotę, nieaktywne pola do zakończenia ładowania skryptów, zachowanie wpisów i rodzaju ceny po błędzie oraz konflikt drugiej karty bez utraty uzasadnienia. Termin, forma, miejsce i wiadomość wypełnione **przed** uzgodnieniem kwoty pozostają w formularzu po jego zapisie. Potwierdzenie własnego zapisu uwzględnia tylko wskazaną, nadal aktualną wersję historii ceny; pozostałe zmiany nadal wymagają odświeżenia. Układ formularza przy 320 px i zakończonego spotkania przy 390 px sprawdzono wizualnie po wczytaniu strony. Po drobnej korekcie tekstu wykonano nowy build i osobny końcowy przebieg tego E2E: **10,4 s** (11,5 s z uruchomieniem). Nie zmieniano reguł finansowych.

Zestaw niezależnych transakcji przeszedł **38/38 prób w 4,09 s**, z 40 potwierdzonymi zależnościami blokad. Sześć nowych przypadków obejmuje powtórzenie uzgodnienia, dwie konkurujące kwoty, uzgodnienie/rezygnację w obu kolejnościach, wpłatę oczekującą na uzgodnienie i użycie tego samego klucza dla innego spotkania. Ten ostatni konflikt wycofał również zmianę kwoty drugiego spotkania. Testowy pomocnik sprzątania potrafi ponownie połączyć się po zakończeniu połączenia SQL. Własne dane usunięto; nie zmieniano katalogowych 17 cen ani chmury.
