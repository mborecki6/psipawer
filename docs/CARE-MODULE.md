# Plany pracy i postępy — pierwszy etap MVP

Aktualizacja lokalna 10.10.2026 po feedbacku behawiorystki: edytor pokazuje jedno czytelne powiązanie bieżącego planu. Wejście z konsultacji, kursu lub fitness wybiera to źródło tylko wtedy, gdy pies nie ma zapisanego szkicu. Inny istniejący szkic zachowuje treść, źródło i wersję; przepięcie wymaga jawnego przycisku. Przełączenie między kategoriami usług w zwiniętej sekcji „Zmień powiązanie planu” jedynie przegląda dostępne usługi, a dopiero wskazanie konkretnej usługi zmienia powiązanie. Wybranie „Ogólny plan pracy” jawnie usuwa powiązanie. Nadal można wybrać cały kurs/pakiet albo pojedyncze spotkanie. Zalecenia po spotkaniu pozostają dostępne do publikacji dopiero po jego zakończeniu. Model jednego szkicu dla psa i reguły serwerowe są bez zmian; ta iteracja nie wymaga migracji.

Test przeglądarkowy na fikcyjnych danych obejmuje kontekst konsultacji, kursu i fitness, przepięcie istniejącego szkicu z zachowaniem tekstu i wersji, błąd oraz ponowienie zapisu, przejście między całym cyklem i pojedynczym spotkaniem oraz 44 warianty układu. Nie łączy się z bazą ani produkcją. Lokalna aktualizacja nie jest wdrożeniem.

Stan: implementacja lokalna, aktualizacja 02.10.2026. Moduł wymaga wszystkich migracji w kolejności, w tym bazowej `202609180001_care_plans.sql` oraz `202610020007_care_template_retries.sql`. Poprawkę ponowień zastosowano wyłącznie lokalnie. Nie zmieniano bazy w chmurze ani wdrożenia aplikacji.

