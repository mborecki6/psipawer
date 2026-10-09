# Wspólny kalendarz i dostępność

Moduł działa w opublikowanym pilocie od 06.10.2026. Migracje kalendarza, w tym `202610030010_calendar_availability.sql`, `202610030011_calendar_api_revalidation.sql` i `202610030012_calendar_completed_buffers.sql`, są zastosowane w chmurze. Moduł obsługuje jedną praktykę i jedną prowadzącą; rozwój korzysta z oddzielnej lokalnej bazy.

## Przebieg

Obie role mają pozycję **Kalendarz**. Tydzień obejmuje spacery i konsultacje; prowadząca widzi też własne blokady czasu. Można przechodzić między tygodniami i wskazać datę. Wielodniowe blokady oraz spotkania przechodzące przez północ pojawiają się w odpowiednich dniach. Daty są prezentowane i interpretowane w strefie Europe/Warsaw, także w tygodniach zmiany czasu.

Opiekun widzi tylko spacery z zaakceptowanym zgłoszeniem własnego psa i swoje umówione konsultacje. W kalendarzu spacer ma ogólną lokalizację; dokładny punkt zbiórki nadal jest udostępniany według dotychczasowych zasad na karcie spaceru. Prywatne blokady i spotkania innych opiekunów nie trafiają do jego kalendarza.

Pulpit obu ról pokazuje najbliższe spotkanie dowolnego typu w kolejnych 31 dniach, z odnośnikiem do szczegółów i kalendarza. Wciąż trwające spotkanie również może się tam pojawić. Jeśli w tym zakresie niczego nie ma, ekran mówi o tym wprost.

Prowadząca może dodać, zmienić lub usunąć prywatną blokadę: przerwę, dojazd, urlop albo inną niedostępność. Formularz w kalendarzu rozwija się przez **Zarezerwuj czas**. Blokada nie odwołuje zajęć; nakładający się przedział zostaje odrzucony. Zapis zachowuje wersję edytowanego formularza i nie nadpisuje nowszej zmiany z innej karty. Po zapisaniu lub usunięciu można od razu dodać kolejną blokadę. Błąd pozostawia wpisane dane.

## Rytm pracy — tygodniowe godziny i przerwy

W panelu prowadzącej **Ustawienia → Godziny i przerwy** (`/admin/settings/calendar`) można ustalić przerwę przed i po spotkaniu (każda 0–120 minut), włączyć pilnowanie godzin pracy i określić dni wolne oraz jedno okno godzinowe na dzień. Kalendarz ma też odnośnik do tego ekranu. Godziny wybiera się co 15 minut, z możliwością zakończenia dnia o 24:00. Stały tydzień obowiązuje w strefie Europe/Warsaw; wyjątkowy urlop lub dojazd pozostaje osobną blokadą.

Domyślnie harmonogram jest **wyłączony**, a obie przerwy mają **0 minut**. Proponowane w formularzu godziny poniedziałek–piątek 9:00–17:00 nie ograniczają zapisów przed świadomym włączeniem. Nie zmieniono istniejących godzin, cen ani zasad zapisów.

Przerwy zwiększają rezerwację czasu spaceru, konsultacji, spotkania kursu i fitness, zachowując faktyczny początek i koniec spotkania w obu kalendarzach. Przy włączonych godzinach całe spotkanie wraz z przerwami musi zmieścić się w jednym oknie jednego dnia. Dokładny koniec o północy należy do zamykanego dnia. Przejście przez powtarzaną godzinę przy zmianie czasu wymaga pokrycia całego przedziału 2:00–3:00; same pozornie pasujące godziny początku i końca nie wystarczą. Prywatne blokady nie dostają dodatkowych przerw i mogą obejmować dni wolne oraz wiele dni.

Zapis ustawień sprawdza wszystkie istniejące rezerwacje. Konflikt cofa ustawienia, godziny, zajętość i audyt razem; nie przesuwa spotkań ani nie zachowuje części nowego tygodnia. W takim przypadku należy przełożyć termin, poszerzyć godziny lub zmniejszyć przerwy. Zmiana ustawień i równoczesne ustalanie terminu są serializowane w bazie. Drugi, nieaktualny edytor zachowuje swoje pola i otrzymuje polecenie odświeżenia. Identyczne ponowienie zapisuje jedną wersję i jeden audyt.

