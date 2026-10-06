# Przypomnienia i kolejka prób

Stan lokalny: 03.10.2026. Moduł `src/modules/reminders/`, migracje `202609190005_reminders.sql` i `202610030001_course_notifications.sql` i `202610030007_fitness_reminders.sql`, lokalny proces `scripts/reminders.mjs`. Brak wdrożenia, migracji w chmurze i wiadomości poza aplikację.

## Zasady robocze

- Opiekun otrzymuje przypomnienie **24 godziny przed potwierdzoną konsultacją** oraz **24 godziny przed spacerem, na który jego pies został przyjęty**. Oczekujący i rezerwowi uczestnicy nie dostają takiego przypomnienia.
- Zapis przyjęty później niż 24 godziny przed spotkaniem trafia do następnej próby od razu. Po rozpoczęciu spotkania przypomnienie zostaje wycofane — proces uruchomiony po długiej przerwie nie rozsyła nieaktualnych terminów.
- Otwarty kontakt kontrolny przypomina wszystkim aktualnym kontom prowadzącej/administratora **o 9:00 w dniu kontaktu, Europe/Warsaw**. Uwzględnia czas letni i zimowy. To zadanie prowadzącej, nie obietnica wizyty opiekuna o określonej godzinie.
- Nadal otwarty, zaległy kontakt zostanie przypomniany po wznowieniu procesu. Jedno przypomnienie nie powtarza się codziennie i nie zamyka zadania. Sprawa pozostaje w „Do zrobienia”.
- Parametry 24 godziny i 9:00 są na razie regułami modułu, bez edytora harmonogramów. Edytor cen usług działa niezależnie.

Zmiana terminu wycofuje oczekujące zadanie i tworzy nowe. Odwołanie, zakończenie lub zastąpienie kontaktu nowym planem usuwa jego aktywne przypomnienie. Dostarczone wiadomości pozostają historycznymi wpisami; po zmianie terminu kolejne przypomnienie dotyczy już nowego terminu. Aktualny stan znajduje się pod przyciskiem otwierającym sprawę.

## Panel prowadzącej

**Powiadomienia → Przypomnienia** (`/admin/reminders`) pokazuje pełne liczniki, filtry stanów, listę po 20 pozycji, szczegóły i historię prób. Stronicowanie tego panelu jest numerowane; przy napływie zmian warto odświeżyć początek listy. Osobista skrzynka powiadomień zachowuje własne stabilne stronicowanie po kursorze.

- **Zaplanowane**: czekają na swój czas i uruchomienie procesu.
- **Ponowna próba**: po błędzie lub po ręcznym wznowieniu.
- **Wymagają uwagi**: pięć nieudanych prób w bieżącym cyklu; prowadząca może ponowić.
- **W skrzynce**: wiadomość zapisana w aplikacji. Nie jest to potwierdzenie przeczytania, e-maila ani powiadomienia push.
- **Wycofane**: sprawa lub termin są nieaktualne.

Przycisk sprawdzenia obsługuje najwyżej 50 wymagalnych zadań. Nie wykonuje zadań przyszłych. Przy większej kolejce należy ponowić sprawdzenie albo pozostawić uruchomiony lokalny proces. Odczyt strony nie dostarcza wiadomości i nie zmienia żadnego statusu.

Czas ostatniego sprawdzenia jest zapisywany także dla pustej kolejki. Panel nie nazywa procesu działającym tylko dlatego, że kiedyś wykonał próbę. Brak możliwości pobrania stanu jest błędem, nie zerowym licznikiem.

Po ręcznym wznowieniu aplikacja otwiera szczegóły zadania i pokazuje trwałe potwierdzenie „czeka na ponowną próbę”. Potwierdzenie wynika z aktualnego stanu kolejki, więc nie ginie po usunięciu wiersza z filtra błędów. Po dostarczeniu zastępuje je stan „W skrzynce” i kolejna pozycja historii. Test telefonu wykrył znikające potwierdzenie oraz przycisk ucięty przez kartę; poprawiono oba problemy.

## Trwałość i uprawnienia

