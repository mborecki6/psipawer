# BLIK przez Tpay — lokalny wariant testowy

To zapis historyczny z 18.10. Późniejsze przygotowanie hosted, serwerowe
rozpoczynanie i ograniczenia odczytu operatora opisuje
[odbiór z 23.10](2026-10-23-gotowosc-platnosci.md) oraz
[instrukcja wydania](../PAYMENT-EMAIL-RELEASE.md). W szczególności GET bez
rzeczywistej otrzymanej kwoty nie potwierdza zapłaty; kwoty żądanej nie
podstawiamy za otrzymaną. Żadna z tych iteracji nie uruchomiła prawdziwych opłat.

Brief użytkownika z 18.10: podstawowa płatność BLIK przez Tpay po akceptacji
Asi, wyłącznie lokalnie i testowo. To zgoda na implementację i lokalny odbiór;
nie obejmuje produkcji, prawdziwych pieniędzy, SMTP, nowych cen ani zasad pakietów.
Biznes i technika przygotowały osobne pierwsze propozycje.

## Uzgodniony zakres

Jedna płatność dotyczy jednej przyjętej, wycenionej należności: spaceru,
konsultacji, kursu albo istniejącej usługi fitness. Zakupy pakietów spacerowych
i kart podarunkowych pozostają poza iteracją. Płacona jest cała pozostała kwota,
ustalona po stronie serwera i bazy, z uwzględnieniem wcześniejszych wpłat.
Nie dodajemy automatycznych rezerwacji, terminów płatności ani zwrotów z panelu.

Powrót z bramki nie potwierdza wpłaty. Podstawą jest zweryfikowane potwierdzenie
Tpay albo odpowiedź autoryzowanego zapytania o transakcję. Ta druga ścieżka
pozwala sprawdzić sandbox bez publicznego tunelu do lokalnego komputera.
Nie wystawiamy localhost do internetu. Brak danych sandboxa nie daje zgody na
użycie środowiska produkcyjnego; symulację odróżniamy od prawdziwego sandboxa.

Płatność otrzymana po rezygnacji, zmianie właściciela lub ręcznej wpłacie nie
przywraca zajęć. Pełny potwierdzony wpływ jest zachowany i jawnie oznaczony
do sprawdzenia. Nie rozliczamy ponownie już opłaconego długu ani nie wykonujemy
automatycznego zwrotu. Nie przypisujemy czynności operatora jako ręcznej wpłaty Asi.

## Kryteria odbioru

| ID | Warunek |
| --- | --- |
| AC-B01 | Wszystkie operacje wymagają lokalnego Supabase i jawnego trybu testowego. Adresy live Tpay i wdrożenie Vercel są blokowane. Brak konfiguracji ma czytelny stan wyłączenia. |
| AC-B02 | Rozpoczęcie wymaga aktualnego przyjęcia, ceny i dodatniej pozostałej kwoty. Oczekujące, rezerwowe, odrzucone, anulowane i rozliczone zgłoszenia są odrzucane także przez bezpośrednie API/RPC. |
| AC-B03 | Kwota i płatnik pochodzą z bazy. Opiekun nie może płacić za obcy cel ani podmienić ceny. Widzi psa, usługę, kwotę i oznaczenie testu przed przekierowaniem. |
| AC-B04 | Trwała próba powstaje przed wywołaniem operatora. Dwie karty i podwójne kliknięcie reużywają aktywną próbę; timeout nie tworzy automatycznie drugiej transakcji. |
| AC-B05 | Potwierdzenie musi odpowiadać sprzedawcy, środowisku, próbie, transakcji, kwocie i PLN. Powrót przeglądarki i niezaufany komunikat nie zmieniają salda. Webhook wymaga weryfikacji JWS. |
| AC-B06 | Wiele potwierdzeń i wyścig odczytu z webhookiem księgują jeden skutek. Sukces jest trwały; późniejszy błąd go nie cofa. Opiekun ani anon nie mogą wykonać finalizacji. |
| AC-B07 | Rozpoczęta, oczekująca, niepewna, nieudana, opłacona i wymagająca sprawdzenia próba mają właściwy komunikat i następny krok. Porzucenie bramki nie jest automatycznie odmową banku. |
| AC-B08 | Spóźniony lub nadmiarowy potwierdzony wpływ nie znika i nie przywraca usługi. Zostaje w historii obu uprawnionych ról z kwotą i powodem sprawdzenia, bez podwójnego rozliczenia długu. |
| AC-B09 | RLS chroni próby i wpłaty; zmiana opiekuna nie przenosi starej próby ani jej historii. Brak podszywania się webhooka pod administratora. Ręczne wpłaty i dotychczasowe zwroty działają dalej. |
| AC-B10 | UI jest czytelne na 320/390 px i dla klawiatury. Brak należności, konfiguracji i błąd odczytu mają osobne komunikaty; stan nie polega wyłącznie na kolorze. |
| AC-B11 | Testy obejmują reguły wszystkich czterech usług, role, konkurencję, podpis, kwoty, błędy operatora i istniejące rozliczenia. Dane prób są lokalne i własne. |
| AC-B12 | Raport odróżnia atrapę/symulację od prawdziwego sandboxa Tpay i lokalny kod od publikacji. Żadnych prawdziwych opłat, kont ani wiadomości. |

