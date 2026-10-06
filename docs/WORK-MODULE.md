# Sprawy prowadzącej i kontakty kontrolne

Stan: implementacja i rzeczywiste próby lokalne, 03.10.2026. Migracje `202609190002_work_queue_followups.sql` i `202610030006_fitness_notifications_work.sql` nie zostały wykonane w chmurze. Produkcja pozostaje bez zmian.

## Proces

Panel **Do zrobienia** (`/admin/work`) zbiera sześć rodzajów spraw: kontakty kontrolne, nowe zgłoszenia konsultacji, nieprzeczytane odpowiedzi o postępach, profile psów do oceny, oczekujące zgłoszenia na przyszłe spacery i pakiety PSI FITNESS wymagające działania. Każda sprawa prowadzi bezpośrednio do miejsca obsługi. Odczyt listy niczego nie oznacza jako zakończone; zmiana w źródłowym module usuwa rozwiązaną sprawę z kolejki.

Kontakty po terminie oraz na dziś pojawiają się przed pozostałymi sprawami. Kontakty na późniejsze dni są za bieżącymi zgłoszeniami. Listę można filtrować; ma po 20 pozycji na stronę. Liczniki dotyczą całej kolejki, także jeśli odpowiedzi jest więcej niż limit jednej odpowiedzi API. Pulpit pokazuje pierwsze cztery sprawy i odsyła do pełnej listy.

Publikacja planu z datą kontaktu tworzy otwarte zadanie dla tego psa. Sam szkic nie tworzy zadania. Nowa publikacja zastępuje poprzedni otwarty kontakt, także jeśli nowy plan nie ma daty; historia wcześniejszego kontaktu pozostaje dostępna. Zadanie ukończone lub odwołane zachowuje swój status. Migracja istniejących danych bierze wyłącznie najnowszą publikację każdego psa — nie wznawia kontaktów z wcześniejszych zaleceń.

W karcie kontaktu prowadząca może:

- zakończyć kontakt i zapisać ustalenia;
- przełożyć datę, podając powód;
- odwołać kontakt z powodem;
- ponownie zaplanować zakończony lub odwołany kontakt, jeżeli dotyczy aktualnego planu.

Ręcznie wybrana data musi być dzisiejsza lub przyszła według czasu Warszawy. Kontakt to zadanie na dzień, a nie rezerwacja konkretnej godziny w kalendarzu. Nie jest po cichu przesuwany przy zmianie konsultacji: data kontaktu pochodzi z planu i jest niezależną decyzją prowadzącej.

Opiekun widzi aktualny status i, jeśli zadanie jest otwarte, bieżącą datę. Opublikowana treść planu zachowuje pierwotną datę z etykietą „Termin kontaktu zapisany przy publikacji”. Przegląd planów używa aktualnej daty otwartego zadania. Zamknięcie usuwa ją z przeglądu, ale nie zmienia archiwalnych zaleceń.

Archiwum kontaktów (`/admin/work/follow-ups`) obejmuje wszystkie statusy. Odnośnik w karcie psa prowadzi do historii tylko tego psa, także jeśli najnowszy plan nie przewiduje kontaktu. Odpowiedź opiekuna ma osobną stronę (`/admin/work/progress/[id]`), dzięki czemu stary wpis nadal da się otworzyć z kolejki, niezależnie od stronicowania historii psa.

## Prywatność i spójność

`care_follow_ups` zawiera datę i status dostępne właściwemu opiekunowi oraz zespołowi. Prywatne notatki są wyłącznie w `care_follow_up_history`, którego odczyt dopuszcza tylko rola `admin`. Edycja obu tabel bezpośrednio z sesji aplikacji jest zablokowana; klient nie może też wywołać operacji zespołu ani odczytać jego kolejki.

Zapis kontroluje wersję formularza, blokuje najpierw psa, potem zadanie, a status, historię i audyt zmienia w jednej transakcji. Publikacja planu używa tej samej kolejności blokad. Dokładne powtórzenie przyjętego zapisu zwraca potwierdzoną wersję bez kolejnej historii. Nieaktualna sprzeczna zmiana jest odrzucana. Zakończonego kontaktu należącego do starszej publikacji nie można wznowić.

