# Publikacja uproszczeń i podglądu płatności — 27.10.2026

## Zgoda i zakres

Użytkownik zatwierdził publikację lokalnych uproszczeń, a następnie rozszerzył
wydanie o wizualny, klikalny placeholder płatności z późniejszą aktywacją operatora.
Zakres obejmuje wcześniejsze uproszczenia zaleceń i adminowego kursu, poprawki
po [audycie prostoty](2026-10-27-uproszczenia-po-audycie.md) oraz
[odczytowy podgląd płatności](2026-10-27-podglad-platnosci.md).

Karty psa, składy, konsultacje, kursy i fitness pokazują bieżącą pracę przed
ustawieniami i historią. Start opiekuna obejmuje pięć rodzajów zgłoszeń;
kalendarz prowadzi do konkretnego spotkania. Zwijane formularze zachowują
szkic, a wynik zapisu odsłania właściwą sekcję. Kwoty, kwalifikacja i uprawnienia
zachowują dotychczasowe reguły.

Własna przyjęta, wyceniona i nierozliczona należność może mieć odsyłacz
„Podgląd płatności online”. Ekran pokazuje psa, usługę, termin, uzgodnioną kwotę,
dotychczasowe wpłaty i pozostałe saldo. Jawnie wskazuje niedostępność płatności;
nie zawiera formularza BLIK, akcji rozpoczęcia transakcji ani obietnicy działającego
operatora. Otwarcie, odświeżenie i powrót nie tworzą prób lub wpłat.

## Wersja i publikacja

- Kod aplikacji: `971d0d94bfb6b50d0d74b876dc309bf198e15c04`.
- Odcisk 438 plików runtime:
  `63939222506a22bd5ebdd49ec77095155d1a1c3511707a8c84acfd04518a0bc9`.
