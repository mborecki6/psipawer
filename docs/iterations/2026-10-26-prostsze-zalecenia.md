# Prostszy widok zaleceń przy psie — lokalnie, 26.10.2026

Użytkownik wskazał ekran administracyjny „Plany i postępy” jako zbyt skomplikowany.
Zakres: uproszczenie jego prezentacji lokalnie, bez zmiany reguł, danych,
akcji zapisu, tras, migracji ani integracji. Dotychczasowa zgoda na publikację
onboardingu nie obejmuje tej zmiany.

Biznes i technika przygotowały niezależne krótkie propozycje. Koordynator przyjął:

| ID | Kryterium |
| --- | --- |
| AC-01 | Admin ma kompaktowy nagłówek psa i jeden widoczny kontekst. Lista planów domyślnie zwinięta pod „Zmień plan”. Bez osobnego powtórzenia „Otwarty plan” i dużego opisu wprowadzającego. |
| AC-02 | Wszystkie konteksty i przygotowanie planu innej usługi pozostają dostępne: ogólny, konsultacja, kurs/pakiet i konkretne spotkanie. Linki zachowują parametry, aktywną pozycję i rozdzielenie treści. Nie zmieniamy wyboru domyślnego kontekstu. |
| AC-03 | Bez publikacji od razu widoczny edytor, bez poprzedzającej go pustej karty. Istniejące wejścia do szkicu zachowują działanie. Zwijanie sekcji nie usuwa DOM formularza. Potwierdzenie i błąd po akcji pozostają widoczne. |
| AC-04 | „Zapisz szkic” i „Opublikuj dla opiekuna” pozostają osobnymi działaniami, z dotychczasowymi blokadami. Historia publikacji jest niezmienna. Nie zmieniamy backendu. |
| AC-05 | Ochrona niezapisanej pracy działa także przy wyborze planu. Anulowanie zostawia tekst i kontekst. Materiały i opcjonalne daty są rozwijane; użycie materiału zachowuje potwierdzenie zastąpienia, a ustawione daty są widoczne w krótkim podsumowaniu. |
| AC-06 | Odpowiedzi i ich wersje pozostają dostępne; nowe wpisy mają czytelny stan. Tylko jawna akcja oznacza przeczytanie. Widok opiekuna oraz trwała publikacja zachowują obecne działanie. |
| AC-07 | Kontakt kontrolny, zaproszenie i dostęp do raportowania pozostają osiągalne w pomocniczej sekcji, po głównej pracy nad planem. Daty/statusy są widoczne w podsumowaniu. Kontakt prowadzącej i zaproszenie opiekuna nie są utożsamiane. |
| AC-08 | Historia, stronicowanie, stany puste, długie nazwy i klawiatura działają przy 320/390/768/1440 px. Przy typowym pustym szkicu na komputerze tytuł i początek zaleceń są osiągalne w pierwszym widoku. Bez poziomego przewijania. |

Właściciel UI: agent techniczny — `views.tsx`, `care.module.css` i prezentacja
`editor.tsx`. Koordynator: testy/fixtures, dokumentacja i lokalny odbiór.
Recenzent: świeży kontekst, wymagania i faktyczny diff, bez edycji aplikacji.

Kontrole zaplanowane: rzeczywiste komponenty care z kontrolowanymi akcjami,
regresje rzeczywistego Next/Supabase dla rozdzielenia planów i publikowania,
typy/lint i odpowiednie testy istniejącej domeny. Nie utożsamiamy fixture Vite
z pełnym odbiorem routingu, sesji ani produkcji.

## Wykonanie

- Nagłówek zawiera nazwę psa i krótkie linki. Jedna karta pokazuje usługę,
  zakres i stan planu; pełny wybór pozostaje pod „Zmień plan”. Nie ma powtórzenia
  „Otwarty plan” ani pustej karty poprzedzającej pierwszy szkic.
- Główna praca to tytuł, treść i osobne przyciski szkicu/publikacji. Biblioteka
  i dwie opcjonalne daty są rozwijane. Ustawione daty pozostają w podsumowaniu.
