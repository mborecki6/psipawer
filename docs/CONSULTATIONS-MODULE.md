# Konsultacje indywidualne

Stan: implementacja lokalna, 18.09.2026. Migracja `202609180002_consultations.sql` nie została zastosowana w chmurze. Dalszy rozwój zgodnie z [lokalnym trybem pracy](LOCAL-DEVELOPMENT.md).

## Przebieg

Opiekun wybiera własnego psa, opisuje potrzebę i opcjonalną dostępność. Zgłoszenie nie wymaga kwalifikacji do spacerów. Behawiorystka odczytuje zgłoszenie i zapisuje uzgodniony termin, długość 15–240 minut, formę spotkania oraz miejsce lub instrukcję połączenia. Zmiana terminu wymaga powodu widocznego dla opiekuna. Prowadząca może zakończyć spotkanie po upływie terminu i dodać wspólne podsumowanie. Obie strony mogą odwołać otwartą konsultację z powodem; opiekun może to zrobić tylko przed rozpoczęciem umówionego spotkania.

Każdy pies ma co najwyżej jedną otwartą konsultację. Po zamknięciu można utworzyć następną. Historia spotkań jest dostępna z karty psa; szczegóły konsultacji prowadzą do jego planu pracy. Lista ma filtry i strony po 20 wpisów, historia zmian strony po 10.

Treść zgłoszenia, miejsce, wiadomości o zmianach i podsumowanie są wspólne. Prywatne notatki pozostają w istniejącym `dog_notes` i mają odrębny wybór widoczności. Formularze konsultacji nie tworzą prywatnych notatek.

## Granice i dane

Kod `src/modules/consultations/`, cienkie strony `/admin/consultations` i `/app/consultations`, nowa pozycja w nawigacji obu ról.

- `consultations`: bieżący stan, zgłoszenie, termin i wersja edycji.
- `consultation_history`: niezmienna historia każdej zaakceptowanej operacji wraz ze szczegółami spotkania w tamtej wersji.
- `consultation_events`: identyfikatory zmian zasilające [powiadomienia w aplikacji](NOTIFICATIONS-MODULE.md). Zapis w tej samej transakcji co zmiana; zewnętrzna wysyłka pozostaje do wykonania. Lokalne [przypomnienia w aplikacji](REMINDERS-MODULE.md) powstają 24 godziny przed potwierdzonym terminem.

RLS ogranicza odczyty do zespołu i właściciela psa. Bezpośrednie zapisy do tabel oraz dostęp anonimowy do funkcji są zabronione. `request_consultation` sam wyznacza autora; `change_consultation` sprawdza rolę, własność, wersję i przejścia statusów. Dokładne ponowienie ostatniej operacji nie tworzy historii ani zdarzenia po raz drugi. Inna treść starej wersji jest odrzucana. Formularz terminu wiąże wersję z wyświetlanym szkicem, także po odświeżeniu danych przez inną akcję.

Konsultacje i spacery korzystają teraz ze [wspólnego kalendarza](CALENDAR-MODULE.md), dodanego lokalnie w migracji `202609190001`. Wzajemne kolizje spacerów, konsultacji i prywatnych blokad są sprawdzane przez ograniczenie bazy przy każdym zapisie. Sąsiadujące terminy są dozwolone. Dojazd można zarezerwować jako blokadę; automatyczne bufory i dostępność cykliczna pozostają oddzielnym krokiem. Globalna rola administratora nadal oznacza pilot jednej praktyki.

Moduł ewidencjonuje należność po potwierdzeniu terminu oraz wpłaty otrzymane poza aplikacją; nie pobiera płatności i nie wykonuje zwrotów. Historia nie znika przy odwołaniu. Nie ma jeszcze kalendarza zewnętrznego. [Powiązanie ze szkicem i konkretnymi publikacjami zaleceń](CONSULTATION-CARE.md) dodano lokalnie 19.09.2026; prowadząca wybiera spotkanie, a publikacja po konsultacji wymaga jej zakończenia. Lista publikacji przy spotkaniu ma strony po pięć wpisów.