Wyzwalacze źródłowych tabel synchronizują `reminder_jobs` w tej samej transakcji co termin, zapis lub kontakt. Zadanie zawiera identyfikatory, rodzaj, generację i czasy; nie kopiuje notatek, zaleceń, linków do spotkań ani adresów. Odbiorcy są ustalani z aktualnych rekordów dopiero podczas dostarczenia.

Przed dostarczeniem proces blokuje źródło zgodnie z kolejnością operacji danego modułu, a następnie zadanie, z `SKIP LOCKED`. Zajęte rekordy odkłada do następnego sprawdzenia. Ponownie sprawdza termin i status. Wstawienie wszystkich wiadomości dla zadania, zapis sukcesu i historii próby są atomowe. Błąd jednego odbiorcy wycofuje dostarczenie do pozostałych odbiorców tego zadania. Klucz `reminder:<id zadania>` jest dodatkowo unikalny dla odbiorcy.

Po niepowodzeniu kolejne odstępy wynoszą 1, 5, 15 i 60 minut. Piąta nieudana próba zatrzymuje zadanie. Ręczne wznowienie uruchamia nowy cykl maksymalnie pięciu prób, zachowuje cały wcześniejszy licznik/historię i zapis audytu. Powtórzenie tego samego polecenia jest bezskutkowe. W dzienniku pozostają bezpieczne kody `delivery_failed` i `source_changed`, bez treści błędu SQL.

Tabele kolejki, historia i stan procesu są czytelne wyłącznie dla zespołu. Bezpośredni zapis z sesji użytkownika jest zablokowany. Prywatne helpery nie są dostępne ani dla klienta, ani dla administratora przez API. Publiczne operacje obsługi panelu wymagają roli administratora w bazie i w aplikacji. Oddzielna funkcja `worker_process_due_reminders` jest dostępna tylko dla `service_role`; operacje przypomnień w panelu korzystają z sesji prowadzącej, a klucz procesu nie trafia do przeglądarki.

Migracja przygotowuje zadania dla przyszłych, kwalifikujących się spotkań oraz otwartych kontaktów. Sama niczego nie dostarcza. Nadal obowiązuje model jednej praktyki i globalnych ról istniejącego pilota.

## Uruchomienie lokalne

Po uruchomieniu rzeczywistego lokalnego Supabase i zastosowaniu migracji:

```sh
pnpm local:env
pnpm local:reminders
# albo proces działający do zamknięcia terminala / Ctrl+C:
pnpm local:reminders:watch
```

Tryb `watch` sprawdza kolejkę co 30 sekund po zakończeniu poprzedniej próby. Każde żądanie ma limit czasu 25 sekund. Czyta wyłącznie `.env.test.local`, odrzuca zdalny adres, osadzone dane uwierzytelniające, dodatkową ścieżkę, parametry i przekierowanie HTTP. Nie korzysta z produkcyjnej `.env.local`. Loguje jedynie liczniki, nie klucze, rekordy ani surowe odpowiedzi serwera.

Nie zainstalowano usługi systemowej ani automatyzacji uruchamianej bez użytkownika. Zamknięty proces nie dostarcza przypomnień; trwała kolejka pozostaje w bazie. Harmonogram docelowego hostingu będzie osobnym elementem wdrożenia po lokalnym odbiorze.

## Weryfikacja i granice

34 testy modułu obejmują migracje i zachowanie w PGlite, oba typy spotkań, czas w Polsce, odwołania, przełożenia, historię po dostarczeniu, spóźnione uruchomienie, kontakty zaległe, ponowienia, wycofanie wszystkich odbiorców po błędzie, uprawnienia worker/admin/client, formularze, odczyt panelu, renderowanie i ochronę lokalnego procesu przed kontaktem z chmurą. Dodatkowy test potwierdza trwałą informację po ręcznym wznowieniu i odróżnia ją od automatycznego ponowienia po błędzie.

Pełny zestaw po zmianie: **416 testów w 41 plikach**, ESLint, kontrola typów i build z jawną lokalną konfiguracją zakończone poprawnie.

02.10.2026 rzeczywisty test `tests/e2e/reminders.spec.ts` przeszedł z lokalnym Auth, PostgREST, PostgreSQL i skompilowaną aplikacją. Uruchamia dostarczony proces `scripts/reminders.mjs --once`, zamiast podstawiać odpowiedź serwera. Obejmuje:

