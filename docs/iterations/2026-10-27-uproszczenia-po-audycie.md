# Uproszczenia po audycie — lokalnie, 27.10.2026

## Zakres i decyzja

Użytkownik: „oki po analizie zrob poprawki”. Podstawą jest
[audyt z 26.10](2026-10-26-audyt-prostoty.md) oraz wcześniejsze lokalne uproszczenia
zaleceń i kursu. Zgoda obejmuje wykonanie poprawek i lokalny odbiór. Nie obejmuje
publikacji, aktywacji integracji, nowych zasad cen/pakietów ani migracji produkcji.
Głosówki pozostają osobnym pomysłem.

Niezależne propozycje biznesu i techniki powstały podczas audytu. Po nowym poleceniu
biznes doprecyzował wyjątki bieżących zgłoszeń; technika określiła realizację
poszczególnych zakresów. Poniższe AC są przyjętym przez koordynatora kontraktem
przed implementacją. Recenzent oceni faktyczny diff w nowym kontekście.

## Kryteria

| AC    | Wymagane zachowanie                                                                                                                                                                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Karta psa obu ról zaczyna się od podglądu i statusu. Profil, ankieta i zdjęcie są edytowane na żądanie, z widocznym stanem uzupełnienia i odczytem potrzeb.                                                                                                                                  |
| AC-02 | Kwalifikacja i notatki Asi są przed długimi edycjami. Prywatność, ponowna ocena i prywatny brief onboardingu zachowują obecne znaczenie.                                                                                                                                                     |
| AC-03 | Spacer admina: informacje organizacyjne kompaktowo, ostrzeżenia widoczne, bieżący skład i oczekujące decyzje przed pomocniczym dodawaniem i historią. Rezerwa i nierozliczone wycofane zgłoszenia pozostają dostępne.                                                                        |
| AC-04 | Decyzje i obecności spaceru otwierają się przy konkretnym psie; wszystkie dotychczasowe akcje i kotwice są zachowane. Bez automatycznego „wszyscy obecni”.                                                                                                                                   |
| AC-05 | Konsultacja requested pokazuje ustalenie terminu; scheduled podgląd i rozwijaną zmianę. Potrzebne uzgodnienie ceny i konflikt pozostają widoczne. Po upływie spotkania zamknięcie i zalecenia są przed historią także na telefonie.                                                          |
| AC-06 | Fitness obu ról ma zwięzłe podsumowanie, widoczny postęp i sprawy wymagające obsługi; jedno rozwinięte spotkanie oraz dostęp do wszystkich pozostałych. Warunki, historia i ustawienia są wtórne.                                                                                            |
| AC-07 | Nieumówione/odwołane spotkania i zaległe obecności fitnessu nie znikają za wyborem najbliższego terminu. Saldo, zwrot, rezygnacja i korekty zachowują znaczenie.                                                                                                                             |
| AC-08 | „Szczegóły” z kalendarza i najbliższego spotkania wskazują dokładny termin kursu/fitnessu. Odczyt opiekuna rozpoznaje ID po dozwolonych danych, nie po tytule. Bez odczytu admin/service_role.                                                                                               |
| AC-09 | Powtórne kliknięcie tej samej kotwicy odsłania właściwą sekcję. Zachowany kontekst powrotu jest ograniczony do wewnętrznych dozwolonych tras.                                                                                                                                                |
| AC-10 | Start opiekuna obejmuje bieżące zgłoszenia spaceru, konsultacji, kursu, fitnessu i prośby o termin: pies, usługa, data lub do ustalenia, status i dokładny odsyłacz.                                                                                                                         |
| AC-11 | Data nie zamyka sprawy: requested/scheduled konsultacji, requested/active fitnessu, open prośby, requested/waitlisted kursu oraz accepted w niezakończonym cyklu pozostają bieżące. Spacer: pending/rezerwa w nieodwołanym i niezakończonym, accepted przed końcem lub z attendance pending. |
| AC-12 | Należność, needs_settlement/needs_review, refund_due lub wpłata needsReview podtrzymują widoczność niezależnie od statusu i daty. Korzystamy z obecnego modelu sald, bez nowych reguł pieniędzy.                                                                                             |
| AC-13 | Rozstrzygnięte i rozliczone zgłoszenia są dostępne w historii. Ewentualne ograniczenie listy ma jawny dostęp do reszty. Ostrzeżenia kwalifikacji, odwołania i onboarding pozostają.                                                                                                          |
| AC-14 | Pusty komunikat adminowej kolejki określa jej faktyczny zakres; pozostałe zgłoszenia mają odsyłacze. Bez rozszerzenia staff_work_items, nowych priorytetów i liczników.                                                                                                                      |
| AC-15 | Kurs opiekuna pokazuje status udziału, terminy i saldo przed długą historią. Adminowy skład ma kompaktowe wiersze, z widoczną kwotą/wyjątkiem i sygnałem szkicu; pełne rozliczenia i zalecenia przy wybranym psie.                                                                           |
| AC-16 | Odpowiedź opiekuna na plan zaczyna się jednym wymaganym polem, dwa dalsze są opcjonalne. Zachowane pola, blokada kontekstu/wersji i wpisany tekst.                                                                                                                                           |
| AC-17 | Finanse kursu/fitnessu prowadzą bezpośrednio do istniejącego rozliczenia. Bez przenoszenia księgowania. Puste dodatki nie konkurują z bieżącą sprawą; zwroty i niepewne wpłaty pozostają widoczne.                                                                                           |
| AC-18 | Jednoznaczna wybrana usługa/pies/prowadząca może być podsumowaniem z możliwością zmiany. Brak wyboru, błędny URL, historyczny/null przydział i walidacja nadal są obsługiwane.                                                                                                               |
| AC-19 | Cena i widoczność są główną edycją cennika; rzadsza konfiguracja i historia pomocniczo. Pełny payload, wersje, testowa cena i historyczne warunki bez zmian.                                                                                                                                 |
| AC-20 | Ograniczyć powtórzenia nagłówków i ujednolicić nazwy planowania; szybki dostęp do spacerów pozostaje w odpowiednim kontekście. Menu główne i zaakceptowane widoki kalendarza zachowują strukturę.                                                                                            |
| AC-21 | Zwijanie nie odmontowuje formularzy i nie kasuje szkicu. Błąd, sukces lub ostrzeżenie po zamknięciu oczekującej sekcji odsłania właściwy formularz przed ustawieniem focusu.                                                                                                                 |
| AC-22 | Sprawdzić obie role, puste i niepuste stany, długie treści, 320/390/768/1440 px, klawiaturę, kotwice i najważniejsze akcje z prawdziwym lokalnym zapisem. Zachować wcześniejsze lokalne zmiany i dane.                                                                                       |

