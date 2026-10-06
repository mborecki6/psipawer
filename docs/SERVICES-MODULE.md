# Usługi i cennik Psi Pawer

Stan: implementacja lokalna, 19.09.2026. Migracja `202609180003_service_catalog.sql` pozostaje wyłącznie w projekcie lokalnym i testach. Nie wdrażano jej do chmury. Pełne uruchomienie z logowaniem wymaga [lokalnego stosu Supabase](LOCAL-DEVELOPMENT.md).

## Obsługa cen

Prowadząca i administrator mają pozycję **Usługi i cennik** (`/admin/services`). Edycja obejmuje nazwę, opis, kwotę, jednostkę ceny, czas, liczbę spotkań, widoczność i oznaczenie ceny jako roboczej lub docelowej. Opiekun ma katalog **Oferta** (`/app/services`). Edycja ceny nie wymaga programisty ani publikacji nowej wersji aplikacji: aktualizuje rekord w bazie. Kwoty przechowujemy w groszach.

Każda z 17 pozycji rozpoczyna od **100 zł**, zgodnie z decyzją użytkownika, niezależnie od rzeczywistych cen na stronie. Kurs i pakiet kosztują roboczo 100 zł za całość, a nie za każde spotkanie. Spacer jest wyceniony za jednego psa. Nie jest to automatycznie synchronizowany cennik witryny.

Przykład: zgłoszenie konsultacji przy cenie 100 zł zachowuje 100 zł. Prowadząca zmienia usługę na 175,50 zł; dopiero następne zgłoszenie otrzymuje 175,50 zł. Otwarty formularz ze starą ofertą nie zapisze po cichu nowej kwoty — wymaga odświeżenia i sprawdzenia ceny. Powtórzenie wcześniej przyjętego zgłoszenia nadal odnajduje wcześniejszy zapis, także po ukryciu usługi.

## Zaimportowana oferta

