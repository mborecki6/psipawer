# Brzoskwiniowa paleta i czytelne miejsce kursu

Status: opublikowano 15.10.2026 po lokalnym odbiorze feedbacku behawiorystki.
Użytkownik zatwierdził publikację:
„wdrozmy na produkcje zdjecia razem z nowa kolorystyka i poprawka formularza kursu”.

## Kryteria

- AC-01: Wyróżnione karty i aktywne pozycje nawigacji: brzoskwinia `#F6E4DB`.
  Drobny tekst i linki na tym tle: brąz `#6E3A28`; akcenty ikon i obramowań:
  terakota `#B5654A`. Zwykłe karty pozostają jasne, tło kremowe.
- AC-02: Czarny przycisk „Zaplanuj zajęcia” zachowuje wygląd. Alarmy i „Po terminie”
  używają wyraźnej czerwieni `#A32D2D`, nadal z tekstem lub ikoną. Zieleń
  potwierdzeń oznacza stan powodzenia, nie kolor marki.
- AC-03: Mały tekst nie używa terakoty o niedostatecznym kontraście na brzoskwini.
  Widoczny focus, czytelność i brak poziomego przewijania przy 320/390/768/1440 px.
- AC-04: Formularz kursu ma od razu widoczną sekcję „Miejsce spotkań” przed terminami.
  Rozróżnia okolicę przed przyjęciem i dokładną zbiórkę po przyjęciu, z przykładami.
  Miejsce początkowe dotyczy wszystkich spotkań, później zmienia się je osobno.
- AC-05: Sala jest opcjonalnym zasobem, osobnym od adresu. Brak aktywnych sal nie
  sugeruje, że formularz nie pozwala podać miejsca. Nie dodajemy nowego modelu
  zapisanych adresów ani wyboru z nieistniejącej listy.
- AC-06: Podpis edycji spotkania: „Zmień termin lub miejsce”. Tworzenie szkicu
  opisuje zarówno miejsce, jak i terminy. Wymagania, pola payloadu, identyfikatory,
  wersje i reguły prywatności pozostają takie same. Brak zmian SQL, ról i kont.
- AC-07: Tekst logowania: „Wspólne spotkania, wskazówki i postępy Twojego psa - blisko
  Ciebie, ze wsparciem specjalisty.” Slogan, logo i podpis „Asia · Psi Pawer” pozostają.
- AC-08: Kolaż jest materiałem referencyjnym. Do czasu wyboru konkretnego zdjęcia
  zachowujemy obecne oryginalne fotografie; nie wstawiamy zrzutu kolażu jako hero.

## Podział prac

Biznes i technika przygotowały niezależne propozycje przed implementacją.
Agent techniczny odpowiada za formularze/widoki/CSS kursów i ich fixture oraz
testy. Koordynator odpowiada za tokeny, Shell, pulpit, kalendarz, logowanie,
dokumentację i odbiór. Niezależny recenzent dostaje wymagania i faktyczny diff.

## Odbiór

Lokalny odbiór zakończony. Niezależny recenzent nie znalazł otwartych uwag
P1/P2 w sprawdzonym zakresie. Podglądy korzystają z fikcyjnych danych
i zastępczych akcji formularzy, bez tworzenia kont, zapisu do Supabase
ani wysyłania powiadomień. Na etapie tego lokalnego odbioru produkcja pozostawała
na poprzednim wydaniu; późniejsze wdrożenie opisano poniżej.

- Testy akcji kursów: 18/18. Niezależny przegląd uruchomił 43/43 testy
  kursów, wyboru rezerwacji, dostępu i renderowania kalendarza.
- Browser kursów: 320/390/768/1440 px, oba wymagane pola lokalizacji,
  pięć terminów, uzupełnianie tygodniowe, sala aktywna/nieaktywna/brak sal,
  zachowanie tekstów i wersji po błędzie oraz pusty katalog — zaliczone.
