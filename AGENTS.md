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
- Odbiór przed płatnościami z 23.10 opisuje
  `docs/iterations/2026-10-23-gotowosc-platnosci.md`, a instrukcję konfiguracji
  `docs/PAYMENT-EMAIL-RELEASE.md`. Użytkownik zatwierdził lokalne poprawki i
  przygotowanie SMTP Auth oraz maili o terminach, przypomnieniach i wpłatach.
  Lokalne migracje 62–65 zastosowano po kopii, zachowując poprzednie rekordy
  i Auth: lokalnie jest 65, produkcja nadal 60 migracji. Wysyłka biznesowa jest
  wyłączona; lokalny podgląd używa jawnego symulatora bez operatora i pieniędzy.
  Konfiguracje hosted i live są przygotowane z osobnymi wyłącznikami, ale nie
  zostały włączone ani odebrane u operatora. Nie publikuj, nie włączaj SMTP,
  nie uruchamiaj realnych płatności i nie kupuj Pro na podstawie tej iteracji.
  Po audycie zależności podniesiono lokalnie Next i eslint-config-next do
  16.4.1; nie oznacza to aktualizacji istniejącej produkcji.
- Lokalny wariant BLIK przez Tpay z 18.10 opisuje
  `docs/iterations/2026-10-18-tpay-blik-lokalnie.md`. Zgoda obejmuje wyłącznie
  lokalne testy. Użytkownik nie ma sandboxa; działa jawny symulator bez operatora
  i pieniędzy, a adapter sandbox wymaga późniejszego rzeczywistego odbioru.
  Spacer przyjęty automatycznie zgodnie z dotychczasowymi zasadami także można
  opłacić. Wtedy lokalny Supabase miał 61 migracji; stan z 23.10 podano wyżej.
  Nie przenoś konfiguracji symulatora do chmury ani nie uruchamiaj live Tpay.
- Bieżące wydanie opisuje `docs/iterations/2026-10-16-odbior-pierwsi-uzytkownicy.md`.
  Poprawki odporności formularzy, zapisu psa i kwalifikacji, rozliczeń, odczytów
  i liczników oraz ręczne linki dostępu opublikowano 16.10 po zgodzie użytkownika;
  produkcja ma 60 migracji. Nie tworzono prawdziwych kont ani nie włączano SMTP.
  Decyzja użytkownika z 17.10 zastępuje wcześniejszy wybór Pro: pozostajemy
  na Supabase Free, a zaproszenia odkładamy do przyszłej integracji SMTP;
  nie ma jeszcze listy prawdziwych odbiorców. Dla zdjęć wybrano zaszyfrowane
  archiwum na prywatnym Google Drive, z kluczem przechowywanym osobno.
  Lokalną kopię 12 plików marki zaszyfrowano i odtworzono 17.10; wysyłkę na
  Drive użytkownik odłożył do listy zadań. Nie używaj służbowego Dysku.
  Zadania do wznowienia opisuje `docs/PRODUCT-STATUS.md`. Produkcyjna kopia
  DB pozostaje niedomknięta; kopia zdjęć jej nie zastępuje. Nie włączaj Pro,
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