- zgłoszenie i przełożenie konsultacji: wcześniejsze generacje wycofane, przyszłe niedostarczone, aktualna wiadomość trafia wyłącznie do opiekuna i otwiera właściwą konsultację;
- prawdziwe tokeny sesji: opiekun nie odczytuje kolejki ani nie uruchamia dostarczania; także prowadząca nie może wywołać prywatnego wejścia procesu;
- dwie niezależne transakcje `service_role`: druga pomija zajęte źródło, czeka na zapis wspólnego znacznika sprawdzenia, a wynik zawiera jedną wiadomość i jedną próbę;
- rzeczywisty brak odbiorcy przez czasowe usunięcie wyłącznie roli fikcyjnego opiekuna: pięć błędów, brak wiadomości, odstępy 1/5/15/60 minut, bezpieczny kod błędu; upływ oczekiwania przyspieszono tylko w tym zadaniu;
- wznowienie z filtra „Wymagają uwagi” przez panel telefonu, trwałe potwierdzenie, skuteczna szósta próba i brak dalszego przycisku ponawiania;
- wycofanie przypomnienia po odwołaniu spaceru oraz dostarczenie zaległego kontaktu wyłącznie aktualnemu zespołowi;
- powtórzenie procesu bez dodatkowej wiadomości lub próby dla już dostarczonego zadania.

Próba blokuje wcześniejsze zadania lokalnej bazy na czas każdego wywołania i sprawdza, że ich treść i status nie zmieniły się. Tworzy własne fikcyjne konta i usuwa wszystkie swoje rekordy po zakończeniu; znacznik ostatniego uruchomienia procesu odzwierciedla rzeczywiste wywołanie. Sprawdzono widoki przy 320, 390, 768 i 1440 px, w tym pełną widoczność przycisku. Nie zainstalowano usługi w tle ani harmonogramu.

Restart rzeczywistego procesu dla przypomnień fitness oraz większa kolejka i atomowe wycofanie wielu odbiorców przeszły osobne odbiory opisane niżej. Pozostają granice innych awarii i zewnętrzna wysyłka; nie są zastępowane wynikiem próby lokalnej.

SMTP, obsługa zewnętrznego dostawcy, e-mail i WhatsApp pozostają odłożone. Ta kolejka dostarcza atomowo do własnej bazy, więc podłączenie poczty będzie wymagało osobnego adaptera, potwierdzeń dostawcy i zabezpieczenia ponowień po niejednoznacznej odpowiedzi sieciowej.

## Przypomnienia spotkań kursowych

Przyjęte zgłoszenie ma osobne przypomnienie **24 godziny przed każdym przyszłym spotkaniem**. Źródłem jest trwała para spotkanie–zgłoszenie w prywatnej tabeli `course_reminder_sources`. Oczekujący, rezerwowi, odrzuceni i osoby po rezygnacji nie mają aktywnych przypomnień. Po rozpoczęciu spotkania proces nie dostarcza jego nieaktualnej wiadomości. Zamknięcie zapisów na cykl nie wycofuje przypomnień przyjętych uczestników.

Zmiana godziny lub szczegółów spotkania wycofuje jego oczekującą generację i planuje nową; inne spotkania zachowują swoje zadania. Rezygnacja wycofuje przyszłe zadania zgłoszenia, a odwołanie spotkania lub cyklu — jego zadania. Dostarczone wiadomości pozostają historią i otwierają aktualny stan. Wpłata, częściowy zwrot i uzgodnienie należności nie zmieniają generacji uczestnictwa ani nie tworzą nowego przypomnienia.

Synchronizacja ogranicza się do zmienionego spotkania lub zgłoszenia. Tylko zmiana dostępności całego cyklu wymaga odczytu wszystkich jego źródeł. Przy 50 uczestnikach i pięciu spotkaniach zachowuje 250 zadań; test partii 13 + 13 + 24 dostarcza dokładnie 50 pierwszych spotkań i pozostawia 200 przyszłych, bez powtórzeń.

