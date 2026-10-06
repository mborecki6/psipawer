# Powiadomienia w aplikacji

Stan lokalny: 03.10.2026. Moduł `src/modules/notifications/`, migracje `202609190004_in_app_notifications.sql`, `202610030001_course_notifications.sql` oraz `202610030006_fitness_notifications_work.sql`, z rozszerzeniami edycji/powrotu kursów. Nie zastosowano migracji w chmurze, nie wykonano wdrożenia ani wysyłki wiadomości poza aplikację.

## Obsługa skrzynki

Obie role mają **Powiadomienia** w menu oraz przycisk z dzwonkiem w nagłówku. Licznik pokazuje wszystkie nieprzeczytane wiadomości danego konta; wizualnie wartości powyżej 99 mają postać `99+`, a etykieta dla czytnika ekranu zawiera dokładną liczbę. Niedostępny licznik jest oznaczony `!`, a nie udawanym zerem.

Widok `/admin/notifications` lub `/app/notifications` ma filtry **Nieprzeczytane** i **Wszystkie**, datę, nazwę psa, kategorię zmiany oraz przycisk **Otwórz sprawę**. Otwarcie oznacza konkretną wiadomość jako przeczytaną i prowadzi do właściwego ekranu. Samo pobranie strony, podgląd linku lub odczyt listy nie zmieniają statusów.

Można oznaczyć pojedynczą wiadomość albo nieprzeczytane wiadomości z bieżącej strony. Zapis obejmuje maksymalnie 20 wskazanych identyfikatorów. Nowe wiadomości, które przyjdą później, nie są przez tę operację ukrywane. Przeczytanie powiadomienia nie oznacza przejrzenia odpowiedzi opiekuna, zakończenia kontaktu ani rozpatrzenia zapisu — to osobne działania w źródłowym module.

Strona zawiera 20 wpisów i przejście do starszych. Kursor jest oparty na identyfikatorze istniejącej wiadomości i jej czasie, z rozstrzygnięciem jednakowych czasów przez identyfikator. Nowe wiadomości na początku nie przesuwają kolejnych stron. Nieaktualny lub niedostępny kursor pokazuje możliwość powrotu do początku.

Licznik i lista odświeżają się przy pobraniu danych oraz po operacjach aplikacji odświeżających panele. **Nie ma jeszcze subskrypcji na żywo ani cyklicznego odpytywania.** Przycisk **Odśwież** pobiera nowe wiadomości bez zmiany ich stanu. Starsze powiadomienie opisuje zdarzenie z podanej daty; otwierany ekran pokazuje aktualny stan sprawy.

## Zdarzenia i odbiorcy

| Zmiana | Kto otrzymuje powiadomienie |
| --- | --- |
| Opublikowanie planu | Opiekun psa; zapis prywatnego szkicu niczego nie tworzy |
| Nowa odpowiedź o postępach | Każde aktualne konto prowadzącej/administratora |
| Jawne oznaczenie odpowiedzi jako przeczytanej | Autor odpowiedzi |
| Zgłoszenie konsultacji | Zespół prowadzący |
| Potwierdzenie, zmiana, odwołanie lub zakończenie konsultacji | Opiekun i pozostałe konta prowadzące |
| Nowy zapis lub rezygnacja ze spaceru | Zespół prowadzący |
| Decyzja lub przywrócenie zgłoszenia | Opiekun psa |
| Zaproszenie psa na spacer | Opiekun psa; jest to komunikat w aplikacji, nie e-mail |
| Zmiana szczegółów spaceru | Opiekunowie aktywnych zapisów: oczekujących, przyjętych i rezerwowych |
| Odwołanie spaceru | Opiekunowie zapisów oznaczonych jako odwołane w terminie, również wcześniejszych rezygnacji w terminie |
| Zapis wpłaty lub zwrotu/korekty | Opiekun wskazany w ewidencji wpłaty |
| Przełożenie, wznowienie lub odwołanie kontaktu kontrolnego | Opiekun psa; bez prywatnej notatki prowadzącej |

Autor własnej operacji nie dostaje dodatkowego powiadomienia o tej samej czynności. Dwa psy jednego opiekuna zapisane na spacer mają oddzielne komunikaty oznaczone nazwą psa. Nie wysyłamy jeszcze komunikatów o każdej zmianie profilu, zdjęciu czy aktywności społecznościowej.

