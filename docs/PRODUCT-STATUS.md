# Stan prac nad uzgodnionym produktem

Aktualizacja: 27.10.2026. MVP działa na [psipawer.vercel.app](https://psipawer.vercel.app/login).
Po akceptacji wizualizacji opublikowano obowiązkowy start nowych opiekunów
(kod `d22ffd9`, migracja 66). **Lokalnie i na produkcji 66 migracji.**
Trzy kroki, różne zdjęcia i karta startu; zapis, pauza i ukończenie działają
między urządzeniami, a późniejsza edycja nie blokuje ponownie panelu.
Istniejące konta i admin nie dostają nowego briefu. Notatka pozostaje prywatna,
a zapis nie tworzy psa. [Zakres i odbiór onboardingu](iterations/2026-10-26-onboarding.md).

Historyczny odbiór onboardingu z 26.10: **1956 unit, 6 Chromium, 3 WebKit, 12/12 UI online i 3/3 odmowy
endpointów PASS**, bez błędów JavaScript i zapisów biznesowych na hostingu.
Przed migracją wykonano świeżą kopię, odtworzenie i próbę zachowania danych.
Rzeczywistych klientów nie zaproszono. Tpay, SMTP i zaproszenia pozostają
wyłączone; plan Supabase nadal Free.

Przygotowano i sprawdzono uproszczenie adminowego widoku zaleceń przy psie: jeden
widoczny plan, zwijany wybór pozostałych, materiały i daty jako opcje oraz
pomocnicza sekcja kontroli po edytorze. Reguły zapisu i publikacji pozostają
bez zmian. [Zakres i odbiór](iterations/2026-10-26-prostsze-zalecenia.md).
Odbiór: 127 testów reguł/DB, 52 warianty UI, 11 E2E Chromium i 3 WebKit PASS;
niezależny przegląd bez nierozwiązanych uwag w sprawdzonym zakresie.
Pierwotny odbiór był lokalny; zmianę opublikowano w wydaniu z 27.10, bez nowych migracji i aktywacji integracji.

Kolejna sprawdzona iteracja upraszcza administracyjny szczegół kursu: zwarta lista
terminów z jednym rozwiniętym spotkaniem, osobne obecności i opcje oraz warunki,
ustawienia i historia poniżej głównej pracy. Zgłoszenia i rozliczenia zachowują
dotychczasowe dane i ostrzeżenia. [Zakres i odbiór](iterations/2026-10-26-prostszy-kurs.md).
Odbiór: 112 testów reguł, 64 warianty UI, 11 scenariuszy Next/API Chromium
i 3 WebKit PASS; niezależna recenzja źródłowa bez potwierdzonych uwag.
Lokalny odbiór poprzedzał publikację z 27.10, bez zmian DB; w pierwotnej iteracji nie przebudowywano jeszcze
podobnych widoków fitness/konsultacji. Dalszą realizację z 27.10 opisano poniżej.

Przeprowadzono odczytowy [audyt prostoty całej aplikacji](iterations/2026-10-26-audyt-prostoty.md):
niezależne oceny biznesu, techniki i recenzenta oraz 31 lokalnych widoków i sześć
wariantów mobilnych. Najważniejsze propozycje dotyczą karty psa, konsultacji,
fitnessu, bieżących spraw opiekuna i przejść do konkretnego spotkania. Wykryto
także zbyt szeroki pusty komunikat kolejki pracy; rozszerzenie jej faktycznego
zakresu jest osobnym zadaniem. Sam audyt był odczytowy; ograniczenia jego danych
testowych opisano w raporcie. Użytkownik następnie zatwierdził lokalną realizację.

Po zgodzie z 27.10 przygotowano [uproszczenia po audycie](iterations/2026-10-27-uproszczenia-po-audycie.md):
podgląd i edycję na żądanie przy psie, zwięzły skład spaceru, konsultacje zależne
od stanu, kompaktowy fitness i kurs opiekuna, bieżące zgłoszenia wszystkich pięciu
rodzajów na starcie, dokładne spotkanie z kalendarza, lżejsze raportowanie/cennik
i mniej pustych rozliczeń. Formularze zachowują szkice i odsłaniają wynik zapisu.
Kwoty, wersje, kwalifikacja i prywatność zachowują dotychczasowe zasady.
Pełne 2040 unit, build, TypeScript i ESLint PASS; 28 różnych scenariuszy Next/Supabase
w Chromium oraz pięć WebKit PASS. Wcześniejsze dane biznesowe zachowano; jedyną
różnicą 93-tabelowego porównania jest diagnostyczny stan lokalnego procesora
przypomnień. Tę partię wraz z wcześniejszymi uproszczeniami zaleceń i kursu
opublikowano 27.10, bez nowych migracji i aktywacji integracji.

Użytkownik następnie zatwierdził publikację uproszczeń oraz rozszerzył wydanie
o [klikalny podgląd płatności online](iterations/2026-10-27-podglad-platnosci.md).
Podgląd jest odczytowy, pokazuje rzeczywistą pozostałą kwotę i jasno informuje,
że operator jeszcze nie działa. Nie tworzy prób ani wpłat. Pełne 2057 testów,
lokalny build i dodatkowy przeklik Chromium/WebKit PASS. Kod `971d0d9` jest
online; odbiór 102 wariantów UI i 3 odmów endpointów PASS, bez błędów JS/HTTP
i zapisów biznesowych. Porównanie 93 tabel potwierdziło zachowanie danych
(oprócz technicznego heartbeat przypomnień), kont, haseł i Storage.
Nadal 66 migracji, Supabase Free; Tpay/PayU,
symulator w chmurze, SMTP i zaproszenia pozostają wyłączone. Nie aktualizowano
infrastruktury Supabase. [Publikacja i dowody](iterations/2026-10-27-publikacja-uproszczen.md).

Po kolejnej uwadze użytkownika przygotowano najpierw lokalnie
[obsługę w biegu](iterations/2026-10-27-obsluga-w-biegu.md): wpłaty kursu/fitnessu
bez wychodzenia z rozliczeń, jawny placeholder głosu przy czterech rodzajach
spotkania Asi i start opiekuna skupiony na zaleceniach/dostępnych zajęciach.
Rozliczenia pozostają w osobnej sekcji. Zachowano potwierdzenie wpłaty przy
utracie odpowiedzi, usunięciu wiersza i powrocie po paginacji. Niezależne uwagi
zamknięto. 2085 unit, 17 różnych scenariuszy Chromium, 6 WebKit, build/lint/typy
PASS; odczytowy przeklik 104 otwarć obu paneli i 12 przejść mobilnego menu PASS.
Ograniczenia niepustych danych opisano w raporcie. 92 tabele biznesowe zachowano;
zmienił się tylko techniczny heartbeat przypomnień. Następnie po osobnej zgodzie
opublikowano kod `4b0c7a5`: **102 warianty UI i trzy odmowy endpointów online PASS**.
Wpłaty otwierają się w rozliczeniach, głos pozostaje placeholderem, Home bez kwot.
Dane, konta, Storage i wyłączone integracje zachowano. Nadal 66 migracji i Free.
[Publikacja oraz ograniczenia odbioru](iterations/2026-10-27-publikacja-obsluga-w-biegu.md).

Najnowsza zmiana jest **opublikowana po osobnej zgodzie użytkownika**:
[prosty skład i obecność](iterations/2026-10-27-prosty-sklad-obecnosc.md).
W kursach i spacerach główne decyzje są widoczne przy psie, bez selectów i
rozwijania listy obecności. Pierwszą zwykłą obecność zapisuje jeden przycisk;
usprawiedliwienia i korekty zachowują swoje zasady. Dokładna niepotwierdzona
decyzja, powód i wersja przetrwają zniknięcie/powrót wiersza po filtrowaniu.
2106 unit, 25 różnych scenariuszy Chromium i 6 WebKit PASS; build, typy i lint
PASS. Recenzję zamknięto, wcześniejsze dane 93 lokalnych tabel pozostały identyczne.
Po nowym poleceniu użytkownika kod `2d0b1bd` opublikowano na głównej domenie.
18 sprawdzeń UI online i 3 odmowy endpointów PASS; bez błędów JS/HTTP i zapisów
biznesowych. Dane, konta i Storage zachowane; tylko heartbeat przypomnień zmieniony.
To odbiór przeglądarek także w szerokościach telefonu, bez fizycznego telefonu Asi.
Nadal 66 migracji, Free i wyłączone integracje.
[Publikacja i ograniczenia](iterations/2026-10-27-publikacja-prostego-skladu.md).

Wcześniejsze poprawki z 18 i 23.10 opublikowano po osobnej zgodzie użytkownika;
kod `50a0543` obejmował dodatkową aktualizację bezpieczeństwa Zod 4.6.6.
[Publikacja i odbiór wcześniejszych poprawek z 26.10](iterations/2026-10-26-publikacja-poprawek.md).

Po wcześniejszej poprawce Zod powtórzono pełne 1843 testy, TypeScript, ESLint i audyt
produkcyjnych zależności (0 zgłoszeń). Końcowy odbiór hostingu: **41/41 UI
i 3/3 odmowy endpointów PASS**, bez zapisów biznesowych i błędów JavaScript.
To odbiór wyłączonych integracji; rzeczywisty operator i doręczenia nadal
wymagają oddzielnych testów.

## Warunek infrastruktury przed prawdziwymi klientami — 26.10.2026

Odbiór hostingu wykrył PGRST303 „JWT issued at future” także dla świeżej
sesji DEMO. Potwierdzono PostgREST 14.5 i zgodne zegary klienta/HTTP/DB.
Jeden kontrolowany restart projektu przywrócił Data API, ale wersja pozostała
14.5; ryzyko nawrotu nie jest zamknięte. Oficjalny incydent Supabase zaleca
aktualizację wersji projektu. To **osobna operacja od zakupu planu Pro**.
Sprawdzono eligibility: obecnie `supabase-postgres-17.6.1.166`, dostępne
`supabase-postgres-17.11.0.003` w głównej wersji PostgreSQL 17, brak ostrzeżeń
i obiektów do usunięcia; platforma szacuje operację na 1 h. Aktualizacji nie
wykonano. Przed wpuszczeniem prawdziwych klientów trzeba uzgodnić okno,
wykonać aktualizację i odebrać logowanie/odczyty. Nie deklarujemy, że restart
trwale naprawił problem. Szczegóły i źródła w iteracji z 26.10.

Film Asi pozostaje opcjonalnym pomysłem. Opublikowany onboarding nie wymaga
wychodzenia z aplikacji ani oglądania filmu.

## Przygotowanie płatności i poczty — lokalnie, 23.10.2026

Poniższy zapis zachowuje stan z 23.10. Publikację po późniejszej zgodzie
i aktualny stan produkcji opisano powyżej.

Użytkownik zatwierdził audyt i lokalne poprawki przed przyjmowaniem pieniędzy,
przygotowanie SMTP Auth i oddzielnych maili o terminach, przypomnieniach oraz
potwierdzonych wpłatach. Konfiguracje hosted, trwałe kolejki i uzgadnianie
rozpoczętych transakcji są przygotowane; prawdziwy SMTP i Tpay pozostają
wyłączone i wymagają rzeczywistego odbioru. Symulator nie łączy się z operatorem.

Lokalnie zastosowano migracje 62–65 po kopii, bez zmiany wcześniejszych danych
i Auth. **Lokalnie 65, produkcja 60 migracji.** Nie włączono planu Pro, nie
publikowano kodu, nie utworzono kont prawdziwych odbiorców ani zewnętrznej wysyłki.
Audyt zależności wskazał aktualizację zabezpieczeń Next.js; lokalny kandydat ma
Next i eslint-config-next 16.4.1, bez zgłoszeń w ponownym audycie produkcyjnych
zależności. Aktualizacja produkcji wymaga osobnego wydania.

Końcowy odbiór lokalny: **1843 testy jednostkowe, 173 testy PostgreSQL,
78 E2E Chromium i 13 E2E WebKit — PASS**. Po korekcie dwóch plików testowych
powtórzono zgodne 13 scenariuszy Chromium — PASS. Pilot 50+1 i 153 rzeczywiste
widoki przeglądarki przeszły; przy 50 jednoczesnych zapisach zachowano limit
4 miejsc, a 50 ponowień tej samej wpłaty utworzyło jeden wpływ. Fizyczne
lokalne odtworzenie 144 tabel, Auth, dwóch plików Storage oraz płatności i
kolejek przeszło. Własne dane testowe usunięto, wcześniejsze dane zachowano.
Znane uwagi recenzenta zamknięto. Wyniki nie zastępują przyszłego odbioru
rzeczywistego operatora, doręczeń oraz hostingu.

[Zakres i wyniki odbioru](iterations/2026-10-23-gotowosc-platnosci.md) oraz
[instrukcja konfiguracji i publikacji](PAYMENT-EMAIL-RELEASE.md) rozróżniają
sprawdzony kod, lokalne próby i otwarte testy integracji. Żaden lokalny wynik
nie potwierdza doręczenia na prawdziwą skrzynkę ani przyjęcia prawdziwego BLIK.

## BLIK przez Tpay — lokalny wariant testowy, 18.10.2026

Przyjęta i wyceniona usługa ma testową płatność w rozliczeniach opiekuna. Obejmuje spacer, konsultację, kurs i PSI FITNESS; kwota pochodzi z bazy i uwzględnia wcześniejsze wpłaty. Spacer przyjęty automatycznie według istniejących reguł także może być opłacony, zgodnie z odpowiedzią użytkownika. Zakupy pakietów spacerowych i kart pozostają poza tą iteracją.

Użytkownik nie ma konta sandbox Tpay. W lokalnym podglądzie włączono **jawną symulację, bez połączenia z Tpay i bez pieniędzy**. Adapter sandbox, odczyt statusu i weryfikacja powiadomień są przygotowane; rzeczywista transakcja u operatora pozostaje do odbioru po założeniu konta. Nie wolno przedstawiać symulatora ani atrap odpowiedzi API jako przeprowadzonego testu prawdziwej bramki.

Migrację `202610180001_tpay_blik.sql` zastosowano wyłącznie lokalnie: **lokalnie 61, produkcja 60 migracji**. Wcześniej wykonano lokalną kopię; porównanie po migracji potwierdziło niezmienione wcześniejsze dane i konta. Nie publikowano kodu, nie zmieniano chmury, SMTP ani kont prawdziwych użytkowników. [Zakres, konfiguracja i odbiór płatności](iterations/2026-10-18-tpay-blik-lokalnie.md).

## Bieżące decyzje i zadania do wznowienia — 17.10.2026

Użytkownik zdecydował pozostać na **Supabase Free**; zastępuje to wcześniejszy wybór Pro. Nie włączono płatnego planu ani SMTP. Zaproszenia prawdziwych opiekunów są odłożone do przyszłej integracji SMTP; lista odbiorców nie jest jeszcze dostępna. Ręczne narzędzie dostępu pozostaje gotowe, ale dziś nie utworzono kont, linków ani wysyłki.

- [ ] Podłączyć prywatny Google Drive i wysłać przygotowane zaszyfrowane archiwum zdjęć, przenośny czytnik oraz instrukcję. **Wysyłkę użytkownik jawnie odłożył**; nie korzystać ze służbowego Dysku.
- [ ] Pobrać archiwum z Drive i potwierdzić rozmiar, SHA-256 oraz odtworzenie wszystkich plików. Samo odtworzenie lokalne nie potwierdza kopii w chmurze.
- [ ] Zabezpieczyć klucz w osobnym bezpiecznym miejscu poza komputerem i Drive. Obecnie jest zapisany oddzielnie, poza repozytorium.
- [ ] Uzgodnić i sprawdzić produkcyjną kopię bazy danych. Dzisiejszy odczyt wykazał 0 dostępnych kopii; archiwum zdjęć nie zastępuje kopii DB ani Auth.
- [ ] W osobnym etapie skonfigurować SMTP i odebrać doręczenie oraz dostęp pierwszych prawdziwych opiekunów.

**Wykonane lokalnie:** jednorazowe archiwum 12 plików `public/brand` (11 fotografii i logo, 5 635 046 B), AES-256-GCM i osobny klucz. Przenośny czytnik odtworzył wszystkie 12 plików identycznie bajt po bajcie; źródła pozostały bez zmian. Narzędzie przeszło 8 testów oraz niezależny przegląd z poprawką sprawdzania rozmiarów przed ekstrakcją. Oba prywatne buckety były puste w odczycie z 17.10, 12:51 UTC. Ta kopia nie obejmuje później dodanych zdjęć i nie jest automatyczna. Niczego nie wysłano na Drive.

[Szczegóły ostatniego wydania i odbioru](iterations/2026-10-16-odbior-pierwsi-uzytkownicy.md). Poniższe sekcje zachowują historię wcześniejszych iteracji.

## Marka, oferta i profil — online, 14.10.2026

Logowanie i panel używają oryginalnego logo oraz hasła „Problemy to wyzwania,
którym stawiaMY czoła!”, ze zdjęciami ze strony Asi. Oferta opiekuna rozpoczyna
się wyborem Indywidualne / Grupowe; nieprzypisane usługi mają mniejszy odnośnik,
a karty podarunkowe pozostają osobno w Więcej. Kliknięcie nazwy konta otwiera
edycję własnego imienia i nazwiska, telefonu i okolicy. E-mail logowania jest
tylko do odczytu. Przycisk WhatsApp prowadzi do bezpośredniego kontaktu
podanego w VCF, zgodnie z późniejszą decyzją użytkownika.

Wydanie nie wymagało migracji ani zmian cen, haseł lub konfiguracji SMTP.
Przeszły lokalny build/lint/TypeScript, 25 ukierunkowanych testów, E2E obu ról
i 28 scenariuszy katalogu. Odczytowy odbiór produkcji: 11 kontroli tras,
30 wariantów responsywności, cztery pliki marki i trzy odmowy anonimowego
dostępu; bez błędów przeglądarki i zapisów biznesowych.
[Zakres i dowody odbioru](iterations/2026-10-14-marka-oferta-profil.md).

## Rozszerzenie funkcji po feedbacku — online, 13.10.2026

Iteracja zachowuje lżejszy interfejs „Spokojnego startu” i obejmuje sześć obszarów:

- **Konteksty zaleceń:** osobne szkice i bieżące publikacje dla psa oraz konkretnej konsultacji, zgłoszenia kursowego lub pakietu fitness, także z powiązaniem spotkania. Odpowiedzi, wcześniejsze wersje i kontakty kontrolne pozostają przy właściwym kontekście.
- **Dostępna oferta:** miesiąc i lista przyszłych zajęć, oddzielone od własnych potwierdzonych terminów. Indywidualna usługa bez publicznego terminu ma prywatne zgłoszenie obsługiwane przez prowadzącą w Zajęciach; nie tworzy automatycznie rezerwacji ani płatności.
- **Dobrowolny Web Push:** osobna zgoda na konkretnym urządzeniu, prywatne subskrypcje, niezależna kolejka z ograniczonymi ponowieniami i ogólny komunikat bez treści zaleceń lub rozmowy. Skrzynka aplikacji działa niezależnie, bez rozsyłania archiwum po włączeniu push.
- **Zaproszenie na kontrolę:** osobną datę ustala prowadząca. Opiekun otrzymuje prośbę o zgłoszenie kontroli właściwego psa i kontekstu; samo zaproszenie nie rezerwuje terminu ani nie zamyka kontaktu prowadzącej.
- **Prywatny czat Psiutków:** po wzajemnym zainteresowaniu oboje opiekunowie świadomie włączają rozmowę, bez obowiązkowego pośrednictwa prowadzącej. Zgody nie wynikają ze starych dopasowań; wycofanie zgody lub zainteresowania, ukrycie profilu i zmiana opiekuna odbierają dostęp. Nowy właściciel nie dziedziczy historii; czat nie udostępnia telefonu ani e-maila i nie ma załączników.
- **Konfiguracja raportowania:** dostęp i jego okres są określane dla nowych przypisań usługi, z jawną możliwością zmiany konkretnego uprawnienia przez prowadzącą. Istniejące przypisania zachowują dotychczasowy dostęp; wygaśnięcie blokuje nowe odpowiedzi, pozostawiając historię oraz odczyt zaleceń.

Lokalny i produkcyjny Supabase mają **57 migracji**, w tym osiem nowych do `202610130008_notification_contexts.sql`. Publikacja nastąpiła po sprawdzeniu świeżej kopii produkcji. Konta, hasła i wcześniejsze dane zachowano; brakujące szkice odtworzono z historii. [Operacje, harmonogramy i ograniczenia wycofania](VERCEL-SUPABASE-PILOT.md#rozszerzenie-po-feedbacku--13102026). Fizyczne dostarczenie Web Push na telefonie nie zostało odebrane. Zewnętrzny SMTP, branding (logo i hasło), ClickMeeting i MailerLite pozostają poza zakresem tej iteracji; nie powstaje aplikacja natywna.

Odczytowy odbiór online objął 38 stron istniejących kont, 36 wariantów układu i dziewięć grup kontroli prywatności; bez błędów strony i zapisów biznesowych. Harmonogram push co minutę zwrócił HTTP 200 z pustą kolejką. Pojedynczy timeout pierwszego odczytu skrzynki nie powtórzył się w ponowieniu i kontroli UI; przyczyna pozostaje nieustalona. Pełne E2E z zapisami i próby obciążenia pozostają odrębnymi lokalnymi przebiegami.

Kryteria oraz końcowe wyniki i granice odbioru są prowadzone w [dokumencie rozszerzenia po feedbacku](iterations/2026-10-13-funkcje-po-feedbacku.md). Wyniki „Spokojnego startu” i wcześniejszych publikacji poniżej pozostają osobnymi przebiegami historycznymi.

## Spokojny start i praca zespołu agentów — odbiór lokalny, 13.10.2026

Zapisano projektowe role biznesową, techniczną i recenzenta oraz [proces ich pracy](AGENT-WORKFLOW.md). Pierwsza wspólna iteracja ma niezależne propozycje, uzgodnione kryteria i osobny przegląd kodu. Profile dziedziczą model sesji; nie uruchamiają pracy w tle.

Pulpit prowadzącej ma jasną kartę terminu z pełną datą i czytelniejsze cztery sprawy. Menu opiekuna ma sześć linków oraz grupy Zajęcia i Więcej; powiadomienia są pod dzwonkiem. Zachowano stare adresy, dane, akcje i zwinięte podsumowanie. Odbiór ujawnił również zbyt mały kontrast drugiej akcji karty opiekuna — poprawiono go w obrębie tego komponentu.

Przeszły lint, TypeScript, końcowa lokalna kompilacja, 70 testów autora i osobny przebieg 61 testów recenzenta (częściowo wspólne zestawy). Rzeczywista lokalna aplikacja przeszła kontrolę 21 tras, 8 wariantów responsywności i 6 scenariuszy mobilnego menu. Po korekcie kontrastu powtórzono 8 widoków pulpitów. Dodatkowe 16 przypadków izolowanych komponentów sprawdziło skrajne treści, puste stany i daty Warszawy. Biznes oraz recenzent nie zgłosili pozostałych problemów blokujących ten zakres. [Szczegółowe kryteria i granice dowodów](iterations/2026-10-13-spokojny-start.md).

W chwili opisanego odbioru podgląd działał na localhost:3000; nie publikowano jeszcze aplikacji ani nie zmieniano chmury. Późniejsze wspólne wdrożenie z rozszerzeniem opisano powyżej. Poprzednie wyniki pełnych E2E, obciążenia i kopii pozostają odrębnymi historycznymi przebiegami.

## Publikacja aktualizacji po feedbacku — 10.10.2026

Pierwsza iteracja opisana poniżej została opublikowana 10.10. Wtedy Supabase miał **49 migracji** do `202610100001_calendar_team.sql`; zastosowano ją atomowo po odtworzeniu i sprawdzeniu świeżej kopii obejmującej Auth, Storage oraz historię migracji. Odtworzenie i zapis produkcyjny zachowały zawartość wcześniejszych 68 tabel publicznych poza celowo przebudowaną projekcją `calendar_slots`. Źródłowe terminy, konta, hasła, ustawienia Auth, ceny i postęp testerów pozostały zachowane.

Końcowy odczyt potwierdził `ACTIVE_HEALTHY`, historię 49 migracji i zgodny skrót SQL nowej migracji, zachowane liczby kont i danych oraz hasła, a także aktywny harmonogram przypomnień.

32 istniejące źródła mają jawne historyczne przypisanie `legacy_unassigned`. Projekcja zawiera 11 zajętych przedziałów; migracja nie tworzy sal ani nie odgaduje prowadzących. Zespół przypisuje zastane spotkania świadomie. Harmonogram przypomnień nadal działa co pięć minut, a SMTP, zaproszenia klientów i fizyczne sprzątanie zdjęć pozostają wyłączone.

Pierwszy opublikowany build tego wydania to `dpl_VdWitq7Bg5jfHXwGvv5ZicZKb5oY`, z kodu `28d6fa9`. Alias [psipawer.vercel.app](https://psipawer.vercel.app/login) jest gotowy. Późniejszy push dokumentacji może nadać wydaniu kolejny identyfikator bez zmiany kodu aplikacji.

Odczytowa kontrola hostingu przeszła **40 stron obu ról i dwóch kont opiekunów**, **39 wariantów responsywności** (13 ekranów × 320/390/1440 px) oraz **16 kontroli prywatnego API**. Sprawdzono tydzień i miesiąc, 42-dniowy zakres ze zmianą czasu, wybór prowadzącego i sali, formularz urlopu bez zapisu, filtry oferty obu ról oraz zachowanie treści i powiązania istniejącego szkicu. Nie było błędów skryptów ani konsoli. Nie wykonano zapisów aplikacyjnych; porównanie liczby wierszy i skrótów 16 tabel biznesowych przed i po potwierdziło identyczne dane. Użyto istniejących kont oraz własnych tymczasowych sesji Auth, bez zmiany haseł. To odczytowy sprawdzian hostingu, odrębny od lokalnego odbioru 1017 testów i 45 unikalnych E2E z zapisami. [Obsługa publikacji, kopii i wycofania](VERCEL-SUPABASE-PILOT.md#aktualizacja-po-feedbacku--10102026).

Dodatkowa odczytowa próba niepustego kalendarza potwierdziła pokrycie wszystkich 32 zastanych źródeł przypisaniami historycznymi, 11 poprawnych zakresów zajętości oraz 12 rzeczywistych zdarzeń zespołu w badanym oknie. Dwa kalendarze opiekunów miały dokładnie własne dozwolone zdarzenia i nie zawierały prywatnych pól. Sprawdzono identyfikatory spotkań, odnośnik oraz miesiąc z wpisami; skróty 13 tabel przed i po były identyczne.

## Pierwsza lokalna iteracja po feedbacku — 10.10.2026

Kalendarz rozdziela autora, prowadzącego i salę. Ma tydzień oraz miesiąc, filtr prowadzącego, blokady całodniowe, indywidualne godziny i odnośnik do konkretnego spotkania. Prowadzącego i opcjonalną salę wybiera się również przy tworzeniu lub zmianie spaceru, konsultacji, spotkania kursu i fitness. Rzeczywiste nakładanie zajęć tej samej osoby albo wyłącznej sali jest blokowane; krótsza preferowana przerwa wymaga świadomego potwierdzenia. Starsze wpisy pozostają jawnie nieprzypisane do czasu decyzji zespołu.

Edytor planu pokazuje jedno bieżące powiązanie z konsultacją, kursem lub fitness, a jego zmianę rozwija osobno. Wejście ze spotkania wybiera właściwy kontekst dla nowego szkicu; istniejący szkic zachowuje treść, wersję i wcześniejsze powiązanie. Kolejka nazywa kwalifikację psów wprost i wyjaśnia zadania kontaktowe. Oferta ma filtry indywidualne, grupowe, karty i pozostałe usługi.

W czasie lokalnego odbioru, przed publikacją opisaną powyżej, migrację `202610100001_calendar_team.sql` zastosowano po prywatnej kopii **tylko w lokalnym Supabase**. Lokalny schemat miał 49 migracji, a chmura 48. Ten etap nie zmieniał cen, kont pilota ani danych chmury. Pakiety premium, zewnętrzne integracje i powiadomienia poza aplikacją pozostają dalszym zakresem.

Odbiór kodu: **1017/1017 testów w 76 plikach**, TypeScript, ESLint 74 zmienionych plików, formatowanie i lokalna kompilacja. Backend kalendarza przeszedł **50/50 scenariuszy SQL** i **19/19 prób PostgreSQL**, z obserwacją 17 zależności blokad. Sprawdzono również komponenty w prawdziwej przeglądarce: 40 wariantów kalendarza, 44 opieki, 28 konsultacji i 24 oferty, z oceną zrzutów na telefonie i komputerze.

W rzeczywistej lokalnej aplikacji zaliczono **45 unikalnych scenariuszy E2E obu ról**. Wynik obejmuje dwa przebiegi: pełny zestaw dał 36 poprawnych ścieżek i wykrył dziewięć testów wymagających dostosowania do osobnego rozwijanego powiązania i wymaganego prowadzącego. Następnie **14/14 powtórzonych scenariuszy** (2,3 minuty), obejmujących wszystkie dziewięć i dodatkowe zmienione sprawdzenia, przeszło. Kod aplikacji pozostał identyczny między przebiegami. Scenariusz nowego kalendarza obejmuje prawdziwe sesje Auth/API/UI, równoległe osoby, kolizję sali, potwierdzenie przerwy, nieaktualne wersje, godziny, urlop i prywatność.

Końcowy odczyt potwierdził wcześniejsze pięć profili, cztery psy, trzy spacery i 17 usług; własne dane nowych prób usunięto. Dwa wcześniejsze konta testowe z 19.09.2026 zachowano. Podgląd lokalny odpowiada HTTP 200. Usunięto cztery wygenerowane kopie typów Next.js wyłącznie po porównaniu identycznej zawartości; końcowy TypeScript przeszedł.

## Lżejszy panel prowadzącej 09.10.2026

Główna nawigacja ma sześć sekcji: Pulpit, Kalendarz, Zajęcia, Psy i opiekunowie, Plany i postępy oraz Rozliczenia. Spacery, konsultacje, kursy i fitness są dostępne przez Zajęcia oraz wspólne zakładki ich list. Ustawienia zawierają cennik, stały tydzień pracy, przerwy i dostęp opiekunów. Więcej grupuje karty podarunkowe, relacje psów i Psiutki; kontrola przypomnień i dane konta są rozwijane. Powiadomienia otwiera dzwonek.

Pulpit pokazuje najbliższe spotkanie i sprawy do obsługi. Statystyki oraz podsumowanie spacerów i rozliczeń pozostają dostępne po rozwinięciu. Formularz prywatnej blokady w kalendarzu jest rozwijany przez Zarezerwuj czas. Menu opiekuna, wcześniejsze adresy modułów, operacje zapisu i zasady dostępu pozostają zachowane.

Kompilacja lokalna i Vercel z TypeScript oraz ESLint zmienionego kodu przeszły. Aktualizacja nie zawiera migracji ani resetu zestawu DEMO. Odczyty chmury przed i po publikacji potwierdziły zdrowy Supabase, zgodną historię 48 migracji i aktywny proces przypomnień. [Mapa nawigacji i scenariusze](PILOT-TEST-SCENARIOS.md) odpowiadają nowemu panelowi.

Sprawdzono **40 stron** prowadzącej i dwóch opiekunów, logowanie hasłem kont DEMO, prywatność danych drugiego konta i ochronę trzech nowych ekranów prowadzącej. Rzeczywista przeglądarka potwierdziła sześć głównych linków, ustawienia, sekcję Zajęcia, rozwijane opcje, obsługę klawiatury mobilnego menu oraz brak poziomego przewijania przy **320/390/1440 px**. Końcowy przebieg nie miał błędów skryptów ani konsoli. Uzupełniono ikonę karty przeglądarki. Testy odczytowe nie zmieniały danych modułów; pełne lokalne E2E MVP pozostają wcześniejszym odbiorem.

## Opublikowany pilot 06.10.2026

- Cloud Supabase we Frankfurcie ma **48 migracji** do `202610030012`. Przed zmianą wykonano kopię schematu i danych, odtworzono ją w oddzielnej lokalnej bazie i sprawdzono wszystkie 35 brakujących migracji. Dotychczasowe profile i role zostały zachowane.
- Fikcyjny zestaw DEMO obejmuje cztery psy, cztery spacery, trzy konsultacje, dwa kursy, trzy pakiety fitness, dwie karty, trzy publikacje zaleceń, prywatny szkic, odpowiedź opiekuna, częściowe wpłaty i społeczność. Zestaw sprawdzono dwukrotnie na kopii, bez duplikatów; ponowienie zachowuje postęp testerów.
- Na hostingu sprawdzono **37 stron** przez rzeczywiste sesje prowadzącej i dwóch kont opiekunów. Logowanie hasłem, prywatność szkicu, blokada odczytu i zapisu cudzych danych, przekierowanie niezalogowanej osoby i ochrona operacji technicznej przeszły. To odczytowy sprawdzian hostingu, nie powtórzenie wszystkich 45 lokalnych E2E.
- Vercel zbudował aplikację z TypeScript; nowe kontrole przypomnień oraz TypeScript i ESLint przeszły. Harmonogram Supabase przetwarza przypomnienia do skrzynek w aplikacji co pięć minut. E-mailowe zaproszenia i odzyskiwanie hasła pozostają wyłączone, do konfiguracji poczty. Domyślna poczta Supabase ma ograniczenia Auth i nie obsługuje biznesowych powiadomień.
- Automatyczne fizyczne usuwanie nieużywanych zdjęć w chmurze jest wyłączone. Zmiana zdjęcia w profilu działa; sprzątanie plików wymaga oddzielnej decyzji operacyjnej.

[Scenariusze wspólnych testów](PILOT-TEST-SCENARIOS.md), [obsługa wdrożenia](VERCEL-SUPABASE-PILOT.md) i [zakres MVP dla 50 osób](MVP-50.md). Lokalne wyniki poniżej pozostają historią odbioru; rozwój lokalny nadal korzysta z oddzielnej bazy.

## Końcowy odbiór lokalnego MVP — 03.10.2026

Oba panele obejmują dostęp i odzyskanie hasła, profile psów, kwalifikację, zdjęcia, spacery, konsultacje, kursy, indywidualny fitness, bibliotekę i wersjonowane zalecenia, odpowiedzi, wspólny kalendarz z godzinami i przerwami, edytowalny cennik, rozliczenia i zwroty, karty podarunkowe, kolejkę prowadzącej oraz skrzynki i proces przypomnień. Ceny 17 usług pozostają roboczo po 100 zł. Nowa osoba przechodzi pełną ścieżkę lokalnego zaproszenia przez Mailpit; rzeczywistych klientów nie zapraszano.

- **971/971 testów w 73 plikach** (24,81 s), **45/45 pełnych scenariuszy E2E** we wspólnym przebiegu (6,2 minuty), TypeScript i pełny ESLint przeszły. Podgląd korzysta z gotowej lokalnej kompilacji. Migracje do `202610030012`, razem **48**, są zastosowane wyłącznie lokalnie.
- [Kalendarz](CALENDAR-MODULE.md) zachowuje pozostałą przerwę także po zakończeniu wszystkich czterech rodzajów spotkań. 30 prób PGlite i 10 prób osobnej bazy z ośmioma obserwowanymi zależnościami blokad uzupełnia rzeczywisty E2E.
- [Kolejka powiadomień](REMINDERS-MODULE.md#kolejka-50-opiekunów-i-pełne-wycofanie-wielu-odbiorców--03102026) dostarczyła 250 zadań pięćdziesięciu rzeczywistym sesjom, bez duplikatów. Obserwowany błąd drugiego odbiorcy cofnął całe dostarczenie do zespołu; następna próba dostarczyła po jednej wiadomości trzem odbiorcom.
- Nowe E2E sprawdzają sześć filtrów i strony kolejki, zmianę kwalifikacji z zachowaniem wcześniej opłaconego zapisu oraz rozliczenie i zwroty karty w konsultacji, kursie i pakiecie wejść. Wraz ze spacerem i fitness obejmuje to interfejs pięciu źródeł rozliczenia karty.
- [Bieżąca próba 50 kont](PILOT-LOAD.md#bieżący-wynik-03102026--48-migracji): 1050 odczytów opiekunów i 27 prowadzącej bez błędów. Przy 50 równoczesnych żądaniach p95 pulpitu/zaleceń/finansów wyniosło 1,26 / 0,99 / 1,65 s. 153 rzeczywiste strony Chrome przy pięciu aktywnych kartach nie mają błędów skryptów, cudzych danych ani poziomego przewijania; szerokości 320/390/1440 px. 50 zapisów zachowuje limit czterech miejsc, a 50 ponowień wpłaty — jeden wpis.
- [Bieżąca kopia 48 migracji](LOCAL-BACKUPS.md#bieżący-wynik-03102026) odtworzyła cały schemat, 119 tabel, 15 832 wiersze i dwa pliki. Logowania, role, uprawnienia, niepuste dane usług, nowe zapisy i historyczne ponowienia przeszły przez odtworzone API.
- Końcowy odczyt potwierdził dokładne pięć wcześniejszych kont, cztery psy, trzy spacery, 17 aktywnych cen, wszystkie wcześniejsze wiersze publiczne i zajętość. Własne dane prób usunięto. Znacznik przypomnień celowo odzwierciedla rzeczywiste uruchomienia. Godziny nadal są domyślnie wyłączone, przerwy zerowe; podgląd ma zgodny manifest i odpowiada HTTP 200.

## Porządkowanie kodu finansów

Po odbiorze MVP wydzielono z głównego widoku osobne elementy należności, wpłat i zwrotów, kart pakietów, tworzenia pakietu oraz stronicowania. Główny plik zmniejszył się z 975 do 239 linii. Zachowano treść funkcji, istniejące operacje zapisu oraz ten sam arkusz stylów. Jest to podział warstwy prezentacji w obecnej aplikacji; nie wydzielano mikroserwisów ani nie zmieniano bazy.

Po podziale ponownie przeszło **971/971 testów w 73 plikach**, **10/10 scenariuszy przeglądarkowych rozliczeń** (2,2 minuty), kompilacja, TypeScript i ESLint zmienionego kodu. Scenariusze obejmują konsultacje, spacery, kursy, fitness, karty podarunkowe i stronicowanie finansów. Końcowy odczyt potwierdził zachowanie wcześniejszych danych oraz działający podgląd z nowej kompilacji. Pełny przebieg 45 E2E powyżej pozostaje wcześniejszym odbiorem całego MVP; po tym podziale powtórzono wskazane dziesięć scenariuszy. Prace pozostały lokalne.

## Przed dołączeniem prawdziwych klientów

1. Wspólny odbiór z administratorem i behawiorystką: treści usług, docelowe ceny, zasady rezygnacji i dopłat do kart. Teraz ceny zmienia się w panelu, z zachowaniem dawnych warunków.
2. Pomiar wydajności hostingu pod rzeczywistym obciążeniem, kopia poza komputerem, retencja i regularna próba odtworzenia. Porównanie migracji i kopia pozostają obowiązkowe przed kolejną zmianą bazy.
3. Zewnętrzny SMTP oraz rzeczywiste testowe skrzynki przed zaproszeniem klientów. Pocztowe przypomnienia potrzebują własnego adaptera; obecny proces obsługuje skrzynki w aplikacji.
4. Harmonogram procesów przypomnień i sprzątania zarejestrowanych zdjęć na wybranym hostingu, obserwacja błędów oraz ustalona osoba obsługująca problemy.
5. Kopia poza komputerem, retencja i sprawdzona procedura dla wybranego hostingu. Dawne osierocone pliki wymagają osobnego, świadomego przeglądu; nie usuwamy ich na podstawie domysłów.

WhatsApp, AI, własny komunikator, wiele praktyk, płatności online i sklep pozostają poza uzgodnionym pierwszym MVP. Dalsze kombinacje wyścigów i awarii są rozwojem testów, a nie brakującymi ekranami. Lokalny odbiór nie zastępuje kontroli docelowego środowiska i poczty.

## Historia etapów

Wcześniejszy etap 47 migracji 03.10.2026: [ustawienia kalendarza](CALENDAR-MODULE.md) dodają prywatne godziny tygodnia i przerwy przed/po aktywnym spotkaniu, z kontrolą istniejących terminów i wersji formularza. Domyślnie reguły są wyłączone. Migracje `202610030010` i `202610030011` zastosowano lokalnie; bieżący schemat ma **47 migracji**. Przeszło **967/967 testów w 73 plikach**, **42/42 pełnych E2E** (5,5 minuty), kompilacja, TypeScript i ESLint. Osiem prób osobnej bazy potwierdziło sześć zależności blokad. Telefon 320/390 px i zachowanie przełączników po zapisie sprawdzono. [Kopia 47 migracji](LOCAL-BACKUPS.md#wcześniejszy-wynik-kalendarza-z-47-migracjami) odtworzyła **119 tabel i 15 193 wiersze**, zachowała logowania, zdjęcia i dane usług; prywatne ustawienia oraz siedem dni można odczytać i zmienić przez odtworzone API, bez powielenia audytu przy ponowieniu. Dokładne identyfikatory pięciu kont, czterech psów, trzech spacerów, wcześniejsza zajętość i 17 cen zostały zachowane; własne dane prób usunięto i podgląd działa. Pozostają m.in. przerwa po zakończeniu spotkania, większa kolejka przypomnień i dalsze warunki tabeli.

Wcześniejszy etap kart 03.10.2026: [karty podarunkowe](GIFT-CARDS-MODULE.md) mają oba panele, personalizację, aktywację kodem, rozliczenie pięciu rodzajów należności i częściowe zwroty. Wykorzystanie salda nie powiela wpływu pieniędzy; zwrot usługi przywraca wartość tej samej karty bez odnowienia ważności. Potwierdzenia pozostają po wyczerpaniu salda i pełnym zwrocie. Migrację `202610030009` zastosowano wyłącznie lokalnie; odbiór tego etapu objął **45 migracji**. Końcowy kod przeszedł **941/941 testów w 73 plikach** (24,56 s), **40/40 pełnych E2E** (5,4 minuty), kompilację, TypeScript i ESLint. Oddzielnie przyjęto **19/19 prób PostgreSQL** (6,73 s), z 18 obserwowanymi zależnościami blokad. Układ 320/390 px i jednostronicowy wydruk z 500 znakami życzeń sprawdzono. [Kopia schematu 45 migracji](LOCAL-BACKUPS.md#wcześniejszy-wynik-kart-z-45-migracjami) zachowała **117 tabel, 14 582 wiersze i 45 migracji**, w tym dwie karty z kodami, saldem i częściowymi zwrotami; nowe zapisy i historyczne ponowienia działały przez odtworzone API bez zmiany źródła. Końcowy odczyt potwierdził zachowanie pięciu kont, czterech psów, trzech spacerów i 17 aktywnych cen roboczych 100 zł, brak danych własnych prób, działające usługi i podgląd. Pozostają dalsze procesy oraz warunki wskazane w tabeli.

Wcześniejszy etap fitness 03.10.2026: [indywidualny pakiet](FITNESS-MODULE.md) ma panele obu ról, zgłoszenie z oferty, cztery osobno umawiane spotkania, obecności i korekty, rezygnację, rozliczenie, częściowe zwroty i powrót. Kalendarz, wspólne finanse, kolejka, skrzynki, przypomnienia oraz zalecenia całego pakietu lub konkretnego spotkania są podłączone. Migracje `202610030005`–`202610030008` zastosowano wyłącznie lokalnie; odbiór tego etapu objął **44 migracje**. Przeszło **862/862 testów w 68 plikach** (19,92 s), **26/26 prób osobnej bazy** z obserwacją 22 zależności blokad (9,67 s) i ponownie **76/76 wcześniejszych prób PostgreSQL** (8,85 s). Nowa ścieżka szkicu, publikacji, odpowiedzi i jawnego przeniesienia kolejnego szkicu na cały pakiet przeszła w 7,7 s. Końcowa kompilacja przeszła **39/39 pełnych E2E** (5,2 minuty), w tym cztery ścieżki fitness. TypeScript, ESLint i układ 320/390 px sprawdzono. Odczyt potwierdził zachowanie pięciu wcześniejszych kont, czterech psów i trzech spacerów oraz brak danych własnych prób fitness. Niepusta kopia 44 migracji przeszła dodatkowy odbiór: 109 tabel i 13 958 wierszy, zachowane logowania i zdjęcia, dwa pakiety fitness, osiem spotkań, rozliczenia, plany i przypomnienie oraz 22 historyczne ponowienia. Źródło i własne sprzątanie sprawdzono. Osobny odbiór restartu rzeczywistego procesu także przeszedł: SIGKILL przed zatwierdzeniem i przed odczytem odpowiedzi oraz SIGTERM trybu ciągłego nie powieliły trzech przypomnień fitness. Dalszy odbiór kart opisano powyżej; pozostają większa kolejka, wielu odbiorców i dalsze warunki wskazane w tabeli.

| Wymaganie / proces                                        | Aktualny dowód                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Dalszy rozwój lub przygotowanie live                                                                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fitness indywidualny w pakiecie                           | Panele obu ról, zachowane warunki, prywatne miejsca, wspólny kalendarz i finanse, przypomnienia każdego spotkania; szkic oraz publikacje całego pakietu lub zakończonego spotkania, odpowiedź opiekuna i jawne przeniesienie kolejnego szkicu bez przepisywania historii. 53 próby PGlite, 26 scenariuszy osobnej bazy i 22 obserwowane zależności blokad. Rzeczywisty E2E obejmuje obie role i zachowanie publikacji po rezygnacji                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Kopia poza komputerem przed live                                                                                                                       |
| Profile psów, kwalifikacja, notatki, zdjęcia              | Rzeczywisty E2E dodania psa i kwalifikacji oraz prywatnych i osobnych zdjęć Psiutków: zgoda, moderacja, publikacja, wymiana, usunięcie i ukrycie; WebP bez metadanych, zachowana orientacja; stare karty zachowują plik i nie nadpisują zmian. Sprzątanie przez Storage API ma trwałą kolejkę, ponowienia po błędzie i cztery rzeczywiste próby konkurujących transakcji. Nowe przesłania są rejestrowane przed danymi, zapisy zamykają je atomowo, a wygasłe trafiają do sprzątania. E2E obejmuje niedokończone przesłania przed i po danych oraz trzy wyścigi wygaśnięcia i zapisu; aktywne zdjęcia pozostają używane. Potwierdzenia moderacji i ukrywania pozostają widoczne                                                                                                                                                                                                                                            | Dawne osierocone pliki, ręczne przesłania bez rejestracji i harmonogram dla docelowego hostingu                                                        |
| Spacery, decyzje, rezerwa, obecność i rezygnacja          | Rzeczywiste E2E kwalifikacji, zapisów automatycznych i na zaproszenie, rezerwy i ręcznej akceptacji, odrzucenia i ponownej decyzji, edycji/copiowania, rezygnacji, przywrócenia i korekt obecności; zachowane formularze po konflikcie, korzystniejszy termin rezygnacji i prywatność zbiórki; niezależne połączenia PostgreSQL obejmują też edycję konkurującą z akceptacją i odwołaniem                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Dodatkowe kombinacje równoczesnych zmian; kwalifikacja przy opłaconym składzie sprawdzona                                                              |
| Finanse spacerów, konsultacji, kursów, fitness i pakietów | Wspólna ewidencja; rzeczywiste E2E stronicowania, częściowych wpłat spacerów/konsultacji, historycznej ceny 175,50 zł oraz rezerwacji i zużycia pakietu. Kursy mają wpłaty za całość, jawne uzgodnienie należności po rezygnacji i częściowe zwroty bez przepisywania pierwotnych wpłat. Test przeglądarkowy sprawdza 40 + 60 zł, należność 30 zł i zwroty 20 + 50 zł; stare formularze zachowują wpisy po konflikcie. Sześć rzeczywistych zależności blokad potwierdza ochronę nadpłaty, ponownego użycia klucza, rezygnacji, starego uzgodnienia i nadmiernego zwrotu. Dawne 76 prób PostgreSQL ponownie przeszło                                                                                                                                                                                                                                                                                                        | Dodatkowe kombinacje wyścigów; wszystkie pięć źródeł karty sprawdzone w panelach                                                                       |
| Plany i postępy                                           | Rzeczywiste E2E na zaproszonym koncie, dla ogólnego planu i pełnej biblioteki: materiał → personalizacja → prywatny szkic → publikacja → kolejne edycje zachowujące wcześniejszy plan; stare karty zachowują pola po konflikcie, identyczne ponowienia nie dodają wersji. Starsza odpowiedź zachowuje publikację, a jawny przegląd usuwa tylko właściwą sprawę. Niezależne połączenia obejmują publikacje, kontakty, odpowiedzi, przegląd oraz dodanie/edycję materiałów. Kursy zachowują własne powiązania publikacji, prywatny szkic i świadomy wybór źródła. Rzeczywisty E2E sprawdza zmianę opiekuna bez przekazania starego zgłoszenia i finansów                                                                                                                                                                                                                                                                     | Pozostałe kombinacje równoczesnych zmian planu i powiązań ze spotkaniami                                                                               |
| Konsultacje                                               | Zgłoszenie, termin, przełożenie, rezygnacja i zakończenie opłaconego spotkania przez zalogowane panele; zachowana cena i wpłaty, odrzucony zapis ze starej karty bez utraty formularza; ręczne uzgodnienie brakującej ceny zachowuje przygotowany termin; historia, kalendarz i przypomnienia sprawdzone przez Auth/API; niezależne połączenia obejmują przełożenie/rezygnację, przełożenie/wpłatę i cenę/rezygnację                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Uzgodnienie docelowych zasad rezygnacji                                                                                                                |
| Katalog i edycja cen                                      | 17 wariantów, robocze 100 zł, historia; rzeczywisty E2E zmiany ceny 100 → 150 zł zachował wcześniejszą kwotę. Kursy mają panele obu ról, cykl, cenę za całość, rezerwę, decyzje, obecności, zmianę terminu, odwołanie, finanse oraz powiadomienia i przypomnienia każdego spotkania. Ponowna decyzja nie zajmuje miejsca; przywrócenie zachowuje wcześniejsze wpłaty, częściowe zwroty, uzgodnienia i plany, z jawną pełną ceną cyklu. 76 testów bazy kursów i dwanaście rzeczywistych scenariuszy obejmuje te procesy, wraz z prywatnym szkicem i publikacjami dla całego cyklu lub spotkania. 28 potwierdzonych zależności blokad oraz dwa pominięcia zajętego źródła sprawdzają współbieżność                                                                                                                                                                                                                           | Docelowe ceny i decyzja o gwarancji świadczenia na karcie                                                                                              |
| Karty podarunkowe                                         | Personalizacja, aktywacja, sześć miesięcy ważności, zapisane przeznaczenie i cena; rozliczenie pięciu źródeł, odrębna sprzedaż, saldo oraz zwroty usług i pieniędzy. 19 rzeczywistych prób osobnej bazy i 18 zależności blokad, pełny E2E karty kwotowej i fitness oraz osobny E2E karty na spacer z korektą usługi i konfliktem dwóch formularzy, jednostronicowy PDF; odtworzenie dwóch kart z 9 historycznymi i 3 nowymi ponowieniami potwierdzone                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Docelowa reguła dopłaty i automatyczne przekazanie PDF po SMTP                                                                                         |
| Wspólny kalendarz                                         | Panel tygodniowych godzin i przerw, prywatność, zapis z dwóch kart, atomowe przeliczenie oraz odrzucenie terminu poza godzinami; osiem nowych prób i sześć obserwowanych blokad. Moduł calendar; rzeczywiste niezależne połączenia potwierdzają odrzucenie nakładających się spaceru i blokady w obu kolejnościach oraz dwóch konsultacji na jeden termin; E2E przełożenia i zwolnienia czasu po rezygnacji; edycja spaceru po kolizji nie zmienia terminu, prywatnej zbiórki ani przypomnień; równoczesna edycja/odwołanie zwalnia zajęty czas                                                                                                                                                                                                                                                                                                                                                                            | Dodatkowe kombinacje zmian; pozostała przerwa po zakończeniu sprawdzona                                                                                |
| Lokalne konta i baza                                      | Działający Supabase z 48 migracjami w Lima (2 CPU / 4 GB), trzy konta demonstracyjne; jawne lokalne adresy launcherów; rzeczywiste sesje obu ról; E2E odrzucenia zmienionego JWT i odebrania roli aktywnej sesji. Pełna kopia schematu 48 migracji odtworzona do osobnych zasobów: 119 tabel i 15 832 wiersze zgodne, zachowane hasła i zdjęcia sprawdzone przez Auth/API. Dwa pakiety fitness z ośmioma spotkaniami zachowują rozliczenia, plany i skrzynki; 22 ponowienia nie powielają zapisów. Dwie karty zachowują kod, saldo i zwroty; 9 historycznych oraz 3 nowych ponowień zachowuje wynik. Dwa niepuste kursy obejmują rozliczenia, częściowy zwrot, powrót, korektę, plany, szkic, odpowiedź i przypomnienia; nowe zapisy oraz historyczne ponowienia działają wyłącznie w odtworzeniu. Wcześniejsze cztery rzeczywiste przerwania SIGTERM/SIGKILL kopii i odtworzenia, odzyskanie oraz sprzątanie potwierdzone | Kopia poza komputerem, retencja i procedura docelowego hostingu; powtarzalność na innym komputerze; awaria zasilania i przerwanie przesyłania archiwów |
| Zaproszenie i odzyskiwanie dostępu                        | Rzeczywisty E2E z Auth i Mailpit: zaproszenie, hasło, profil, reset i nowe logowanie; wygaśnięcie, trzy wysyłki, odrzucenie poprzednich linków; historia, rozpoznanie osobistego hasła i archiwum niewysłanych szkiców z wyszukiwaniem i przywróceniem; GET nie zużywa tokenu                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Zewnętrzny SMTP odłożony                                                                                                                               |
| Pulpit prowadzącej                                        | Najbliższe spotkanie spaceru, konsultacji, kursu i fitness, wspólna kolejka sześciu rodzajów spraw, w tym fitness, filtry i liczniki całego zbioru; rzeczywiste E2E obsługi kontaktów i jawnego przeglądu odpowiedzi przez odnośniki kolejki; poprawne odczyty rzeczywistej sesji przy równoczesnym obciążeniu 50 opiekunów                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Dodatkowe przypadki; sześć filtrów, strony i układ telefonu sprawdzone                                                                                 |
| Kontakty kontrolne, powiadomienia i przypomnienia         | Rzeczywisty E2E kontaktu i odpowiedzi oraz niezależne transakcje. Proces przypomnień sprawdza odbiorców, dwa procesy bez duplikatu, pięć błędów i ręczne wznowienie. Kursy mają transakcyjne wiadomości z historii i odnośniki do konkretnego zgłoszenia/spotkania, zachowany opiekun zgłoszenia i wycofanie nieaktualnych zadań. Nowy E2E potwierdza przełożenie, dwa dostarczania i obie kolejności rezygnacji/dostarczenia. PGlite sprawdza 250 zadań i partie dla 50 uczestników                                                                                                                                                                                                                                                                                                                                                                                                                                       | E-mail po konfiguracji dostawcy; dalsze granice innych awarii. Kolejka 250 i atomowe wycofanie zespołu sprawdzone                                      |
| Gotowość 50 osób                                          | 971 testów w 73 plikach i 45 rzeczywistych scenariuszy Auth/API/przeglądarki we wspólnym przebiegu po dodaniu ustawień kalendarza; siedem potwierdzonych wyścigów zdjęć, pięć domeny kursów, sześć finansów kursów i próba dostarczania/rezygnacji oraz trzy wyścigi publikacji/rezygnacji/ponowienia zgłoszenia i osiem nowych zależności przywrócenia. Zestaw 76 niezależnych transakcji PostgreSQL ponownie przeszedł po zmianie dowodu przyjęcia w uzgodnieniach kursu. Historyczna próba 50 opiekunów i jednej prowadzącej: 1050 odczytów HTML plus 27 odczytów zespołu i 100 wywołań zapisu, lokalny cel p95 < 2 s spełniony; rzeczywiste odtworzenie kopii bazy i plików oraz cztery kontrolowane przerwania procesów                                                                                                                                                                                               | Kopia poza komputerem i pomiar hostingu; dalsze kombinacje awarii. 153 strony przeglądarki sprawdzone                                                  |

Wcześniejszy odbiór 03.10.2026: **745/745 testów w 62 plikach** (15,25 s), **34/34 pełne scenariusze** (4,5 minuty) oraz **76/76 dotychczasowych niezależnych prób PostgreSQL** (8,16 s). [Ponowna decyzja i powrót do kursu](COURSE-REOPENING.md) są dostępne w gotowym lokalnym podglądzie. Nowe dwa scenariusze obejmują oba panele i osiem rzeczywistych zależności blokad; zrzuty 320/390 px sprawdzono wizualnie. Powód pozostaje po konflikcie, a potwierdzenie po udanym zapisie. Przywrócenie zachowuje cenę, wpłaty, częściowe zwroty, uzgodnienia i plany, a powrót po odmowie nie zajmuje miejsca. Po poprawie samego fragmentu zrzutu przeglądarkowy przebieg ponownie przeszedł w 6,8 s; kod produktu pozostał ten sam. Build, końcowy TypeScript, ESLint i kontrola różnic przeszły. Odczyt potwierdził 40 migracji, wszystkie trzy konta demonstracyjne i zachowanie pięciu wcześniejszych kont, bez nowego konta z tego dnia oraz bez kursów, potwierdzeń powrotu/edycji, korekt, szkiców/publikacji kursowych i innych danych prób kursowych. 17 aktywnych usług nadal ma robocze ceny 100 zł. Produkcji nie zmieniano; pełny cel pozostaje aktywny.

Wcześniejsza [próba kopii](LOCAL-BACKUPS.md#wcześniejszy-wynik-03102026--40-migracji) 03.10.2026 potwierdziła odtworzenie **całego bieżącego schematu 40 migracji, 103 tabel i 8011 wierszy**, trzech logowań, dwóch zdjęć oraz niepustych danych dwóch kursów. Zachowano rozliczenia, częściowy zwrot i przywrócenie, ustawienia, korektę obecności, dwie publikacje, prywatny szkic, odpowiedź do wcześniejszej wersji, pięć przypomnień oraz niedokończoną rezerwację zdjęcia. Nowe operacje i historyczne ponowienia przez odtworzone API działają bez zmiany źródła. Wszystkie wcześniejsze tabele `public` zachowały liczby i skróty wierszy po usunięciu własnych danych próby; usługi, reguły połączeń, brak zasobów odtworzenia i gotowy podgląd sprawdzono. Osiem testów granic kopii i ESLint przeszły. Nie zmieniano kodu produktu ani migracji; powyższy pełny odbiór produktu jest osobnym przebiegiem. Pozostaje kopia poza komputerem i procedura docelowego hostingu.

Moduł [konsultacji i zaleceń](CONSULTATION-CARE.md): prowadząca może przygotować szkic do umówionego spotkania i opublikować go po zakończeniu konsultacji. Każda publikacja zachowuje własne powiązanie i adres; powiadomienia otwierają konkretną wersję. Dotychczasowe szkice nie zmieniają powiązania po samym otwarciu strony z innego spotkania. Test przeglądarkowy wykrył i pozwolił naprawić utratę wybranego powiązania po zapisie; tę samą ochronę dodano do rodzaju ceny i widoczności usługi.

Weryfikacja 01.10.2026: **489/489 testów w 49 plikach**, w tym 15 testów izolacji lokalnego launchera i zgodności kompilacji z konfiguracją. Cztery pełne scenariusze lokalnego Auth/API/Mailpit/Storage zakończone poprawnie na gotowej kompilacji (58,0 s). Izolowane testy interfejsu: 32 warianty planów, 28 konsultacji, 24 cennika i 24 kalendarza — łącznie **108**. Obejmują odzyskanie formularza po błędzie, poprawne wersje zapisu i różne szerokości ekranu. Test pełnej konsultacji celowo wstrzymuje ładowanie skryptów: pola pozostają nieaktywne do gotowości obsługi i nie gubią daty. Tę ochronę zastosowano także w edytorach planów, materiałów, cennika, blokad kalendarza i kontaktów kontrolnych oraz wyborze usługi.

Naprawiono mobilne menu: zamknięte nie przyjmuje fokusu, otwarte blokuje tło i przewijanie, zatrzymuje fokus wewnątrz, obsługuje Escape i przywraca fokus przyciskowi. Sprawdzono to w rzeczywistym E2E; wykonano także przegląd zrzutów listy zaproszeń i potwierdzenia hasła. Kontrola typów i ESLint zmienionego kodu zakończone poprawnie. Instrukcja uruchamiania wskazuje lokalne launchery i nie wymaga nadpisywania `.env.local` ani resetu danych.

Oddzielny build z 01.10.2026 zakończony poprawnie wraz z TypeScript przez `pnpm local:build`. Korzysta z rzeczywistego lokalnego Supabase i jest zapisany w `.next-local/`. `pnpm local:preview` sprawdza identyfikator i skrót konfiguracji, zanim uruchomi go na localhost:3000. Podgląd obecnie działa; zmiany kodu wymagają ponownej kompilacji i restartu albo powrotu do `pnpm local:dev`. Nie jest to publikacja produktu ani jeszcze pomiar 50 sesji.

Weryfikacja 02.10.2026: **16/16 rzeczywistych prób współbieżności PostgreSQL 17.6** (2,64 s) przez `pnpm local:concurrency`. Obserwator potwierdził 17 oczekiwań na blokadę między konkretnymi procesami bazy, zanim zwolniono pierwszą transakcję. Wyniki obejmują statusy, kwoty, audyt, powiadomienia, pakiety i pojedynczą publikację z kontaktem kontrolnym. Wszystkie własne dane próbne usunięto. ESLint nowego kodu testowego przeszedł. [Zakres i powtarzalne uruchomienie](LOCAL-DEVELOPMENT.md#równoczesne-operacje-w-rzeczywistej-bazie). Moduł cennika ponownie sprawdzono: w lokalnej bazie 17 aktywnych pozycji po 100 zł, 28 testów modułu i 24 scenariusze interfejsu przeszły poprawnie.

Kolejna weryfikacja 02.10.2026: **490/490 testów w 49 plikach** (27,0 s), **pięć pełnych E2E** na lokalnej kompilacji (1,4 minuty) i ponownie **16/16 prób niezależnych transakcji** po dostosowaniu wspólnego pomocnika do Playwright (2,82 s). Nowy [scenariusz przypomnień](REMINDERS-MODULE.md) uruchamia prawdziwy proces przez PostgREST, sprawdza dwóch dostawców, pięć rzeczywistych niepowodzeń, wznowienie w panelu i skuteczną szóstą próbę. Wykrył i pozwolił poprawić znikające potwierdzenie wznowienia oraz ucięty przycisk na telefonie. Przy szerokości do 360 px nagłówek ma własny wiersz. Zrzuty 320/390/768/1440 px sprawdzono; powtórzono wszystkie E2E po zmianie wspólnego nagłówka. Najnowszy lokalny build i TypeScript przeszły; podgląd został ponownie uruchomiony. Nie uruchomiono stałego harmonogramu przypomnień.

Najnowsza weryfikacja 02.10.2026: **502/502 testy w 50 plikach** (26,61 s), **6/6 pełnych E2E** (1,4 minuty), lokalny build z TypeScript i ESLint zmienionego kodu. [Historia zaproszeń](INVITATIONS-MODULE.md) jest dostępna w panelu prowadzącej. Rzeczywiste próby potwierdziły wygaśnięcie, zastąpienie wcześniejszych linków i zmianę etapu po ustawieniu hasła. Wykryto i poprawiono błędne uznawanie losowego hasła Auth za hasło opiekuna. Starsze konta bez dowodu ustawienia hasła mają uczciwie oznaczony niepotwierdzony stan. Przy zmianie szerokości okna linki zamkniętego menu nie pozostają już przez chwilę widoczne nad treścią. Zastosowano dwie migracje wyłącznie lokalnie; podgląd jest ponownie uruchamiany po kompilacji.

Po dodaniu archiwum 02.10.2026: **514/514 testów w 50 plikach** (12,36 s), **6/6 pełnych E2E** (1,0 minuty), **19/19 niezależnych prób PostgreSQL** (2,18 s, 21 potwierdzonych oczekiwań na blokady), lokalny build z TypeScript i ESLint. Archiwizacja oraz przywrócenie nie wysyłają wiadomości; wyszukiwanie zachowuje adres przy zmianie widoku. Pełny test sprawdził także odmowę wysyłki archiwalnego szkicu, odmowę archiwizacji po pierwszej próbie i brak duplikatu adresu. Zrzut archiwum na telefonie 320 px oraz historię na komputerze sprawdzono wizualnie. Migrację `202610020003` zastosowano lokalnie, a podgląd uruchomiono z nowej kompilacji.

Po pomiarach 02.10.2026: **541/541 testów w 54 plikach** (12,58 s), **8/8 pełnych E2E** (48,7 s), **19/19 niezależnych prób PostgreSQL** (2,08 s, 21 potwierdzonych oczekiwań na blokady), lokalny build z TypeScript i ESLint zmienionego kodu. Nowy E2E finansów sprawdza po 31 rekordów w każdej z trzech list, pełne sumy, otwarcie konkretnego pakietu i należności poza pierwszą stroną, wpłatę za pakiet oraz odmowę dostępu do obcych danych. Nawigację sprawdzono przy 320/390/768/1440 px. Drugi nowy E2E potwierdza odmowę dla zmienionego JWT, `private, no-store` i ponowne sprawdzenie aktualnej roli przy kolejnym żądaniu.

[Próba 50 kont](PILOT-LOAD.md) na końcowej kompilacji zakończyła się poprawnie: przy 50 równoczesnych żądaniach opiekunów p95 wyniosło **1123,68 ms dla pulpitu, 937,65 ms dla zaleceń i 1084,00 ms dla finansów**. Odczyty prowadzącej także pozostały poniżej 2 s. Zapis zachował cztery miejsca przy 50 chętnych; 50 ponowień wpłaty utworzyło jeden wpis 100 zł. Wszystkie 50 sesji miało sprawdzoną izolację, a sprzątanie potwierdziło brak danych własnej próby. Raport `4c00c4e3-5cc4-4465-85d8-1aa23a813e47` jest prywatny w `.local/pilot-load/`.

Pomiar pozwolił przyspieszyć polityki SELECT bez zmiany zakresu widoczności, współdzielić odczyty wewnątrz jednego żądania i ograniczyć renderowanie finansów do 20 pozycji na listę przy zachowaniu pełnych sum. Regresja uprawnień porównuje 15 tabel i 54 kombinacje stanów spacerów. Kolejne żądanie nadal sprawdza użytkownika w Auth i aktualną rolę w bazie. Nie stosowano nowych migracji w chmurze ani nie publikowano aplikacji.

Dodano [lokalne kopie i ich odtworzenie](LOCAL-BACKUPS.md). Końcowa próba `c326e4bd-527e-4dad-807c-3afc542829c3` potwierdziła fizyczną integralność, schemat i wszystkie wiersze **87 tabel użytkowych**, gotowość odtworzonych usług, **trzy rzeczywiste logowania zachowanymi hasłami**, właściwe role, prywatność psa i notatek oraz **dwa zdjęcia** pobierane po odtworzeniu. Obce i anonimowe konta nadal nie miały dostępu. Wszystkie 27 migracji zgadzały się z repozytorium; własne zasoby i dane próbne usunięto. Źródła nie zastępowano. Kopie, klucze i logi pozostają prywatne w `.local/backups/`, bez wysyłania do chmury.

Po dodaniu narzędzia kopii: **546/546 testów w 55 plikach** (21,90 s), TypeScript bez błędów i ESLint całego nowego kodu. Osobna końcowa kontrola lokalnej bazy potwierdziła zero własnych kont, psów i plików próby oraz zachowanie 27 migracji. Nie zmieniano kodu ekranów w tym etapie, dlatego wcześniejsze osiem E2E pozostaje odrębnym dowodem działania aplikacji; scenariusz odtworzenia jest dodatkową próbą Auth/API/Storage.

Po poprawieniu odzyskiwania: **549/549 testów w 55 plikach** (12,40 s), TypeScript i ESLint bez błędów. Raport `d5b787ad-6182-4017-ab53-eae1f614dcf2` potwierdził cztery przerwania własnych, żywych procesów: SIGTERM/SIGKILL przy wstrzymanym źródle oraz po utworzeniu zasobów lub uruchomieniu usług odtworzenia. Równoczesne operacje i odzyskiwanie żywego procesu zostały odrzucone bez zmiany ich stanu; niedokończone kopie nie tworzą zasobów odtworzenia. Wszystkie oryginalne kontenery, reguły połączeń i uprawnienia zachowano, a własne zasoby usunięto. Dzienniki są zapisywane przed zmianami, blokada pozostaje po śmierci procesu, konfiguracja jest zastępowana kompletnym plikiem. Odczyty Docker wybierają jawnie typ zasobu, co poprawia sprzątanie kontenera i wolumenu o tej samej nazwie. [Polecenia odzyskiwania i dokładny zakres](LOCAL-BACKUPS.md).

Na końcowym kodzie kopia `b067e471-6b3f-459e-a3a6-171954913e13` ponownie przeszła pełne odtworzenie **87 tabel / 2661 wierszy**, trzy logowania i pobranie dwóch zdjęć z izolacją dostępu. Końcowa kontrola potwierdziła oryginalny plik reguł, dziewięć usług źródłowych, brak blokady i sesji blokady, brak zasobów próbnego odtworzenia, zero kont i plików własnej próby oraz 27 migracji. Nie zmieniano ekranów aplikacji ani konfiguracji chmury.

Po rozszerzeniu prób konsultacji 02.10.2026: **32/32 niezależne scenariusze PostgreSQL w 3,38 s**, z 34 potwierdzonymi zależnościami blokad. Trzynaście nowych przypadków sprawdza wpłaty, korekty, odwołanie, przełożenie i konkurencję o jeden termin wraz z saldem, historią, audytem, powiadomieniami i przypomnieniami. Nowy rzeczywisty [E2E rozliczenia konsultacji](CONSULTATION-FINANCE.md) przeszedł w **13,4 s** (14,0 s z uruchomieniem). Obejmuje formularze obu ról, częściowe wpłaty 40 i 60 zł, zmianę ceny katalogowej bez zmiany wcześniejszej kwoty, konflikt starej karty, przełożenie, rezygnację i dwa zwroty. Bezpośrednie wywołania API potwierdziły odmowę wpłaty i korekty dla opiekuna oraz odmowę dostępu do obcych danych. Historię sprawdzono wizualnie przy 320 i 390 px. Własne konta, psy, konsultacje, wpłaty i dodatkową usługę usunięto; 17 zaimportowanych usług pozostało aktywnych po robocze 100 zł. TypeScript, ESLint i kontrola różnic przeszły. W tym etapie zmieniano testy i dokumentację; wcześniejsze osiem E2E oraz 549 testów pozostają odrębnymi przebiegami, bez ponownego uruchamiania całego zestawu.

Po dodaniu historycznej kwoty 02.10.2026: **570/570 testów w 55 plikach** (33,80 s), **10/10 E2E** we wspólnym przebiegu (około 1,5 minuty), **38/38 niezależnych prób PostgreSQL** (4,09 s, 40 potwierdzonych zależności blokad), lokalny build z TypeScript i ESLint bez błędów. [Uzgodnienie brakującej ceny](CONSULTATION-FINANCE.md#starsze-spotkanie-bez-ceny) zachowuje wcześniejsze warunki, zapisuje powód i powiadamia opiekuna w aplikacji. E2E sprawdził pustą kwotę, opóźnione ładowanie skryptów, zachowanie formularza po błędzie, konflikt drugiej karty, cenę 175,50 zł, wpłatę i zakończenie opłaconego spotkania. Wpisane wcześniej data, forma, miejsce i wiadomość pozostają po zapisie ceny, a potwierdzenie obejmuje tylko własną aktualną wersję historii. Po końcowej drobnej korekcie tekstu ten E2E ponownie przeszedł w 10,4 s. Zrzuty 320 i 390 px sprawdzono wizualnie po wczytaniu końcowego stanu. Odczyt bazy potwierdził 28 migracji, zachowanie pięciu wcześniejszych kont, brak kont współbieżnej próby i psów nowego testu oraz 17 aktywnych usług po robocze 100 zł. Wcześniejsze kopie i pomiar 50 kont pozostają osobnymi historycznymi przebiegami. Produkcji nie zmieniano.

Po rozszerzeniu rozliczeń spacerów 02.10.2026: **580/580 testów w 56 plikach** (35,04 s), **13/13 pełnych E2E** we wspólnym przebiegu (2,5 minuty) oraz **48/48 niezależnych prób PostgreSQL** (7,85 s, 50 potwierdzonych zależności blokad). Trzy nowe E2E sprawdziły rzeczywiste panele obu ról: wpłaty 40 i 60 zł, rezygnację i zwroty, korekty obecności z ponowną należnością, rezerwację/zużycie/zwrot pakietu, przywrócenie zgłoszenia i odwołanie organizatora. Zwrot i usprawiedliwienie nieobecności dawały wcześniej różny status w zależności od kolejności; lokalna migracja `202610020006` naprawia wynik bez zmiany kwot lub historii. Konflikt wykorzystanego już wejścia odrzuca korektę atomowo, zachowuje wybraną obecność i wskazuje sprawdzenie przydziałów. Po uzgodnionej zmianie przydziału ponowienie działa i zachowuje pojedyncze zużycie.

Układ salda pakietu przy 320 px ma teraz pełne etykiety w osobnych wierszach. Po zmianie CSS, nowej kompilacji i uruchomieniu podglądu ponownie przeszły **4/4 E2E spacerów i stronicowania finansów** (1,1 minuty). Zrzuty końcowego salda i formularza błędu 320/390 px sprawdzono wizualnie. TypeScript, ESLint zmienionego kodu i kontrola różnic zakończyły się poprawnie. Końcowa baza ma 29 migracji, zachowane pięć wcześniejszych kont, zero kont niezależnych prób współbieżności i psów nowych testów oraz 17 aktywnych usług po robocze 100 zł. Lokalny podgląd odpowiada na localhost:3000; nie stosowano migracji w chmurze ani wdrożenia.

Po odbiorze decyzji i edycji spacerów 02.10.2026: **16/16 pełnych E2E** we wspólnym przebiegu (2,9 minuty) oraz **56/56 niezależnych prób PostgreSQL** (7,01 s, 58 potwierdzonych zależności blokad). Trzy nowe scenariusze sprawdzają rezerwę bez automatycznego awansu, odmowę przyjęcia ponad limit, odrzucenie/powrót do decyzji, ukrywanie zbiórki po cofnięciu akceptacji, dwa otwarte edytory, kolizję terminu, kopiowanie samych ustawień, spacer na zaproszenie i automatyczny zapis na ostatnie miejsce. Pomyślny zapis aktualizuje wiadomości i przypomnienia obu opiekunów; nieudany nie zmienia żadnego z tych danych. Zmiana terminu zachowuje wcześniejsze warunki rezygnacji, a stara karta nie nadpisuje nowszej zmiany i zachowuje wpisane pola. Osiem nowych prób współbieżności potwierdza te reguły przy rzeczywistych oczekiwaniach na blokady.

Opiekun widzi teraz krótkie wskazówki przy zgłoszeniu oczekującym, rezerwowym i odrzuconym. Sześć zrzutów rezerwy, przyjęcia, konfliktu pojemności, starej karty, zmiany terminu i zaproszenia 320/390 px sprawdzono wizualnie na końcowej kompilacji. Build z TypeScript, ESLint zmienionego kodu i kontrola różnic przeszły. Końcowy odczyt potwierdził 29 migracji, zachowanie pięciu wcześniejszych kont, brak psów nowych prób i kont współbieżności, 17 aktywnych usług po robocze 100 zł oraz działający lokalny podgląd. Zestaw 580 testów, obciążenie 50 kont i odtworzenie kopii pozostają osobnymi wcześniejszymi przebiegami. Nie stosowano migracji ani wdrożenia w chmurze.

Po odbiorze [kontaktów kontrolnych i odpowiedzi](WORK-MODULE.md) 02.10.2026 przeszło **18/18 pełnych E2E** (3,2 minuty) i **70/70 niezależnych prób PostgreSQL** (9,19 s, 72 potwierdzone zależności blokad). Poprawiono ukrywanie potwierdzenia pierwszej publikacji przez zwinięcie formularza i reset listy działań po odmowie przełożenia kontaktu. Końcowe usunięcie powtórzonego odnośnika do planu sprawdzono po nowej kompilacji przez **2/2 E2E w 17,9 s**. Przegląd siedmiu zrzutów 320/390/1440 px i końcowej karty odpowiedzi potwierdził czytelność. Build z TypeScript, ESLint i kontrola różnic przeszły. Baza ma 29 migracji, pięć kont, zero danych nowych prób i 17 aktywnych usług po robocze 100 zł; lokalny podgląd ma gotowy, zgodny manifest i odpowiada na localhost:3000. W tym etapie nie dodawano migracji ani nie publikowano aplikacji. Wcześniejsze 580 testów, próba 50 kont i kopie pozostają oddzielnymi przebiegami.

Po odbiorze [biblioteki i personalizacji](CARE-MODULE.md#biblioteka-i-personalizacja) 02.10.2026 przeszło **588/588 testów w 56 plikach** (13,29 s), **19/19 pełnych E2E** we wspólnym przebiegu (3,7 minuty) i **76/76 niezależnych prób PostgreSQL** (9,12 s). Pierwszy materiał nie ukrywa już potwierdzenia przez zwinięcie formularza. Migracja `202610020007`, zastosowana wyłącznie lokalnie, obsługuje ponowienia własnego identycznego zapisu bez nowej wersji i audytu; konkurujące treści nadal otrzymują konflikt. Tekst materiałów i planów ma jednolity zapis akapitów przed walidacją, także przy granicy 20 000 znaków. E2E sprawdza personalizację, prywatny szkic, historię, odmowę dostępu do biblioteki przez opiekuna oraz zachowanie wcześniejszych publikacji po edycji materiału. Cztery zrzuty 320/390/1440 px sprawdzono wizualnie. Lokalny build z TypeScript, ESLint zmienionego kodu i kontrola różnic przeszły. Nie zmieniano usług ani cen katalogowych, danych produkcji lub konfiguracji chmury.

Końcowy odczyt po tym przebiegu potwierdził 30 migracji, zachowanie pięciu wcześniejszych kont, zero kont współbieżnej próby, psów nowych testów i materiałów próbnych oraz 17 aktywnych usług po robocze 100 zł. Manifest lokalnego podglądu jest gotowy i zgodny z identyfikatorem kompilacji; sprawdza konfigurację lokalnych adresów, nie skróty plików źródłowych. Kod modułu care sprawdzono oddzielną kompilacją i wymienionymi testami. Logowanie na localhost:3000 odpowiada HTTP 200; podgląd pozostaje uruchomiony.

To jest dowód działania opisanych ścieżek z lokalnym Auth, PostgREST, Storage i Mailpit, wymienionych niezależnych transakcji, pełnych odpowiedzi HTML dla 50 lokalnych sesji, lokalnego odtworzenia danych i plików oraz odzyskania po przerwaniu procesów w wymienionych punktach. Nie dowodzi gotowości zewnętrznego SMTP, czasu renderowania w przeglądarce, hostingu, odporności na awarię zasilania lub dysku ani wszystkich operacji współbieżnych. Ten wcześniejszy odbiór nie był końcem prac. Bieżący wynik lokalnego MVP oraz przygotowania do live opisano na początku dokumentu.