Nazwy i zakres sprawdzono w [menu i ofercie Psi Pawer](https://www.psipawer.pl/) oraz podstronach usług 18–19.09.2026. Szczegóły CITY CHALLENGE potwierdzono bezpośrednio w przeglądarce 19.09.2026: 5 × 60 min, do czterech psów z opiekunami, różne przestrzenie miejskie Wrocławia. Pojedyncze pozycje menu z kilkoma wariantami rozdzielono w katalogu. Opisy są krótkimi parafrazami; nie przenoszono terminów wydarzeń ani regulaminów.

| Usługa / warianty | Jednostka ceny roboczej | Podstawa |
| --- | --- | --- |
| Psie Przedszkole — grupowe i indywidualne | 100 zł za każdy cały kurs, 5 × 60 min | [grupowe](https://www.psipawer.pl/psie-przedszkole-grupowe), [indywidualne](https://www.psipawer.pl/psie-przedszkole-indywidualne) |
| Psia Szkółka — grupowe i indywidualne | 100 zł za każdy cały kurs, 5 × 60 min | [grupowe](https://www.psipawer.pl/psia-szk%C3%B3%C5%82ka-grupowe), [indywidualne](https://www.psipawer.pl/psia-szk%C3%B3%C5%82ka-indywidualne) |
| PSI FITNESS — ocena ruchowa i plan; pakiet 4 spotkań | 100 zł za ocenę 60 min; 100 zł za cały pakiet 4 × 45 min | [fitness](https://www.psipawer.pl/psi-fitness-zajecia) |
| Trening indywidualny | 100 zł za 60 min | [trening](https://www.psipawer.pl/trening-indywidualny) |
| Posłuszeństwo PAWER UP! | 100 zł za kurs 5 × 60 min | [kurs](https://www.psipawer.pl/pawer-up) |
| CITY CHALLENGE | 100 zł za cały kurs, 5 × 60 min | [kurs miejski](https://www.psipawer.pl/city-challenge) |
| Konsultacja behawioralna — stacjonarna i online | 100 zł za każdy wariant, 90 min | [konsultacja](https://www.psipawer.pl/konsultacja-behawioralna) |
| Walk for a dog | 100 zł za 60 min | [spacer indywidualny](https://www.psipawer.pl/walk-for-a-dog) |
| Spacer socjalizacyjny — pojedynczy, pakiet 4 i duet | 100 zł za psa / spacer; 100 zł za psa / cały pakiet; 100 zł za psa / duet | [spacery](https://www.psipawer.pl/spacery-socjalizacyjne); czas pojedynczego spaceru przyjęto orientacyjnie 60 min |
| Treningi tematyczne | 100 zł za spotkanie 45 min | [treningi](https://www.psipawer.pl/treningi-tematyczne) |
| Karta podarunkowa | 100 zł za roboczą kartę | [karty](https://www.psipawer.pl/karty-podarunkowe) |

## Połączenie z zapisami

- Pięć wariantów pojedynczych spotkań trafia do istniejącej ścieżki konsultacji: ocena fitness, trening indywidualny, konsultacja stacjonarna, konsultacja online i Walk for a dog. Termin potwierdza prowadząca.
- Tworzenie nowego spaceru może pobrać nazwę, czas i cenę z katalogu spacerów. Cena zapisuje się przy konkretnym terminie. Późniejsza edycja cennika nie zmienia istniejących terminów ani zgłoszeń; kopia spaceru zachowuje kwotę oryginału, dopóki prowadząca nie zmieni jej świadomie.
- Wariant kursu prowadzi do listy jego cykli i zgłoszenia na cały kurs; prowadząca tworzy cykl z wybranej usługi. Pakiet fitness prowadzi do własnego zgłoszenia i czterech indywidualnych spotkań, z ceną całego pakietu zachowaną z chwili zgłoszenia. Realizacja vouchera pozostaje ofertą z informacją o kontakcie z prowadzącą. Dotychczasowy moduł pakietów spacerowych ma nadal niezależną ewidencję i ręczne określenie warunków.
- Kwota konsultacji tworzy należność po potwierdzeniu terminu przez prowadzącą. Samo zgłoszenie nie jest obciążane. [Wpłaty, korekty i odwołania](CONSULTATION-FINANCE.md) korzystają ze wspólnego ekranu finansów. Operator płatności nie został dodany.
- Ukrycie oferty blokuje nowe zgłoszenia pojedynczych spotkań i usuwa ją z wyboru dla nowych terminów spacerów. Już istniejące terminy spacerów pozostają dostępne według dotychczasowych reguł — trzeba odwołać je oddzielnie, jeśli to zamierzony efekt.

## Spójność i sprawdzanie

Zmiany cen wymagają roli administratora także po stronie bazy. Klient widzi aktywny katalog, a historię zmian tylko prowadząca. Zapis sprawdza wersję, blokuje rekord i dodaje historię oraz audyt w jednej transakcji. Ponowienie zapisu nie tworzy duplikatu. Kwota zgłoszenia pochodzi z bazy, nigdy z pola wysłanego przez opiekuna.

Testy obejmują import, kwoty, uprawnienia, ukrycie, konflikt wersji, powtórzenia, zachowanie ceny, zmianę formy spotkania i wycofanie transakcji po błędzie historii. Test przeglądarkowy korzysta z rzeczywistych komponentów i atrap zapisu na fikcyjnych danych: `pnpm test:services-ui`. Sprawdza formularz po błędzie, wersję edycji i 24 warianty układu przy 320, 390, 768 i 1440 px. Osobny test konsultacji sprawdza przekazanie wybranej usługi. Te testy nie zastępują pełnego przebiegu z rzeczywistą lokalną sesją Supabase.

Weryfikacja 18.09.2026 po tej zmianie: **250 testów w 23 plikach**, ESLint i build z TypeScript zakończone poprawnie. Testy przeglądarkowe: 24 warianty cennika i 28 konsultacji, w tym wybór usługi i zachowanie pól po błędzie. Panel edycji na komputerze i ofertę na telefonie sprawdzono również wizualnie. Build używał jawnych lokalnych adresów oraz zastępczego publicznego klucza.

Ponowna weryfikacja 19.09.2026 po uzupełnieniu CITY CHALLENGE: **28 testów modułu usług** oraz **24 scenariusze responsywne cennika** zakończone poprawnie. Sprawdzono także odzyskanie formularza po błędzie, kontrolę wersji zapisu, widok opiekuna oraz domyślną cenę nowego spaceru. Nie uruchamiano migracji ani zapisów w chmurze.

Podczas integracji konsultacji z zaleceniami poprawiono również zachowanie list wyboru w edytorze cennika: rodzaj ceny i widoczność zachowują wartości po błędzie oraz po udanym zapisie. Potwierdzają to dodatkowe asercje w istniejącym teście przeglądarkowym.

Weryfikacja 02.10.2026: odczyt rzeczywistej lokalnej bazy potwierdził **17 aktywnych pozycji, wszystkie po 100 zł i oznaczone jako ceny robocze**. Ponownie porównano katalog z menu oferty psipawer.pl oraz warianty konsultacji, fitness i spacerów z podstronami usług. **28 testów modułu oraz 24 scenariusze responsywne cennika** zakończyły się poprawnie. Test formularza obejmował zmianę ceny, zachowanie pól po błędzie, kolejne zapisy, widoczność oferty i wybór ceny docelowej. Istniejący panel już spełniał to wymaganie, więc nie nadpisywano katalogu ani nie zmieniano aplikacji w chmurze.

Dodatkowy rzeczywisty [E2E konsultacji i finansów](CONSULTATION-FINANCE.md), zakończony 02.10.2026 w 13,4 s, sprawdził edycję ceny w zalogowanym panelu prowadzącej. Zmiana 100 → 150 zł zachowała 100 zł przy wcześniejszej konsultacji; kolejne zgłoszenie miało już 150 zł. Test używał własnej fikcyjnej usługi i usunął ją po zakończeniu. Końcowy odczyt bazy ponownie potwierdził 17 aktywnych usług z ceną roboczą 100 zł.

## Rdzeń cyklu kursu

02.10.2026: lokalna migracja `202610020011_courses.sql` dodaje domenę cyklu kursu. Jest to podstawa dla pełnych paneli, nie ukończony proces zakupu lub rozliczenia w interfejsie. Moduł ma osobne typy w `src/modules/courses` i operacje transakcyjne bazy. Katalog i jego edytor nadal działają; migracja nie zmienia cen, widoczności ani istniejących zgłoszeń innych usług.

Przygotowanie cyklu kopiuje wybrany wariant, jego wersję, kwotę, czas i liczbę spotkań. Wymaga wszystkich przyszłych terminów we właściwej kolejności. Cena oznacza całość dla jednego psa, bez mnożenia przez pięć spotkań; późniejsza cena katalogowa dotyczy nowych cykli. Szkic jest prywatny dla zespołu. Dopiero publikacja zajmuje każdy termin we wspólnej tabeli kalendarza. Jeśli choć jeden termin koliduje ze spacerem, konsultacją, innym kursem lub blokadą, cała publikacja jest wycofywana.

Warianty indywidualne mają jedno miejsce dla psa z opiekunem, zgodnie z [ofertą przedszkola indywidualnego](https://www.psipawer.pl/psie-przedszkole-indywidualne). Grupę określa prowadząca przy przygotowaniu cyklu; dla katalogu Psi Pawer panel powinien rozpoczynać od czterech miejsc, zgodnie z [kursem grupowym](https://www.psipawer.pl/psie-przedszkole-grupowe). Forma została zapisana w katalogu jako osobna właściwość i zachowana przy cyklu. Publiczna okolica i dokładny punkt spotkania mają osobne miejsca przechowywania. Każde spotkanie może mieć inny punkt, a zmiana jednego nie nadpisuje pozostałych.

Opiekun zgłasza własnego psa na otwarty, nierozpoczęty kurs. To zgłoszenie nie rezerwuje miejsca ani nie tworzy opłaty. Prowadząca przyjmuje, kieruje na rezerwę lub odrzuca z powodem. Blokada cyklu chroni ostatnie miejsce również przy równoczesnych decyzjach. Przyjęcie zapisuje jedną należność za cały kurs; obecności kolejnych spotkań nie dodają następnych opłat. Dokładne punkty są widoczne tylko zespołowi i aktualnie przyjętemu opiekunowi. Pozostali nie widzą obcych zgłoszeń, obecności i ich historii.

Opiekun może odnotować rezygnację, a prowadząca odwołać cały cykl. Wcześniejsze decyzje i obecności pozostają w historii. Wszystkie niewykonane terminy i aktualne zgłoszenia zostają odwołane atomowo; terminy zwalniają kalendarz. Dotychczasowa kwota przyjętego zgłoszenia pozostaje do jawnego rozliczenia. Nie zaimplementowano domyślnej zasady naliczania zwrotu lub anulowania długu. To pole domenowe, jeszcze bez powiązania z tabelą wpłat i ekranem finansów.

Zmiana terminu lub miejsca sprawdza wersję spotkania oraz aktualizuje wersję cyklu, dzięki czemu zgłoszenie ze starszym harmonogramem otrzymuje konflikt. Dokładne ponowienie własnej udanej operacji nie tworzy nowej wersji, historii ani audytu. Obecności są dostępne po rozpoczęciu spotkania dla przyjętych uczestników; mają własne wersje i historię korekt. Zakończenie spotkania wymaga upływu jego czasu i uzupełnienia obecności. Zakończenie cyklu wymaga rozstrzygnięcia każdego spotkania.

Weryfikacja: **13 testów domeny bazy**, pełny zestaw **635/635 w 59 plikach**, TypeScript i ESLint zmienionego kodu. Rzeczywisty lokalny `tests/e2e/courses-domain.spec.ts` sprawdził Auth, RPC, polityki dostępu i pięć potwierdzonych zależności blokad między niezależnymi procesami PostgreSQL. Próby obejmują ostatnie miejsce, zamknięcie przy nowym zgłoszeniu, odwołanie przy akceptacji i obie kolejności konfliktu publikacji z blokadą kalendarza. Własne cykle, konta i dane zostały usunięte. Ten test korzysta z API; nie dowodzi jeszcze przejścia kursu przez formularze przeglądarki.

Po tym pierwszym etapie dodano wpłaty i jawne rozliczenie rezygnacji, powiadomienia i przypomnienia oraz [powiązania z zaleceniami](COURSE-CARE.md). Ponowne decyzje po odrzuceniu i powrót po rezygnacji nadal wymagają rozbudowy reguł. Pakiet fitness oraz karta podarunkowa mają odrębne procesy i nie są utożsamiane z cyklem kursu. Panele obu ról i odczyt kalendarza opisano poniżej.

## Panele kursów i kalendarz

Moduł `src/modules/courses` ma osobne modele, walidację, odczyty, operacje, formularze i widoki. Trasy `/admin/courses` i `/app/courses` udostępniają listy i szczegóły cyklu. Z katalogu opiekun przechodzi do dostępnych cykli wybranej usługi, a prowadząca może przygotować nowy. Edycja katalogu zachowuje cenę istniejącego cyklu.

Prowadząca tworzy szkic ze wszystkimi terminami, nazwą, liczbą miejsc i osobnym publicznym oraz dokładnym opisem zbiórki. Grupowy wariant zaczyna od czterech miejsc, indywidualny od jednego. Przycisk uzupełnienia kolejnych tygodni zachowuje lokalną godzinę; każdy termin jest sprawdzany i zapisywany w czasie Europe/Warsaw, również przy zmianie czasu. Formularze pozostają nieaktywne przed gotowością skryptów. Oferta i jej wersja są związane z widocznym formularzem; odświeżenie danych w tle nie zmienia po cichu jego ceny.

Opiekun zgłasza psa na cały cykl. Własne potwierdzenie pozostaje widoczne po odświeżeniu danych. Wybór nie pokazuje psów, które mają już zgłoszenie; brak profilu i zgłoszenie każdego psa mają odrębne wskazówki. Prowadząca zatwierdza skład, kieruje na rezerwę, odrzuca lub zapisuje rezygnację. Lista zgłoszeń i historia mają osobne filtry i strony, a komplet przyjętych uczestników służy obecnościom każdego spotkania.

Zmiana jednego terminu lub zbiórki zachowuje pozostałe spotkania i cenę. Otwarty edytor zamraża swoją wersję. Po konflikcie pozostają data, miejsce i powód; jawny odnośnik „Odśwież dane” otwiera aktualne dane i nowe wersje formularzy. Własny udany zapis aktualizuje wyłącznie wersję tego formularza. Zmiana harmonogramu sprawia również, że stare zgłoszenie otrzymuje odmowę zamiast przyjmować inny cykl niż widoczny przy wyborze.

Obecności zapisuje prowadząca po rozpoczęciu zajęć. Zakończenie spotkania wymaga upływu czasu i wszystkich obecności; odwołanie wymaga powodu. Można zakończyć cykl po rozstrzygnięciu każdego spotkania. Wcześniejsze obecności pozostają czytelne w szczegółach i historii. Odwołanie cyklu usuwa przyszłe rezerwacje czasu i ukrywa prywatne zbiórki przed odwołanymi uczestnikami. Zapisana należność pozostaje do osobnego rozliczenia, bez udawania zarejestrowanej wpłaty lub zwrotu.

Migracja `202610020012_course_calendar.sql` rozszerza dotychczasowy odczyt kalendarza bez zmiany jego parametrów lub uprawnień. Każde spotkanie jest osobnym wpisem, a jego odnośnik otwiera cykl. Lista używa terminu razem z identyfikatorem cyklu, więc wiele spotkań tego samego kursu nie nadpisuje się w widoku. Klient widzi tylko kurs, na który został przyjęty. Dokładny punkt korzysta z polityk dostępu oddzielnej tabeli; osoba oczekująca lub rezerwowa nie otrzymuje go. Pulpit korzysta z tego samego odczytu i prowadzi do właściwego modułu.

Weryfikacja tego etapu: **650/650 testów w 60 plikach** (14,35 s), w tym **15** bazy kursów i **13** granicy operacji aplikacji. **25/25** rzeczywistych scenariuszy Auth/API/przeglądarki przeszło we wspólnym przebiegu (3,9 minuty). Po poprawie pustego wyboru psa i dodaniu skrótu do zgłoszenia wykonano nowy build i ponownie **2/2** scenariusze kursów (17,9 s). Obejmują tworzenie, opóźnione skrypty, zgłoszenia, przyjęcie, rezerwę, odmowę ponad limit, zmianę jednego spotkania, starą kartę edytora i stare zgłoszenie, zachowanie pól, prywatność zbiórki, kalendarz, obecności, zakończenie i odwołanie. Czas pierwszego spotkania drugiej próby przesunięto wyłącznie dla własnego rekordu, żeby sprawdzić zegarową regułę obecności; nie zmieniano zegara serwera.

Zrzuty końcowych widoków w `output/courses/` sprawdzono przy 320, 390 i 1440 px, również oddzielne karty zbiórki i obecności. Nowy test czeka na widok danych, dzięki czemu zrzut nie przedstawia ekranu ładowania. Nie ma przewijania w bok. **76/76** istniejących niezależnych prób PostgreSQL ponownie przeszło po migracji (9,10 s); pięć wyścigów kursowych pozostaje częścią osobnego rzeczywistego testu API. Build z TypeScript, ESLint i kontrola różnic przeszły. Odczyt potwierdził 35 migracji, pięć wcześniejszych kont, brak kursów, spotkań, zgłoszeń, zajętych czasów i psów własnej próby oraz 17 aktywnych usług po robocze 100 zł. Nie wdrażano chmury, SMTP ani zmian cen.

Końcowa próba potwierdza również najbliższy kurs na pulpicie opiekuna i rzeczywiste przejście jego odnośnikiem do cyklu.

Ten wcześniejszy etap nie obejmował ewidencji wpłat ani uzgodnienia rezygnacji; dodano je w kolejnym etapie opisanym poniżej. Powiadomienia, przypomnienia i zalecenia powiązane z cyklem są już dodane w dalszych etapach. Edycję nazwy/pojemności i korekty obecności dodano w migracji `202610030003`. Powrót po rezygnacji lub odmowie pozostaje częścią dalszego produktu.

## Rozliczenia kursów

Lokalna migracja `202610020013_course_finance.sql` łączy zgłoszenie kursowe ze wspólną ewidencją `payments`. Jedna operacja wpłaty obsługuje cztery odrębne cele: spacer, pakiet, konsultację lub zgłoszenie na cały kurs. Dotychczasowe wywołania z sześcioma lub siedmioma parametrami pozostają obsługiwane. Cena przyjętego zgłoszenia pozostaje ceną całego cyklu; kolejna zmiana katalogu nie zmienia należności.

Przy zgłoszeniu w szczegółach kursu prowadząca odnotowuje otrzymane wpłaty, również częściowe. Opiekun widzi cenę, należność, wpłaty po zwrotach, odnotowane zwroty i aktualne saldo. Płatnikiem pozostaje opiekun zapisany przy zgłoszeniu, również jeśli później zmieni się opiekun psa. Odczyty i historia nie przechodzą wtedy na inne konto.

Rezygnacja lub odwołanie cyklu zachowuje wcześniejsze kwoty i wpłaty. Przyjęte zgłoszenie otrzymuje stan „Kwota po rezygnacji do uzgodnienia”; jego tymczasowa należność nie powiększa sumy „Do zapłaty”. Prowadząca ustala z opiekunem końcową kwotę od 0 zł do pierwotnej ceny, zapisuje ją z powodem i potwierdzeniem. Zgłoszenie nigdy nieprzyjęte nie może dostać dodatniej opłaty. Uzgodnienie może zostać później poprawione z nowym powodem i zachowaniem historii. Nie wylicza się automatycznie potrącenia za spotkania ani domyślnej zasady zwrotu.

Uzgodnienie niższej kwoty nie udaje zwrotu. Dopóki zarejestrowane wpłaty po wcześniejszych zwrotach przekraczają uzgodnioną należność, panel pokazuje pozostałą kwotę do zwrotu. Prowadząca odnotowuje faktyczny zwrot przy konkretnej wpłacie, w całości lub w częściach. Każda część ma własny identyfikator, kwotę, datę i powód w `course_payment_refunds`. Pierwotna kwota wpłaty nie jest przepisywana; pełny zwrot zamyka ją jako `refunded`. Dotychczasowa operacja pełnej korekty zwraca wyłącznie jeszcze niezwróconą część. Wpis w aplikacji nie wykonuje przelewu ani obciążenia karty.

Saldo `course_balances` jest odczytem z politykami dostępu użytkownika i obserwuje należność, stan, wpłaty oraz zwroty w jednej instrukcji SQL. Uzgodnienia oczekujące na decyzję i pozostałe zwroty trafiają również do wspólnych finansów, z odnośnikiem do dokładnie wybranego zgłoszenia. Parametr `enrollment` otwiera właściwe zgłoszenie niezależnie od strony listy, z zachowaniem ograniczenia do tego kursu i uprawnień opiekuna. Kwoty wpłat we wspólnym podsumowaniu uwzględniają częściowe zwroty; odczyty sald i historii nie zatrzymują się na domyślnym limicie API.

Wpłata, zwrot, uzgodnienie, decyzja o uczestniku i odwołanie korzystają z kolejności blokad cykl → zgłoszenie → wpłata. Kwota jest sprawdzana po uzyskaniu blokady; dwie sesje nie mogą jednocześnie przekroczyć należności lub niezwróconej części wpłaty. Każda operacja pieniężna zmienia wersję zgłoszenia i zapisuje historię oraz audyt atomowo. Uzgodnienie ze starszej karty otrzymuje konflikt. Własne potwierdzenie i wpisane pola pozostają w formularzu; nowy wpis wymaga jawnego wczytania aktualnego salda. Odnośnik odświeżenia nie używa fragmentu strony, który mógłby wykonać tylko przewinięcie zamiast pobrania nowych danych.

Identyfikator żądania jest zachowany przez formularz także po odświeżeniu danych w odpowiedzi. Dokładne ponowienie wpłaty, częściowego zwrotu lub uzgodnienia potwierdza wcześniejszy wynik bez nowego zapisu, również po późniejszych zmianach salda. Użycie tego identyfikatora z inną kwotą, celem lub opisem zostaje odrzucone. Potwierdzenie zwrotu i uzgodnienia jest dodatkowo związane z autorem.

Dowody i warunki uruchomienia końcowych prób: [lokalne rozliczenia kursów](LOCAL-DEVELOPMENT.md#rozliczenia-kursów). Powiadomienia i przypomnienia dodano w następnej migracji opisanej poniżej, a [zalecenia kursów](COURSE-CARE.md) w migracji `202610030002`. Nie stosowano zmian w chmurze ani nowych cen.

## Powiadomienia i przypomnienia kursów

03.10.2026 lokalna migracja `202610030001_course_notifications.sql` łączy historię kursu z osobistą skrzynką i istniejącą kolejką przypomnień. Decyzje, zmiany spotkań, rezygnacja, odwołanie, obecności, wpłaty, częściowe zwroty i uzgodnienia kierują do właściwego zgłoszenia lub spotkania. Przyjęci uczestnicy mają przypomnienie przed każdym przyszłym spotkaniem, z wycofaniem nieaktualnych generacji. Zapis finansowy nie tworzy kolejnego przypomnienia. Odbiorcą kursowych wiadomości i przypomnień pozostaje opiekun zgłoszenia.

Oba panele obsługują te kategorie, zachowują odnośnik do konkretnego spotkania i respektują prywatność zbiórki. Zasady, kolejność blokad i dowody: [powiadomienia](NOTIFICATIONS-MODULE.md#kursy), [przypomnienia](REMINDERS-MODULE.md#przypomnienia-spotkań-kursowych) i [lokalny odbiór](LOCAL-DEVELOPMENT.md#powiadomienia-i-przypomnienia-kursów). Ponowną decyzję po odmowie i przywrócenie udziału dodano w migracji `202610030004`; edycję ustawień i korekty obecności opisano poniżej.

## Zalecenia kursów

03.10.2026 lokalna migracja `202610030002_course_care.sql` łączy przyjęte zgłoszenie ze wspólnym planem pracy psa. Prowadząca przygotowuje plan całego cyklu albo prywatny szkic po konkretnym spotkaniu. Plan całego kursu można publikować podczas cyklu; zalecenia po spotkaniu wymagają jego zakończenia. Przy uczestniku jest osobna lista wersji i bezpośrednie przejście do edytora lub opublikowanych zaleceń. Powiązania, prywatność, zmiana opiekuna i rzeczywiste próby blokad są opisane w [module zaleceń kursowych](COURSE-CARE.md).

## Edycja ustawień i korekty obecności

Migracja `202610030003_course_edits.sql` i panele prowadzącej pozwalają zmienić nazwę oraz liczbę miejsc w szkicu lub aktywnym cyklu, z powodem i powiadomieniem opiekunów. Ceny, zgłoszenia, harmonogram i rezerwa pozostają zachowane; limit nie może spaść poniżej liczby przyjętych psów. Zapisana obecność zakończonego spotkania ma jawną korektę z powodem, wcześniejszym stanem i nową wersją, również po zakończeniu kursu. Korekta nie przelicza opłaty. [Potwierdzenia zapisów, prywatność, formularze i rzeczywiste blokady](COURSE-EDITS.md).

## Ponowna decyzja i powrót do udziału

Migracja `202610030004_course_reopening.sql` i panele prowadzącej pozwalają wrócić do decyzji po odmowie albo przywrócić udział po rezygnacji przed pierwszym spotkaniem aktywnego kursu. Powrót do decyzji nie zajmuje miejsca ani nie nalicza opłaty. Przywrócenie wymaga wolnego miejsca i świadomie przywraca pierwotną cenę całego cyklu, z zachowaniem rzeczywistych wpłat, częściowych zwrotów, planów i wcześniejszych uzgodnień. Formularz pokazuje cenę; historia zachowuje powód i obie należności. Zmiana opiekuna wyklucza powrót historycznego zgłoszenia. [Zasady, ponowienia i osiem rzeczywistych zależności blokad](COURSE-REOPENING.md).