## Decyzje i zależności

- Użytkownik nie ma konta sandbox Tpay. Przygotowujemy adapter sandbox i osobną, jawnie oznaczoną symulację lokalną. Odbiór rzeczywistej transakcji u operatora pozostaje do wykonania po założeniu konta; sekretów nie umieszczamy w rozmowie ani repozytorium.
- Użytkownik potwierdził, że spacer przyjęty automatycznie według dotychczasowych zasad może być opłacony BLIK. Nie dodajemy obowiązku osobistej ręcznej decyzji Asi.

## Źródła techniczne

- [Środowiska i testowe kody BLIK](https://docs-api.tpay.com/en/first-steps/environments/)
- [Autoryzacja](https://docs-api.tpay.com/en/first-steps/authorization/)
- [Płatność BLIK z przekierowaniem](https://docs-api.tpay.com/en/payment-methods/blik/)
- [Powiadomienia i idempotencja](https://docs-api.tpay.com/en/webhooks/)
- [API — także certyfikaty sandbox](https://api.tpay.com/)

## Obsługa i konfiguracja lokalna

W panelu opiekuna: **Moje rozliczenia → Zapłać BLIKIEM — test**. Najpierw
wyświetlane są pies, usługa i pozostała kwota. Po rozpoczęciu symulator pozwala
wybrać sukces lub niepowodzenie. Obie role widzą historię i wynik; tylko
uprawniony opiekun może rozpocząć płatność lub uruchomić symulację.

Próba o niepewnym wyniku pozostaje do sprawdzenia zamiast tworzyć automatycznie
kolejną transakcję. W sandboxie związana transakcja może być sprawdzana ponownie
także po potwierdzeniu, żeby wykryć późniejszą zmianę wpływu. Wyższa potwierdzona
kwota jest zachowana do uzgodnienia, bez kolejnej alokacji do długu. Powtórzony
lub starszy komunikat nie cofa sukcesu. Systemowe wpłaty mają własną metodę
i nie są przypisywane jako ręczna czynność Asi.

Płatności wymagają jednocześnie lokalnego adresu aplikacji i Supabase, jawnej
konfiguracji oraz włączonych ustawień w lokalnej bazie. Domyślnie są wyłączone.
Launcher `scripts/local-app.mjs` czyta opcjonalny, ignorowany plik
`.local/tpay-sandbox.env`; konfiguracja hosted nie jest źródłem zastępczym.
Aktualny plik prywatny ma uprawnienia `0600` i tylko:

```dotenv
TPAY_ENABLED=true
TPAY_MODE=simulator
```

Po założeniu konta sandbox można w tym prywatnym pliku ustawić
`TPAY_MODE=sandbox`, `TPAY_CLIENT_ID`, `TPAY_CLIENT_SECRET`,
`TPAY_MERCHANT_ID` oraz `TPAY_SECURITY_CODE` dla powiadomień. Nie wpisywać
sekretów do czatu, repozytorium ani zmiennych publicznych. Brak kodu bezpieczeństwa
blokuje webhook. Jawnie pusty kod jest poprawny tylko wtedy, gdy tak ustawiono
go u operatora. Endpointy API i bramki są na stałe ograniczone do sandboxa.
Zmiana konfiguracji wymaga restartu lokalnego procesu.

Nie skonfigurowano publicznego adresu powiadomień ani tunelu. Sandbox można
odebrać lokalnym przyciskiem sprawdzającym transakcję przez autoryzowane API.
Adres powrotu sam nie potwierdza wpłaty. Pełny odbiór powiadomień wymaga osobnego
kontrolowanego środowiska testowego, gdy będzie potrzebne.

W testowej konfiguracji lokalnej ustawienie `online_payment_settings` jest
włączone z `walk_gate=accepted`. Nowa migracja nie włącza go automatycznie.
Pozostałe usługi i ręczne rozliczenia zachowują dotychczasowe reguły; istniejące
zapisy zwrotów to ewidencja, nie zlecenie zwrotu do Tpay.

## Odbiór i granice dowodów

- Niezależny przegląd biznesu, propozycja techniczna, uzgodnione AC i osobny
  przegląd implementacji. Dwie uwagi P2 poprawiono i niezależnie sprawdzono:
  zachowanie później zwiększonej kwoty wpływu oraz odróżnienie błędu odczytu
  konfiguracji od wyłączonej funkcji/brakującej migracji. Końcowy przegląd
  nie pozostawił otwartych uwag w sprawdzonym zakresie.
- Pełny Vitest: 121 plików, 1678 przypadków PASS i 10 FAIL wyłącznie w starym
  mocku `node:fs` dla launchera. Uzupełniono brakujący `existsSync`, dodano
  sprawdzian opcjonalnego pliku i niedziedziczenia hostowanego sekretu.
  Ponowienie launchera i konfiguracji: 20/20 PASS. Po końcowych dwóch etykietach
  historii niezależny przebieg UI i launchera: 43/43 PASS. Pozostałe 120 plików
  pełnego przebiegu przeszło; całej serii nie powtarzano bez kolejnych zmian.
- Osobny przegląd: 210/210 ówczesnych testów Tpay i 99/99 regresji ręcznych
  finansów PASS. Są to częściowo te same przypadki co w pełnym przebiegu,
  a nie dodatkowa liczba unikalnych scenariuszy.
- Rzeczywisty PostgreSQL: 7/7 prób w osobnej wygenerowanej bazie i sześć
  zaobserwowanych zależności blokad. Obejmują dwie próby jednego długu,
  wyścig potwierdzeń, ręcznej wpłaty i anulowania oraz role/RLS. Własną bazę
  usunięto, a skróty wcześniejszych danych, kont, schematu, migracji i listy baz
  pozostały identyczne. Ten przebieg poprzedzał wąską korektę późniejszego
  wzrostu potwierdzonej kwoty; korektę zweryfikowano dodatkowymi testami domeny
  (26/26 PASS) i niezależną reprodukcją, bez zmiany kolejności blokad.
- Globalne ESLint i TypeScript oraz lokalna kompilacja PASS. Końcowe etykiety
  mają własne testy renderowania dla obu ról.
- Rzeczywista lokalna aplikacja: podsumowanie ceny 100 zł po wpłacie 40 zł
  pokazało 60 zł; zapis symulacji utworzył jedną systemową wpłatę 60 zł.
  Niepowodzenie nie utworzyło wpłaty i pozwoliło na nową próbę. Potwierdzenie
  po anulowaniu zachowało 100 zł jako wpływ do sprawdzenia, bez ponownej
  rezerwacji i alokacji do należności. Wyniki były widoczne dla obu ról.
  UI podsumowania/statusu sprawdzono wizualnie na 320 i 390 px, bez poziomego
  przepełnienia; rozpoczęcie i zapis wyniku wykonano także klawiaturą z widocznym
  fokusem. Administrator nie ma przycisku symulacji. Drugi opiekun po wejściu
  na adres cudzej próby otrzymał stan niedostępności bez kwoty i historii.
  Po końcowej kompilacji ponownie sprawdzono czytelną nazwę metody wpłaty.

Odpowiedzi API w testach transportu są atrapami; JWS jest sprawdzany także
syntetycznym łańcuchem certyfikatów. Odczyt publicznego łańcucha Tpay potwierdza
wyłącznie jego konfigurację, nie doręczenie prawdziwego webhooka. Bez konta
sandbox nie potwierdzono autoryzacji merchant, przekierowania do bramki,
testowego BLIK ani formatu rzeczywistego potwierdzenia. Adapter wymaga rzeczywistej
kwoty otrzymanej (`payments.amountPaid`) i nie odgaduje jej z kwoty żądanej;
to pole odpowiedzi GET wymaga sprawdzenia na koncie sandbox. Brak danych
otrzymanej kwoty pozostawia wynik niepewny, zamiast księgować przypuszczenie.

## Stan środowisk

Migrację `202610180001_tpay_blik.sql` zastosowano **wyłącznie lokalnie**, po
wykonaniu lokalnej kopii. Lokalny Supabase ma **61 migracji**, produkcja nadal
**60**. Po migracji dane 87 wcześniejszych tabel publicznych oraz konta były
identyczne. Nowe tabele i ustawienia testowe są osobnym dodatkiem.
Prywatne dowody i zrzuty odbioru są w ignorowanym `.local/tpay-20261018/`.
Ta kopia lokalna nie domyka odłożonej kopii produkcyjnej ani wysyłki na Drive.

Po odbiorze usunięto trzy własne konta syntetyczne, ich psy, konsultacje,
próby i wpłaty oraz zależne dane testowe. Odtworzono wcześniejsze ustawienie
prowadzącej. Skróty danych wszystkich 89 tabel publicznych i wcześniejszych
kont były identyczne z początkiem odbioru; bez resetu bazy i zmiany haseł.
Lokalny podgląd końcowej kompilacji pozostawiono na `http://localhost:3000/login`,
z włączoną symulacją. Dane istniejących kont demo pozostały zachowane.

Nie publikowano aplikacji ani migracji. Nie tworzono konta Tpay, nie pobierano
pieniędzy i nie uruchamiano wiadomości. Następny etap integracji to założenie
sandboxa, prywatne skonfigurowanie dostępu i rzeczywisty odbiór transakcji.
