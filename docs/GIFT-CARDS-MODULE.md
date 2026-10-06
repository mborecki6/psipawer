# Karty podarunkowe Psi Pawer

Stan: 03.10.2026. Moduł działa w lokalnych panelach prowadzącej i opiekuna. Prowadząca wystawia kartę po potwierdzeniu całej wpłaty otrzymanej poza aplikacją, przekazuje spersonalizowany wydruk, a następnie rozlicza należności z jej salda. Opiekun aktywuje kartę kodem i widzi własne saldo oraz historię. Nie wdrażano zmian w chmurze ani wysyłki do klientów.

Oferta obejmuje kartę o podanej wartości lub na wskazaną usługę, personalizację i sześć miesięcy ważności od zakupu. Źródło oferty: [Psi Pawer — karty podarunkowe](https://www.psipawer.pl/karty-podarunkowe/). **Robocza reguła aplikacji:** karta na usługę przechowuje wartość z chwili zakupu i ogranicza wykorzystanie do tej usługi. Późniejsza zmiana ceny nie zmienia salda; ewentualna dopłata jest widoczna w rozliczeniu usługi. Gwarancja jednego świadczenia niezależnie od przyszłej ceny wymaga osobnej decyzji i zmiany modelu.

## Obsługa w panelach

1. Prowadząca otwiera **Karty podarunkowe → Nowa karta**. Wybiera wartość lub usługę z katalogu, wpisuje darczyńcę, obdarowanego i opcjonalne życzenia. Karta kwotowa ma domyślnie robocze 100 zł; karta na usługę pobiera jej bieżącą cenę i wersję.
2. Podaje datę zakupu, metodę wpłaty i potwierdza otrzymanie całej kwoty poza aplikacją. Karta, sprzedaż, pierwsze saldo i historia powstają razem. Aplikacja nie pobiera pieniędzy.
3. Otwiera kartę i wybiera **Drukuj / zapisz jako PDF**. Wydruk zawiera nazwę, obdarowanego, życzenia, wartość zakupu, zmienione saldo, datę ważności i kod. Formularze, prywatne uzasadnienia i historia rozliczeń nie trafiają na wydruk.
4. Kod przekazuje obdarowanemu samodzielnie. Opiekun w **Karty podarunkowe** wybiera **Aktywuj moją kartę**. Alternatywnie prowadząca przypisuje kartę do konta. Karta nie zakłada konta i nie rezerwuje terminu zajęć.
5. Po przyjęciu zgłoszenia prowadząca wybiera zgodną należność tego opiekuna i kwotę z karty. Może pokryć całość lub część. Pozostałą wpłatę odnotowuje osobno we właściwym rozliczeniu.

Karta jest ważna do końca wskazanego dnia według czasu Warszawy. Sześć miesięcy oznacza miesiące kalendarzowe; daty na końcu miesiąca mają właściwy ostatni dzień miesiąca docelowego. Po zwrocie, wycofaniu lub przywróceniu nie otrzymuje nowego terminu ważności.

## Powiązanie z usługą

Konsultacje, kursy i fitness mają zapisany identyfikator usługi katalogowej. Starszy spacer albo pakiet wejść może mieć tylko własną nazwę. Dla karty na usługę prowadząca musi wtedy jawnie potwierdzić odpowiednie powiązanie i jego powód. Nie dopasowujemy po nazwie ani takiej samej cenie.

Błędne wcześniejsze wskazanie można skorygować z panelu karty przed pierwszym rozliczeniem dowolną kartą. Formularz zachowuje zaobserwowaną wersję powiązania; konkurująca zmiana otrzymuje konflikt. Po wykorzystaniu powiązanie pozostaje niezmienne, również po pełnym zwrocie. Ukrycie usługi w katalogu nie odbiera możliwości rozliczenia wcześniej zakupionej karty zgodnie z jej zapisanym przeznaczeniem.

## Saldo i zwroty

| Operacja                                               | Saldo karty             | Otrzymane pieniądze we wspólnych finansach |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------ |
| Potwierdzenie sprzedaży 100 zł                         | +100 zł                 | +100 zł, jeden raz                         |
| Pokrycie należności 40 zł                              | −40 zł                  | Bez nowego wpływu                          |
| Zwrot 20 zł za usługę opłaconą kartą                   | +20 zł na tę samą kartę | Bez zwrotu gotówki                         |
| Wycofanie karty                                        | Bez zmiany kwoty        | Bez automatycznego zwrotu                  |
| Potwierdzony zwrot pozostałych 80 zł za wycofaną kartę | −80 zł                  | −80 zł                                     |

Zwrot za usługę nie odnawia ważności, nie przywraca wycofanej karty i nie przekazuje wartości innemu opiekunowi. Można odnotować częściowy zwrot. Zdarzenia częściowego i końcowego zwrotu nie przywracają tej samej kwoty dwukrotnie.

Zwrot pieniędzy za samą kartę wymaga jej wycofania, powodu i potwierdzenia faktycznej operacji poza aplikacją. Nie może przekroczyć dostępnego salda. Po wykorzystaniu karta zachowuje przypisanego opiekuna. Zapisanie identycznej operacji ponownie zwraca jej wcześniejszy wynik; zmienione dane z tym samym kluczem są odrzucane.

Potwierdzenie pozostaje widoczne także po wykorzystaniu ostatnich środków lub zwrocie całej pozostałej wartości. Zapisany formularz jest zablokowany. Odnośnik **Wczytaj aktualne saldo i przygotuj kolejną operację** otwiera świeży formularz z nową wersją.

## Dostęp i granice modułu

Opiekun widzi wyłącznie przypisane mu karty i ich historię salda. Nie pobiera kodów, prywatnej sprzedaży, uzasadnień decyzji ani potwierdzeń poleceń. Zapis rozliczenia wymaga prowadzącej również przy bezpośrednim wywołaniu API. Kod jest generowany na serwerze, ma 40 znaków i nie trafia do zwracanych wyników formularza. Pięć błędnych aktywacji w ciągu 15 minut blokuje dalsze próby danego konta na ten okres.

Moduł `src/modules/gifts` ma własne typy, odczyty, formularze i operacje. Wykorzystanie jest transakcją wspólną z istniejącym rozliczeniem spaceru, pakietu, konsultacji, kursu lub fitness. Osobne wpisy salda i potwierdzenia chronią wartość oraz historyczne ponowienia; sprzedaż karty i wykorzystanie na usługę pozostają rozróżnione w finansach.

Migracja `202610030009_gift_cards.sql` została zastosowana wyłącznie lokalnie. Odbiór samego modułu obejmował schemat 45 migracji; bieżący stan wskazuje [odbiór produktu](PRODUCT-STATUS.md). Nie importowano historycznych kart ani wpłat, nie zmieniano wcześniejszych cen. SMTP, automatyczne dostarczanie PDF i operator płatności pozostają poza tym etapem.

## Sprawdzone działanie

- **941/941 testów w 73 plikach** na końcowym kodzie, w tym reguły kart, odczyty, uprawnienia, działania formularzy i wspólne finanse. Wszystkie pięć rodzajów rozliczeń i ich zwroty są objęte próbami bazy.
- **19/19 scenariuszy rzeczywistego PostgreSQL** we własnej oznaczonej bazie, z 18 obserwowanymi zależnościami blokad. Sprawdzono równoczesne wykorzystania, przypisania, wycofania, zwroty usług i pieniędzy oraz atomowe cofnięcie przy błędzie zapisu salda. Własna baza została usunięta; źródło zachowano.
- **40/40 pełnych E2E aplikacji** na najnowszej kompilacji (5,4 minuty). Nowa ścieżka obejmuje oba panele, aktywację, odmowę dostępu obcego konta, wykorzystania 40 i 80 zł, powroty 20 i 80 zł, wycofanie oraz zwrot pieniędzy 80 zł. Sprzedaż pozostaje jednym wpływem; końcowy wpływ po zwrocie wynosi 20 zł.
- Dwa scenariusze kart ponownie przeszły na tej samej kompilacji (22,2 s). Nowa karta na spacer sprawdza cenę z katalogu, przypisanie konta, jawną korektę błędnego powiązania, konflikt dwóch otwartych formularzy bez utraty powodu, wykorzystanie całych 100 zł i odmowę zmiany usługi po rozliczeniu. To dodatkowy przebieg po pełnym zestawie 40 E2E; nie sumujemy ich jako jednego uruchomienia.
- Telefon 320/390 px nie przewija całej strony w bok. Jednostronicowy PDF z życzeniami o długości 500 znaków sprawdzono tekstowo i wizualnie. Po przejściu do finansów załadowane ustawienia wydruku kart nie ukrywają innego ekranu.
- [Kopia 45 migracji](LOCAL-BACKUPS.md#wcześniejszy-wynik-kart-z-45-migracjami) zachowała 117 tabel i 14 582 wiersze, logowania, zdjęcia oraz dwie karty z kodami, saldem i zwrotami. Nowe operacje i 9 historycznych oraz 3 nowych ponowień kart wykonano przez odtworzone API bez zmiany źródła. Wszystkie własne dane i zasoby próby usunięto.

TypeScript, kompilacja, ESLint i formatowanie przeszły. Końcowa kontrola potwierdziła te same pięć kont, cztery psy, trzy spacery i 17 aktywnych usług po robocze 100 zł; podgląd na localhost:3000 odpowiada HTTP 200. Poniżej opisano późniejszy odbiór pozostałych trzech rodzajów usług. Przechowywanie kopii poza komputerem pozostaje przygotowaniem docelowego hostingu.

## Powtarzalne sprawdzenie lokalne

Przy przygotowanym lokalnym Supabase:

```sh
pnpm local:gift-domain
pnpm local:build
pnpm local:preview
```

W osobnym terminalu:

```sh
pnpm local:e2e tests/e2e/gift-cards-journey.spec.ts
```

Próba kopii: `pnpm local:backup-test`. Nie uruchamiaj jej równolegle ze scenariuszami zapisującymi do lokalnej bazy. Narzędzia odrzucają adresy zdalne; nie wymagają zmiany `.env.local` ani resetu istniejących danych.

## Konsultacja, kurs i pakiet wejść w przeglądarce — 03.10.2026

`tests/e2e/gift-other-services.spec.ts` przeszedł na obu rzeczywistych lokalnych panelach. Prowadząca wystawia i przypisuje kartę kwotową 300 zł, a następnie rozlicza po 100 zł należności konsultacji, przyjętego kursu i pakietu czterech wejść. Po każdej operacji saldo maleje, właściwa należność ma jedną wpłatę metodą karty, a rzeczywisty wpływ w finansach pozostaje pojedynczą sprzedażą 300 zł.

Zwrot konsultacji, kursu i nieużytego pakietu przez ich właściwe formularze przywraca po 100 zł na tę samą kartę. Opiekun widzi trzy wpisy zwrotu i saldo 300 zł; obce konto nie widzi karty. Wpływ pieniędzy nadal wynosi 300 zł, ponieważ zwrócono wartość usługi na saldo, nie gotówkę nabywcy. Po próbie własne karty, wpłaty, cykl, pakiet, konsultacja i konta zostały usunięte. Wraz z wcześniejszymi przebiegami spaceru i fitness pokrywa to interfejs wszystkich pięciu źródeł rozliczenia.
