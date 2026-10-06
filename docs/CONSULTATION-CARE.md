# Konsultacja i zalecenia

Implementacja lokalna, 19.09.2026. Migracja `202609190007_consultation_care.sql` nie była uruchamiana w chmurze.

## Proces pracy

Prowadząca otwiera konsultację i wybiera **Przygotuj zalecenia**. Może przygotować prywatny szkic do umówionego spotkania. Publikacja planu powiązanego z konsultacją wymaga oznaczenia jej jako zakończonej; zakończenie samo w sobie nie publikuje żadnej treści. Nadal można publikować ogólne plany pracy bez przypisanej konsultacji.

Przy psie pozostaje jeden wspólny szkic. Jeśli otwarto go z innego spotkania, formularz zachowuje dotychczasowe powiązanie i treść oraz proponuje osobny, jawny wybór nowej konsultacji. Otwarcie strony nie zapisuje zmian. Materiał z biblioteki zastępuje tylko tytuł i treść, po dotychczasowym potwierdzeniu; nie zmienia powiązania.

Po publikacji obie strony widzą zalecenia przy właściwej konsultacji. Każda wersja ma osobny adres `/admin/care/plans/[id]` lub `/app/care/plans/[id]`, z przejściem do konsultacji i aktualnego planu psa. Powiadomienie o publikacji otwiera konkretną wersję. Starsze zalecenia są oznaczone jako wcześniejsze, również gdy opiekun wszedł z dawnego powiadomienia. Lista publikacji przy spotkaniu ma własne stronicowanie po pięć pozycji.

## Trwałość i dostęp

- Szkic i każda publikacja przechowują własne `consultation_id`. Nowa wersja może wskazywać inne spotkanie, a wcześniejsze publikacje zachowują powiązanie.
- Złożony klucz obcy wymaga tego samego psa i praktyki. Funkcja zapisu dodatkowo sprawdza rolę, stan spotkania i wersję szkicu. Zgłoszenia bez terminu i spotkania odwołane nie przyjmują nowych powiązań.
- Jeśli spotkanie odwołano już po przygotowaniu szkicu, jego treść pozostaje. Przed kolejnym zapisem należy wybrać inne dostępne spotkanie lub ogólny plan.
- Powtórzenie publikacji jest rozpoznawane wyłącznie przy zgodnych treści, autorze, dacie kontaktu i konsultacji. Nie tworzy kolejnej publikacji ani powiadomienia.
- Kolejność blokad: praktyka (key-share), opcjonalna konsultacja (share), pies (update). Zapis treści, powiązania, publikacji, zadania kontrolnego i zdarzenia pozostaje jedną transakcją. Niezależne równoległe połączenia wymagają dodatkowej weryfikacji na pełnym PostgreSQL.
- Opiekun nie pobiera szkiców, biblioteki ani listy wyboru konsultacji. Przy spotkaniu nie ujawniamy mu nawet faktu istnienia szkicu. Publikacja i konsultacja korzystają z uprawnień do psa; zmiana właściciela odbiera dostęp poprzedniemu opiekunowi.
- Starsze rekordy pozostają bez powiązania. Nie zgadujemy, którego spotkania dotyczyły. Sześcioparametrowe wywołania zapisu nadal obsługują plany bez konsultacji; aplikacja przesyła siódmy parametr jawnie.

## Formularze i weryfikacja

Edytory zaleceń i cennika zachowują wybory po zapisie i po błędzie. Wykorzystują natywną obsługę zdarzenia resetowania formularza: reset wykonywany podczas zatwierdzania akcji React pomija syntetyczne zdarzenia. Test przeglądarkowy wykrył wyzerowanie powiązania pomimo prawidłowego stanu React; zachowanie sprawdzamy także dla rodzaju ceny i widoczności usługi.

Testy SQL obejmują cały proces zakończenia spotkania i publikacji, prywatność, cudze psy, zmianę właściciela, odwołanie, wersjonowanie, ponowienia i wycofanie transakcji. Testy odczytu sprawdzają stronicowanie, ponad 1000 konsultacji, link do konkretnej publikacji, błędy oraz brak zapytań o szkice dla opiekuna. Widoki są sprawdzane na fikcyjnych danych w przeglądarce.

Powyższe ograniczenie dotyczyło pierwszego etapu. Pełne logowanie i proces z rzeczywistym lokalnym Auth/PostgREST sprawdza obecnie `tests/e2e/consultation-care.spec.ts`: zgłoszenie, prywatny szkic, zakończenie spotkania, publikacja i odpowiedź opiekuna. Niezależne transakcje planów i konsultacji opisano w [stanie produktu](PRODUCT-STATUS.md). Pierwsze próby SQL nadal korzystają z PGlite i minimalnego modelu Auth/Storage, a izolowane próby formularzy z kontrolowanych odpowiedzi; są odrębną warstwą od rzeczywistego E2E.