Aktualizacja 03.10.2026: [zalecenia fitness](FITNESS-MODULE.md#zalecenia-całego-pakietu-i-po-spotkaniu) zachowują jawny pakiet i opcjonalne spotkanie. Prowadząca może przygotować szkic przed umówionym spotkaniem, opublikować go po zakończeniu i osobno wybrać plan całego pakietu. Wejście z innego źródła nie zmienia zapisanego szkicu; wcześniejsze publikacje zachowują własny kontekst. Migracja `202610030008` jest zastosowana wyłącznie lokalnie. Dotychczasowe plany, odpowiedzi, powiadomienia i kontakty kontrolne korzystają z tego samego modułu.

## Dostępne funkcje

- Nowa pozycja „Plany i postępy” w obu panelach i odnośnik w karcie każdego psa.
- Biblioteka własnych materiałów dla zespołu prowadzącego: tworzenie i edycja, kontrola wersji oraz użycie materiału w indywidualnym planie.
- Prywatny szkic z tytułem, treścią i opcjonalną datą kontaktu kontrolnego.
- Zapis szkicu albo publikacja tekstu aktualnie widocznego w formularzu. Publikacja tworzy niezmienną wersję dla opiekuna.
- Historia wcześniejszych wersji. Edycja materiału w bibliotece lub nowego szkicu nie zmienia opublikowanych zaleceń.
- Odpowiedź opiekuna: wykonana praca, co się udało i co było trudne. Odpowiedź zachowuje autora, psa i wersję planu.
- Lista odpowiedzi do przeczytania w panelu behawiorystki; jawne oznaczenie jako przeczytane. Sam odczyt strony nie zmienia statusu.
- Stronicowanie planów, historii i odpowiedzi, zachowanie treści formularzy po błędach oraz układ sprawdzony od 320 px.

Aktualizacja 19.09.2026: data w opublikowanym planie tworzy zadanie w module [kontaktów kontrolnych](WORK-MODULE.md). Prowadząca może je przełożyć, zakończyć, odwołać lub wznowić przy aktualnym planie; opiekun widzi bieżącą datę i status. Oryginalna publikacja pozostaje niezmienna, a notatki z kontaktu są prywatne. Lokalny proces [przypomnień w aplikacji](REMINDERS-MODULE.md) przeszedł rzeczywisty test; zewnętrzne e-maile pozostają odłożone do konfiguracji dostawcy.

## Granica modułu

Kod znajduje się w `src/modules/care/`. Strony Next.js są cienkimi punktami wejścia. Moduł korzysta z istniejącej sesji i identyfikatora psa; nie zmienia reguł kwalifikacji, rezerwacji ani rozliczeń.

`care_practices` ma celowo ograniczenie do jednej praktyki. Nowe rekordy wskazują praktykę, ale uprawnienia zespołu nadal korzystają z istniejącego globalnego `admin`. Nie jest to gotowy model wielu niezależnych praktyk. Ograniczenie można zdjąć dopiero wraz z pełną migracją ról, danych i dostępu do plików.

| Tabela               | Własność i widoczność                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `care_templates`     | Biblioteka praktyki, dostępna tylko prowadzącym                                                           |
| `care_drafts`        | Jeden edytowany szkic dla psa, tylko dla prowadzących                                                     |
| `care_plan_versions` | Niezmienne publikacje, dostępne prowadzącym i właściwemu opiekunowi                                       |
| `care_progress`      | Odpowiedzi opiekuna, widoczne dla autora nadal opiekującego się psem oraz prowadzących                    |
| `care_events`        | Trwały zapis zdarzeń publikacji i odpowiedzi, bez treści dokumentów i bez odczytu przez sesję użytkownika |

Zapisy przechodzą przez kontrolowane funkcje SQL. Konto aplikacyjne nie może bezpośrednio edytować tabel modułu. Funkcje sprawdzają uprawnienia niezależnie od formularzy. Publikacja blokuje rekord psa i sprawdza wersję szkicu, a zapis zdarzenia jest częścią tej samej transakcji. Ponowienie tej samej publikacji lub odpowiedzi nie tworzy kolejnego zdarzenia.

`care_events` zasila teraz lokalną [skrzynkę powiadomień](NOTIFICATIONS-MODULE.md), dodaną migracją `202609190004`. Opiekun dowiaduje się o publikacji planu, a prowadząca o nowej odpowiedzi. Osobne jawne oznaczenie odpowiedzi jako przeczytanej powiadamia autora. Dostawca zewnętrznych wiadomości i komunikatory pozostają do wykonania.

## Biblioteka i personalizacja

Dodanie pierwszego materiału zachowuje rozwinięty formularz z potwierdzeniem. Po udanym zapisie formularz dodawania ma pustą treść i nowy identyfikator; edytor istniejącego materiału zachowuje aktualną wersję dla kolejnego zapisu. Odmowa zapisu ze starej karty nie usuwa wpisanego tytułu ani treści i przenosi fokus na komunikat.

Ponowienie dodania lub edycji jest bezpieczne, jeśli dokładnie odpowiada ostatniemu zapisowi tego samego autora. Nie zmienia wtedy czasu, wersji ani audytu. Inna treść, inny autor lub późniejsza edycja powoduje konflikt. Zapis materiału i audyt są jedną transakcją. Przeglądarka przesyła akapity jako CRLF; serwer ujednolica je do LF przed walidacją treści planów i materiałów, zachowując widoczne akapity oraz limit 20 000 znaków.

Wybór materiału kopiuje tytuł i treść do szkicu psa, zachowując datę kontaktu. Zastąpienie niepustej treści wymaga potwierdzenia prowadzącej. Personalizacja nie zmienia biblioteki. Nowa publikacja korzysta z tekstu aktualnie wpisanego w formularzu, a wcześniejszy plan zachowuje własną treść i datę także po kolejnych edycjach materiału.

Rzeczywisty E2E `tests/e2e/care-library.spec.ts` przeszedł 02.10.2026 w 14,2 s (15,0 s z uruchomieniem). Obejmuje dodanie, kolejne edycje, ponowienia, stare karty materiału i planu, prywatność szkicu i biblioteki, odmowę zapisu przez opiekuna/obce konto, potwierdzenie zastąpienia, bezpośrednią publikację oraz historię opiekuna. Cztery zrzuty 320/390/1440 px sprawdzono wizualnie. Sześć nowych prób niezależnych transakcji obejmuje równoczesne dodanie, edycję i opóźnione ponowienie; pełny zestaw PostgreSQL przeszedł **76/76** w 9,12 s. Nowe testy izolowane sprawdzają również autora, wersje graniczne oraz wycofanie zapisu po błędzie audytu. Pełny zestaw Vitest przeszedł **588/588 w 56 plikach** (13,29 s).

## Uruchomienie na środowisku testowym

**Aktualna decyzja użytkownika:** dalsze uruchamianie i migracje wyłącznie lokalnie. Postępuj według [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md). Poniższy proces z odrębnym projektem w chmurze jest odłożony i nie stanowi bieżącego polecenia wdrożenia.

1. Użyć odrębnego projektu testowego Supabase z dotychczasowymi migracjami oraz potwierdzić, do którego projektu jest podłączone CLI.
2. Sprawdzić listę migracji i zastosować brakującą `202609180001_care_plans.sql` standardowym procesem migracji opisanym w README. Nie używać resetu zdalnej bazy ani nie wysyłać konfiguracji lokalnego Auth do chmury.
3. Uruchomić tę wersję aplikacji ze zmiennymi środowiska projektu testowego. Nowy moduł nie wymaga klucza administracyjnego w runtime.
4. Na fikcyjnych kontach prowadzącej i opiekuna utworzyć psa, zapisać materiał w bibliotece, przygotować szkic i opublikować plan.
5. Jako opiekun przeczytać plan i wysłać odpowiedź. Jako prowadząca odnaleźć ją w „Plany i postępy” i oznaczyć jako przeczytaną.
6. Zmienić materiał w bibliotece i sprawdzić, że wcześniejsza publikacja zachowała treść. Opublikować kolejną wersję i sprawdzić powiązanie wcześniejszej odpowiedzi z poprzednią wersją.

Przed wydaniem do istniejącego pilota trzeba potwierdzić kopię bazy, zastosowanie migracji w właściwym projekcie oraz rzeczywisty przebieg powyższej ścieżki przez Supabase Auth i jego API. Następnie można wdrożyć aplikację. W razie potrzeby cofnięcia wersji aplikacji nowe tabele należy pozostawić z zapisanymi danymi; nie usuwać ich jako automatycznego kroku cofania wdrożenia.

## Weryfikacja lokalna

Wynik z 18.09.2026: **181 testów w 18 plikach — poprawnie**, ESLint — poprawnie, kompilacja produkcyjna wraz z TypeScript — poprawnie. Test przeglądarkowy przeszedł scenariusze formularzy i wszystkie 24 warianty układu; sprawdzono też wizualnie zrzuty ekranu. To wynik lokalnej weryfikacji, nie test produkcyjnego wdrożenia.

```sh
pnpm test --maxWorkers=2
pnpm lint
pnpm build
pnpm test:care-ui
```

Testy bazy wykonują rzeczywiste migracje i funkcje PostgreSQL w PGlite. Obejmują ochronę szkiców i cudzych danych, kontrolę autora odpowiedzi, stare formularze, niezmienność publikacji, idempotencję oraz wycofanie całej publikacji przy błędzie zapisu zdarzenia.

Test przeglądarkowy `test:care-ui` uruchamia lokalnie prawdziwe komponenty widoków i formularzy, ale zastępuje działania serwerowe kontrolowanymi odpowiedziami testowymi. Wymaga lokalnej przeglądarki Chrome; alternatywny zainstalowany kanał można wybrać przez `CARE_BROWSER_CHANNEL`. Sprawdza błędy i zachowanie tekstu, intencję publikacji, wersje edycji, bibliotekę oraz 24 warianty układu (sześć widoków × cztery szerokości: 320, 390, 768, 1440 px). Zrzuty trafiają do ignorowanego `test-results/care-ui/`. Test nie zakłada kont, nie korzysta z produkcyjnej bazy i nie wysyła wiadomości.

Testy lokalne nie zastępują odbioru docelowego hostingu. Konsultacje indywidualne, kontakty kontrolne, skrzynka powiadomień i terminowe [przypomnienia w aplikacji](REMINDERS-MODULE.md) przeszły opisane rzeczywiste próby lokalnego stosu. [Zaproszenia i odzyskiwanie dostępu](INVITATIONS-MODULE.md) sprawdzono na fikcyjnych kontach z lokalnym Auth i Mailpit; zewnętrzne SMTP oraz zapraszanie klientów pozostają odłożone zgodnie z decyzją użytkownika. [Próba 50 kont](PILOT-LOAD.md) jest odrębnym, wcześniejszym pomiarem.

## Powiązanie ze spotkaniami

Końcowa regresja po poprawkach biblioteki 02.10.2026: **19/19 rzeczywistych E2E** we wspólnym przebiegu (3,7 minuty), w tym pełna konsultacja z prywatnym szkicem, zakończeniem spotkania, publikacją i odpowiedzią oraz oba scenariusze kontaktów i przeglądu postępów. Build z TypeScript i ESLint zmienionego kodu przeszły. Podgląd został uruchomiony z najnowszej kompilacji na localhost:3000. Nie jest to wdrożenie ani potwierdzenie gotowości wszystkich pozostałych procesów produktu.

19.09.2026 dodano [konsultację i zalecenia](CONSULTATION-CARE.md): opcjonalne przypisanie szkicu i każdej publikacji do spotkania, prywatne przygotowanie przed terminem, publikacja po zakończeniu oraz osobne adresy wersji. Zmiana powiązania kolejnego szkicu nie zmienia wcześniejszych publikacji.

03.10.2026 dodano [kursy i zalecenia](COURSE-CARE.md): plan całego cyklu albo szkic po konkretnym spotkaniu, publikacja po zakończeniu spotkania, lista wersji przy uczestniku i trwałe odnośniki. Szkic pozostaje wspólny dla psa i zmienia źródło tylko przez świadomy wybór. Historia pracy podąża za aktualnym opiekunem psa, a zgłoszenie i rozliczenia kursowe zachowują pierwotnego zgłaszającego.

02.10.2026 rzeczywisty [E2E kontaktów i odpowiedzi](WORK-MODULE.md) potwierdził także ogólny plan bez konsultacji. Po pierwszej publikacji formularz pozostaje rozwinięty z widocznym potwierdzeniem. Odpowiedź wysłana ze starszej karty po publikacji nowszego planu zachowuje poprzednią wersję i treść. Następny wpis ma nowy identyfikator i bieżący plan. Otwarcie odpowiedzi nie oznacza jej jako przeczytanej, a jawny przegląd i jego ponowienie tworzą jeden audyt oraz jedno powiadomienie autora. Dwa nowe E2E oraz czternaście nowych prób niezależnych połączeń PostgreSQL uzupełniają historyczne testy tego modułu; pełny lokalny przebieg obejmował 18 E2E i 70 prób współbieżności. Po uproszczeniu odnośników karty odpowiedzi oba nowe E2E ponownie przeszły na końcowej kompilacji. Nie zmieniano bazy ani aplikacji w chmurze.