Formularz zachowuje notatkę po błędzie. Numer wersji posuwa się dopiero po potwierdzeniu zapisu, więc odświeżenie danych nie nadaje starej edycji nowej wersji. Sukces czyści notatkę i udostępnia działania właściwe dla nowego statusu.

## Weryfikacja i pozostała praca

19.09.2026: **299 testów w 27 plikach**, ESLint i kompilacja Next.js z TypeScript zakończyły się poprawnie. Build używał jawnych lokalnych adresów i zastępczego publicznego klucza. Moduł pracy ma 14 testów bazy i 11 testów operacji/formularzy. Obejmują migrację istniejących planów, publikację i zastępowanie zadań, odwołanie i wznowienie, zachowanie oryginalnych zaleceń, prywatność, ponowienia, konflikt wersji, liczniki dla 1005 odpowiedzi oraz wycofanie zmian po błędzie zapisu historii.

Wymienione historyczne testy SQL używają PGlite i uproszczonych schematów Auth/Storage. Same nie dowodzą działania pełnego Supabase ani rzeczywistej współbieżności wielu niezależnych połączeń. Poniższe późniejsze próby uzupełniają ten zakres.

02.10.2026: dwa nowe rzeczywiste E2E w `tests/e2e/care-followups.spec.ts` sprawdzają logowanie obu ról, publikację ogólnego planu, przełożenie, zakończenie, odwołanie i wznowienie kontaktu, zastąpienie otwartego zadania planem bez daty oraz archiwum. Opiekun widzi aktualną datę i status, a pierwotne zalecenia zachowują datę publikacji. Powiadomienia, przypomnienia, prywatna historia, dokładne powtórzenie zapisu i odmowy bezpośrednich operacji API mają niezależne asercje. Otwarta stara karta nie nadpisuje terminu ani notatki. Celowo wstrzymane skrypty potwierdzają, że pola są nieaktywne przed gotowością formularza.

Drugi scenariusz wysyła odpowiedź przygotowaną przed publikacją nowszego planu. Wpis zachowuje wcześniejszy plan i wszystkie trzy pola, a następna odpowiedź otrzymuje nowy identyfikator i bieżącą wersję zaleceń. Otwarcie odpowiedzi z kolejki lub powiadomienia nie oznacza jej jako przeczytanej. Jawny przegląd usuwa tylko tę jedną sprawę; ponowienie nie tworzy kolejnego audytu ani wiadomości dla opiekuna.

Próby wykryły dwie poprawione usterki interfejsu: publikacja pierwszego ogólnego planu zwijała formularz i ukrywała potwierdzenie, a odmowa przełożenia kontaktu resetowała wizualnie listę działań do zakończenia kontaktu. Edytor planu zachowuje teraz stan rozwinięcia, a formularz kontaktu blokuje automatyczny reset pól. Po udanym zapisie nadal czyści prywatną notatkę i pokazuje działania odpowiednie dla nowego statusu.

Na lokalnej kompilacji z poprawkami formularzy przeszło **18/18 E2E we wspólnym przebiegu** (3,2 minuty). Osobny zestaw PostgreSQL zakończył się wynikiem **70/70 prób w 9,19 s**, z 72 potwierdzonymi oczekiwaniami między konkretnymi procesami bazy. Czternaście nowych przypadków obejmuje powtórzenie i konflikt przełożenia, zakończenie konkurujące z przełożeniem, publikację konkurującą z zamknięciem lub wznowieniem starego kontaktu, powtórzenia i konflikty odpowiedzi, dwa przeglądy oraz publikację konkurującą z odpowiedzią do poprzedniego planu. Sprawdzono historię, audyt, właściwe wiadomości i aktualne przypomnienie. Własne dane testowe usunięto. Nie dodawano migracji ani nie uruchamiano procesu wysyłkowego poza lokalnymi testami.

Po końcowym usunięciu drugiego odnośnika do tego samego planu, nowej kompilacji i uruchomieniu podglądu ponownie przeszły **2/2 E2E kontaktów i odpowiedzi w 17,9 s**. Odnośnik pozostały w karcie odpowiedzi prowadzi do właściwego psa z widocznym stanem przeglądu obu wpisów. Siedem zrzutów 320/390/1440 px sprawdzono wizualnie; końcową kartę odpowiedzi sprawdzono ponownie po uproszczeniu. Zrzuty czekają na właściwy widok i gotowe formularze, a przed pełnym przechwyceniem przywracają początek strony, aby stały nagłówek nie zasłaniał historii. Build z TypeScript, ESLint i kontrola różnic przeszły. Końcowy odczyt potwierdził 29 migracji, pięć kont, brak psów i kont nowych prób, 17 aktywnych usług po robocze 100 zł oraz gotowy manifest zgodny z działającym podglądem. Zestaw 580 testów jednostkowych, pomiar 50 kont i odtworzenie kopii pozostają wcześniejszymi osobnymi przebiegami.

