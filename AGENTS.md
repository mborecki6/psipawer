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
- Bieżący zakres opisuje `docs/iterations/2026-10-13-funkcje-po-feedbacku.md`.
  Iterację z 13.10 opublikowano po osobnej zgodzie użytkownika. Kolejne funkcje
  rozwijamy lokalnie, zachowując lżejszy interfejs. Logo, hasło,
  ClickMeeting i MailerLite pozostają na koniec. Otwarte decyzje produktowe
  wymagają odpowiedzi użytkownika; propozycja agenta nie jest taką odpowiedzią.
  Web Push, skrzynka aplikacji, e-mail i przyszły push natywny to osobne kanały.
- Wiąż autoryzację z zakresem konkretnego zadania. Dawna publikacja nie oznacza
  automatycznej publikacji każdej kolejnej zmiany. Gdy użytkownik już autoryzował
  działanie w aktualnym zakresie, wykonuj je bez ponownego pytania.