## Własność plików

- Technika A: `components/dogs.tsx`, `components/walks.tsx`, własne CSS i testy.
- Technika B: widoki, formularze i CSS konsultacji/fitnessu, testy tego zakresu.
- Technika C: start opiekuna, nowe pliki dashboard, rozszerzenie podsumowania
  finansów, komunikaty kolejki, własne testy.
- Koordynator: komponenty wspólne, nawigacja/kalendarz, pozostałe UI i integracja,
  dokumentacja oraz końcowy odbiór. Kolejne delegacje dostaną osobne zakresy.
- Recenzent: bez zmian kodu i testów, niezależny odczyt diffu i kontrole.

## Wynik i ograniczenia

### Zrealizowana zmiana

- Karta psa zaczyna się od podglądu, potrzeb i kwalifikacji. Formularze profilu,
  ankiety i zdjęcia otwierają się na żądanie; notatki Asi zachowują prywatność.
- Spacer admina pokazuje najpierw zwięzły termin, ostrzeżenia i skład, podzielony
  na decyzje, przyjętych i rezerwę. Obsługa odbywa się przy wybranym psie.
- Konsultacja prowadzi do ustalenia terminu, zmiany lub zakończenia odpowiednio
  do stanu. Bieżące czynności i rozliczenie są przed historią również w DOM.
- Fitness ma postęp, widoczne zaległe/nieumówione sprawy oraz jedno otwarte
  spotkanie. Ustawienia, warunki i historia są pomocnicze. Kurs opiekuna ma
  kompaktowe terminy, a adminowy skład zwięzłe wiersze z saldem i sygnałem szkicu.