Te scenariusze nie stanowią pełnego odbioru pozostałych filtrów kolejki, wszystkich kombinacji zapisu ani odporności procesu przypomnień na restart. Pozostała praca jest zapisana w stanie całego produktu.

## Pakiety fitness i odczyt listy

Jeden wpis przypada na wymagający obsługi pakiet. Powód obejmuje rozpatrzenie zgłoszenia, pozostałe terminy, zapis obecności po spotkaniu, zakończenie obsłużonego pakietu, uzgodnienie należności po rezygnacji albo odnotowanie uzgodnionego zwrotu. Zmiana opiekuna aktywnego pakietu wymaga uzgodnienia dalszej obsługi. Przyszłe spotkania z pełnym zestawem terminów nie zajmują kolejki. Zaległa obecność ma datę spotkania w czasie Warszawy i jest uwzględniona w liczniku spraw po terminie. Zakończenie pakietu pozostawia ewentualną niezapłaconą należność w finansach.

Niepoprawna odpowiedź listy lub liczników jest jawnym błędem pobrania; nie udaje pustej kolejki ani zerowej liczby spraw. Diagnostyka rozróżnia listę, liczniki i odrzucone połączenie, zapisując tylko nazwę operacji, dozwolony kod i stan HTTP, bez treści błędu ani danych użytkowników. Rozszerzona próba zarejestrowała sporadyczne HTTP 502. Cztery odczyty list/liczników pracy i skrzynki mogą ponowić wyłącznie taką odpowiedź, najwyżej raz; zapisów i innych błędów to nie dotyczy. 480 odczytów dwóch ról przeszło, w tym dwa skuteczne ponowienia po 502. Następnie przeszło 37/37 pełnych E2E aplikacji przed rozszerzeniem przypomnień fitness. To nie jest nowy odbiór 50 użytkowników ani wyjaśnienie źródłowej przyczyny bramy. [Zakres i aktualne dowody fitness](FITNESS-MODULE.md).

Przełożenie, wznowienie i odwołanie kontaktu tworzy teraz krótkie [powiadomienie w aplikacji](NOTIFICATIONS-MODULE.md) dla opiekuna. Prywatna notatka nie trafia do komunikatu. Przeczytanie powiadomienia nie zamyka zadania. Osobny [moduł przypomnień](REMINDERS-MODULE.md) obsługuje terminowy komunikat dla zespołu o 9:00 w dniu kontaktu, trwałą kolejkę, próby i ręczne ponowienia. E-mail i WhatsApp pozostają odłożone. [Pełny zakres i warunki odbioru produktu](MVP-50.md), [bieżący stan prac](PRODUCT-STATUS.md).

## Odbiór sześciu filtrów i stron — 03.10.2026

`tests/e2e/work-queue.spec.ts` przeszedł na rzeczywistych lokalnych sesjach i kompilacji. Własny zestaw zawiera 23 nowe profile oraz po jednym zgłoszeniu konsultacji, fitness i spaceru, kontakt po terminie i odpowiedź o postępach. Wszystkie sześć filtrów otwiera właściwy rodzaj sprawy; globalne liczniki pozostają zgodne na drugiej stronie. Powrót odtwarza pierwszy zestaw bez powielenia pozycji, a zmiana filtra zaczyna od strony pierwszej. Odnośniki prowadzą do konkretnego zgłoszenia lub spotkania. Samo przeglądanie nie zamyka spraw.

Opiekun nie uruchamia funkcji listy ani przez API. Pełny układ 320/390/1440 px mieści się w ekranie; zrzut telefonu 390 px sprawdzono wizualnie. Próba kończy się usunięciem wyłącznie własnych danych. Dalsze kombinacje awarii są rozwojem testów, a nie brakującym filtrem lokalnego MVP.
