<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Zespół agentów Psi Pawer

Przy rozwoju produktu stosuj role `psi_business`, `psi_technical` i
`psi_reviewer` z `.codex/agents/`. Agent prowadzący koordynuje pracę.
Proces i format przekazania wyników opisuje [docs/AGENT-WORKFLOW.md](docs/AGENT-WORKFLOW.md).

- Dla istotnej funkcji biznes i technika najpierw opracowują osobne propozycje
  na podstawie tego samego briefu. Koordynator uzgadnia kryteria przed implementacją.
- Recenzent zaczyna w świeżym kontekście, od wymagań i faktycznego diffu, bez
  uzasadnienia autora. Formułuje ocenę przed konfrontacją wyników. Autor poprawia kod.
- Deleguj tylko pracę, którą warto rozdzielić. Drobna korekta nie wymaga trzech
  pełnych opracowań. Nie uruchamiaj agentów tylko po to, żeby potwierdzili zgodę.
- Przy wspólnym katalogu każdy edytowany plik ma jednego właściciela. Recenzent
  nie zmienia kodu aplikacji. Koordynator integruje i przeprowadza odbiór.
- Jeśli narzędzie delegowania nie pozwala wybrać profilu, odczytaj właściwy TOML
  i przekaż jego `developer_instructions` jako instrukcję zadania. Nie zakładaj,
  że samo nadanie nazwy agentowi załadowało profil lub zmieniło jego uprawnienia.
- Zachowuj model i poziom rozumowania bieżącej sesji, chyba że użytkownik wybierze inne.
- Bieżąca iteracja: `docs/iterations/2026-10-27-prosty-sklad-obecnosc.md`.
  Kursy i spacery mają widoczny skład oraz duże przyciski przyjęcia/obecności,
  z zachowaniem usprawiedliwień, korekt, historii i rozliczeń. 2106 unit,
  25 różnych scenariuszy Chromium i 6 WebKit PASS; 93 lokalne tabele zachowane.
  Uwagi niezależnej recenzji zamknięto i odtworzono w przeglądarce. Bez migracji
  i aktywacji integracji. Po nowym poleceniu użytkownika opublikowano kod
  `2d0b1bd`; 18 sprawdzeń UI online i 3 odmowy endpointów PASS. Zachowano dane,
  konta i Storage; jedyna różnica to heartbeat przypomnień. Odbiór publikacji:
  `docs/iterations/2026-10-27-publikacja-prostego-skladu.md`. Nie aktywuj
  integracji ani nie publikuj dalszych funkcji na podstawie tej zgody.
- Opublikowana iteracja z 27.10: `docs/iterations/2026-10-27-obsluga-w-biegu.md`;
  odbiór: `docs/iterations/2026-10-27-publikacja-obsluga-w-biegu.md`.
  Szybka wpłata kursu/fitnessu w rozliczeniach, jawny placeholder głosu w czterech
  rodzajach spotkania Asi i Home opiekuna bez rozliczeń, z publikacjami/ofertą.
  2085 unit, 17 różnych scenariuszy Chromium, 6 WebKit, build/lint/typy PASS;
  przeklik obu ról i zachowanie 92 tabel biznesowych potwierdzono. Znane uwagi
  zamknięte; ograniczenia danych opisano w raporcie. Po osobnej zgodzie opublikowano
  kod `4b0c7a5`; 102 warianty UI i 3 odmowy endpointów online PASS, dane zachowane.
  Bez migracji; nie aktywuj nagrywania, operatora ani SMTP na podstawie tej iteracji.
