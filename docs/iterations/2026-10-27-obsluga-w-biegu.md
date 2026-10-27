# Obsługa w biegu — lokalnie, 27.10.2026

## Brief i zakres

Użytkownik chce odnotować otrzymaną częściową wpłatę na kurs bez opuszczania
rozliczeń; w szczegółach spotkania Asi ma być placeholder notatki głosowej.
Start opiekuna ma dawać wartość, zalecenia i propozycje zajęć, a rozliczenia
pozostać w swojej sekcji. Zlecono również przeklik całego narzędzia obu ról.

To osobny zakres po publikacji z 27.10, przygotowywany lokalnie. Bez publikacji,
migracji, aktywacji operatora/SMTP lub właściwego nagrywania i transkrypcji.
Nowy brief zastępuje wcześniejsze AC dotyczące eksponowania finansowych wyjątków
na Home i odsyłania z rozliczeń do formularza w kursie/fitnessie. Same salda,
uzgodnienia, zwroty, historia i uprawnienia zachowują dotychczasowe reguły.

Biznes i technika przygotowały niezależne propozycje od tego samego briefu,
przed konfrontacją wyników. Koordynator przyjął poniższy kontrakt.

## Kryteria

| AC    | Wymagane zachowanie                                                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-01 | Asia otwiera wpłatę kursu/fitnessu jednym rozwinięciem i zapisuje bez opuszczania rozliczeń.                                                                                                                                                       |
| AC-02 | Widać opiekuna, psa, konkretną usługę, aktualną należność, wpłaty i pozostałe saldo, także przed pierwszą wpłatą. Po uzgodnieniu należności nie nazywamy jej pierwotną ceną całego kursu.                                                          |
| AC-03 | Należność 400 zł, wpłata 100 zł, potem 300 zł: dwa właściwe wpisy, saldo 300 zł, potem 0 zł; bez zmiany ceny.                                                                                                                                      |
| AC-04 | Zachowane parsowanie kwot, odmowa zera/ujemnej kwoty/nadpłaty i zachowanie pól przy błędzie.                                                                                                                                                       |
| AC-05 | Opłacone i nieprzyjęte zgłoszenia nie otrzymują aktywnej wpłaty. Uzgodnienie po rezygnacji i pozostały zwrot zachowują właściwą odrębną obsługę.                                                                                                   |
| AC-06 | Podwójne kliknięcie, utrata odpowiedzi, ponowienie i odświeżenie innego wiersza nie dublują wpisu. Wpisany stan i request_id pozostają do własnego potwierdzenia; po nim następna świadoma wpłata ma nowy klucz. Nadpłatę przy wyścigu blokuje DB. |
| AC-07 | Obie uprawnione role widzą zgodne saldo/historię. Opiekun nie księguje wpłat. Notatka ma jawny opis widoczności dla opiekuna.                                                                                                                      |
| AC-08 | Najbliższe spotkanie zachowuje dokładne wejście do spaceru, konsultacji, spotkania kursu lub fitnessu.                                                                                                                                             |
| AC-09 | Adminowy placeholder głosu jest przy bieżących czynnościach konkretnego spotkania, przed historią, dostępny na telefonie.                                                                                                                          |
| AC-10 | Kliknięcie „Notatka głosowa” otwiera informację o przygotowywanej funkcji. Bez mikrofonu, nagrywania, zapisu danych i sugerowania gotowej transkrypcji.                                                                                            |
| AC-11 | Home opiekuna nie pobiera i nie pokazuje sald, kwot, finansowych ostrzeżeń ani kart pakietów; bieżące sprawy są uporządkowane organizacyjnie, a rozliczenia pozostają w menu.                                                                      |
| AC-12 | Rzeczywiście opublikowane zalecenia mają odsyłacz z psem i tytułem. Propozycje zajęć pochodzą z aktualnej dostępnej oferty, bez fikcyjnego dopasowania lub porad klinicznych.                                                                      |
| AC-13 | Puste stany wskazują sensowny następny krok. Minione/odwołane/zamknięte/pełne zajęcia i własne zgłoszenia nie są reklamowane jako nowe wolne miejsca.                                                                                              |
| AC-14 | Zachowane ostrzeżenia kwalifikacji, odwołania i onboarding; brak szkiców/cudzych zaleceń i ujawniania prywatnego briefu.                                                                                                                           |
| AC-15 | Zmienione widoki mają etykiety, klawiaturę, fokus i czytelny feedback, bez poziomego przepełnienia przy 320/390/768/1440 px.                                                                                                                       |
| AC-16 | Przeklik obu ról obejmuje wszystkie główne sekcje, szczegóły i powrót. Raport rozdziela odczyt źródeł, komponenty, prawdziwy przeklik i braki danych.                                                                                              |

