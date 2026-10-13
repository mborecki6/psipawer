# Rozszerzenie funkcji po feedbacku behawiorystki

Status: implementacja, odbiór lokalny i publikacja ukończone 13.10.2026. Użytkownik zlecił pozostałe punkty przeglądu
feedbacku; logo, hasło, ClickMeeting i MailerLite pozostawił na koniec.
Po lokalnym odbiorze osobno autoryzował publikację. Rozszerzenie i „Spokojny start”
działają online; zachowano konta i hasła, bez wysyłki do testerów.
[Odbiór hostingu, migracje i ograniczenia](../VERCEL-SUPABASE-PILOT.md#rozszerzenie-po-feedbacku--13102026).

## Decyzje i granice

Przyjmujemy osobne konteksty zaleceń oraz osobny kalendarz dostępnej oferty.
Powiadomienia Web Push będą dobrowolne na konkretnym urządzeniu, ze skrzynką
w aplikacji jako niezależnym kanałem. Nie budujemy aplikacji natywnej ani SMTP.
Nie odgadujemy rzeczywistych sal, prowadzących historycznych wpisów ani godzin
pracy. Istniejące funkcje kalendarza zachowują swoje zasady.

Użytkownik 13.10 potwierdził trzy decyzje w formularzu:
- **Psiutki:** wbudowany czat, bez obowiązkowego pośrednictwa prowadzącej.
- **Kontrola:** datę przypomnienia o zgłoszeniu konsultacji ustala behawiorystka.
- **Raportowanie:** konfigurowalne uprawnienia i czas dostępu teraz, bez sztywnych
  nazw premium/silver/gold.

Czat wymaga świadomego udziału obu opiekunów po wzajemnym zainteresowaniu;
nie udostępnia adresów e-mail ani numerów telefonów. Konfiguracja oferty
określa dostęp dla nowych przypisań usługi; istniejące przypisania zachowują
dotychczasowy dostęp. Prowadząca może jawnie zmienić konkretne uprawnienie.

## Kryteria akceptacji

1. **AC-01 Konteksty szkiców.** Osobny szkic dla psa i dokładnego kontekstu:
   ogólny, konkretna konsultacja, zgłoszenie kursowe z opcjonalnym spotkaniem,
   pakiet fitness z opcjonalnym spotkaniem. Zapis i nawigacja nie przenoszą
   tekstu między kontekstami. Konflikt starej karty nie nadpisuje nowszego szkicu.
2. **AC-02 Publikacje i historia.** Opiekun widzi bieżące publikacje według
   kontekstu, wcześniejsze wersje pozostają dostępne. Szkice są prywatne.
   Identyfikatory, treść, autorzy, daty, odpowiedzi i powiązania historyczne
   pozostają zachowane. Ponowienie publikacji nie tworzy nowej wersji lub
   drugiego powiadomienia. Publikacja po spotkaniu nadal wymaga jego zakończenia.
3. **AC-03 Kontakty w kontekście.** Nowa publikacja zastępuje otwarty kontakt
   tylko w tym samym kontekście. Zalecenia fitness nie zamykają kontroli
   konsultacji. Stare zadania i ich historia pozostają zachowane.
4. **AC-04 Dostępna oferta.** Opiekun ma miesiąc i listę przyszłych dostępnych
   zajęć oraz odnośnik do dotychczasowego procesu zapisu. Oferta jest oddzielona
   od własnych potwierdzonych terminów. Nie udostępnia prywatnych konsultacji,
   fitness innych psów, uczestników, blokad ani chronionych miejsc spotkań.
   Usługa indywidualna bez publicznego terminu prowadzi do zgłoszenia ustalenia
   terminu, a nie do wymyślonego wolnego okienka.
   Indywidualny kurs bez przyszłego otwartego cyklu i indywidualna usługa
   katalogowa mają prywatne zapytanie o termin. Prowadząca obsługuje je przez
   „Zajęcia”. Zapytanie nie tworzy płatności ani rezerwacji; otwarte zgłoszenie
   psa na tę usługę nie dubluje się po drugim formularzu lub ponowieniu.
5. **AC-05 Dostępność i daty.** Oferta respektuje zaproszenia, kwalifikację,
   pojemność i statusy usług. Pełne lub zamknięte zajęcia nie obiecują wolnego
   miejsca. Granice miesiąca i zmiana czasu używają Europe/Warsaw. Prowadząca
   publikuje zajęcia przez istniejące formularze.
6. **AC-06 Push urządzenia.** Obie role świadomie włączają i wyłączają push.
   Odmowa, brak obsługi, brak konfiguracji oraz wygasłe urządzenie mają jasny
   stan. Zmiana konta i wylogowanie nie pozwalają odczytać poprzednich treści.
   Endpoint subskrypcji nie umożliwia wysyłania do dowolnych lub prywatnych
   serwerów. Push zawiera oszczędny komunikat bez zaleceń i danych kontaktowych.
7. **AC-07 Dostarczenie.** Osobna kolejka push ma ograniczone ponowienia,
   wygaszanie subskrypcji i niezależny wynik od skrzynki aplikacji. Nie rozsyła
   archiwalnych wpisów po włączeniu urządzenia. Awaria dostawcy nie wycofuje
   zapisu w skrzynce. Przyjęcie przez dostawcę nie oznacza przeczytania.
8. **AC-08 Zaproszenie na kontrolę.** Według osobnej daty wybranej przez prowadzącą: jedna automatyczna
   prośba do opiekuna o zgłoszenie kontroli właściwego psa. Link nie rezerwuje
   terminu i nie zamyka kontaktu. Ponowienie i dwa formularze nie tworzą dwóch
   zgłoszeń. Zmiana/wycofanie i nowa publikacja respektują kontekst. Włączenie
   funkcji nie uruchamia masowej wysyłki historycznych dat.
9. **AC-09 Kontakt Psiutków.** Wbudowany czat, udostępniany wyłącznie
   uprawnionym uczestnikom na podstawie aktualnych zgód. Zainteresowanie psem
   nie jest zgodą na ujawnienie danych. Wycofanie zgody lub zainteresowania,
   ukrycie profilu i zmiana opiekuna odbierają dalszy dostęp. Zachowana moderacja
   profili; historyczne dopasowania nie stają się automatycznie zgodą kontaktową.
   Wiadomości mają bezpieczne ponowienia, limity tekstu i stronicowanie;
   uczestnik może przerwać rozmowę. Nowy właściciel psa nie dziedziczy wiadomości.
   Powiadomienie nie ujawnia treści rozmowy. Brak załączników w tej iteracji.
10. **AC-10 Raportowanie.** Ustawienie
    uprawnienia i okresu dostępu sprawdzane również przez serwer przy zapisie.
    Wygaśnięcie blokuje nowe raporty, nie usuwa historii ani odczytu zaleceń.
    Domyślna konfiguracja zachowuje dotychczasowy dostęp i nie zmienia cen.
11. **AC-11 Odbiór.** Lokalne migracje po sprawdzeniu kopii; testy zmian SQL,
    izolacji dwóch opiekunów, ponowień i konfliktów; odpowiednie scenariusze
    E2E, TypeScript, lint i build. Obie role, 320/390 px, klawiatura i puste stany.
    Brak wymyślonych wyników i rozróżnienie realnego dostarczenia od mocka.

## Ochrona zastanych danych

Przed pracą zapisano prywatną kopię lokalnego Supabase. Jej identyfikator i logi
pozostają w `.local/`; odtworzenie jest sprawdzane w izolowanym środowisku.
Migracje są dopisywane po istniejących 49 plikach, bez zmiany migracji wydanych.
Schemat testów może wymagać aktualizacji dawnych założeń o jednym szkicu psa;
testy mają nadal sprawdzać historię, uprawnienia i bezpieczne ponowienia.

## Wyniki

Implementacja AC-01–10 jest dostępna lokalnie i online. Poniższy zapis dotyczy wcześniejszego, lokalnego odbioru przed publikacją:

- Sprawdzoną kopię z odtworzeniem 124 tabel w osobnej bazie; po porównaniu
  zastosowano osiem nowych migracji tylko lokalnie. Lokalny Supabase ma
  57 migracji, a wydana wcześniej chmura pozostaje przy 49.
- Porównanie wszystkich wcześniejszych kolumn 71 tabel publicznych po migracji.
  Zachowano pięć kont, pierwotne szkice, publikacje i historię kontaktów.
  Po E2E jedyną zmienioną wcześniej istniejącą tabelą jest techniczny
  `reminder_worker_state`, zgodnie z wykonaniem prób procesu przypomnień.
  Usunięto tymczasowe konta i dane nowych scenariuszy.
- Pełny zestaw 90 plików: 1129 z 1130 przypadków przeszło od razu.
  Jeden sprawdzał stary tekst błędu duplikatów identyfikatorów; po zmianie
  samego oczekiwanego komunikatu jego cały plik zaliczył 15/15 przypadków.
  Dodatkowe końcowe sprawdzenia odczytów, ponowień i prywatnych logów: 47/47.
  Zestaw autora czatu/push/linków: 37/37. Przebiegi częściowo się pokrywają.
- 51 unikalnych scenariuszy E2E w rzeczywistej aplikacji i lokalnym Supabase.
  Pełny przebieg: 44/51. Powtórzenie dotkniętych ścieżek: 7/9; ostatnie
  powtórzenie po poprawkach: 4/4. Obejmują łącznie wszystkie pierwotne błędy.
  Zmiany testów uwzględniły dokładny kontekst publikacji, nowe relacje,
  izolację komunikatów od znacznika Next.js i oczekiwanie na wczytaną historię.
  Nie zastąpiono odmów dostępu samymi sprawdzeniami wyglądu.
- Rzeczywisty błąd 502 odczytu kontekstów potwierdzono w logu lokalnej bramy.
  Nowe odczyty opieki mają najwyżej dwie próby, wyłącznie dla HTTP 502;
  niepoprawne dane i odmowy dostępu pozostają błędami. Zapisy nie są ponawiane
  tym mechanizmem. Zmianę oraz testy sprawdził niezależny recenzent.
- Końcowy lokalny build z TypeScript oraz pełny ESLint przeszły. Cztery
  ostatnie E2E wykonano na tym buildzie, obejmując oba nowe przepływy kontroli
  i raportowania, izolację kontekstów i czat z przerwanym potwierdzeniem zapisu.
- Osobny przegląd komponentów opieki: 44 warianty szerokości i treści.
  Zrzuty rzeczywistych formularzy, wygasłego raportowania i czatu sprawdzono
  także wizualnie. Dodatkowo rzeczywista aplikacja przeszła odczyt 12 tras obu
  ról w 36 wariantach (320/390/1440 px), bez poziomego overflow, pageerrors
  i żądań zewnętrznych. Sprawdzono klawiaturowe rozwinięcie ustawień push,
  manifest oraz nagłówki service workera. Smoke czeka na hydratację Shell.
  Wcześniejsza próba pomyliła CTA dodawania psa z profilem i otwierała
  nieistniejącą ścieżkę; skorygowano wyłącznie wybór UUID w skrypcie.
  Nie wyciszano błędów React ani nie zmieniano autoryzacji dla zaliczenia testu.

Recenzent nie zgłosił otwartych P1/P2 w zbadanym kodzie. Wyniki nie oznaczają
nowego testu obciążeniowego ani pełnego testu równoległości wszystkich nowych
operacji na rzeczywistym PostgreSQL. Izolację i ponowienia sprawdzają SQL,
API oraz E2E; przegląd kolejności blokad nie zastępuje próby wyścigu.

Push przeszedł kolejkę, autoryzację i błędy transportu z kontrolowanym
adapterem. Nie potwierdzono odbioru systemowego na fizycznym telefonie.
Włączenie powiadomień wymaga decyzji na urządzeniu, a poza localhost również
HTTPS. Nie wykonano wysyłki do rzeczywistych testerów. SMTP, aplikacja natywna,
logo/hasło, ClickMeeting i MailerLite pozostają poza tą iteracją.

Podgląd działa na localhost:3000. Dwa lekkie procesy lokalne obsługują
przypomnienia i kolejkę push co 30 sekund, tylko z `.env.test.local`.
Pierwszy przebieg nie dostarczył wiadomości; nie było aktywnych subskrypcji.
Wycofał jedno stare przypomnienie spaceru z września, którego źródło już nie
istnieje (`source_changed`). Po tym uruchomieniu, obok `reminder_worker_state`,
zmienione są tylko techniczne `reminder_jobs` i `reminder_attempts`; konta
oraz pozostałe wcześniejsze dane biznesowe nadal są zgodne z kopią.
Są to procesy tej sesji, a nie usługi uruchamiane automatycznie po restarcie.

Na tym etapie lokalnego odbioru nie publikowano jeszcze kodu ani migracji w chmurze. Późniejsze wdrożenie opisano na początku dokumentu. Instrukcje lokalnych procesów
przypomnień i push są w [LOCAL-DEVELOPMENT](../LOCAL-DEVELOPMENT.md).
Prywatne logi, kopie, konta i zrzuty pozostają poza repozytorium w `.local/`,
`test-results/` i `output/`.

## Przegląd w trakcie implementacji

Pierwsza niezależna ocena wykryła niejednoznaczne powiązanie tabel kontaktów
w PostgREST, wyliczanie aktualności kontaktu po całym psie i linki gubiące
kontekst oraz mylący stan push po utracie konfiguracji. Te ścieżki poprawiono, a rzeczywiste API i końcowe E2E potwierdziły
zachowanie kontekstu oraz stanów dostępu.
Wykryto też brak formularza po CTA „Uzgodnij termin” dla indywidualnego kursu
bez cyklu. Uzupełniono tę ścieżkę w ramach AC-04, bez zmiany zasad zapisów,
cen, rezerwacji i kwalifikacji pozostałych usług.