- Wydanie z 27.10 opisuje `docs/iterations/2026-10-27-publikacja-uproszczen.md`.
  Użytkownik zatwierdził publikację uproszczeń oraz klikalnego podglądu płatności.
  Kod `971d0d9` jest online; obejmuje też wcześniejsze uproszczenia zaleceń i kursu.
  Podgląd własnej przyjętej, wycenionej należności pokazuje saldo, bez tworzenia
  prób i wpłat. Operator jest jawnie niedostępny. Bez nowych migracji: nadal 66.
  Tpay/PayU, symulator w chmurze, oba kanały SMTP, zaproszenia i nowe workery
  pozostają wyłączone; plan Free. Nie aktualizowano infrastruktury Supabase.
  Końcowo 2057 testów w 144 plikach PASS; do wcześniejszych 28 Chromium/5 WebKit
  doszedł rzeczywisty podgląd płatności w obu silnikach. Odbiór hostingu: 102
  warianty UI i 3 odmowy endpointów PASS, bez zapisów biznesowych/JS/HTTP błędów.
  Zachowano 92 tabele biznesowe, Auth i Storage; zmienił się tylko heartbeat
  przypomnień. Dowody oraz ograniczenia opisano w zapisie publikacji.
- Bieżący onboarding opisuje `docs/iterations/2026-10-26-onboarding.md`.
  Po akceptacji wizualizacji użytkownik 26.10 polecił wdrożenie. Kod `d22ffd9`
  i migracja 66 są opublikowane; lokalna i produkcyjna baza mają 66 migracji.
  Brief obowiązuje tylko nowe konta opiekunów po migracji. Wcześniejsze konta
  nie mają rekordu i są trwale zwolnione; admin omija onboarding. Nie backfilluj.
  Odpowiedzi są prywatne dla opiekuna, bez panelu Asi i automatycznej karty psa.
  Pauza, ukończenie i edycja są trwałe; edycja nie cofa ukończenia.
  Odbiór: 1956 unit, 6 Chromium, 3 WebKit oraz 12 UI/3 odmowy endpointów online
  PASS. Świeżą kopię odtworzono i próbnie zmigrowano przed zmianą produkcji.
  Nie utworzono prawdziwych kont, nie włączono SMTP/Tpay/zaproszeń ani Pro.
  Osobna aktualizacja infrastruktury Supabase nadal pozostaje do uzgodnienia.
- Wcześniej 26.10 użytkownik autoryzował publikację poprawek po audycie. Kod aplikacji
  `50a0543` (z dodatkową poprawką Zod 4.6.6) i migracje 61–65 są opublikowane;
  produkcja miała wtedy 65 migracji.
  Wydanie opisuje `docs/iterations/2026-10-26-publikacja-poprawek.md`.
  Tpay, symulator w chmurze, oba kanały SMTP, zaproszenia i nowe workery
  pozostają wyłączone; plan nadal Free. Nie aktywowano kont prawdziwych klientów.
  Odbiór ujawnił produkcyjny PGRST303 dla świeżych JWT w PostgREST 14.5.
  Jeden kontrolowany restart całego projektu przywrócił REST, lecz wersja
  pozostała 14.5. Przed prawdziwymi klientami pozostaje aktualizacja wersji
  infrastruktury Supabase, osobna od zakupu Pro; aktualizacji nie wykonano.
  Sprawdzono dostępny cel 17.11.0.003 i estymatę platformy 1 h, bez ostrzeżeń.
  Nie traktuj restartu ani lokalnych testów jako trwałego usunięcia tego błędu.
  Krótkie wprowadzenie było w tamtej iteracji propozycją; późniejszą osobną
  zgodę, implementację i publikację opisano powyżej.
- Odbiór przed płatnościami z 23.10 opisuje
  `docs/iterations/2026-10-23-gotowosc-platnosci.md`, a instrukcję konfiguracji
  `docs/PAYMENT-EMAIL-RELEASE.md`. Użytkownik zatwierdził lokalne poprawki i
  przygotowanie SMTP Auth oraz maili o terminach, przypomnieniach i wpłatach.
  Lokalne migracje 62–65 zastosowano po kopii, zachowując poprzednie rekordy
  i Auth: wtedy lokalnie było 65, produkcja pozostawała przy 60 migracjach.
  Aktualny stan produkcji podano w wydaniu z 26.10 powyżej. Wysyłka biznesowa jest
  wyłączona; lokalny podgląd używa jawnego symulatora bez operatora i pieniędzy.
  Konfiguracje hosted i live są przygotowane z osobnymi wyłącznikami, ale nie
  zostały włączone ani odebrane u operatora. Nie publikuj, nie włączaj SMTP,
  nie uruchamiaj realnych płatności i nie kupuj Pro na podstawie tej iteracji.
  Po audycie zależności podniesiono lokalnie Next i eslint-config-next do
  16.4.1; opublikowano je dopiero po nowej zgodzie 26.10.
