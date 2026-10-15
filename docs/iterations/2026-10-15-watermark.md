# Fotografie bez dopisku fotografa

Status: opublikowano 15.10.2026. Korekta po prośbie użytkownika o usunięcie napisu „PSYJEMNE
KADRY”. To jawnie zastępuje wcześniejsze kryterium zachowania znaku fotografa
w aktualnie używanych czterech fotografiach. Brak zmian logiki aplikacji,
formularzy, układu, danych i uprawnień. To bezpośrednia korekta tych samych
fotografii po ich zaakceptowanym wdrożeniu. Koordynator interpretuje bieżącą
prośbę o usunięcie znaku jako zlecenie podmiany tych fotografii w aplikacji;
nie rozszerza to autoryzacji na inne funkcje lub przyszłe wydania.

## Kryteria

- AC-W01: usunięte wszystkie trzy wiersze znaku: odręczny podpis, nazwa
  PSYJEMNE KADRY i FOTOGRAFIA. Wszystkie cztery kadry i wymiary zachowane.
- AC-W02: twarze, sylwetki, pies oraz reszta zdjęć pozostają oryginalne.
  Zmieniany jest jedynie niewielki prostokąt ze znakiem, bez kadrowania.
- AC-W03: lokalne logowanie i cztery motywy panelu używają wariantów `-clean`.
  Oryginały pozostają zachowane. Nowe nazwy unikają starego cache obrazów.
- AC-W04: podgląd telefonu i komputera oraz niezależny ogląd retuszu.
  Brak nowych funkcji i zmian innych zasobów marki, w tym logo Psi Pawer.

## Metoda i pliki

Tryb: wbudowane narzędzie imagegen, cztery niezależne operacje edycji.
Wejściem każdego retuszu był wycinek 512×512 obejmujący znak i kontekst.
Z wyniku użyto wyłącznie małego fragmentu napisu, z łagodną granicą 4 px,
nałożonego na oryginalną fotografię. Pozostała część obrazu nie pochodzi z AI.
Wynik zapisano jako bezstratny WebP, by nie zmienić pikseli poza łatką.

Pliki wynikowe (w `public/brand/`):

| Plik | Rozmiar | Obszar retuszu (x,y,w,h) |
| --- | --- | --- |
| training-play-clean.webp | 1000×1500 | 382,1276,252,88 |
| training-reward-clean.webp | 1000×1500 | 382,1276,252,88 |
| asia-outdoors-clean.webp | 1800×1200 | 840,1004,248,88 |
| training-walk-clean.webp | 1800×1200 | 840,1004,248,88 |

Łączny rozmiar plików bezstratnych: 4 886 092 B. Aplikacja nadal serwuje obrazy
przez optymalizator Next.js z rozmiarami responsywnymi; źródła są większe niż
poprzednie stratne WebP. Oryginałów w Downloads ani poprzednich WebP nie nadpisano.

## Prompt

Dla każdego wycinka: usuń wyłącznie trzy białe wiersze znaku wraz z antyaliasem,
odtwórz zakryte tło, zachowaj kadr, geometrię, barwy, światło i ostrość bez zmian.
Dodatkowy kontekst dotyczył odpowiednio buta/trawy, nieostrej trawy, skóry
i brzegu różowych spodenek albo trawy pod spacerującymi osobami.

Pełny zestaw promptów, ścieżki wyników imagegen i dowody porównania pikseli:
ignorowane `.local/watermark-20261015/`. Dla każdego pliku kontrola wykazała
zero zmienionych pikseli poza wskazanym prostokątem (około 1–1,5% powierzchni).

## Odbiór

Lokalny odbiór zakończony. Koordynator sprawdził osiem wariantów rzeczywistego
Shell i loginu: cztery szerokości loginu oraz po jednym podglądzie czterech
motywów (trzy w roli admin, jeden w roli opiekuna), bez błędów i przewijania
poziomego. To fixture z fikcyjnymi
danymi oraz zastępczym `next/image`, nie pełny przebieg z sesjami.

Niezależny recenzent obejrzał wszystkie pary zdjęć i powiększone fragmenty,
potwierdził brak pozostałości znaku, naturalny wygląd retuszu i własne porównanie
RGBA z zerem zmienionych pikseli poza prostokątami. Brak blockerów. Jego próba
HTTP do podglądu była zablokowana przez sandbox, więc UI stanowi osobną kontrolę
koordynatora. TypeScript, ESLint zmienionych TSX i diff check zaliczone.

Wydanie obejmuje wyłącznie cztery nowe pliki `-clean` oraz trzy podmiany ścieżek
obrazów w loginie i PanelBackdrop. Poprzednie fotografie zachowano jako oryginały.

## Publikacja

Kod: `1d6be22609ebb81d1f4968b2571ccbc05f54e4c2`.
Gotowe wdrożenie Vercel: `dpl_EN8pgoy66PyRSQtUHaFZXcLLb52L`.
Publiczny adres [Psi Pawer](https://psipawer.vercel.app/login) wskazuje tę wersję,
co potwierdzono przez inspect publicznego adresu i identyfikator wdrożenia.
Nie była potrzebna dodatkowa ręczna zmiana aliasu.

Odbiór produkcji zaliczony: cztery pliki źródłowe zgodne SHA-256 z lokalnymi,
cztery poprawne odpowiedzi optymalizatora Next.js oraz login przy szerokościach
320 i 1440 px. Oba zdjęcia loginu wczytane, brak przewijania poziomego i błędów
przeglądarki. Zoptymalizowane obrazy o szerokości 640 px mają odpowiednio
39 856, 42 606, 18 712 i 32 640 B. Obejrzano zrzut loginu na produkcji.

Kontrola była anonimowa i odczytowa. Nie zmieniano danych, kont, uprawnień,
schematu ani konfiguracji Supabase. Nie powtarzano odbioru zalogowanych scenariuszy
z poprzedniego wydania, bo logika i układ aplikacji nie zmieniły się.
Raport i zrzuty: ignorowane `.local/watermark-20261015/hosted-smoke.json`
oraz `production-login-{320,1440}.png` w tym samym katalogu.