- Regresja przeglądarkowa kalendarza obu ról: 60 wariantów — zaliczona.
- Pulpit, logowanie i kolejka: 12 wariantów przy czterech szerokościach,
  bez poziomego przewijania i błędów przeglądarki. Recenzent wykonał także
  własną kontrolę kursów i tych ekranów w IAB.
- Kontrast: brąz na brzoskwini 7,41:1; terakota na brzoskwini 3,46:1
  (ikony i obramowania). Poprawiono dawny półprzezroczysty override focus,
  który osłabiał widoczność klawiatury poza Shell; teraz ma kolor `--focus`.
- TypeScript, ESLint zmienionych plików, formatowanie i diff check — zaliczone.

Podgląd palety i pulpitu: `http://127.0.0.1:4185/`; logowanie: `/login`;
kolejka: `/?queue`. Formularz kursu: `http://127.0.0.1:4184/`, edycja:
`/?view=detail`. Zrzuty są w ignorowanych `test-results/peach-ui/`
i `test-results/courses-ui/`. Powtarzalny test kursów: `npm run test:courses-ui`.

Ograniczenia pierwszego odbioru: to realne komponenty z zastępczymi akcjami, nie pełny
przebieg Next.js z sesjami i bazą. Nie uruchamiano pełnego builda, suite SQL
ani rzeczywistego odczytu kilku ról. Prywatność lokalizacji sprawdzono
w istniejących zapytaniach/RLS; ta iteracja nie zmienia backendu. Zmiana
globalnych tokenów nie oznacza ręcznej kontroli każdego ekranu produktu.
Kolaż nie wskazuje jednego zdjęcia do podmiany; obecne fotografie zachowano.

Później użytkownik przekazał cztery oryginalne fotografie i zlecił użycie
wszystkich w panelu oraz 1–2 przy logowaniu. Ten kolejny zakres opisuje
[osobna iteracja zdjęć](2026-10-15-fotografie-panelu.md); zastępuje decyzję
o zachowaniu starego hero po odbiorze pierwszego kandydata.

## Przygotowanie publikacji 15.10.2026

Łączny zakres obejmuje paletę, zdjęcia i miejsce w formularzu kursu. Pełny
lokalny build Next.js, 43 testy granic akcji/dostępu/kalendarza oraz końcowy
przegląd wspólnego diffu zaliczone. Sprawdzono prawdziwy ekran loginu po buildzie
przy czterech szerokościach i cztery zdjęcia przez optymalizator Next.js.
Wydanie nie ma migracji ani zmian konfiguracji Supabase, danych, ról lub SMTP.

## Publikacja 15.10.2026

Kod aplikacji `0bbf2fb5d1dc681e065c4b053158156bc4c1aa6a` jest na GitHub main.
Build Vercel READY: `dpl_4np8vsb7D4GRA2hk4GNToKxcs1eK`;
publiczny alias `https://psipawer.vercel.app` wskazuje to wydanie.
Wcześniejszy gotowy build zachowano jako punkt powrotu; nie wykonywano migracji.

Odbiór produkcyjny istniejącego konta właściciela i demonstracyjnego opiekuna:
13 widoków, 52 warianty 320/390/768/1440 px, cztery zgodne pliki fotografii,
trzy blokady anonimowego dostępu, zero błędów przeglądarki i zero zapisów
biznesowych. Potwierdzono także prawdziwą optymalizację fotografii i widoczną
sekcję miejsca przed terminami kursu. Kontrole tylko odczytywały UI; nie
tworzyły kursów ani kont. Tymczasowe własne sesje testowe zamknięto.

Dowody: ignorowane `.local/peach-release-20261015/` (build, przegląd wdrożenia,
raport i zrzuty). Pierwszy przebieg odbioru czekał za krótko na optymalizację
zdjęcia; po poprawieniu oczekiwania w skrypcie cały odbiór został zaliczony.
Nie zmieniano z tego powodu kodu aplikacji.