- Lokalny wariant BLIK przez Tpay z 18.10 opisuje
  `docs/iterations/2026-10-18-tpay-blik-lokalnie.md`. Zgoda obejmuje wyłącznie
  lokalne testy. Użytkownik nie ma sandboxa; działa jawny symulator bez operatora
  i pieniędzy, a adapter sandbox wymaga późniejszego rzeczywistego odbioru.
  Spacer przyjęty automatycznie zgodnie z dotychczasowymi zasadami także można
  opłacić. Wtedy lokalny Supabase miał 61 migracji; stan z 23.10 podano wyżej.
  Nie przenoś konfiguracji symulatora do chmury ani nie uruchamiaj live Tpay.
- Historyczne wydanie z 16.10 opisuje `docs/iterations/2026-10-16-odbior-pierwsi-uzytkownicy.md`.
  Poprawki odporności formularzy, zapisu psa i kwalifikacji, rozliczeń, odczytów
  i liczników oraz ręczne linki dostępu opublikowano 16.10 po zgodzie użytkownika;
  wtedy produkcja miała 60 migracji. Nie tworzono prawdziwych kont ani nie włączano SMTP.
  Decyzja użytkownika z 17.10 zastępuje wcześniejszy wybór Pro: pozostajemy
  na Supabase Free, a zaproszenia odkładamy do przyszłej integracji SMTP;
  nie ma jeszcze listy prawdziwych odbiorców. Dla zdjęć wybrano zaszyfrowane
  archiwum na prywatnym Google Drive, z kluczem przechowywanym osobno.
  Lokalną kopię 12 plików marki zaszyfrowano i odtworzono 17.10; wysyłkę na
  Drive użytkownik odłożył do listy zadań. Nie używaj służbowego Dysku.
  Zadania do wznowienia opisuje `docs/PRODUCT-STATUS.md`. Produkcyjna kopia
  DB ma świeżą lokalną kopię i próbę odtworzenia z 26.10; regularne kopie poza
  komputerem pozostają niedomknięte. Kopia zdjęć nie zastępuje DB. Nie włączaj Pro,
  SMTP ani zaproszeń bez nowego polecenia w odpowiednim zakresie.
  Wydanie wizualne opisują `docs/iterations/2026-10-15-brzoskwinia-miejsce-kursu.md`
  i `docs/iterations/2026-10-15-fotografie-panelu.md`. Zdjęcia, paleta i formularz
  kursu opublikowano 15.10 po zgodzie użytkownika, bez zmian DB.
  Reguły kalendarza pozostają w `docs/iterations/2026-10-14-spokojny-kalendarz.md`.
  Asia jest jedyną prowadzącą; administrator organizujący wpis pozostaje autorem.
  Konfiguracja primary jest w DB, a dostępność jest wspólna także dla dawnych UUID/null.
  Iteracje z 13 i 14.10 opublikowano po osobnych zgodach użytkownika. Kolejne
  funkcje rozwijamy lokalnie, zachowując lżejszy interfejs. Logo i hasło są
  już wdrożone; ClickMeeting i MailerLite pozostają na koniec. Otwarte decyzje produktowe
  wymagają odpowiedzi użytkownika; propozycja agenta nie jest taką odpowiedzią.
  Web Push, skrzynka aplikacji, e-mail i przyszły push natywny to osobne kanały.
- Wiąż autoryzację z zakresem konkretnego zadania. Dawna publikacja nie oznacza
  automatycznej publikacji każdej kolejnej zmiany. Gdy użytkownik już autoryzował
  działanie w aktualnym zakresie, wykonuj je bez ponownego pytania.