Aktualizacja po dodaniu [katalogu usług](SERVICES-MODULE.md): nowe zgłoszenie wymaga wybrania usługi. Zapis zachowuje jej nazwę, kwotę, wersję, czas i formę spotkania oraz oznaczenie ceny testowej. Późniejsza zmiana cennika nie zmienia tych warunków. Forma spotkania jest zgodna z wybraną usługą; długość można uzgodnić podczas planowania bez automatycznej zmiany kwoty. Starsze konsultacje bez wybranej usługi nie otrzymują automatycznie ceny katalogowej. Prowadząca może zapisać uzgodnioną kwotę z powodem i historią w opisanym [formularzu rozliczenia](CONSULTATION-FINANCE.md#starsze-spotkanie-bez-ceny).

19.09.2026 dodano [rozliczenia konsultacji](CONSULTATION-FINANCE.md), migracja `202609190003`. Należność pojawia się po potwierdzeniu terminu; samo zgłoszenie nie jest obciążane. Wpłaty częściowe, korekty i historia korzystają z dotychczasowego modułu finansów. Roboczo odwołanie zwalnia niezapłaconą należność, a otrzymane wpłaty oznacza do osobnego rozliczenia. Nie zmienia to zasad rezygnacji ze spacerów.

## Sprawdzenie

Lokalna aktualizacja po feedbacku z 10.10.2026: formularz terminu pozwala wskazać prowadzącego i opcjonalnie wspólną salę, z osobną wersją przypisania. Te dane są dostępne tylko zespołowi; opiekun nadal widzi uzgodniony termin, miejsce i wiadomość. Kolizje oraz godziny pracy są sprawdzane dla wybranego prowadzącego i sali przez [kalendarz zespołu](CALENDAR-MODULE.md). Krótsza niż zalecana przerwa wymaga jawnego zaznaczenia potwierdzenia i ponownego zapisu tych samych danych. Zmiana pól unieważnia wcześniejsze potwierdzenie. Błąd lub ostrzeżenie zachowuje cały szkic formularza. Po własnym udanym zapisie prowadzący i sala są zablokowane do odświeżenia formularza; dalsza zmiana terminu zachowuje zapisane przypisanie. Wcześniej przypisana, wyłączona sala może pozostać bez zmian, a nowy wybór obejmuje tylko aktywne sale.

Test przeglądarkowy tej aktualizacji obejmuje zachowanie szkicu po błędzie, wybór innego prowadzącego i sali, przekazanie wersji przypisania, obowiązkowe potwierdzenie przerwy, zablokowanie starego wyboru po zapisie oraz zachowanie wyłączonej sali. Przeszło także 28 wariantów układu i kontrola ról. Testy akcji sprawdzają podpis potwierdzenia dla tych samych danych i jego odrzucenie po zmianie terminu. To sprawdzenie lokalnych komponentów i granicy akcji; migracja i odbiór całego stosu są osobnymi etapami. Produkcji nie aktualizowano.

Wynik lokalny z 18.09.2026: **222 testy w 21 plikach zakończone poprawnie**, ESLint i kompilacja z TypeScript poprawne. Test przeglądarkowy konsultacji przeszedł wszystkie 28 wariantów układu i scenariusze formularzy; zrzuty formularzy na komputerze i telefonie sprawdzono wizualnie. Build wykonano z jawnymi lokalnymi adresami i zastępczym publicznym kluczem, bez połączenia z bazą w chmurze.

- Testy PostgreSQL w PGlite: własność, RLS historii, niedozwolone zapisy, powtórzenia, stare wersje, kolizje, daty i czasy, zakończenie/odwołanie, atomowe wycofanie po błędzie zapisu zdarzenia.
- Testy akcji: uprawnienia, mapowanie pól, polska strefa czasu i luka DST, błędy bez ujawniania szczegółów infrastruktury.
- `pnpm test:consultations-ui`: prawdziwe komponenty z atrapami akcji, zachowanie treści po błędzie, wersje edytora, uprawnienia widoków, 28 wariantów układu (7 widoków × 320/390/768/1440 px). Zrzuty w ignorowanym `test-results/consultations-ui/`.

Aktualizacja 02.10.2026: pełny lokalny stos działa, a rzeczywisty E2E konsultacji i zaleceń oraz [E2E rozliczeń](CONSULTATION-FINANCE.md) potwierdzają ścieżki obu ról przez Auth i PostgREST. Drugi obejmuje dwie wpłaty, zmianę cennika, przełożenie, odrzucenie starego formularza, rezygnację opiekuna i dwa zwroty, wraz z kalendarzem, przypomnieniami i odmową dostępu do obcych danych. Trzynaście scenariuszy konsultacji w rozszerzonym zestawie **32/32 niezależnych prób PostgreSQL** sprawdza także współbieżność rozliczeń i zmian terminów. Dokładny zakres oraz pozostałe ograniczenia opisuje moduł rozliczeń; nie wdrażano aplikacji ani migracji do chmury.