## Decyzje realizacyjne i własność

- Finanse: technika jest właścicielem `components/finance/charge-row.tsx`,
  `payment-entry-form.tsx`, `payment-recovery.tsx`, `components/finance.tsx`,
  `components/finance.module.css` oraz przypisanych testów.
  Wykorzystujemy istniejący `PaymentEntryForm` i `recordPayment`, który już obsługuje
  kurs/fitness, blokady DB i request_id. Koordynator wybrał ten wspólny prosty
  przebieg zamiast kopiowania pełnych formularzy usług z dodatkowym odświeżeniem.
  Kwota i jawna metoda zostają dostępne; opcjonalna notatka jest drugorzędna.
  Przycisk jednoznacznie oznacza odnotowanie pieniędzy już otrzymanych.
- Placeholder głosu: osobny autor ma wspólny komponent i jego miejsca w szczegółach
  spaceru, konsultacji, spotkania kursu i fitnessu. Bez zmian akcji i DB.
- Koordynator: Home, model i zapytania dashboardu, dokumentacja, integracja,
  serwer lokalny i rzeczywiste testy lokalnej bazy/przeglądarki. Propozycje to
  kilka najbliższych dostępnych zajęć z istniejącego odczytu `calendar_offer`.
- Recenzent: świeży kontekst wymagań i faktyczny diff, bez edycji aplikacji/testów.

## Wynik i ograniczenia

### Zachowanie

- Kurs i fitness: „Odnotuj wpłatę” otwiera kwotę i metodę przy danej należności.
  Opcjonalna notatka jest zwinięta, z jawną informacją o widoczności dla opiekuna.
  Pokazujemy aktualną należność, wpłacone i pozostałe pieniądze. Zapis korzysta
  z dotychczasowego `recordPayment`; bez nowego cennika, księgowania ani migracji.
- Wysłane polecenie zachowuje UUID i pola do potwierdzenia. Provider ponad listą
  przechowuje je wyłącznie w pamięci tego widoku, bez cache salda i localStorage.
  Gdy wiersz znika po pełnej wpłacie lub paginacji, pozostaje dokładne potwierdzenie
  albo ponowienie. Powrót wiersza przywraca niepotwierdzone dane i komunikat.
- Głos: cztery rodzaje szczegółów spotkania Asi mają przycisk „Notatka głosowa ·
  Wkrótce”. Otwiera wyłącznie informację „Teraz nic się nie nagrywa”. Opiekun
  nie ma tego przycisku; brak mikrofonu, audio, transkrypcji, API i zapisu.
- Start opiekuna: najbliższe spotkanie, rzeczywiście opublikowane zalecenia,
  maksymalnie dwie aktualnie dostępne propozycje oraz bieżące zgłoszenia i psy.
  Odczyty Home mają jawne projekcje bez kwot/statusów finansowych; nie pobierają
  podsumowania rozliczeń. Rozliczenia, historia i podgląd płatności pozostają
  we właściwej sekcji.

### Niezależny przegląd i poprawki

Recenzent otrzymał AC i faktyczny diff bez raportu autora. Wykryto i zamknięto:
odczyt zbędnych kolumn finansowych spaceru na Home; utratę potwierdzenia pełnej
wpłaty po usunięciu wiersza; utratę klucza częściowej wpłaty po powrocie z innej
strony paginacji. Ostatnią poprawkę recenzent sprawdził we własnych 37 testach
w pięciu plikach. Późniejszy prawdziwy przeklik ujawnił zbyt szeroką nazwę
dostępną pola notatki — opis widoczności ma teraz osobne `aria-describedby`.

### Odbiór

- Pełny Vitest: **2085/2085, 148 plików PASS**. Po zmianie wyłącznie semantyki
  etykiety notatki powtórzono właściwe 68 testów/9 plików — PASS.
- Lokalny produkcyjny build, pełny ESLint i TypeScript — PASS. Po ostatnich
  korektach testów dodatkowo ich formatowanie, lint i TypeScript — PASS.
  W lokalnym katalogu wygenerowanych typów pojawiły się identyczne kopie
  `* 2.ts`; po porównaniu bajtowym odłożono je do prywatnych dowodów i ponowiono
  kontrolę. Bez zmiany źródeł, `tsconfig` ani wyciszania błędów typowania.
- **17 różnych scenariuszy lokalnego Next/Supabase w Chromium — PASS**:
  16 z `care-simple`, `course-simple`, `finance-transport-recovery`,
  `voice-placeholder`, `community-chat`, `course-finance`, `finance-pagination`,
  `home-value`, `profile-personalization`, `quick-payments`, `reminders`,
  `service-requests` oraz scenariusz `concurrent stale scheduling` z
  `fitness-journey`. Dwa scenariusze finansów kursu obejmują także prawdziwe
  blokady PostgreSQL, nadpłatę, uzgodnienia i zwroty.
