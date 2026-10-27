# Publikacja prostego składu i obecności — 27.10.2026

## Zgoda i zakres

Po odebraniu [lokalnej iteracji](2026-10-27-prosty-sklad-obecnosc.md) użytkownik
polecił „wdrożmy na produkcję i zobaczymy”. Zgoda obejmuje widoczny skład,
bezpośrednie przyjęcia i oznaczanie obecności kursów/spacerów oraz zachowanie
niepotwierdzonej decyzji, powodu i wersji po zmianach filtrów. Usprawiedliwienia,
korekty, prywatność, limity, kwalifikacja i rozliczenia zachowują swoje reguły.

Kontrola zakresu przed publikacją: 8 plików UI, 17 testowych, 4 dokumentacyjne;
bez uwag blokujących. Nie zmieniano backendu, migracji, zależności ani
konfiguracji integracji. Lokalnie 2106 unit, 25 różnych Chromium i 6 WebKit
PASS; build, typy i ESLint PASS. Ograniczenia odbioru są w iteracji lokalnej.

## Wersja produkcyjna

- Kod: `2d0b1bde01b5279e8407d2e9a87ce8e7e531de85`, Git `main`
  repozytorium `mborecki6/psipawer`.
- Odcisk 444 plików runtime:
  `1e31a076c51d753c729cadc4e9576551171a6f945a4f55a417544341cbcdaab5`.
- Build: `dpl_FSGhindv5s194PG4hAaA5Mc8ZmEp`, `READY`, produkcja.
- API Vercel potwierdziło commit, `main`, właściwy projekt i przypisanie
  [psipawer.vercel.app](https://psipawer.vercel.app/login).
- Publikacja przez Git; prywatne `.local`, sesje, kopie i poświadczenia
  nie trafiły do repozytorium ani uploadu aplikacji.

## Odbiór

**18/18 sprawdzeń UI PASS** przy 320/390/1440 px na istniejącym własnym
administratorze i DEMO. Brak błędów JavaScript, konsoli, HTTP, poziomego
przepełnienia i prób biznesowego zapisu lub ruchu zewnętrznego. Obie sesje
pozostały wyłącznie w pamięci i zostały wylogowane.

- Kurs: trzy rzeczywiste spotkania w trzech szerokościach, pełny oczekiwany
  skład, zapisane statusy i „Nieoznaczono”, duże przyciski bez wewnętrznych
  selectów/disclosure, blokada przed startem i dostępność korekty z powodem.
- Spacer: trzy istniejące zgłoszenia, w tym dwa przyjęte psy; widoczny skład,
  przyciski obecności, jawne rozróżnienie płatnej nieobecności/usprawiedliwienia
  oraz skutek finansowy. Fokus i przewijanie nagłówka PASS.
- Opiekun: te same własne rekordy, bez czynności admina i danych obcych psów.
  Własność rekordów potwierdzono wcześniej sesją DEMO przez RLS.
- Wybrane dane online nie zawierały aktualnie dopuszczalnego oczekującego
  przyjęcia na kurs/spacer ani przyszłego przyjętego spaceru. Tych stanów
  nie utworzono na produkcji; przyjęcia i guard spacerowy odebrano lokalnie.
- Osiem zastanych wpłat i zero prób płatności pozostały bez zmian zarówno
  w globalnym odczycie admina, jak i odczycie DEMO.

Nie wysyłano produkcyjnych formularzy obecności, decyzji i wpłat. Ich zapisy,
konflikty oraz utratę odpowiedzi odebrano wcześniej na izolowanych lokalnych
fixture’ach. Końcowy dokumentacyjny następca zachowuje identyczne 444 pliki
runtime; jego SHA i wynik powiązania aliasu są w prywatnym gate’cie wydania.

Trzy sprawdzenia endpointów bez poświadczeń PASS: workery płatności i e-mail
zwracają 401, a wyłączony webhook Tpay 503 z `FALSE`. Nie wywoływano
uprawnionych workerów ani operatora.

## Dane i integracje

Odczytowe porównanie przed i po wdrożeniu zachowało 92 tabele biznesowe,
konta i hasła, tożsamości Auth oraz metadane Storage. Jedyną zmienioną tabelą
jest techniczny heartbeat `reminder_worker_state`. Konfiguracja Auth, cron
i rejestr 66 migracji pozostały identyczne; brak tabel bez RLS i publicznych
funkcji/tabel anonimowych w sprawdzanych gate’ach.

Dziewięć wyłączników Vercel nadal OFF, ustawienia operatora i poczty biznesowej
w DB również OFF. Próby płatności, notyfikacje operatora i kolejka maili puste.
Supabase pozostaje Free. Nie włączano operatora, symulatora w chmurze, SMTP,
zaproszeń, nagrywania ani transkrypcji. Sprawdzono integralność istniejącej kopii
z 26.10; nie jest to nowa kopia lub próba odtworzenia.

Nie jest to odbiór fizycznego telefonu Asi, czytnika ekranu, doręczeń ani
prawdziwego operatora. Wcześniejsze ryzyko PostgREST i osobna aktualizacja
infrastruktury pozostają w statusie produktu; bieżąca zdrowa odpowiedź ich
nie zamyka.

Dowody prywatne: `.local/roster-release-20261027/`.