Godziny pracy są prywatne dla zespołu. Opiekun nie widzi formularza ani danych przez API. Formularz zachowuje także przełączniki i wybory godzin po udanym zapisie — ochrona przed automatycznym resetem formularza została sprawdzona w rzeczywistej przeglądarce.

## Spójność terminów

`calendar_slots` jest prywatną, transakcyjnie utrzymywaną projekcją zajętego czasu. Ma odniesienia do spaceru, konsultacji albo blokady i nie zawiera treści notatek, danych opiekunów ani lokalizacji. Tabela nie jest dostępna przez sesje aplikacyjne. Klucze obce usuwają projekcję wraz z usunięciem jej źródła.

Wyzwalacze przy zapisach źródłowych aktualizują przedział, a ograniczenie PostgreSQL `EXCLUDE USING gist (occupied WITH &&)` odrzuca nakładanie się zajętego czasu. Reguła obejmuje tworzenie i zmianę spacerów, ustalanie i przesuwanie konsultacji oraz blokady. Nie polega wyłącznie na wcześniejszym odczycie wolnego terminu. Zakresy `[)` dopuszczają sąsiadujące spotkania: koniec o 11:00 i kolejny początek o 11:00.

Podstawa mechanizmu: [PostgreSQL — constraints on ranges](https://www.postgresql.org/docs/current/rangetypes.html#RANGETYPES-CONSTRAINT).

Odwołanie zaplanowanego spotkania usuwa zajętość. Zakończenie spaceru, konsultacji, spotkania kursu albo fitness zachowuje pozostałą skonfigurowaną przerwę po faktycznym końcu; oznaczenie obecności ani zakończenie całego cyklu nie zwalnia jej przed czasem. Przy zerowej przerwie pozostaje wcześniejsze zachowanie. Po upływie przerwy historyczny przedział nie koliduje z przyszłymi spotkaniami. Nieudana zmiana terminu wycofuje także zmianę projekcji; dotychczasowy termin i historia zostają nienaruszone.

## Uruchomienie i ograniczenia

- Rozwój i testy zapisu wykorzystują [lokalny tryb pracy](LOCAL-DEVELOPMENT.md). Opublikowany pilot ma osobną bazę; testy modułu nie wykorzystują rzeczywistych danych klientów.
- Migracja importuje obecne aktywne terminy. **Zastane nakładanie się terminów zatrzyma migrację** — trzeba wcześniej sprawdzić kolizje i świadomie poprawić dane. Migracja nie przesuwa i nie usuwa istniejących zajęć automatycznie.
- Kalendarz jest wspólny dla jednej prowadzącej. Nie wprowadzono rozdzielenia dostępności wielu pracowników.
- Automatyczne przerwy i stały tydzień są opcjonalnymi ustawieniami panelu. Nadal brak synchronizacji zewnętrznego kalendarza i wielu okien w jednym dniu; godziny przechodzące przez północ wymagają osobnych terminów lub wyłączenia ograniczenia godzin.
- Reguły obejmują zaplanowane terminy oraz nadal trwającą przerwę po zakończeniu. Późniejsze włączenie przerw nie odtwarza zajętości dawnych zakończonych spotkań, usuniętej wcześniej przy zerowym ustawieniu.
- Nie ma automatycznej wysyłki informacji o zmianach. Dotychczasowe historie konsultacji i komunikaty spacerów pozostają dostępne.

## Weryfikacja

Końcowy wspólny odbiór schematu 48 migracji: 971/971 testów w 73 plikach (24,81 s), 45/45 pełnych E2E (6,2 minuty), TypeScript i ESLint. [Kopia 48 migracji](LOCAL-BACKUPS.md#bieżący-wynik-03102026) zachowuje prywatne ustawienia i tydzień oraz umożliwia nowy zapis i ponowienie w odtworzonym API. Źródłowa zajętość oraz domyślne ustawienia są zachowane. Poniższe etapy pozostają odrębnymi wcześniejszymi przebiegami.

Domknięcie przerwy po zakończeniu, schemat **48 migracji**: **971/971 testów w 73 plikach** (21,38 s), w tym **30/30 scenariuszy kalendarza** w PGlite. **10/10 prób osobnej bazy PostgreSQL** (2,35 s) obserwuje osiem zależności blokad, w tym oba porządki zakończenia spotkania i zmiany ustawień oraz oczekiwanie nowego terminu na zakończenie. Rozszerzony rzeczywisty E2E (11,7 s) potwierdza odrzucenie nowego spaceru podczas pozostałej przerwy, zachowanie formularza i udany zapis po jej upływie. TypeScript i ESLint przeszły. Poniższy pełny przebieg i kopia opisują wcześniejszy schemat 47 migracji; nie przypisujemy ich automatycznie nowej migracji.

Odbiór ustawień 03.10.2026: **967/967 testów w 73 plikach** (21,98 s), **42/42 pełnych E2E** (5,5 minuty), kompilacja, TypeScript i ESLint. Osiem niezależnych scenariuszy PostgreSQL obserwuje sześć rzeczywistych zależności blokad: oba porządki zapisu godzin i terminu, oba porządki przerw i terminu, dwa edytory oraz identyczne ponowienia. Osobna baza została usunięta po zachowaniu źródła. `tests/e2e/calendar-availability.spec.ts` sprawdza zgodność zapisanego tygodnia z przełącznikami, ponowne przeliczenie przerw, konflikt bez zmiany zajętości, odrzucenie terminu poza godzinami z zachowaniem formularza, prywatność oraz układ 320/390 px.

Rzeczywiste API ujawniło ochronę przed zbiorczym zapisem bez warunku. Poprawka w osobnej migracji `202610030011` zachowuje zablokowanie projekcji i atomowe sprawdzenie wszystkich terminów; wcześniejszej zastosowanej migracji nie przepisywano. [Odtworzenie 47 migracji](LOCAL-BACKUPS.md#wcześniejszy-wynik-kalendarza-z-47-migracjami) sprawdziło zachowane prywatne ustawienia i siedem dni, nowy zapis przerw przez odtworzone API, identyczne ponowienie bez drugiego audytu oraz niezmienione źródło. Po sprzątaniu zachowano pięć kont, cztery psy, trzy spacery, 17 cen oraz wcześniejszą zajętość; ustawienia wróciły do początkowej wyłączonej konfiguracji. Lokalny podgląd działa.

Poniższe wyniki opisują wcześniejszy odbiór podstawowego kalendarza z 19.09.2026.

Testy rzeczywistych migracji w PGlite obejmują kolizje w obu kierunkach, nakładające się spacery, stykanie się granic, odwołanie, cofnięcie nieudanej zmiany, blokady, powtórzenia operacji, uprawnienia, prywatność i zakresy wielodniowe. Istniejące scenariusze finansowe zachowały swoje reguły; ich niezależnym spacerom nadano rozłączne terminy, aby dane testowe odpowiadały nowemu kalendarzowi jednej prowadzącej.

`pnpm test:calendar-ui` sprawdza rzeczywiste komponenty z atrapami akcji: zachowanie danych po błędzie, wersje, usuwanie i ponowne tworzenie blokady, rozdzielenie ról i 24 warianty responsywności przy 320/390/768/1440 px. Podglądy panelu na komputerze i kalendarza opiekuna na telefonie sprawdzono wizualnie. Nie jest to jeszcze test prawdziwej sesji Auth/PostgREST ani wyścigu niezależnych połączeń do PostgreSQL.

Wynik po integracji: **274 testy w 25 plikach — poprawnie**, ESLint i build z TypeScript — poprawnie. Test przeglądarkowy kalendarza przeszedł wszystkie scenariusze formularzy i 24 warianty układu. Build wykonano z jawnymi lokalnymi adresami i zastępczym publicznym kluczem. To weryfikacja lokalna, bez wdrożenia i bez połączenia z chmurą.