- Kontakt prowadzącej, zaproszenie opiekuna i raportowanie przeniesiono po
  edytorze do „Kontrola i ustawienia”, z widocznymi statusami i datami.
  Odpowiedzi oraz jawne oznaczenie przeczytania pozostają bezpośrednio dostępne.
- Zmiany prezentacji są ograniczone do adminowego DogCareView przez klasy
  i opcjonalny wariant `compact`; panel klienta, biblioteka i trwała publikacja
  zachowują dotychczasową prezentację. Brak zmian akcji, zapytań, tras i SQL.

## Odbiór

| Kontrola | Wynik i zakres |
| --- | --- |
| Vitest | 127/127, 7 plików: care actions, queries/links, konteksty PostgreSQL, prywatność i wersje, konsultacje, odczyty i odzyskiwanie huba. |
| Komponenty w Chrome | 52/52 warianty (13 stanów × 320/390/768/1440 px), bez overflow i błędów JS; natywna klawiatura, zachowanie pól i dat, błędy zapisu, wersje, materiały i ochrona opuszczenia formularza. |
| Rzeczywisty Next/Supabase, Chromium | 11/11 scenariuszy: nowe uproszczenie, oddzielne konteksty i kontakty, dwa scenariusze follow-up, materiały, konsultacja, zaproszenie i raportowanie, kurs z blokadami PostgreSQL, fitness. Fikcyjne konta i własne dane posprzątano. |
| Rzeczywisty Next/Supabase, WebKit | 3/3: uproszczenie z zapisem/publikacją i #szkic, zaproszenie do kontroli, uprawnienia i wygaśnięcie raportowania. Własne fikcyjne dane posprzątano. |
| TypeScript, ESLint, build, diff | PASS; lokalny build ma jawnie lokalną konfigurację. |

Przy pierwszym odbiorze nowy test wykrył link do dokładnie tego samego adresu
z `#szkic`: po ręcznym zwinięciu edytora nie zachodzi `hashchange`. Poprawiono
otwieranie również przy takim kliknięciu, zachowując capture ochrony niezapisanego
tekstu i obsługę zmodyfikowanych kliknięć. Test rzeczywistego Next po poprawce PASS.

Dodatkowo nowy wynik konkretnej akcji otwiera kompaktowy edytor, jeśli zwinięto
go podczas oczekiwania. Deterministyczna opóźniona akcja sprawdza zarówno błąd,
jak i sukces, zachowanie treści i późniejszą możliwość ręcznego zwinięcia.
Zwykłe odświeżenie props nie otwiera sekcji. Fixture Vite podmienia akcje i
kontrolę przepływu Next; nie zastępuje testu routingu, sesji ani bazy.

Przejściowe problemy infrastruktury odbioru: stary fixture wymagał dodania
bundlowania React DOM i atrapy `unstable_rethrow`; pierwszy nowy E2E miał
niejednoznaczny selektor tekstu publikacji powtórzonego w zwiniętym formularzu
odpowiedzi. Dostosowano wyłącznie harness/selekcję. Finder dopisywał `.DS_Store`
podczas czyszczenia `.next-local/server`; końcowy build wykonano w świeżym
katalogu wynikowym. Nie zmieniano konfiguracji aplikacji z tego powodu.

Niezależny recenzent nie stwierdził nierozwiązanych błędów w sprawdzonym zakresie.
Sprawdził diff, uprawnienia w źródłach, ESLint, linki, blokady publikacji,
zachowanie tekstu po zwinięciu i 16 wariantów UI bez overflow. Modal środowiska
IAB uniemożliwił mu dokończenie interakcji; nie zalicza anulowania przejścia,
zapisów ani pełnej klawiatury jako własnych testów. Te ścieżki mają oddzielne
dowody koordynatora z Chrome/WebKit. Raport i zrzut rzeczywistej lokalnej strony:
`.local/care-simplify-20261026/` (ignorowane pliki).

Stan: implementacja, lokalny odbiór i niezależny przegląd zakończone.
Nie opublikowano tej zmiany. Lokalnie i na produkcji
pozostaje 66 migracji; integracje i hosting bez zmian.
