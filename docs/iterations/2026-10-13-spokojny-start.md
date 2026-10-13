# Spokojny start

Status: implementacja i odbiór lokalny zakończone.
Data briefu: 13 października 2026. Wersja nieopublikowana.

## Potrzeba i zakres

Prowadząca po otwarciu panelu rozpoznaje najbliższy termin oraz sprawy wymagające
działania. Opiekun ma krótsze menu i zachowuje dostęp do istniejących funkcji.
Podstawą jest wybrana propozycja „Spokojny start”, wcześniejszy feedback o
przeciążeniu interfejsu oraz zgoda na pracę zespołu agentów w Codexie.

Już działają: sześć sekcji menu prowadzącej, karta najbliższego spotkania,
podgląd czterech spraw, pełna kolejka, zwinięte podsumowanie i mobilna nawigacja.
Iteracja dopracowuje prezentację tych elementów. Nie dodaje nowych procesów.

## Uzgodnienie dwóch perspektyw

Biznes i technika niezależnie zaproponowały zachowanie obecnych danych i funkcji
oraz redukcję ciężaru wizualnego. Różniły się sposobem grupowania menu opiekuna:
jedna grupa „Więcej” albo osobne „Zajęcia” i „Więcej”. Przyjmujemy dwie nazwane
grupy, żeby użytkownik znajdował spotkania według ich znaczenia.

Menu opiekuna ma sześć głównych linków: Mój start, Kalendarz, Moje psy,
Plany i postępy, Oferta i Moje rozliczenia, oraz dwie grupy: Zajęcia (spacery,
kursy, fitness, konsultacje) i Więcej (karty podarunkowe, Psiutki).
Powiadomienia pozostają pod dzwonkiem, a konto i wylogowanie są nadal dostępne.
Nagłówek pulpitu pozostaje „Pulpit”, zgodnie z nazwą w nawigacji. Krótsza
prezentacja daty nie może sugerować, że przyszłe spotkanie odbywa się dziś.

## Kryteria akceptacji

| ID | Oczekiwane zachowanie |
| --- | --- |
| AC-01 | Pulpit pokazuje obok siebie termin i sprawy na komputerze, a pionowo przy 320 i 390 px. Brak poziomego przepełnienia i utraty informacji przy długich nazwach. |
| AC-02 | Podgląd zawiera maksymalnie cztery sprawy, link do pełnej kolejki i domyślnie zwinięte podsumowanie. |
| AC-03 | Sprawa ma rozpoznawalny podmiot, czynność oraz istotny status lub termin; zaległość jest czytelna również bez koloru. |
| AC-04 | Jeden tytuł strony, dzwonek i główna akcja zachowują swoje funkcje. „Zaplanuj zajęcia” prowadzi do /admin/activities; opiekun zachowuje dostęp do „Znajdź spacer”. |
| AC-05 | Terminy, nazwiska, tytuły, liczniki i zaległości pochodzą z dotychczasowych danych. Brak fikcyjnych wartości z makiety i domyślnego przypisywania sal lub prowadzących. |
| AC-06 | Brak terminu jest opisany jako brak potwierdzonych spotkań w najbliższych 31 dniach; pusta kolejka ma rzeczywisty pusty stan i przydatne przejście dalej. |
| AC-07 | Menu opiekuna ma najwyżej osiem głównych wierszy. Dotychczasowe funkcje pozostają osiągalne najwyżej dwoma działaniami od otwartego menu, a stare adresy działają. |
| AC-08 | Aktywna trasa i jej grupa są widoczne przy bezpośrednim wejściu i nawigacji klienta. Działają Tab, Shift+Tab, Escape, zamknięcie po linku oraz powrót fokusu menu mobilnego. |
| AC-09 | Ostrzeżenia kwalifikacyjne i ich akcje pozostają widoczne. Teksty kontaktu kontrolnego nie sugerują automatycznej wiadomości do opiekuna. |
| AC-10 | Obecne logo, kontrast, oznaczenia fokusu i dane konta są zachowane. Nowe style mają ograniczony zasięg. |

## Granice iteracji

Praca lokalna. Bez zmian źródeł danych, zapytań, akcji biznesowych, schematu,
finansów, autoryzacji i logowania. Pakiety, SMTP, push oraz nowy plik logo
pozostają osobnym zakresem. Nie publikujemy tej iteracji na podstawie dawnej
autoryzacji publikacji poprzedniej wersji.

## Przekazanie i kontrola