- **6 różnych scenariuszy WebKit — PASS**: Home, trzy szybkie wpłaty i dwa
  miejsca głosu. Kurs/fitness sprawdzają głos we własnych konkretnych spotkaniach
  wewnątrz scenariuszy wpłat, a osobne testy konsultację/spacer. Przyciski nie
  są dostępne opiekunowi. Wejście klawiaturą otwiera i zamyka informację.
- Kurs 400 → 100 → 300 zł: kwota/cena, dwa wpisy i historia obu ról zgodne;
  błędne kwoty zachowują pola i UUID. Częściowa oraz pełna wpłata fitnessu
  po utracie już zapisanej odpowiedzi, paginacji i odświeżeniu innego wiersza:
  dokładne ponowienie zachowuje jeden wpis i jeden zestaw efektów.
- Otwarte formularze wpłaty i Home: 320/390/768/1440 px, brak poziomego
  przepełnienia. Zrzuty wizualnie obejrzano. Home w rzeczywistej sesji pokazuje
  opublikowany plan i nową dostępną ofertę, bez prywatnego szkicu, własnego
  zgłoszenia w propozycjach, kwot i aktywnej funkcji księgowania przez opiekuna.
- Odczytowy przeklik istniejących kont: **104 otwarcia stron obu ról**, dodatkowe
  mobilne szczegóły i **12 rzeczywistych przejść głównego menu na telefonie**.
  Wszystkie główne sekcje, ustawienia, profil/hasło, formularze utworzenia,
  skrzynka oraz istniejące szczegóły: HTTP 200, bez błędów JS, poziomego
  przepełnienia i blokowanych żądań biznesowych. Główne układy 1440 i 390 px.
  Ten przeklik był odczytowy — nie oznacza wykonania każdego możliwego zapisu.
- W tym zastanym zestawie brakowało niepustych szczegółów konsultacji, kursu,
  fitnessu, kart, zaproszeń, kontaktów/odpowiedzi kontrolnych i rozmów. Pierwsze
  trzy, plany, wiadomości i finanse odebrano następnie na izolowanych fixtures
  w powyższych E2E. Karty, zaproszenia i adminowe relacje odebrano tutaj tylko
  jako trasy/stany zastane; nowa iteracja nie dowodzi pełnego cyklu tych danych.
- Porównanie po sprzątnięciu: **92 tabele biznesowe bez zmian liczby i skrótu
  rekordów**. Jedyna różnica w 93 tabelach to techniczny heartbeat
  `reminder_worker_state`, po lokalnej próbie procesora przypomnień. Własne
  konta, psy, usługi i wpisy testowe usunięto; istniejących danych nie poprawiano.

Pierwsze przebiegi wykryły także korekty samych testów: błędną kolumnę przy
tworzeniu własnego spaceru, szeroki selektor pojedynczego statusu przy dwóch
poprawnych potwierdzeniach i podwójne otwarcie/zamknięcie `details` przez helper
w istniejącym scenariuszu fitness. Odpowiednie scenariusze powtórzono — PASS.
W WebKit szybkie kolejne pełne `goto` powodowały komunikaty ładowania przerwanych
RSC. A/B przy stałej aplikacji i routeguard potwierdziło, że oczekiwanie na
zakończenie sieci przed następną pełną nawigacją usuwa ten problem. Kontrola
`errors=[]` pozostała niepoluzowana; nie filtrujemy komunikatów „access control”.
Nie ustalono tej frazy na poziomie stosu sieciowego; nie deklarujemy na tej
podstawie rozwiązania ogólnego problemu szybkiej nawigacji użytkownika.

Logi i zrzuty są w prywatnym, ignorowanym `.local/in-the-moment-20261027/`.
Dokumentacja źródłowa, komponenty, rzeczywisty przeklik i ograniczenia danych
mają powyżej oddzielne wyniki. Nie ma znanych otwartych uwag recenzenta
blokujących sprawdzony lokalny zakres.

Pierwotny odbiór zakończono lokalnie. Użytkownik następnie osobno polecił
publikację; kod `4b0c7a5` opublikowano 27.10. **102 warianty UI i trzy odmowy
endpointów online PASS**, bez migracji, zmian danych biznesowych i aktywacji
integracji. [Osobny zapis publikacji](2026-10-27-publikacja-obsluga-w-biegu.md).
Nadal 66 migracji; operator, symulator w chmurze, oba kanały SMTP i zaproszenia
pozostają wyłączone. Nie zmieniano infrastruktury Supabase.
