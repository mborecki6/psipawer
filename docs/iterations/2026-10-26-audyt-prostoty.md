# Audyt prostoty Psi Pawer — 26.10.2026

## Cel i status

Użytkownik zlecił analizę miejsc, w których aplikację można uprościć z zachowaniem
zdrowego umiaru. Narzędzie ma pomagać prowadzić zajęcia i współpracę z opiekunami.
Poniższe rekomendacje są propozycjami kolejnych zakresów, **nie zaakceptowanymi
kryteriami przebudowy ani wdrożonymi poprawkami**. W tej iteracji nie zmieniono kodu
aplikacji, danych biznesowych ani produkcji.

Biznes i technika przygotowały niezależne oceny. Recenzent w osobnym kontekście
ocenił źródła i ścieżkę opiekuna, a następnie zakwestionował ryzykowne założenia
konsolidacji. Koordynator sprawdził lokalną aplikację i ustalił poniższe priorytety.

## Główny wniosek

Największy ciężar powstaje wewnątrz szczegółów: formularze edycji, cała historia,
warunki i bieżąca praca konkurują o uwagę. Ekrany często odwzorowują strukturę
danych; użytkownik musi sam znaleźć kolejny krok.

Pomocna zasada: **najpierw bieżąca sytuacja i potrzebne działanie, następnie
pozostałe szczegóły, na końcu konfiguracja i historia**. Jedna dominująca czynność
jest dobrym ustawieniem domyślnym; niezależne pilne problemy nadal muszą być widoczne.
Samo schowanie wszystkiego pod „Więcej” zwiększyłoby szukanie.

## Najważniejsze miejsca

### UX-01. „Do zrobienia” powinno uczciwie określać swój zakres

**Dziś:** pusty podgląd mówi „Wszystkie bieżące sprawy są obsłużone”, lecz źródłowa
kolejka nie obejmuje oczekujących zgłoszeń kursowych ani `service_requests`.
Prośby o termin mają osobną obsługę i licznik w Zajęciach; zgłoszenia nie znikają.

**Propozycja:** najpierw precyzyjniejszy pusty komunikat i czytelne przejście do
pozostałych zgłoszeń. W osobnym etapie rozważyć jedno miejsce obsługi wszystkich
oczekujących próśb, bez dodawania kolejnego modułu lub pulpitu.

**Zakres:** korekta komunikatu i odsyłacza jest mała. Wspólna kolejka wymaga zmian
odczytów, rodzajów spraw, liczników, paginacji i ustalenia priorytetów. To oddzielna
zmiana funkcjonalna, a nie kosmetyczne zwinięcie kart.