Proces blokuje cykl → spotkanie → zgłoszenie → zadanie, zgodnie z operacjami kursu. Zajęte źródło odkłada przez `SKIP LOCKED`. Odbiorcę ustala z niezmiennego opiekuna zgłoszenia i aktualnej roli podczas dostarczania. Panel prowadzącej opisuje rodzaj „Przed spotkaniem kursu”, a odnośnik prowadzi do konkretnego spotkania i zgłoszenia. Dotychczasowe ponowienia, historia i uprawnienia procesu działają również dla kursów.

Rzeczywisty test `tests/e2e/course-notifications.spec.ts` potwierdza pominięcie trwającego przełożenia, dwa procesy bez duplikatu, oczekiwanie rezygnacji na dostarczanie oraz pominięcie trwającej rezygnacji. W pierwszej kolejności dostarczenie może zostać zatwierdzone przed rezygnacją i pozostaje wtedy historią. W drugiej kolejności zatwierdzona rezygnacja nie pozostawia dostarczenia ani oczekujących zadań. [Zakres i końcowe wyniki](LOCAL-DEVELOPMENT.md#powiadomienia-i-przypomnienia-kursów).

## Przypomnienia indywidualnych spotkań fitness

Każde przyszłe umówione spotkanie aktywnego pakietu ma własne przypomnienie 24 godziny wcześniej. Przy późniejszym ustaleniu terminu czeka od razu na proces, a po rozpoczęciu spotkania nie jest dostarczane. Przełożenie, rezygnacja, zakończenie i zmiana opiekuna wycofują nieaktualne zadania; wpłaty i zwroty nie zmieniają generacji. Dostarczone wiadomości są historią pierwotnego opiekuna. Nowy opiekun nie przejmuje ich ani dawnego pakietu.

Proces wymaga bieżącej roli klienta i zgodności opiekuna psa ze zgłoszeniem. Blokuje psa → pakiet → spotkanie → zadanie, pomijając zajęte źródła. Dwa procesy nie dostarczają tej samej wiadomości; wspólny zapis ostatniego stanu procesu może serializować zakończenie ich transakcji. Sukces i skrzynka zatwierdzają się atomowo. Panel i powiadomienie prowadzą do konkretnego spotkania, bez kopiowania miejsca do kolejki.

Odbiór reguł: 849/849 testów, w tym dziesięć nowych prób fitness i widok przypomnienia; 19/19 prób odrębnej bazy z 15 zależnościami blokad, błędem dostarczenia i nowym połączeniem po sukcesie. Nowe połączenie nie jest dowodem restartu całego uruchomionego procesu. [Dokładny zakres i najnowsze wyniki](FITNESS-MODULE.md).

## Przerwanie i restart rzeczywistego procesu — 03.10.2026

```sh
pnpm local:reminders-test
```

`tests/local/reminder-lifecycle.mjs` tworzy własne fikcyjne konta, pakiet i trzy terminy fitness w rzeczywistym lokalnym Auth/API/PostgreSQL. Uruchamia dostarczony `scripts/reminders.mjs` jako niezależne procesy, bez podmieniania odpowiedzi API. Wcześniejsze zadania kolejki pozostają zablokowane i są porównywane przed i po próbie. Test kończy własne procesy i usuwa tylko własne dane; nie instaluje usługi ani harmonogramu.

Raport `def8acfa-a115-4aa8-808f-87fa1be1def1` ma `status=ready` i `cleanup=true`. Potwierdzono trzy granice:

1. **SIGKILL przy niezatwierdzonym rzeczywistym żądaniu.** Obserwator potwierdził oczekiwanie procesu PostgREST na blokadę zapisu stanu. W innym połączeniu zadanie, historia i skrzynka nie zawierały jeszcze dostarczenia. Po zabiciu klienta i zwolnieniu blokady serwer zakończył transakcję. Nowy proces odczytał jej stan i nie utworzył drugiej wiadomości ani próby.
2. **SIGKILL po zatwierdzeniu, przed odczytaniem wyniku przez CLI.** Pomocnik testowy wstrzymuje rzeczywistą odpowiedź `fetch` po potwierdzonym HTTP 200. Przekazuje rodzicowi wyłącznie stan i liczniki; niczego nie dopisuje do bazy ani odpowiedzi. Osobny odczyt potwierdził dostarczenie przed zabiciem procesu. Nowy, nieinstrumentowany proces zachował dokładnie ten sam wpis zadania, wiadomości i historii próby.
3. **SIGTERM trybu `watch` i nowe uruchomienie.** Pierwsze rzeczywiste dostarczenie zakończyło się poprawnie. Zatrzymanie podczas oczekiwania zakończyło proces kodem 0 w 18 ms, bez następnego wywołania. Nowy proces nie dostarczył tej wiadomości ponownie.

Każde z trzech spotkań ma jedną wiadomość dla właściwego opiekuna i jedną próbę zakończoną sukcesem. Po sprzątaniu wszystkie wcześniejsze tabele `public` mają zgodne liczby i skróty wierszy z wyjątkiem `reminder_worker_state`: znacznik celowo pokazuje rzeczywiste uruchomienia. Dokładne identyfikatory wcześniejszych kont są zachowane.

Pierwsze próby zatrzymały się przy odczycie obserwatora: SQL `NULL` nie tworzył linii oczekiwanej przez pomocnik JSON. Test jawnie zwraca JSON `null`; nie zmieniano procesu, funkcji ani migracji produktu. Nieudane próby również potwierdziły sprzątanie i zachowanie danych. Ten odbiór dotyczy wymienionych granic procesu i trzech zadań fitness, nie awarii bazy, dużej kolejki, wszystkich rodzajów spotkań czy zewnętrznej wysyłki.

## Kolejka 50 opiekunów i pełne wycofanie wielu odbiorców — 03.10.2026

Polecenie `pnpm local:reminders-queue-test` uruchamia `tests/local/reminder-queue.mjs` na rzeczywistym lokalnym Auth, API i procesie. Raport `e831ba5f-15a1-42cd-8ae4-1fc1cea4b988` ma `status=ready` i `cleanup=true`; próba trwała 15:39:35–15:39:47 UTC, na schemacie 48 migracji.

- 50 fikcyjnych opiekunów loguje się przez Auth i zgłasza po jednym psie na pięć spotkań kursu. Powstaje **250 wymagalnych zadań**. Pięć rzeczywistych procesów dostarcza partie po 50, z pojedynczą udaną próbą i wiadomością dla każdego zadania.
- Każda z 50 sesji odczytuje dokładnie pięć właściwych spotkań i nie odczytuje skrzynki sąsiada. Prowadząca nie przejmuje prywatnych przypomnień opiekunów. Powtórzenie procesu nie zmienia wcześniej dostarczonego zbioru.
- Kontakt kontrolny ma trzech aktualnych odbiorców zespołu. Próbny wyzwalacz, ograniczony do jednego własnego zadania i drugiego odbiorcy, potwierdza wewnątrz transakcji istnienie pierwszej wiadomości. Obserwator widzi rzeczywiste oczekiwanie serwera na blokadę; inna sesja nie widzi częściowego dostarczenia.
- Celowy błąd drugiego odbiorcy **cofa całą wiadomość**, zapisując jedno ponowienie i wyłącznie bezpieczny kod `delivery_failed`. Po usunięciu własnego wyzwalacza następna próba dostarcza jedną wiadomość każdemu z trzech odbiorców. Kolejne uruchomienie niczego nie powiela, a 250 wcześniejszych wiadomości kursu pozostaje bez zmian.
- Wcześniejsze zadania były zablokowane i porównane. Wszystkie własne konta, psy, kurs, plan i próbny wyzwalacz zostały usunięte. Skróty wszystkich wcześniejszych tabel `public` oraz dokładne identyfikatory kont i lista migracji są zachowane, z wyjątkiem zamierzonej aktualizacji znacznika rzeczywistego procesu.

Daty kolejki porównuje się z zegarem PostgreSQL. Pierwsze próby poprawiły wyłącznie dane i sprawdzenia testu: zegar komputera nie jest zegarem serwera, a operacja planu wymaga parametru `p_course_enrollment`. Nie zmieniano funkcji produktu. Ten odbiór dotyczy skrzynek w aplikacji; nie deklaruje dostarczenia poczty ani WhatsApp.
