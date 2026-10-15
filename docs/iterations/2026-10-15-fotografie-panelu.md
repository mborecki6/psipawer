# Oryginalne fotografie Asi w panelu

Status: lokalna zmiana na prośbę użytkownika z 15.10, po przekazaniu czterech
oryginałów DSC08135, DSC08137, DSC08338 i DSC08362. Zlecenie obejmuje użycie
wszystkich w różnych częściach panelu oraz jednego lub dwóch przy logowaniu.
Użytkownik następnie zatwierdził publikację zdjęć razem z paletą i formularzem
kursu. Wspólny zakres przechodzi odbiór wydania; pozostałe funkcje są zachowane.

## Kryteria

- AC-F01: wszystkie cztery zdjęcia są użyte w panelu, a dwa przy logowaniu.
  Sekcja ma stałe przypisanie, bez animacji, losowania lub karuzeli.
- AC-F02: proporcje i pełne kadry pozostają zachowane, w tym twarz, pies
  i znak fotografa. Brak retuszu, odbijania i usuwania osób. Pionowe zdjęcia
  zajmują pionowy fragment tła, nie panoramiczny pasek.
- AC-F03: fotografie są dodatkiem do kremowego/brzoskwiniowego UI. Treść,
  pola i kalendarz zachowują kryjące powierzchnie i czytelność. Tło ma małą
  intensywność i łagodne zanikanie krawędzi, bez prostokąta ze zdjęciem.
- AC-F04: jeden obszar ma jeden motyw. Czerwień zaległości, czarny CTA
  i aktywna nawigacja pozostają wyraźne. Brak dodatkowych funkcji i przycisków.
- AC-F05: przy 320/390/768/1440 px brak poziomego przewijania, zasłaniania
  kontrolek i odsuwania formularza loginu na telefonie. Pełne kadry także mobile.
- AC-F06: odbiór loginu i co najmniej jednej trasy z każdej grupy zdjęć,
  dla obu ról. Brak zmian danych, uprawnień, akcji i integracji.
- AC-F07: lekkie lokalne WebP, bez kopiowania EXIF/geometadanych. Login
  wskazuje rozmiary responsywne; tło jest dekoracyjne dla czytnika ekranu.

## Kompozycja

Login: DSC08135 i DSC08137, pełne pionowe kadry obok siebie z lekkim przesunięciem.
Pozostaje istniejący podpis „Asia · Psi Pawer”, logo, hasło i ustalony tekst.

Panel, dla obu ról:

- pulpit, kolejka, rozliczenia, ustawienia i pozostałe: DSC08338 — Asia w plenerze;
- kalendarz i spacery: DSC08362 — spacer/trening;
- oferta, zajęcia, kursy, PSI FITNESS i zgłoszenia: DSC08135 — zabawa;
- psy, plany, konsultacje i Psiutki: DSC08137 — nagradzanie.

Biznes ocenił proporcje i czytelność odczytowo. Agent techniczny jest właścicielem
czterech nowych zasobów WebP; koordynator layoutu, Shell i odbioru. Nowy recenzent
otrzymuje brief, kryteria i faktyczny diff tej korekty.

## Odbiór

Lokalny odbiór zakończony; niezależny recenzent nie zgłosił P1/P2 w zakresie
fotografii. Zasoby mają łącznie 524 408 B zamiast około 49,8 MB oryginałów,
pełne kadry, jakość WebP 82. Oryginały pozostają bez zmian w Downloads.

- Cztery WebP: 1000×1500 (pionowe), 1800×1200 (poziome), kolor sRGB,
  bez EXIF/XMP. Koordynator i recenzent sprawdzili metadane; technika
  oraz recenzent obejrzeli oryginały i wynik z zachowanymi znakami fotografa.
- Koordynator: 36 wariantów loginu i czterech grup tła obu ról przy
  320/390/768/1440 px. Zdjęcia załadowane, poprawne motywy, brak poziomego
  przewijania i błędów przeglądarki. Menu: otwarcie, Escape, powrót fokusu.
- Recenzent: własne 36 odczytów układu i kontrola przejścia klawiaturą
  z menu do kalendarza. Pełne kadry, formularz loginu przed zdjęciami mobile,
  brak zmian ról i zachowania akcji.
- TypeScript, ESLint zmienionych TSX, Prettier oraz diff check — zaliczone.

Podgląd: `http://127.0.0.1:4185/login`, `/admin`, `/admin/calendar`,
`/admin/courses`, `/admin/care` oraz odpowiedniki `/app`. Podgląd używa
rzeczywistego Shell i loginu, ale kart z fikcyjnymi danymi i zamiennika
`next/image`; nie jest pełnym uwierzytelnionym przebiegiem aplikacji.
Zrzuty i raport koordynatora: ignorowane `test-results/photos-ui/`.

Nie uruchamiano pełnego builda/suite, rzeczywistego logowania, kontroli RLS
ani operacji danych. Nie sprawdzano produkcyjnego procesu optymalizacji obrazów
i każdego widoku biznesowego z tłem. Ta korekta nie zmienia tych mechanizmów.
Produkcja pozostaje bez zmian.

## Przygotowanie publikacji 15.10.2026

Zgoda użytkownika obejmuje cały połączony zakres. Pełny build lokalny zaliczony;
cztery szerokości prawdziwego loginu oraz cztery obrazy przez optymalizator
Next.js sprawdzono bez błędów. Końcowy niezależny przegląd wspólnego diffu
nie zgłosił P1/P2. Dane wdrożenia i odbiór produkcyjny zostaną dopisane po wydaniu.