**Dowód:** źródła; przeszukanie późniejszych migracji nie wykazało rozszerzenia
ostatniej definicji. Nie odtwarzano brakującego rodzaju zgłoszenia w DEMO.
[Kolejka SQL](../../supabase/migrations/202610030006_fitness_notifications_work.sql#L129),
[pusty komunikat](../../src/modules/work/views.tsx#L122),
[osobne prośby w Zajęciach](../../src/app/admin/activities/page.tsx#L9).

### UX-02. Karta psa powinna najpierw służyć do czytania

**Dziś:** po wejściu obie role dostają otwartą edycję profilu z sześcioma polami
i kwestionariusz z dziesięcioma polami tekstowymi. Status kwalifikacji już jest
widoczny przy imieniu psa, ale formularz decyzji kwalifikacyjnej dla Asi i notatki
znajdują się dalej. To potwierdzono również w rzeczywistym lokalnym widoku.

**Propozycja:** krótka karta psa: najważniejsze informacje, stan kwalifikacji,
potrzeby i ostatni kontekst współpracy. „Edytuj profil” oraz „Uzupełnij / zmień
informacje o psie” otwierają istniejące formularze. Dla Asi kwalifikacja wymagająca
reakcji i notatki powinny być dostępne blisko podsumowania.

**Zachować:** widoczny brak ankiety, informacje istotne dla bezpieczeństwa,
prywatność notatek oraz wpisany szkic. Prywatny brief onboardingu nie zastępuje
kwestionariusza psa i nie powinien być do niego automatycznie kopiowany.

**Zakres:** średnia zmiana UI, bez nowych zasad kwalifikacji lub schematu danych.
[Karta i formularze psa](../../src/components/dogs.tsx#L175).

### UX-03. Konsultacja powinna prowadzić do czynności właściwej dla jej stanu

**Dziś:** pełny formularz ustalenia terminu jest otwarty również przy umówionej
konsultacji. Historia poprzedza część bieżących działań; na węższym ekranie
rozliczenie, zalecenia i zakończenie spotkania trafiają za pierwszą kolumnę.

**Propozycja:** nowe zgłoszenie → ustalenie terminu; umówione spotkanie → czytelna
data, miejsce i temat oraz wtórne „Zmień termin”; po upływie spotkania → jego
zamknięcie i zalecenia. Historia dostępna po rozwinięciu. Ta sama logiczna kolejność
na telefonie i komputerze.

**Zachować:** przy starszym zgłoszeniu bez kwoty najpierw uzgodnienie ceny,
ostrzeżenia o kolizjach, przyczyny odwołania, kontrolę wersji i istniejącą blokadę
przedwczesnego zakończenia. Nie zwijać pierwszego formularza potrzebnego do obsługi.

**Zakres:** średnia zmiana UI. Ocena źródłowa; lokalne konto audytu nie miało
wypełnionej konsultacji do sprawdzenia tych stanów w przeglądarce.
[Szczegóły konsultacji](../../src/modules/consultations/views.tsx#L453),
[kolejność na małym ekranie](../../src/modules/consultations/consultations.module.css#L234).

### UX-04. Fitness i szczegół kursu opiekuna potrzebują wyraźnego centrum pracy

**Dziś:** fitness pokazuje warunki, wszystkie spotkania i historię przed częścią
obsługi pakietu. W widoku kursu opiekuna pełna lista spotkań poprzedza część
informacji o własnym udziale. Na telefonie długa pierwsza kolumna staje się
szczególnie kosztowna. Formularze terminów i obecności są już zwinięte.

**Propozycja dla Asi:** postęp, spotkanie wybrane lub wymagające obsługi, zwięzła
lista reszty; ustawienia i historia dalej. Lokalnie uproszczony kurs jest użytecznym
wzorcem, lecz nie wolno go mechanicznie skopiować.

**Propozycja dla opiekuna:** status własnego udziału, najbliższy termin lub
„czekamy na ustalenie”, miejsce, saldo i właściwy następny krok; potem pozostałe
spotkania i historia.

**Zachować:** nieumówione i odwołane terminy wracające do ustalenia, zaległe
obecności, możliwość korekty wcześniejszego spotkania, rezygnację oraz nierozliczone
kwoty. Wybór wyłącznie najbliższego datowanego spotkania byłby niewystarczający.

**Zakres:** średnia zmiana UI; bez zmiany zasad pakietów, cen i naliczania wejść.
Lokalny kompakt kursu obejmuje admina, nie rozwiązał jeszcze układu opiekuna.
Szczegóły fitnessu i niepustego kursu opiekuna oceniono źródłowo.
[Fitness](../../src/modules/fitness/views.tsx#L232),
[kurs](../../src/modules/courses/views.tsx),
[wcześniejszy lokalny zakres kursu](2026-10-26-prostszy-kurs.md).

### UX-05. Wybrane spotkanie powinno pozostać wybrane po otwarciu szczegółów

**Dziś:** „Szczegóły” z kalendarza lub karty najbliższego spotkania prowadzą do
całego kursu/pakietu. Użytkownik musi ponownie znaleźć termin. „Otwórz kalendarz”
już zachowuje właściwy dzień i wpis. Powrót ze sprawy zwykle prowadzi do listy
modułu, a nie wcześniejszej kolejki z filtrem.

**Propozycja:** otwierać dokładne spotkanie i jego sekcję oraz zachować możliwość
powrotu do poprzedniej pracy. Wykorzystać istniejące kotwice i formularze.

**Zakres:** routing i UI, a dla opiekuna możliwe rozszerzenie odczytu — jego RPC
nie dostarcza ID spotkania tak jak odczyt admina. Nie odgadywać numeru z tytułu.
Cel wewnętrznego powrotu musi być kontrolowany; rozwinięcie powinno otworzyć kotwicę.
[Odsyłacze kalendarza](../../src/modules/calendar/views.tsx#L306),
[najbliższe spotkanie](../../src/modules/calendar/next-appointment.tsx#L24),
[RPC opiekuna](../../supabase/migrations/202610100001_calendar_team.sql#L631),
[cele kolejki](../../src/modules/work/types.ts#L61).

### UX-06. Start opiekuna powinien pokazywać bieżącą współpracę

**Dziś:** „Twoje zgłoszenia” obejmuje wszystkie zgłoszenia spacerowe, bez daty
spotkania i oddzielenia historii; odczyt sortuje je od najstarszych. Oczekująca
konsultacja, kurs i fitness nie trafiają do tej sekcji. Wspólne najbliższe
potwierdzone spotkanie nie zastępuje podglądu oczekujących spraw.

**Propozycja:** niewielka sekcja bieżących zgłoszeń wszystkich rodzajów: pies,
usługa, termin lub „do ustalenia”, status i następny krok. Historia pod odsyłaczem.
Puste dodatki i nieaktywne pakiety nie muszą zajmować osobnych dużych kart.

**Zachować:** odwołania, ponowną kwalifikację, zaległą należność i zwrot również
wtedy, gdy samo spotkanie jest już w przeszłości. „Aktywne” wymaga jawnej definicji;
nie wystarczy odfiltrować dawnych dat.

**Zakres:** zmiana odczytów i hierarchii UI, nie tylko etykiety. Zawartość obecnej
sekcji potwierdzają źródła i lokalny podgląd; mieszany scenariusz oczekujących
usług wymaga osobnych danych testowych przy implementacji.
[Start opiekuna](../../src/app/app/page.tsx#L56),
[odczyt zgłoszeń](../../src/lib/data/queries.ts#L43).

### UX-07. Skład kursu może być krótką listą uczestników

**Dziś:** każdy uczestnik ma rozbudowaną kartę statusu, rozliczeń i zaleceń.
Przy kilku psach powtarza się wiele informacji. Ostatnie lokalne uproszczenie
kursu celowo skupiało się na harmonogramie, nie tej części.

**Propozycja:** wiersz „pies — status — saldo / problem — szczegóły”. Rozliczenie
i plan otwierane przy wybranej parze pies–opiekun, z istniejącymi odsyłaczami.

**Zachować:** kwotę do zapłaty lub zwrotu, wyjątki rozliczenia i sygnał istniejącego
szkicu. Historie wpłat są już zwinięte. Nie wyliczać sumy całego kursu na podstawie
jednej strony paginowanej listy uczestników.

**Zakres:** średnia zmiana UI, bez nowego systemu finansowego.
[Uczestnicy kursu](../../src/modules/courses/views.tsx#L685),
[rozliczenie](../../src/modules/courses/billing.tsx#L50),
[zalecenia uczestnika](../../src/modules/courses/care-panel.tsx#L49).

### UX-08. Odpowiedź opiekuna na zalecenia może zaczynać się od jednego pola

**Dziś:** opiekun wybiera kontekst planu i ma trzy pola odpowiedzi. Przy krótkim
raporcie może to wyglądać jak obowiązek przygotowania formalnego sprawozdania.
To ocena konstrukcji formularza, nie wynik badania porzuceń.

**Propozycja:** czytelnie wskazać bieżący plan i jedno główne pole „Jak poszło?”.
Dwa dodatkowe pola dostępne jako opcjonalne doprecyzowanie. Zmiana planu dopiero,
gdy jest rzeczywisty wybór. Lokalne uproszczenie adminowego edytora nie obejmowało
tego formularza opiekuna.

**Zachować:** rozdzielenie pól w zapisie, właściwy kontekst i wersję planu,
niezapisany tekst, wyjaśnienie wygasłego dostępu oraz czytelny błąd zapisu.
Zwinięcie nie może odmontowywać formularza i kasować odpowiedzi.

**Zakres:** mała lub średnia zmiana UI.
[Formularz postępu](../../src/modules/care/progress-form.tsx#L47),
[widok zaleceń](../../src/modules/care/views.tsx#L496).

### UX-09. W spacerze skład powinien być bliżej bieżącej pracy Asi

**Dziś:** informacje „Przed spacerem” i miejsce zajmują pierwszą kolumnę, która
na telefonie poprzedza skład. Przy przyszłym terminie formularz dodania psa jest
nad uczestnikami. Lista zawiera także odrzucone i wycofane zgłoszenia; formularze
decyzji lub obecności są otwarte przy psach spełniających warunki danej czynności.

**Propozycja:** krótki nagłówek z terminem i miejscem, następnie oczekujące decyzje
i bieżący skład. Wiersz psa pokazuje status, stan rozliczenia i potrzebną czynność.
Dodanie psa oraz pozostałe zgłoszenia są dostępne pomocniczo, z zachowaniem kotwic.

**Zachować:** ostrzeżenia o konfliktach między psami i kwalifikacji, rezerwę oraz
nierozliczoną sprawę także przy wycofanym zgłoszeniu. Nie zmieniać kolejki przyjęć,
naliczania wejść ani reguł odwołania. Nie dodawać automatycznego „wszyscy obecni”.

**Zakres:** średnia zmiana hierarchii UI. Bogatsze stany listy oceniono źródłowo;
lokalny podgląd istniejącego spaceru nie zastępuje odbioru pełnego składu.
[Układ spaceru](../../src/components/walks.tsx#L252),
[lista i formularze](../../src/components/walks.tsx#L345).

## Mniejsze poprawki do wykonania przy okazji

| Miejsce | Proponowane uproszczenie | Granica |
| --- | --- | --- |
| Rozliczenia | Przy kursie i fitnessie od razu odsyłacz do zapisu wpłaty; dziś najpierw otwiera się sekcję zawierającą sam link. | Zachować istniejący formularz w module i dokładny cel; nie przenosić logiki pieniędzy. [Źródło](../../src/components/finance/charge-row.tsx#L12). |
| Formularze | Przy jednoznacznym wyborze pokazać wybraną usługę, jednego uprawnionego psa lub „Prowadząca: Asia”, z możliwością zmiany. | Wybór usługi jest już przekazywany w URL. Zachować walidację, cenę, wersje i dawne/null przypisania. [Usługa](../../src/modules/services/selection.tsx), [prowadząca](../../src/modules/calendar/booking-choice.tsx). |
| Nagłówki i skróty | Skrócić powtarzające się duże tytuły i hasła na roboczych szczegółach. Ujednolicić etykiety planowania; ograniczyć konkurencję globalnego „Znajdź spacer” z celem aktualnego ekranu. | Zachować szybki dostęp do spacerów. Bez nowego uniwersalnego kreatora. [Belka](../../src/components/shell.tsx#L437), [planowanie](../../src/modules/calendar/views.tsx#L431). |
| Cennik | Zmiana ceny i widoczności na początku, rzadsze parametry i historia w szczegółach. | Zachować dotychczasowe wartości i warunki starszych zapisów; oznaczenia ceny testowej pozostają widoczne. [Edytor](../../src/modules/services/editor.tsx#L57). |
| Puste rozliczenia | Połączyć powtarzające się puste komunikaty i zerowe podsumowania, gdy nie ma żadnej bieżącej sprawy. | Niski priorytet. Formularze finansowe już są zwinięte. Lokalny panel symulatora BLIK nie jest dowodem bałaganu w produkcji, gdzie Tpay pozostaje OFF. |

## Co warto zachować

- Menu ma już po sześć głównych pozycji; Zajęcia, Więcej i ustawienia grupują
  dalsze funkcje. Nie ma podstaw do kolejnej przebudowy całej nawigacji.
- Pulpit Asi z najbliższym spotkaniem i zadaniami oraz zaakceptowany miesiąc
  i spokojny wybór dnia w tygodniu mają właściwy kierunek.
- Oddzielne powiadomienia i zadania mają różne znaczenie: przeczytanie komunikatu
  nie oznacza obsłużenia sprawy. Nie łączyć ich wyłącznie dla mniejszej liczby zakładek.
- Ostatnie lokalne uproszczenia zaleceń i harmonogramu kursu są punktem wyjścia.
  Nie są jeszcze opublikowane i nie obejmują wszystkich gałęzi opiekuna.
- Ustawienia urządzenia, filtry, część formularzy oraz historie wpłat są już
  zwinięte. Nie liczyć ich jako otwartych decyzji przy wejściu.

Nie ma danych o użyciu uzasadniających usuwanie całych funkcji. Najpierw poprawić
hierarchię i kontekst, potem zebrać obserwacje kilku rzeczywistych opiekunów i Asi.
Pomysł głosówki warto rozpatrywać jako skrót w szczegółach spotkania zastępujący
część pisania, nie jako kolejny główny moduł. Nie jest implementowany tym audytem.

## Proponowana kolejność dalszej pracy

1. **Mały porządek:** prawdziwy komunikat zakresu kolejki, bezpośrednie przejścia do
   istniejących rozliczeń, spójne etykiety. Osobno sprawdzić identyfikatory potrzebne
   do otwierania dokładnego spotkania dla każdej roli.
2. **Codzienna praca Asi:** karta psa, konsultacja zależna od stanu, skład spaceru i fitness;
   każdy jako mała osobna iteracja z odbiorem telefonu i wyjątków.
3. **Bieżąca sytuacja opiekuna:** hierarchia udziału w kursie/fitnessie, aktywne
   zgłoszenia na starcie, krótszy formularz postępu. Agregację danych i znaczenie
   „aktywne” uzgodnić przed implementacją.
4. **Dalsze odchudzenie:** karty uczestników, cennik, pozorne wybory i powtórzenia
   tekstu. Rozszerzenie kolejki jest odrębnym zakresem funkcjonalnym.

Przyszły odbiór powinien sprawdzać wykonanie konkretnego zadania: od zgłoszenia do
kwalifikacji i powrotu; od wybranego spotkania do jego obsługi; od wejścia opiekuna
do znalezienia statusu i terminu. Dodatkowo: zapisany szkic po zwinięciu, widoczny
błąd, kwota do zapłaty/zwrotu i wcześniejsza historia nadal dostępne. Sama mniejsza
liczba kart lub kliknięć nie jest wystarczającym kryterium.

## Zakres dowodów i ograniczenia

- Odczyt źródeł, warunków ról i statusów, linków, zamkniętych `details`, kolejności
  responsywnej oraz późniejszych migracji kolejki.
- Rzeczywista lokalna aplikacja: **31 widoków przy 1440 px i sześć wariantów
  szczegółów przy 390 px**, istniejące konta testowe administratora i opiekuna.
  Zapisano metadane i wybrane zrzuty; nie stwierdzono poziomego przepełnienia
  w tych wariantach. Audyt prostoty nie jest pełnym testem regresji lub uprawnień.
- Lokalne dane są ograniczone. Nie było wypełnionych szczegółów konsultacji,
  fitnessu i kursu dla tych kont; opis ich przeciążenia opiera się na źródłach,
  nie na nowym odbiorze wszystkich stanów w przeglądarce.
- W przeglądarce dopuszczono lokalne logowanie, a pozostałe żądania modyfikujące
  dane i ruch do zewnętrznych domen były blokowane. Nie tworzono kont i rekordów
  biznesowych. Nie badano produkcji, doręczeń, prawdziwych płatności ani obciążenia.
- Lokalne materiały pomocnicze: `.local/ux-audit-20261026/` — raport techniczny,
  niezależny przegląd, metadane i zrzuty. Nie zawierają eksportu sesji do repozytorium.

Audyt nie zastępuje osobno zapisanych warunków gotowości infrastruktury, SMTP
i operatora płatności w [stanie produktu](../PRODUCT-STATUS.md).