- Start opiekuna obejmuje pięć rodzajów zgłoszeń. Data nie zamyka nierozstrzygniętej
  sprawy; wyjątki finansowe pozostają widoczne. Historia i wszystkie pozostałe
  bieżące sprawy są dostępne, bez ucinania danych do pierwszej strony.
- Szczegóły z kalendarza wskazują ID konkretnego spotkania. Opiekun odczytuje
  identyfikatory i czas przez własne RLS, bez odczytu administracyjnego. Linki
  z kolejki zachowują dozwolony filtr i stronę powrotu.
- Odpowiedź na zalecenia zaczyna się jednym wymaganym polem, dalsze dwa są
  opcjonalne. Wybrane jednoznacznie usługa/pies/prowadząca są podsumowaniem;
  pełny wybór i walidacja pozostają. Cennik eksponuje cenę i widoczność.
- Rozliczenia mają bezpośrednie odsyłacze do kursu/fitnessu i mniej pustych kart.
  Needs-review, niepewne wpłaty oraz zwroty nie są traktowane jako rozliczone.
- Wspólne rozwijane sekcje zachowują zamontowane formularze i wpisany tekst.
  Wynik zapisu oraz błąd/warning odsłaniają właściwy formularz przed focusem.
  Powtórne kliknięcie bieżącej kotwicy również odsłania jej cel.

### Odbiór

- Pełne **2040/2040 testów w 143 zestawach PASS**; lokalny build Next.js,
  TypeScript i ESLint źródeł PASS.
- Odczyt rzeczywistego lokalnego podglądu: **31 stron przy 1440 px i sześć
  wariantów szczegółów przy 390 px**, bez poziomego przepełnienia. W tej próbie
  blokowano biznesowe POST oraz ruch zewnętrzny; dane istniejących kont DEMO
  nie zawierają wszystkich stanów konsultacji/kursu/fitnessu.
- Dodatkowe kontrole rzeczywistych komponentów w Chrome: kurs **64 warianty**,
  konsultacje/fitness **52**, usługi/cennik **36**, utrzymanie szkicu i feedback
  **6 scenariuszy**, odświeżenie składu spaceru **4 scenariusze** — PASS.
  Obejmują 320/390/768/1440 px, długie treści, klawiaturę, kotwice i oczekujące
  formularze. To kontrolowane komponenty z atrapami, bez realnego operatora.
- Rzeczywiste lokalne ścieżki Next/Supabase: po dostosowaniu testów zaliczono
  **28 różnych scenariuszy Chromium oraz pięć WebKit**. Obejmują nowy onboarding,
  psa i kwalifikację, decyzje/rezerwę spacerów, konsultację i historyczną cenę,
  częściowe wpłaty/zwroty, kurs i obecności, fitness, zalecenia, kontakty kontrolne,
  raportowanie i wygasły dostęp, prośby o termin oraz filtry/paginację kolejki.
  Dokładny termin z kalendarza opiekuna sprawdzono dla kursu i fitnessu przez
  rzeczywiste odczyty jego sesji; test kursu przeszedł również WebKit.
- Końcowe TypeScript, lint zmienionych testów, formatowanie i `git diff --check`
  PASS. Identyczne zdublowane pliki wygenerowanych typów Next (`… 2.ts`) przeniesiono
  poza katalog kompilacji; nie zmieniano źródeł dla obejścia błędu typowania.
- Przed i po E2E porównano liczniki oraz skróty wszystkich **93 tabel publicznych**.
  **92 są identyczne**, w tym wcześniejsze dane biznesowe i profile. Jedyna zmiana
  to techniczny `reminder_worker_state`: czas i wynik ostatniego lokalnego przebiegu
  procesora przypomnień (końcowo 0 wysłanych/błędów). Wygenerowane konta i rekordy
  scenariuszy usunięto. To porównanie nie jest kopią ani odtworzeniem produkcji.

