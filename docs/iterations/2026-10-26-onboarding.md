# Obowiązkowy start nowych opiekunów — 26.10.2026

## Zakres i źródło decyzji

Użytkownik zaakceptował wizualizację, poprosił o różne fotografie i krótsze
powitanie, następnie polecił „ok wdrażamy”. Zakres obejmuje implementację i
publikację tego wprowadzenia. Prototyp `psi-pawer-onboarding-fotografie.html`
jest wzorem interfejsu, a jego przełącznik kont i stan demonstracyjny nie są
mechanizmem aplikacji.

Biznes i technika przygotowały niezależne propozycje przed implementacją.
Koordynator przyjął poniższe kryteria. Brief służy opiekunowi jako karta startu;
nie tworzy psa, rezerwacji, kwalifikacji ani indywidualnego planu pracy.
Notatka jest prywatna, do późniejszego omówienia z Asią. Udostępnianie jej
prowadzącej i wiązanie z kartą konkretnego psa pozostają poza tą iteracją.

## Kryteria akceptacji

| ID    | Wymaganie                                                                                                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Tylko konta utworzone po aktywacji funkcji wymagają nowego wprowadzenia. Wszystkie wcześniejsze są zwolnione, także bez psa, danych kontaktowych lub wcześniejszego logowania. Admin omija brief.                                |
| AC-02 | Bramka obejmuje bezpośrednie adresy panelu i jego akcje. Błąd odczytu nie daje zwolnienia. Obsługa konta, odzyskanie hasła i wylogowanie pozostają dostępne. Dotychczasowy profil kontaktowy jest osobnym wcześniejszym krokiem. |
| AC-03 | Trzy kroki: etap życia, jeden cel i forma pracy; każde pole pozwala wybrać „nie wiem”. Imię do 40 znaków i notatka do 240 są opcjonalne; etap współpracy i rytm mają neutralne wartości początkowe.                              |
| AC-04 | Powitanie i kroki używają czterech zaakceptowanych zdjęć, bez napisów na fotografii. Powitanie ma krótką treść zatwierdzonej drugiej wizualizacji.                                                                               |
| AC-05 | Odpowiedzi, etap, pauza i ukończenie są trwale zapisane w DB, również dla drugiego urządzenia. Zmiana etapu następuje po potwierdzeniu zapisu.                                                                                   |
| AC-06 | Błąd zapisu zachowuje odpowiedzi i nie otwiera panelu. Identyczne ponowienie nie duplikuje danych; starsza karta nie nadpisuje nowszych odpowiedzi.                                                                              |
| AC-07 | Końcowe zatwierdzenie atomowo zapisuje poprawny brief i ukończenie. Edycja, pauza ani starszy zapis nie cofają ukończenia. Kartę można otworzyć i edytować później z profilu.                                                    |
| AC-08 | Brief odczytuje i zmienia tylko właściciel, z tożsamością ustaloną na serwerze. Bezpośredni zapis, anonimowy dostęp i dostęp obcego opiekuna lub administratora są zabronione.                                                   |
| AC-09 | Zapis nie zmienia psów, kwalifikacji, zgłoszeń, terminów, wpłat ani powiadomień. Nie tworzy niepełnego psa nawet przy podanym imieniu.                                                                                           |
| AC-10 | Cel i etap życia zmieniają treść, forma kieruje do odpowiedniej kategorii Oferty, etap „po spotkaniu” do Planów i postępów, rytm zmienia podpowiedź. Same odpowiedzi „nie wiem” dają poprawny start.                             |
| AC-11 | Odsyłacze prowadzą do istniejących widoków. Karta nie obiecuje diagnozy, automatycznej kwalifikacji ani opublikowanych zaleceń.                                                                                                  |
| AC-12 | Brak psa, terminów, usług lub zaleceń pozostaje prawdziwym stanem pustym. Kompaktowy pierwszy krok może zastąpić pusty najbliższy termin tylko dla osoby, która ukończyła onboarding.                                            |
| AC-13 | Działanie przy 320/390/1440 px i z klawiaturą: etykiety, fokus, ogłaszanie błędów/zmian, bez poziomego przewijania.                                                                                                              |
| AC-14 | Regresje obu ról sprawdzone. SMTP, zaproszenia, płatności, Pro i aktualizacja infrastruktury pozostają wyłączone/poza zakresem. Nie tworzymy prawdziwych kont odbiorców.                                                         |

## Kontrakt i właścicielstwo

Migracja 66 dodaje prywatną relację 1:1 `guardian_onboarding` i trigger dla nowych
profili, bez uzupełniania wcześniejszych rekordów. Jedyny zapis z aplikacji to
RPC sprawdzający rolę, własność, walidację i rewizję. Ukończenie jest monotoniczne.
Odczyt sesji korzysta z tej relacji; `/onboarding` znajduje się poza układem `/app`,
aby uniknąć pętli przekierowań.

- Technika backend: migracja, typy, walidacja, akcja/RPC i testy domenowe.
- Technika UI: widoki, model personalizacji, style i testy modelu/E2E.
- Koordynator: bramka sesji, integracja pulpitu/profilu, fixtures, dokumentacja,
  lokalny odbiór oraz kopia/próba migracji i publikacja.
- Recenzent: niezależny przegląd wymagań i faktycznego diffu, bez edycji aplikacji.

