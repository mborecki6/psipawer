# Scenariusze wspólnych testów Psi Pawer

Wersja testowa działa pod [psipawer.vercel.app](https://psipawer.vercel.app/login). Wszystkie wpisy z oznaczeniem **DEMO** są fikcyjne. Terminy i rozliczenia służą wyłącznie sprawdzaniu aplikacji; nie są prawdziwymi rezerwacjami ani wpłatami.

## Konta i sposób testowania

Prowadząca korzysta z dotychczasowego konta `asiakostrzanowska@gmail.com`, administrator z `mborecki6+1@gmail.com`. Hasła tych kont pozostają bez zmian. Dwa oddzielne konta opiekunów to `demo.opiekun@psipawer.test` i `demo.opiekun2@psipawer.test`. Wygenerowane hasła oraz kod fikcyjnej karty przekazujemy w prywatnym pliku, poza repozytorium i wdrożeniem.

Otwórz konto opiekuna w osobnej przeglądarce lub oknie prywatnym, aby równolegle sprawdzać oba panele. Pierwszy opiekun ma Kluskę i nowego Borysa; drugi Lunę i Figę. Przy zgłaszaniu uwag zapisz rolę, ekran, wykonaną czynność i oczekiwany rezultat.

## Scenariusze obu ról

| Obszar | Opiekun | Prowadząca | Co sprawdzić |
| --- | --- | --- | --- |
| Profile i prywatność | Otwórz psy, zmień opis, dodaj lub wymień zdjęcie. | Otwórz Borysa i przejrzyj profil do zatwierdzenia. | Opiekun widzi swoje psy i wspólną notatkę, ale nie prywatną notatkę prowadzącej. Drugie konto ma osobne dane. |
| Spacer ze zgłoszeniami | Otwórz oczekujące zgłoszenie Kluski. | Otwórz spacer w Parku Pawłowickim, sprawdź ostrzeżenie o relacji, przyjmij albo odmów. | Decyzja, liczba miejsc, lista rezerwowa Figi i powiadomienie opiekuna są spójne. |
| Nowy zapis | Zapisz zatwierdzonego psa na spacer z wolnymi miejscami. | Przyjmij zgłoszenie i sprawdź szczegóły zbiórki. | Zgłoszenie trafia do kolejki prowadzącej, a prywatna zbiórka do przyjętego opiekuna. |
| Obecność i historia | Otwórz zakończony spacer Kluski. | Zmień lub przejrzyj obecność. | Historyczna wpłata 100 zł i obecność pozostają powiązane z tym spacerem. |
| Wpłaty i zwroty | Otwórz rozliczenia: spacer ma wpłatę 40 zł, konsultacja 30 zł, kurs 50 zł, fitness 25 zł. | Dopisz fikcyjną wpłatę, wycofaj błędną albo sprawdź zwrot. | Saldo przelicza się po obu stronach; historia i powód zmiany pozostają widoczne. |
| Pakiet spacerów | Sprawdź pakiet trzech wejść. | Przypisz pakiet do nowego zaakceptowanego spaceru. | Wejścia i pieniądze są rozliczane oddzielnie. Nie można wydać tego samego wejścia dwa razy. |
| Konsultacje | Przejrzyj zaplanowaną konsultację Kluski i zgłoszenie Luny na drugim koncie. | Umów Lunę, przełóż Kluskę lub anuluj termin z powodem. | Kalendarz blokuje konflikt, a opiekun dostaje właściwą zmianę w skrzynce. |
| Kurs grupowy | Otwórz przyjęte zgłoszenie Kluski; na drugim koncie zgłoszenie Luny czeka na decyzję. | Przyjmij Lunę, przejrzyj zakończone pierwsze spotkanie, przełóż kolejne. | Miejsca, obecność, należność i zmiany terminu są spójne. |
| Szkic kursu | Sprawdź listę dostępnych kursów. | Otwórz i opublikuj kurs oznaczony „Szkic kursu”. | Szkic pojawia się opiekunowi dopiero po publikacji. |
| Fitness | Otwórz aktywny pakiet Kluski i kolejne spotkanie; na drugim koncie zgłoszenie Figi. | Przyjmij Figę, ustal kolejne spotkania, przejrzyj lub przywróć odwołany pakiet Luny. | Wykorzystane spotkania, terminy, należność i historia są zachowane. |
| Zalecenia i wersje | Otwórz opublikowany plan po fitness oraz poprzednie plany po konsultacji i kursie. Dodaj odpowiedź. | Przejrzyj odpowiedź i prywatny szkic, skopiuj materiał z biblioteki, opublikuj nową wersję. | Opiekun widzi publikacje i ich powiązania; prywatny szkic pozostaje dostępny wyłącznie prowadzącej. |
| Kontakty kontrolne | Sprawdź powiadomienia i odpowiedz na plan. | Otwórz kolejkę spraw, zaległy kontakt oraz odpowiedź opiekuna. | Sprawę można otworzyć, oznaczyć jako sprawdzoną lub przełożyć z historią. |
| Karty podarunkowe | Otwórz przypisaną kartę 100 zł. Przypisz drugą kartę kodem z prywatnego pliku. | Zastosuj fikcyjną kartę do wybranej należności i sprawdź historię. | Karta zachowuje właściciela, saldo i powiązanie rozliczenia. |
| Społeczność | Przejrzyj profile Kluski i Luny, wyraź zainteresowanie drugim profilem. | Przejrzyj moderację, publikację i prywatne relacje psów. | Publiczny profil nie ujawnia prywatnych notatek i danych innych opiekunów. |
| Kalendarz i oferta | Przejrzyj własne terminy i ceny usług. | Dodaj blokadę kalendarza, sprawdź godziny pracy i zmień roboczą cenę usługi. | Konflikty są blokowane; nowa cena dotyczy nowych zgłoszeń, a istniejące uzgodnienia zachowują swoją cenę. |
| Powiadomienia | Otwórz skrzynkę, przejdź do wskazanego zgłoszenia lub planu, oznacz wiadomość jako przeczytaną. | Przejrzyj przypomnienia i czas ostatniego sprawdzenia. | Przypomnienia działają co pięć minut w Supabase i nie wymagają włączonego komputera. |

## Zakres tej walidacji

Logowanie hasłem i skrzynki w aplikacji działają dla kont testowych. Zaproszenia nowych klientów i wysyłka biznesowych powiadomień e-mailem pozostają wyłączone do konfiguracji poczty. [Domyślna poczta Supabase](https://supabase.com/docs/guides/auth/auth-smtp) obsługuje wyłącznie Auth, z ograniczeniem odbiorców i liczby wiadomości; fikcyjne adresy `.test` nie mają skrzynek.

Automatyczne fizyczne usuwanie nieużywanych zdjęć jest wyłączone. Zmiana i usunięcie zdjęcia w profilu nadal są dostępne; kontrolowane sprzątanie plików wymaga osobnej decyzji operacyjnej.

Zestaw danych jest zapisany w `supabase/fixtures/pilot-demo.sql` i ma trwałe potwierdzenie utworzenia. Ponowne wykonanie zachowuje postęp testerów i nie dubluje wpisów. Odtworzenie początkowego stanu wymaga osobnej, świadomej operacji; wdrożenia nie resetują danych.