| Kryteria | Dowody w sprawdzonym zakresie                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01–04 | Testy podglądu psa/składu, odzyskiwanie formularza, stale qualification, cztery pełne scenariusze decyzji/edycji spacerów, kontrola mobilna.                                                                                    |
| AC-05–07 | Testy stanów konsultacji/fitnessu, 52 warianty komponentów, realne konsultacje/fitness z wpłatą, odwołaniem, korektą i historią.                                                                                                |
| AC-08–09 | Regresje dokładnego ID i bezpiecznego powrotu, kotwice/powtórne kliknięcie, kalendarz opiekuna obu modułów oraz rzeczywista paginacja i cele sześciu filtrów kolejki.                                                           |
| AC-10–14 | Regresje modelu bieżących spraw, paginowanych odczytów i wyjątków finansowych, realny start DEMO oraz kolejka i prośba o termin. Mieszane stany dashboardu pokryto testami modelu/odczytów, nie pełnym osobnym pilotem 50 osób. |
| AC-15–20 | 64 warianty kursu, 36 usług/cennika, rzeczywiste terminy/uczestnicy/rozliczenia, jeden wymagany raport i zachowanie kontekstu, kontrole pustych finansów i nagłówków.                                                           |
| AC-21–22 | Sześć scenariuszy utrzymania szkicu, cztery zmiany statusu spaceru, pending-close i stare wersje z rzeczywistym zapisem, pięć scenariuszy WebKit, kontrolowane szerokości 320/390/768/1440 i porównanie tabel.                  |

### Znalezione problemy i poprawki

- Niezależny recenzent wskazał brak kotwicy kwalifikacji, błąd przy tablicowym
  `returnTo` oraz zbyt szeroki pusty komunikat pełnej kolejki. Wszystkie poprawiono
  i sprawdzono regresjami. Neutralne nazwy kontekstu zaleceń nie sugerują już
  opiekunowi, że bieżący kurs/pakiet jest poprzedni.
- Rzeczywisty test ReactDOM wykazał odmontowanie formularza decyzji spacerowej
  po przejściu między grupami statusów. Stabilny wspólny rodzic zachowuje teraz
  tożsamość formularza, wynik i szkic; recenzent niezależnie potwierdził poprawkę.
- Długie imię psa rozszerzało fitness przy 320 px; poprawiono zawijanie i grid.
- Pierwsze E2E ujawniły nieaktualne selektory pól i literalne linki bez nowego
  `returnTo`. Testy otwierają teraz właściwe sekcje przez widoczne podsumowania;
  zachowano asercje kwot, uprawnień, prywatności i wersji. Pomocnik nie rezygnuje
  z kliknięcia przed pierwszym layoutem; nie wymusza otwarcia przez mutację DOM.
- Test blokady zakończenia fitnessu odczytuje natywną właściwość `option.disabled`.
  Osobna minimalna próba potwierdziła, że matcher `toBeDisabled` dla opcji wewnątrz
  `label` rozpoznaje stan kontrolki nadrzędnej zamiast tej opcji. Reguła ukończenia
  pakietu i jej dotychczasowe kontrole backendowe pozostały bez zmian.
- Pierwsza próba WebKit nie uruchomiła scenariuszy z powodu brakującej domyślnej
  ścieżki przeglądarki. Powtórzenie z istniejącym `.local/browser-runtimes` dało
  pięć PASS, bez instalacji lub zmiany konfiguracji aplikacji.

### Granice odbioru

Bez publikacji, migracji, zmiany integracji lub zasad biznesowych. Wcześniejsze
lokalne uproszczenia zaleceń i kursu zachowano. Recenzent pracował od wymagań
i diffu, bez zmian kodu; odbiór DB/Next prowadzi koordynator. Wyniki lokalne
nie zastępują testów produkcji, fizycznego telefonu, prawdziwego SMTP ani Tpay.

Powrót z kolejki działa po wejściu do sprawy; paginacja historii/planów wewnątrz
konsultacji i fitnessu nie przenosi jeszcze tego kontekstu dalej. Recenzent nie
uznał tego za naruszenie AC-09; jest jawnym ograniczeniem wygody nawigacji.
Pełna wspólna kolejka admina dla kursów i próśb o termin pozostaje oddzielnym
zakresem. Ten etap poprawia opis jej zasięgu i odsyłacze, bez rozszerzenia RPC.

Materiały lokalne: `.local/ux-audit-20261026/` (logi i zrzuty) oraz `test-results/`
z ostatniego przebiegu. Nie zawierają eksportu sesji ani kluczy w repozytorium.
