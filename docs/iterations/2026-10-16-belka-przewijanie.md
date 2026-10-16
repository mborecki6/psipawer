# Belka panelu podczas przewijania

Status: sprawdzona lokalnie; publikacja zatwierdzona przez użytkownika 16.10. Źródło: dwa zrzuty feedbacku behawiorystki i nagranie
WhatsApp z 16.10, przekazane przez użytkownika. W nagraniu tytuł panelu,
menu i przyciski belki pozostają nad przewijaną treścią, która przebija przez
gradient. Nagranie obejmuje pulpit opiekuna, kalendarz i plany pracy;
drugi zrzut wskazuje ten sam problem na większym ekranie.

## Zakres i kryteria

- AC-B01: cała górna belka przewija się z dokumentem i znika po przejściu
  poniżej niej. Nagłówek, menu i akcje nie zasłaniają treści pod spodem.
  Dotyczy obu ról na telefonie i komputerze.
- AC-B02: po powrocie na górę tytuł, powiadomienia i główna akcja są dostępne.
  Aktywna nawigacja, menu telefonu, Tab/Escape i powrót fokusu działają.
  Boczna nawigacja na komputerze zachowuje swoje dotychczasowe położenie.
- AC-B03: brak zmian danych, reguł biznesowych, kalendarza, zdjęć i kolorów.
  To drobna korekta wspólnego CSS, bez nowego mechanizmu reagowania na scroll.
  Po odbiorze użytkownik 16.10 poleceniem „publikujmy” zatwierdził publikację
  tej konkretnej poprawki belki, bez innych zmian produktu.

Uzgodnienie koordynatora: „chowanie się” oznacza naturalne przewinięcie belki
poza ekran, bez automatycznego pojawiania jej przy zmianie kierunku przewijania.
Przyciski menu i akcji wracają po przewinięciu na górę. Nie dodajemy kolejnej
pływającej belki ani dodatkowego przycisku.

## Weryfikacja

Przed zmianą odtworzono problem w rzeczywistym Shell: po przewinięciu o 500 px
belka zostawała na y=0 i zasłaniała 78 px ekranu przy szerokości 390 px.
Podgląd wykorzystuje fikcyjne dane i zastępcze akcje, bez połączenia z bazą.
Wyniki i zrzuty lokalne: ignorowane `.local/scroll-header-20261016/`.

Po zmianie koordynator sprawdził 16 wariantów: pulpit i kalendarz obu ról
przy szerokościach 320, 390, 768 i 1440 px. Belka przemieszcza się o pełne
500 px wraz ze stroną i znika nad ekranem; nie ma przewijania poziomego ani
błędów przeglądarki. Menu telefonu otwiera się, zatrzymuje fokus, zamyka przez
Escape i kliknięcie pozycji oraz oddaje fokus przyciskowi. Boczny panel na
komputerze pozostaje w swoim położeniu. Obejrzano porównanie przed/po oraz
kalendarz na większym ekranie.

Kompilacja lokalnej aplikacji w trybie produkcyjnym zakończona sukcesem
(`node scripts/local-app.mjs build`). Sprawdzono wynikowy CSS: reguły `.topbar`
nie zawierają przyklejenia do ekranu. Formatowanie i diff check zaliczone.
Nie uruchamiano testów domenowych ani operacji na danych, bo zmiana usuwa
wyłącznie trzy deklaracje CSS ze wspólnej belki. Podgląd wykorzystuje prawdziwe
komponenty Shell, NextAppointment i CalendarView, a nie pełny przebieg z sesjami;
obrazy i akcje są lokalnymi zamiennikami.

Niezależny recenzent ocenił wymagania i faktyczny diff bez raportu autora.
Brak uwag. Potwierdził zachowanie czterech tras przy 390 i 1440 px oraz
dodatkowo 320 px, powrót na górę, aktywną nawigację i obsługę menu klawiaturą.
Raport: ignorowane `.local/scroll-header-review-20261016/review.md`.
Kontrola przez CUA dotyczyła lokalnego fixture; nie fizycznych urządzeń,
produkcji ani backendu. Wynik nie stanowi zgody na publikację.

## Rozszerzony odbiór faktycznych stron

Użytkownik ponownie wskazał nachodzenie napisu „Oferta w kalendarzu” na miesiąc
i nawigację. Doprecyzował, że problem występuje **na wersji online**, która
jeszcze nie zawiera poprawki. Poprzedni fixture sprawdzał CalendarView, nie
CalendarOfferView, dlatego nie dowodził poprawności tej konkretnej trasy.

