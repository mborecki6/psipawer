# Publikacja obsługi w biegu — 27.10.2026

## Zgoda i zakres

Po odbiorze lokalnym użytkownik polecił „wdrożmy na produkcję”. Zgoda dotyczy
[przygotowanej iteracji](2026-10-27-obsluga-w-biegu.md): ręczna wpłata kursu
lub fitnessu bez otwierania usługi, zachowanie niepotwierdzonego wpisu po
utracie odpowiedzi/paginacji, przycisk zapowiedzi głosu przy czterech rodzajach
spotkania Asi i start opiekuna z zaleceniami oraz dostępnymi zajęciami.
Rozliczenia pozostają w osobnej sekcji. Nagrywanie i transkrypcja nie działają.

Niezależny recenzent sprawdził faktyczny diff i nowe pliki przed publikacją:
brak uwag blokujących, migracji, zależności i zmian konfiguracji integracji.
Lokalny odbiór: 2085 unit, 17 różnych scenariuszy Chromium, 6 WebKit oraz
build/TypeScript/ESLint PASS. Szczegółowe ograniczenia są w iteracji lokalnej.

## Wersja

- Kod: `4b0c7a5411f97aad1e97a00b7ca8ea1135aa0d43`, wysłany do `main`
  repozytorium `mborecki6/psipawer`.
- Odcisk 441 plików runtime:
  `1275550b3904050a058b300b3bf91bfe69485b8d5d8dcc45e024079435cb15e1`.
- Produkcyjny build Git Vercel: `dpl_5yPcZuLGw9wcCpMd9ixvAkeoEpYR`, `READY`.
- API potwierdziło, że [psipawer.vercel.app](https://psipawer.vercel.app/login)
  wskazuje tę wersję, właściwy projekt i `main`. Nie przesyłano prywatnych
  plików `.local`, sesji, kluczy ani kopii danych.
- Dokumentacyjny następca powyższego commita zachowuje ten sam runtime;
  jego końcowy SHA, build i dowód zgodności zapisano w prywatnym odbiorze.

## Rzeczywisty odbiór hostingu

**102 różne warianty UI i trzy odmowy endpointów PASS** przy 320/390/1440 px,
na istniejącym własnym administratorze i koncie DEMO. Bez tworzenia kont,
próbnych wpłat, publikowania planów, zaproszeń i wysyłki.

- Home opiekuna pokazuje nowe sekcje zaleceń i propozycji oraz bieżące sprawy;
  nie pokazuje kwot ani finansowych ostrzeżeń. Sprawdzono rzeczywiste stany
  zastanego DEMO; pełną publikację i szkic planu odebrano wcześniej lokalnie.
- Adminowe wpłaty kursu i fitnessu: sześć otwarć w trzech szerokościach,
  właściwe kwoty całkowite/wpłacone/pozostałe, domyślna kwota, metoda,
  opcjonalna notatka z jawną widocznością i aktywny formularz w rozliczeniach.
  Nie wysyłano formularzy produkcyjnych. Wpłaty częściowe i ponowienia odebrano
  na rzeczywistej lokalnej bazie w poprzednim etapie.
- Dwanaście adminowych wariantów przycisku głosu: spacer, konsultacja,
  spotkanie kursu i fitnessu, trzy szerokości. Klawiatura otwiera i zamyka
  jawny komunikat, bez żądań zapisu. Opiekun nie ma przycisku.
- Menu, aktywna nawigacja, fokus, przewijanie nagłówka, szczegóły, podgląd
  płatności i powroty: PASS. Brak błędów JS/HTTP, poziomego przepełnienia,
  zablokowanych prób zapisu lub ruchu do operatora.
- Workery płatności/e-mail bez poświadczeń zwracają 401; wyłączony webhook
  Tpay zwraca 503 z `FALSE`. Nie wywoływano uprawnionych workerów.
- Własne DEMO zachowało siedem wcześniejszych wpłat i zero prób płatności.
  Wszystkie cztery sesje obu przebiegów wylogowano; nie eksportowano tokenów.

Pierwszy przebieg miał 99/102 PASS: trzy fałszywe błędy fokusu w finansach.
Runner próbował fokusować tekstowy `span` wewnątrz `summary`. Poprawiono wyłącznie
test na właściwy natywny element i przypisanie przycisku głosu do otwartego
spotkania. Celowa powtórka 24 wariantów przeszła; po połączeniu dowodów wszystkie
102 różne warianty mają PASS. Kontrole błędów pozostały niepoluzowane.

## Dane i integracje

Odczytowe porównanie przed/po: 92 tabele biznesowe bez zmian; zmienił się tylko
techniczny heartbeat `reminder_worker_state`. Konta i hasła, tożsamości Auth,
metadane Storage, konfiguracja Auth, zadania cron i rejestr 66 migracji zachowane.
Bucketom i tabelom pozostają dotychczasowe reguły prywatności i RLS.

Dziewięć wyłączników Vercel nadal OFF. Biznesowe ustawienia operatora i poczty
w DB także OFF; próby płatności, notyfikacje operatora i kolejka maili puste.
Nie aktywowano Tpay/PayU, symulatora w chmurze, SMTP ani zaproszeń. Supabase
pozostaje Free; bez zmiany infrastruktury, nowych migracji i nowej kopii DB.
Sprawdzono integralność wcześniejszej kopii, co nie jest nową próbą odtworzenia.

Nie jest to odbiór prawdziwego operatora, doręczeń ani fizycznego telefonu Asi.
Wcześniejsze ryzyko PostgREST i osobna aktualizacja infrastruktury pozostają
opisane w statusie produktu; obecne poprawne odczyty nie zamykają tamtej sprawy.

Prywatne dowody: `.local/moment-release-20261027/`.