Agent techniczny jest właścicielem plików interfejsu, potrzebnych istniejących
testów oraz ewentualnych izolowanych stylów. Koordynator jest właścicielem
AGENTS.md, profili agentów, dokumentacji procesu i tego briefu.
Recenzent przygotował własne kryteria regresji przed poznaniem planu autora.
Odbiór obejmie istniejące testy nawigacji i właściwych komponentów, lint,
TypeScript, lokalną kompilację oraz rzeczywistą obsługę menu i pulpitu
w przeglądarce. Testy z danymi wyłącznie w lokalnym środowisku.

## Wynik implementacji i niezależnego przeglądu

Karta terminu prowadzącej jest jasna, ma pełną datę w strefie Europe/Warsaw,
godziny początku i końca oraz tylko rzeczywiście przypisane miejsce, osobę i salę.
Wiersze czterech spraw eksponują psa i czynność; zaległość nadal ma etykietę
tekstową. Nawigacja opiekuna otrzymała sześć linków i dwie grupy otwierane również
przez aktywną trasę. Konto przeniesiono na dół menu. Główne akcje, stare adresy,
kwalifikacja i istniejące dane pozostają zachowane.

Recenzent ocenił diff przed otrzymaniem raportu autora. Nie znalazł istotnej,
reprodukowalnej regresji; sprawdził również mapowanie czynności kolejki względem
wariantów źródłowych w SQL. Agent biznesowy osobno potwierdził zgodność nazw,
grupowania i ścieżek obu ról, na podstawie kodu i zrzutów.

Koordynator wykrył na zrzucie dodatkowy problem: ciemny tekst drugiej akcji na
ciemnej karcie opiekuna. Autor poprawił kontrast i fokus wyłącznie w tej karcie.
Recenzent przyjął korektę po sprawdzeniu kaskady CSS; końcowy zrzut prawdziwej
aplikacji potwierdza czytelny link „Wybierz usługę”.

## Dowody odbioru

- Autor: ESLint całego repozytorium, TypeScript oraz **70 testów w 5 zestawach**:
  notifications-view, work-queries, work-actions, calendar-actions i domain.
- Recenzent: osobny przebieg **61 testów w 5 zestawach**: notifications-view,
  work-actions, work-queries, qualification i calendar-actions. Zestawy częściowo
  pokrywają się z kontrolą autora; liczby nie oznaczają 131 unikalnych testów.
- Koordynator: końcowa lokalna kompilacja po poprawce kontrastu — powodzenie.
- Rzeczywisty lokalny Next.js z Supabase: **21 tras obu ról**, **8 wariantów
  responsywności** przy 1440/768/390/320 px i **6 scenariuszy mobilnego menu**
  przy 390/320/760 px. Sprawdzono Tab, Shift+Tab, Escape, powrót fokusu,
  niedostępność tła przy otwartym menu, nawigację, powrót i zmianę szerokości.
  Brak błędów skryptów i żądań poza lokalnymi usługami.
- Po wąskiej korekcie kontrastu ponownie sprawdzono **8 widoków obu pulpitów**
  na końcowej kompilacji oraz odnośnik do oferty. Zrzuty oceniono wizualnie.
  Kontrola czeka na rzeczywistą zawartość pulpitu, a nie sam ekran ładowania.
- Izolowany odbiór rzeczywistych komponentów z fikcyjnymi danymi: **16 przypadków**.
  Obie role, długie i puste karty przy 320/390/1440 px, letnia i zimowa data
  Warszawy także przy strefie przeglądarki America/Los_Angeles. Pełne teksty,
  zakres przez północ, cztery sprawy z pięciu i właściwe odnośniki zachowane;
  brak przepełnienia, błędów skryptów i zewnętrznych żądań. Minimalny zmierzony
  kontrast tekstu poprawionej akcji wynosił 12,92:1, po najechaniu 10,52:1.
  Autor ocenił zrzuty, a koordynator niezależnie obejrzał długi stan prowadzącej
  przy 320 i 1440 px. To próba układu komponentów, nie dodatkowy zapis w bazie.

Pełne logi, dane sesji i narzędzia odbioru pozostają w ignorowanym `.local/`,
zrzuty w `output/spokojny-start-local/` i `output/spokojny-start-edge/`.
Pomocniczy serwer komponentów został zamknięty; podgląd aplikacji pozostaje
na localhost:3000. To odbiór lokalnego UI; nie jest nowym
pełnym E2E procesów finansowych, sprawdzianem hostingu ani pomiarem dla 50 osób.
Nie zmieniano chmury, migracji, haseł ani danych biznesowych. Logowania testowe
utworzyły zwykłe lokalne sesje Auth.