Potwierdzono trasę `/app/calendar/offer`. Jej nagłówek, miesiąc i kontrolki są
w normalnym przepływie; nie znaleziono drugiego pozycjonowanego nagłówka.
Zakres kodu pozostaje ten sam: trzy usunięte deklaracje `.topbar`.

Uruchomiono pełny lokalny build Next.js na `http://localhost:3000`, z istniejącą
lokalną bazą i istniejącymi fikcyjnymi kontami. Pierwsza próba ujawniła brak
wcześniejszej migracji `202610140001_single_practitioner.sql` w lokalnej bazie
(błąd RPC PGRST202 na kalendarzu administratora). Uzupełniono wyłącznie tę
istniejącą migrację przez `supabase migration up --local`, z jawnym socketem
projektu; bez resetu bazy, wyboru prowadzącej ani zmian produkcji. Lokalny schemat
ma teraz 58 migracji. Nie dodawano nowej migracji ani funkcji do tej poprawki UI.

Dwa nagłówki znalezione przez pierwszy selektor nie były dwiema widocznymi
belkami: jeden należał do ukrytego `div#S:0[hidden]` po błędzie odczytu. Pomiar
potwierdził prostokąt 0×0 i brak widoczności. Nie zmieniono layoutów Shell.
W ponowionym odbiorze wymagano jednego **widocznego** nagłówka oraz braku widoku
błędu odczytu przed kontrolą geometrii.

Pełny odbiór zaliczony: **95 wariantów** — 19 rzeczywistych tras przy szerokościach
320, 390, 768, 1024 i 1440 px. Obejmuje 13 tras administratora: pulpit, kalendarz,
do zrobienia, zajęcia, kursy, konsultacje, fitness, psy, plany i postępy,
rozliczenia, ustawienia, ustawienia kalendarza i usługi. Obejmuje też sześć tras
opiekuna: start, kalendarz, ofertę w kalendarzu, plany, psy i ofertę usług.
Nie stwierdzono nakładania górnej belki, poziomego przewijania dokumentu ani
błędów przeglądarki. Przeszły zmiany kategorii i miesiąca oferty, przejście do
listy wybranego dnia i historia Wstecz/Dalej.

Osobno porównano rzeczywistą ofertę z niepustą listą: istniejący lokalny spacer
z 26.09, bez tworzenia danych. Dla 390 i 1440 px odtworzono dawny CSS wyłącznie
tymczasowym stylem w przeglądarce, a następnie go usunięto. W tym samym kadrze
stara belka nachodziła na miesiąc i przyciski, poprawiona znikała nad ekranem.
Obejrzano oba porównania oraz faktyczny kalendarz administratora.

Raporty: ignorowane `.local/scroll-header-20261016/real-pages/report.json`
i `offer-comparison.json`; zrzuty `real-offer-{before,after}-{390,1440}.png`.
To odbiór pełnej aplikacji lokalnej, bez podstawionych widoków lub akcji.
Nie wykonywano zapisów biznesowych w testach przeglądarkowych. Dane oraz sesje
produkcyjne i konta Asi pozostają poza tą kontrolą. Fizycznych urządzeń nie używano.

Recenzent niezależnie obejrzał siedem wskazanych obrazów przed odczytaniem raportu
koordynatora i ponownie ocenił źródła. Potwierdził kolizję w obu kadrach „before”,
jej usunięcie w obu kadrach „after” i czytelne widoki kalendarza administratora
oraz usług. Brak nowych uwag. To odrębny ogląd dowodów z pełnej aplikacji,
bez nowego logowania i interakcji recenzenta; nie zastępuje testu na fizycznym
urządzeniu ani kontroli produkcji po przyszłej publikacji.

## Publikacja

Zgoda użytkownika: „publikujmy”, 16.10.2026, po przedstawieniu poprawki i jej
odbioru. Publikacja obejmuje tę samą zmianę trzech deklaracji wspólnego CSS,
sprawdzoną w pełnej lokalnej aplikacji. Nie obejmuje nowych migracji, konfiguracji
Supabase, kont, danych ani funkcji. Odbiór produkcyjny ma sprawdzić zachowanie
belki w rzeczywistych widokach obu ról, bez zapisów biznesowych.