## Spójność i prywatność

`notifications` przechowuje odbiorcę, jego rolę w chwili zdarzenia, psa, identyfikator sprawy, kategorię, klucz źródła, czas oraz czas przeczytania. Nie kopiuje treści zaleceń, odpowiedzi, prywatnych notatek, punktów spotkania, linków do rozmów ani opisów wpłat.

Powiadomienia powstają po zapisie zdarzenia w `care_events`, `consultation_events`, wybranych wpisów audytu oraz historii kontaktu kontrolnego. Wszystko odbywa się w transakcji źródłowej operacji. Błąd zapisu powiadomienia wycofuje zmianę; źródło i skrzynka nie mogą rozminąć się przez częściowy zapis. Nie wykonujemy w tej transakcji połączenia do żadnego zewnętrznego dostawcy.

Unikalny klucz `(recipient_id, source_key)` chroni przed ponownym dodaniem tego samego zdarzenia. Kontrolowane operacje źródłowe same rozpoznają dokładne ponowienia. Helpery tworzenia powiadomień są prywatne — sesja użytkownika nie może podać odbiorcy, wywołać rozsyłania ani pisać bezpośrednio do tabeli.

RLS pozwala odczytać wyłącznie własną skrzynkę. Administrator również nie ma dostępu do skrzynki drugiego administratora ani klienta. Wiadomości przeznaczone dla zespołu znikają z dostępnego zbioru po utracie roli; opiekun musi nadal mieć dostęp do wskazanego psa. Funkcja oznaczenia jako przeczytane sprawdza tę samą regułę, odrzuca całą mieszaną paczkę cudzych i własnych identyfikatorów, zachowuje pierwszy czas odczytu i nie zmienia innych danych.

Adres docelowy jest wyznaczany na serwerze z kategorii, identyfikatora sprawy i aktualnej roli. Pola `href`, `next` czy odbiorca podane przez formularz nie sterują przekierowaniem. Powiadomienie o wpłacie prowadzi do konkretnego wpisu historii finansów; odpowiedź o postępach do ekranu jej przeglądu.

Instalacja nie zapełnia skrzynki zdarzeniami historycznymi. Pierwsze wpisy pochodzą z kolejnych operacji. Moduł nadal zakłada jedną praktykę z istniejącymi globalnymi rolami — nie wprowadza izolacji wielu firm.

## Sprawdzenie i kolejne kroki

Dodano 33 testy: rzeczywiste migracje i operacje w PGlite, fan-out dla obu ról, brak prywatnych treści, ponowienia, odwołania i wpłaty, wycofanie całej publikacji po błędzie, izolacja odbiorców, utrata roli/własności, niedozwolone zapisy, jawne oznaczanie oraz stronicowanie 1005 wpisów z jednakowymi czasami. Testy serwerowych formularzy i renderowania obejmują przekierowania, liczniki, wybór tylko widocznych wiadomości, stany puste, nieaktualny kursor i brak zmian przy samym renderowaniu.

Pierwotna weryfikacja z 19.09.2026: **383 testy w 36 plikach**, ESLint, kontrola typów i kompilacja poprawne. Na tamtym etapie sprawdzenie renderowania było testem treści i kontrolek, bez działającego lokalnego Auth/PostgREST. Późniejsze rzeczywiste próby obu ról i niezależnych połączeń opisuje [stan produktu](PRODUCT-STATUS.md).

Przypomnienia o określonej porze mają teraz osobny [moduł i trwałą kolejkę prób](REMINDERS-MODULE.md), dodane lokalnie migracją `202609190005`. Obsługa zewnętrznego dostawcy i poczta po konfiguracji SMTP pozostają do wykonania. Bieżąca skrzynka działa niezależnie od flagi `AUTH_EMAIL_ENABLED` i nie stanowi uruchomienia e-maili, WhatsApp ani powiadomień push.

Powiadomienie o nowym planie otwiera teraz [konkretną publikację](CONSULTATION-CARE.md), zachowując dostęp do treści wskazanej przez zdarzenie również po opublikowaniu nowszego planu.

## Kursy