## Odbiór lokalny i niezależny przegląd

- 1956/1956 testów jednostkowych w 134 plikach, ESLint, TypeScript i lokalny
  build produkcyjny: PASS.
- Chromium: 3/3 nowe scenariusze onboardingu i 3/3 regresje profilu, sesji oraz
  pełnej ścieżki zaproszenie → hasło → profil → onboarding → konsultacja →
  zalecenia → odzyskanie hasła: PASS. Same odpowiedzi „nie wiem” i puste imię
  ukończono także w ścieżce zaproszenia.
- WebKit: 3/3 scenariusze onboardingu PASS, bez pobierania nowej przeglądarki.
  To silnik przeglądarki, nie odbiór na fizycznym iPhonie.
- AC-01/02/05–09: rzeczywiste RLS/RPC w PGlite, lokalny PostgREST w E2E,
  drugie urządzenie/kontekst, błąd połączenia, konflikt starszej rewizji,
  ukończenie i edycja bez cofnięcia dostępu: PASS.
- AC-03/04/10–13: reguły modelu, prawdziwe odsyłacze, stany puste,
  15 wariantów 320/390/1440 px, klawiatura, fokus i zdjęcia: PASS.
  Artefakty wcześniejszego capture po resize wyjaśniono: DOM zawierał jedną
  kopię widoku; po synchronizacji przewijania i klatek obrazy są poprawne.
- Recenzent zaczął od kryteriów i diffu, przed raportami autorów. Sam wykonał
  113 testów, dodatkową próbę Unicode i obejrzał zrzuty; nie znalazł
  reprodukowalnych uwag. Zachowano ograniczenia jego własnej interakcji.

Pierwszy pełny zestaw zatrzymał zakaz lokalnego nasłuchu atrapy SMTP i brak
mostka importu w istniejącym teście pulpitu. Po poprawieniu testu i uruchomieniu
z dozwolonym loopback cały zestaw przeszedł. Pierwsza próba ścieżki zaproszenia
na porcie 4392 nie pasowała do lokalnego SiteURL 3000; faktyczną ścieżkę
powtórzono na domyślnym porcie, bez zmiany szablonów lub konfiguracji Auth.
Nie są to dowody wysyłki SMTP do prawdziwej osoby.

## Kopia i próba migracji

Świeża prywatna kopia produkcji obejmuje public/Auth/Storage i historię migracji
oraz osobny eksport ról. W Storage nie było obiektów wymagających kopii bajtów.
Kopię odtworzono w osobnej oznaczonej lokalnej bazie i zastosowano migrację 66:
92 wcześniejsze tabele, dane kont i hasła, tożsamości oraz metadane Storage
zachowane; efektywne granty/RLS zgodne po odtworzeniu. Baza próby została usunięta,
a istniejąca lokalna baza i jej dane zachowane.

Kopia: `c32463a8-c04d-4e17-882c-eee8f2dea336`, próba 26.10 17:15 UTC.
Prywatne archiwa, raporty i screenshoty są ignorowane przez Git/Vercel.
Potwierdzono dziewięć przełączników poczty, zaproszeń i Tpay jako OFF.

## Stan publikacji

Opublikowano kod `d22ffd9` i migrację 66 po osobnej zgodzie użytkownika.
Kontrolowany build `dpl_TJknLnzRe8Augsa7z511tgvWWc9i` miał stan READY,
zgodny commit, projekt, właściciela i odcisk 427 wejść runtime. Następnie
zastosowano migrację i potwierdzono relację w PostgREST bez odczytu klientów;
dopiero wtedy przełączono `psipawer.vercel.app`. Dodatkowy odczyt przez
eksperymentalne `vercel api` przekroczył czas; potwierdzenie wykonano przez
`inspect` i bezpośrednie API z istniejącym poświadczeniem CLI, bez eksportu
sekretów lub środowiska. Nie pominięto kontroli tożsamości kandydata.

Odbiór online: 12/12 UI i 3/3 odmowy wyłączonych endpointów PASS, zero błędów
JavaScript, zero prób zapisu z przeglądarki. Sprawdzono istniejące własne konto
administratora i istniejące DEMO, brak nowego briefu na profilu dawnych kont, przekierowania
`/onboarding` dla admina/opiekuna/anonima, profil i reprezentatywne dotychczasowe
widoki. Sesje kontrolne wylogowano. Nie tworzono kont, nie wysyłano wiadomości
ani nie wykonywano płatności. Pełną nową kohortę odebrano lokalnie; na produkcji
nie tworzono dodatkowego konta w celu powtórzenia tej ścieżki.

Produkcyjne porównanie po odbiorze obejmuje 92 wcześniejsze tabele: 91 bez zmian,
a `reminder_worker_state` ma normalną zmianę technicznego heartbeat.
Konta/hasła, tożsamości i Storage zachowane; konfiguracja Auth oraz cron bez zmian.
Płatności i mail biznesowy OFF, kolejki puste, brak anonimowych grantów,
wszystkie tabele publiczne z RLS. Lokalnie i na produkcji 66 migracji.
Znany problem starego PostgREST pozostaje odrębną sprawą infrastruktury;
to wydanie nie jest aktualizacją wersji Supabase ani odbiorem prawdziwego SMTP/Tpay.