- Kandydat Vercel: `dpl_BMNuPD2sQigJxaY9ABLjN9nnhuia`, stan `READY`.
- Po kontroli źródeł, projektu i wyłączników przełączono
  [psipawer.vercel.app](https://psipawer.vercel.app/login); odczyt API potwierdził
  alias wskazujący powyższego kandydata.
- Paczka CLI: 783 pliki, wyłącznie śledzone w Git; bez prywatnych konfiguracji,
  kluczy, sesji, kopii DB i materiałów roboczych.
- Odbiór hostingu zakończony. Zapis odbioru jest dokumentacyjnym następcą
  powyższego kodu; ponowny build z Git musi wskazywać `main` i identyczny runtime.
  Końcowy SHA, alias i dowód zgodności są zapisane prywatnie w `state-after-git.json`.

## Odbiór lokalny i niezależny przegląd

- Końcowe **2057/2057 testów w 144 plikach PASS**, build Next.js, TypeScript,
  lint zmienionych plików, formatowanie i `git diff --check` PASS.
- Wcześniejsza partia uproszczeń: 28 różnych scenariuszy rzeczywistego
  Next/Supabase w Chromium i pięć w WebKit, dodatkowo warianty komponentów
  i responsywności opisane w iteracji. Nie sumujemy kolejnych pełnych zestawów unit.
- Dodatkowo podgląd płatności: po jednym rzeczywistym scenariuszu Chromium
  i WebKit. Przyjęty lokalny kurs 100 zł, wcześniejsza wpłata 40 zł i saldo 60 zł;
  przeklik, odświeżenie, powrót i 320/390/1440 px PASS. Niepoprawny cel i cudze
  konto nie ujawniają należności. Przed/po identyczne saldo, wersja, status,
  rekordy wpłat i prób; brak ruchu do operatora. Własne fixtures usunięto.
- Niezależny recenzent podglądu ocenił izolowany diff i wykonał 92 testy PASS,
  bez uwag blokujących. Rzeczywisty odbiór RLS i przeglądarki wykonał koordynator.

## Rzeczywisty odbiór hostingu

**102 różne warianty UI oraz trzy odmowy endpointów PASS** przy 320/390/1440 px.
Istniejące własne konto administratora i konto DEMO, bez tworzenia klientów,
wysyłki i zapisów biznesowych. Menu, klawiatura, fokus, przewijanie, zwijana
edycja psa, kotwice dokładnych spotkań i brak poziomego przepełnienia sprawdzone.
Brak błędów JS/HTTP i prób zablokowanego zapisu/ruchu zewnętrznego.

- Podgląd czterech rodzajów należności (spacer, konsultacja, kurs, fitness):
  12 wariantów, rzeczywiste kwoty, arytmetyka salda, odświeżenie i oba powroty.
  Brak aktywnego formularza lub deklaracji działającego operatora. Trzy błędne
  lub brakujące cele sprawdzone w dziewięciu wariantach bez ujawniania należności.
- Liczniki własnego DEMO przed i po: zero prób płatności i siedem wcześniejszych
  wpłat. Obie własne sesje każdorazowo wylogowano, bez eksportu cookies/tokenów.
- Nieuprawnione POST: workery płatności i e-mail po 401; wyłączony webhook Tpay
  503 z `FALSE`. Nie wywoływano uprawnionych workerów ani operatora.
- Pierwszy runner dał 94/102 PASS i osiem fałszywych błędów `status:null`.
  Playwright przy ponownej nawigacji tego samego dokumentu z kotwicą nie zwraca
  nowej odpowiedzi HTTP. Poprawiono wyłącznie test: sprawdzenie dokładnego URL,
  następnie rzeczywisty reload i wymagane HTTP 200. Celowa powtórka 16 wariantów
  kalendarza, finansów, kursu i fitnessu przeszła w całości. Po połączeniu dowodów
  wszystkie 102 różne warianty mają PASS; oryginalnych raportów nie nadpisano.
- Istniejące DEMO nie udostępniało bezpośredniego odsyłacza do opublikowanego
  planu, więc nie dodawano takiego rekordu na produkcji. Karty zaleceń przy psie
  sprawdzono online, a pełne zapisy i publikację planów lokalnie.

## Zachowanie danych i integracji

Wydanie nie zawiera migracji. Lokalnie i na produkcji pozostaje 66 migracji.
Weryfikowane wyłączniki Auth e-mail, zaproszeń, biznesowego e-maila, Tpay hosted/live
i uzgadniania pozostają OFF. Konfiguracja biznesowa płatności i poczty także OFF.
Symulator nie został przeniesiony do chmury; PayU nie został zintegrowany.
Nie utworzono kont prawdziwych klientów i nie wysłano zaproszeń lub wiadomości.

Przed publikacją zapisano odczytowe skróty 93 tabel publicznych, haseł/metadanych
Auth, tożsamości, Storage, konfiguracji Auth, zadań cron i rejestru migracji.
Potwierdzono prywatność bucketów i RLS. Porównanie po odbiorze: 92 tabele
biznesowe identyczne, jedyna zmiana to techniczny `reminder_worker_state`.
Hasła/metadane Auth, tożsamości, Storage, konfiguracja Auth, zadania cron
i rejestr migracji są identyczne. Próby płatności, powiadomienia operatora
i kolejka e-mail pozostają puste; wszystkie dziewięć wyłączników nadal OFF.

Sprawdzono integralność istniejącej lokalnej kopii z 26.10 i jej manifestu;
nie wykonano nowej kopii ani odtworzenia 27.10. Dotychczasowa próba odtworzenia
i migracji 66 jest opisana przy onboardingu. Regularne kopie poza komputerem
pozostają osobnym zadaniem; plan nadal Supabase Free.

## Ograniczenia

Placeholder nie jest odbiorem Tpay lub PayU. Włączenie operatora i poczty wymaga
konfiguracji, osobnej zgody oraz rzeczywistych testów transakcji i doręczeń.
Testy przeglądarkowe nie zastępują odbioru fizycznego telefonu przez Asię.

Świeże logowanie istniejącego DEMO i odczyt REST przed publikacją przeszły,
ale nie wykonano aktualizacji infrastruktury Supabase. Dzisiejszy sukces nie
zamyka wcześniejszego ryzyka PostgREST 14.5/PGRST303. Uzgodnienie okna aktualizacji
przed prawdziwymi klientami pozostaje aktualne, niezależnie od planu Free/Pro.

Prywatne dowody: `.local/simplicity-release-20261027/`.