Migracja `202610030001` dodaje transakcyjne wiadomości z historii kursu. Nowe zgłoszenie trafia do aktualnego zespołu. Przyjęcie, rezerwa, odmowa, rezygnacja, odwołanie cyklu, obecność i zmiany rozliczenia trafiają do opiekuna zgłoszenia oraz pozostałych kont zespołu. Autor własnej czynności jest pomijany. Przełożenie i odwołanie spotkania trafia do aktywnych zgłoszeń: oczekujących, przyjętych i rezerwowych; zakończenie spotkania lub kursu — do przyjętych uczestników. Odwołanie całego cyklu tworzy jedną wiadomość dla każdego aktywnego zgłoszenia, bez dodatkowego komunikatu o każdym odwołanym spotkaniu.

Wpłaty i częściowe zwroty kursowe mają własne rodzaje wiadomości. Nie powielają ogólnych powiadomień wpłaty z audytu. Dokładne ponowienia decyzji, przełożenia lub wpisu finansowego nie dopisują wiadomości. Błąd zapisu u jednego odbiorcy wycofuje całą zmianę źródłową, pozostałe wiadomości i nowe przypomnienia.

Wiadomość zachowuje identyfikatory cyklu, zgłoszenia i ewentualnego spotkania. Otwiera wybrane zgłoszenie nawet poza pierwszą stroną listy; zmiana spotkania i przypomnienie przewijają do tego spotkania, a finanse — do rozliczenia. Dokładne miejsce i aktualny stan są pobierane ze źródłowego ekranu z jego ograniczeniami dostępu.

Odbiorcą pozostaje opiekun zapisany przy zgłoszeniu, również po późniejszej zmianie opiekuna psa. Licznik, lista i oznaczanie przeczytania stosują tę samą regułę dostępu oraz wymagają aktualnej roli klienta. Nowy opiekun nie otrzymuje wcześniejszych rozliczeń ani wiadomości. Jeżeli poprzednie konto nie może już odczytać profilu psa, lista pokazuje „Pies zgłoszenia”, bez udostępniania nowej prywatnej nazwy profilu.

Dowody odbioru: [powiadomienia i przypomnienia kursów](LOCAL-DEVELOPMENT.md#powiadomienia-i-przypomnienia-kursów). Poczta, WhatsApp i push nadal pozostają oddzielnym, odłożonym zakresem.

## Indywidualny fitness

Migracja `202610030006` dodaje wiadomości z niezmiennej historii pakietu fitness. Zgłoszenie trafia do zespołu; decyzje, rezygnacja, wznowienie, terminy i ich odwołanie, obecność/korekta/spotkanie zastępcze oraz rozliczenia trafiają do pierwotnego opiekuna pakietu i pozostałych prowadzących. Autor własnego działania jest pomijany. Ponowienie tego samego zapisu nie tworzy drugiej wiadomości. Wpłaty i częściowe zwroty mają własne kategorie bez powielania ogólnej wiadomości z audytu.

Kontekst `fitness_package_id` i opcjonalny `fitness_session_id` jest zwracany przez `notification_feed` oraz sprawdzany przed oznaczeniem i otwarciem wiadomości. Identyfikator spotkania musi należeć do tego pakietu. Spotkania otwierają właściwą kartę i kotwicę spotkania; wpłaty, uzgodnienie i zwroty — rozliczenie całego pakietu. Treści prywatne i pieniądze pozostają w źródłowym module, bez ich kopiowania do skrzynki.

RLS, pełny licznik i operacja przeczytania zachowują tę samą regułę pierwotnego opiekuna pakietu oraz aktualnej roli. Nowy opiekun psa nie przejmuje wcześniejszej skrzynki. Odczyt mieszanej listy własnych i cudzych identyfikatorów nie oznacza żadnej wiadomości. Błąd skrzynki wycofuje także źródłową zmianę fitness. Migracja `202610030007` dodaje terminowe przypomnienie każdego umówionego spotkania; obowiązują wspólne ponowienia, historia i wycofanie nieaktualnego źródła. Skrzynka przypomina, aby otworzyć aktualny termin i miejsce. Odczyt listy i licznika może ponowić sporadyczne HTTP 502 najwyżej raz; trwały błąd nie jest pustą skrzynką. [Zakres, rzeczywiste E2E i dowody bazy](FITNESS-MODULE.md).
