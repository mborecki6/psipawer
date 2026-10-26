# Odbiór przed płatnościami — 23.10.2026

## Brief i autoryzacja

Użytkownik zlecił dokładne sprawdzenie całej aplikacji, poprawki i przygotowanie
do późniejszego podłączenia SMTP, Tpay oraz zmiany planu Supabase. Powodem jest
ryzyko utraconej lub podwójnej płatności i problemów opiekuna po zapłacie.
To zgoda na lokalny kod, testy, własne syntetyczne dane i przygotowanie integracji.
Nie obejmuje publikacji, prawdziwych opłat, zmiany planu, kont klientów,
zewnętrznej wysyłki ani konfiguracji chmury. Dotychczasowe zmiany pozostają zachowane.

Nie deklarujemy braku wszystkich możliwych błędów. Warunkiem odbioru jest brak
znanych blokujących problemów w sprawdzonym zakresie, aktualne dowody i jawne
bramki testów operatora, doręczeń oraz hostingu. Testy lokalne nie zastępują
tych odbiorów.

## Uzgodnienie niezależnych propozycji

Biznes i technika przygotowały osobne propozycje; koordynator przyjął poniższe
AC-R01–R20. Recenzent bada rzeczywisty kod i własne reprodukcje przed konfrontacją
z autorami. Nie zmieniamy reguł cen, akceptacji usług, pakietów, rezygnacji ani
zwrotów do operatora. Spacer przyjęty automatycznie może być opłacony.

Zidentyfikowane celowe ograniczenia dotychczasowego wydania: Tpay i zaproszenia
są lokalne; samo wpisanie kluczy/SMTP nie uruchomi chmury. Przygotowujemy
bezpieczne konfiguracje hosted, domyślnie wyłączone, bez wykonywania zewnętrznych
operacji. Symulator pozostaje wyłącznie lokalny. Nowe migracje nie przepisują
zastosowanych wcześniej migracji.

| ID | Warunek odbioru |
| --- | --- |
| AC-R01 | Wyłączenie, brak konfiguracji/migracji i awaria odczytu nie udają sukcesu, pustej historii ani zera zadłużenia. |
| AC-R02 | Tylko własna, przyjęta i wyceniona usługa z dodatnią pozostałą kwotą; cztery rodzaje usług, kontrola także API/RPC. |
| AC-R03 | Opiekun rozpoznaje psa, usługę, termin, poprzednie wpłaty i kwotę. Zmiana salda po podsumowaniu wymaga ponownego potwierdzenia; cena nie jest wyprowadzana z formularza. |
| AC-R04 | Jeden potwierdzony wpływ i jedna alokacja; zgodne saldo, historia i oba panele; płatność nie zmienia samodzielnie uczestnictwa. |
| AC-R05 | Dwie karty, ponowienie i równoległe potwierdzenia nie tworzą drugiej transakcji ani wpłaty. |
| AC-R06 | Przerwana/niepewna próba pozostaje odnajdywalna także poza ostatnimi 20. Brak automatycznego ponawiania tworzenia; bezpieczne odzyskanie identyfikatora przez administratora i zweryfikowany odczyt operatora. |
| AC-R07 | Weryfikacja podpisu, merchant, środowiska, transakcji, PLN i kwoty; sam powrót niczego nie księguje; późniejsza rozbieżność pozostaje jawna. |
| AC-R08 | Obie kolejności ręcznej wpłaty, rezygnacji, zmiany właściciela/należności i potwierdzenia zachowują cały wpływ bez podwójnego rozliczenia. |
| AC-R09 | Dotychczasowe reguły rezygnacji i ewidencji zwrotów pozostają zachowane. Brak automatycznego zlecania zwrotu do banku. |
| AC-R10 | Wcześniejsza cena i wpłaty pozostają po zmianie oferty/terminu; brak starej ceny wymaga uzgodnienia; stare formularze nie nadpisują nowszych danych. |
| AC-R11 | Anon, obcy opiekun i odebrane uprawnienia nie dają dostępu do cudzych danych, prób, finansów i plików. |
| AC-R12 | Sumy obejmują cały dozwolony zbiór; historia i nierozstrzygnięte próby dostępne także po wyłączeniu nowych płatności. |
| AC-R13 | Zaproszenie → własne hasło → profil → ponowne logowanie i odzyskanie istniejącego konta; nieprawidłowe/użyte linki nie dają dostępu; GET nie aktywuje konta. |
| AC-R14 | Poczta ma prawdziwe stany: przygotowano/przyjęto/otwarto. Awaria nie obiecuje doręczenia i nie mnoży kont. Zapłata nie zależy od maila. |
| AC-R15 | Skrzynka, e-mail i push są oddzielne; nieaktualne przypomnienia wycofane; restart nie powiela dostaw. |
| AC-R16 | Pełne procesy usług i regresja kwalifikacji, limitów, wspólnego kalendarza Asi, zaleceń, odpowiedzi, kart i pakietów. |
| AC-R17 | Rzeczywiste UI 320/390/768/1440 px, klawiatura, zachowane pola po błędzie, widoczny fokus i czytelne stany. |
| AC-R18 | Opiekun może wskazać problematyczną próbę, a Asia rozpoznać płatnika/usługę i uzgodnić wyjątek bez zalecania kolejnej zapłaty. |
| AC-R19 | Niepusta kopia i odtworzenie zachowują Auth, DB, Storage i płatności; ponowione potwierdzenie po restore nie podwaja wpływu. |
| AC-R20 | Aktualne wyniki testów, obciążenia 50+1 i niezależnego przeglądu; wersja/dowody/środowisko; osobna lista niewykonanych testów integracji. |

Techniczne doprecyzowania: wyłączanie nowych transakcji nie blokuje odczytu
historii, webhooka ani uzgadniania istniejących prób. Środowisko nowej próby
nie może być wybierane dowolnym bezpośrednim RPC opiekuna. Zweryfikowane
powiadomienie ma trwały, prywatny zapis z ograniczonymi polami; bez surowego
payloadu i danych płatnika. Reconciliation ma wspólną walidację, trwałe claimy,
ograniczoną partię i ponowienia; nie tworzy nowych transakcji.

Użytkownik zatwierdził przygotowanie zaproszeń i haseł oraz osobnych maili
o terminach, przypomnieniach i potwierdzonych wpłatach. SMTP Auth i moduł
wiadomości biznesowych mają oddzielne konfiguracje oraz wyłączniki. Wysyłka
do prawdziwych osób pozostaje wyłączona; kolejka nie wykonuje historycznej
wysyłki po późniejszym włączeniu. Awaria poczty nie cofa zapisanej zapłaty.

## Przebiegi

- Punkt wyjścia: pełny Vitest **121/121 plików, 1691/1691 przypadków PASS**.
- Uruchomiono wyłącznie lokalny Supabase. Przed poprawkami wykonano prywatną
  lokalną kopię `4e9a41c9-ca81-4a06-ae3e-0a5625014bc0`; usługi wznowione.
- Lokalne migracje 62 i 63 zastosowano razem po kopii. Porównanie wszystkich
  wcześniejszych tabel (z pominięciem dodanych kolumn prób) i Auth potwierdziło
  zachowanie poprzednich rekordów. Poczta biznesowa pozostała wyłączona;
  lokalne ustawienia symulatora zachowano. Produkcji nie zmieniano.
- Po niezależnej reprodukcji E-01 dodano migrację 64: odwołanie całego pakietu
  fitness tworzy mail, a przywrócenie pakietu wycofuje nieaktualne zadanie.
  Migracja 63 pozostała niezmieniona. Zastosowanie 64 lokalnie zachowało
  wszystkie wcześniejsze rekordy, Auth i ustawienia.
- Kolejna własna reprodukcja recenzenta (E-02) wykazała, że uzgodnienie należności
  po anulowaniu unieważniało nadal aktualny mail. Migracja 65 wiąże go z
  niezmiennym zdarzeniem odwołania, zamiast ogólną wersją pakietu. Sprawdzono
  wpłaty, uzgodnienia, zwroty, przywrócenie i kolejny cykl odwołania oraz
  ograniczoną adaptację istniejącej kolejki bez nowej wysyłki. Po niezależnym
  odbiorze zastosowano 65 lokalnie: wcześniejsze rekordy, Auth i ustawienia
  bez zmian. **Lokalnie 65, produkcja 60 migracji.**
- Końcowy pełny Vitest na zamrożonym kodzie: **129/129 plików, 1843/1843 przypadków PASS**.
  Pierwszy przebieg bez dostępu do loopback miał 4 odmowy `listen EPERM` testów
  sztucznego SMTP. Ponowienie z uprawnieniem wyłącznie do lokalnego listenera
  przeszło; nie wysyłano wiadomości do internetu.
- Rzeczywisty PostgreSQL płatności: **7/7 PASS**, sześć obserwowanych zależności
  blokad, osobna oznakowana baza usunięta i źródłowe fingerprinty bez zmian.
  Sprawdzono dwie karty, równoległe potwierdzenia i obie kolejności ręcznej
  wpłaty lub rezygnacji względem potwierdzenia.
- Rzeczywisty PostgreSQL poczty: **5/5 PASS**, 50 zadań, 25 par przejęć przez
  niezależne połączenia z niezatwierdzoną blokadą pierwszego workera, zero
  podwójnych przejęć. Sprawdzono też role, aktualne źródło i wygasłe claimy.
  Wynik nie dowodzi doręczenia SMTP ani wydajności zarządzanego hostingu.
- Lokalny build produkcyjny wraz z TypeScript oraz globalny ESLint przeszły.
- Rzeczywista końcowa regresja PG na 65 migracjach: **173/173 PASS w 9 plikach**,
  wykonywanych kolejno. Obejmuje kalendarz, psy i kwalifikację, pakiety, karty,
  wpłaty, role i wyścigi. Osobne bazy prób usunięto; wcześniejsze dane zachowano.
- Przypomnienia: próby przerwania przed/po commicie i restartu przeszły. Osobno
  50 opiekunów × 5 spotkań dało 250 zadań i 250 wiadomości, bez duplikatów;
  sprawdzono 50 rzeczywistych lokalnych sesji Auth i odmowy obcego dostępu.
  Zmienił się oczekiwany znacznik wykonania lokalnego workera, nie dane użytkowników.
- Nowe E2E płatności na skompilowanym Next 16.4.1 i DB64: **10/10 PASS, 40,1 s**;
  dodatkowo **1/1** dla stabilnego obrazu 320 px i dowodu cleanup. Dane testowe
  usunięte, wcześniejsze ustawienia i primary przywrócone. Wcześniejsze błędy
  dotyczyły fixture/selekcji pól testowych, nie odtworzonej usterki produktu.
  Końcowy pełny odbiór na DB65: **78/78 E2E PASS, 8,2 min**. Obejmuje oba
  panele, zaproszenie → hasło → profil → konsultację → zalecenia → odzyskanie
  dostępu, kwalifikację, usługi, rezerwacje, zdjęcia, czat, finanse i przerwania
  sieci. Chromium; po korekcie testów WebKit wykonano dodatkowo wspólny,
  ukierunkowany zestaw opisany poniżej.
- Niezależny przegląd: znalezione E-01/E-02 (maile o odwołaniu) oraz
  F-01/F-02 (odporność narzędzia prób kopii) zamknięte po własnych reprodukcjach
  recenzenta. Poprawki autorów mają testy regresji; nie były odbierane przez autora.
  Szczegółowe prywatne raporty pozostają w `.local/launch-20261023/`.
- Końcowe fizyczne odtworzenie DB65 **PASS**: 144 tabele, 24 751 wierszy,
  trzy logowania i kontrola ról, dwa prywatne pliki oraz rezerwacja przesłania.
  Zachowane kursy, fitness, karty, rozliczenia, zalecenia, kalendarz i przypomnienia.
  Trzy próby płatności: replay dwóch zapisanych wpłat nie utworzył duplikatu,
  trzecia niedokończona została rozliczona dokładnie raz; trzy wiersze maili,
  w tym zachowany wynik niepewny. Źródłowe dane, Auth i ustawienia porównane
  przed/po, wszystkie własne fixture usunięte.
  Kopia `e92674e1-c6df-48b8-aff7-2d8a001c4ad9`, odtworzenie
  `e5819017-e3bc-45a5-9267-30e182d494be`; wyłącznie lokalne zasoby.
- WebKit: **13/13 E2E PASS, 1,0 min**, w tym dziesięć ścieżek płatności,
  zaproszenie/odzyskanie, profil oraz konsultacja/zalecone działania. Pierwszy
  przebieg miał 7 PASS/5 FAIL. Cztery porażki wynikały z użycia Tab przy domyślnej
  preferencji macOS/WebKit pomijającej zwykłe przyciski; prosty niezależny od
  aplikacji eksperyment wykazał pełną sekwencję przez Option+Tab. Test używa
  tego gestu tylko na macOS/WebKit, nadal wymaga rzeczywistego fokusu, widocznego
  obrysu i Enter w czterech szerokościach. Piąta porażka dotyczyła wymogu
  widoczności segmentu React Suspense przy celowo zatrzymanych skryptach:
  przed zwolnieniem kontrolki muszą być obecne i zablokowane, a niewidoczność
  jest dozwolona tylko wewnątrz rzeczywistego ukrytego segmentu streamu.
  Potem test wymaga widocznego, aktywnego formularza i rzeczywistego zapisu
  terminu. Niezależny przegląd potwierdził zachowanie kryteriów, bez pominięcia
  scenariuszy ani programowego ustawiania fokusu. Nie zmieniano aplikacji,
  żeby dopasować ją do testu. To lokalny silnik WebKit, nie odbiór fizycznego
  iPhone'a ani wszystkich wersji Safari.
  Po korekcie tych dwóch plików testowych powtórzono ten sam zestaw w Chromium:
  **13/13 PASS, 1,2 min**; kod aplikacji i build pozostały zamrożone.
  Po obu przebiegach pięć wcześniejszych kont i ich profile mają identyczne
  hashe; wszystkie tabele public i Storage, ustawienia i primary pozostały
  bez zmian. Auth zachował dwa nowe techniczne stany PKCE (`auth.flow_state`)
  po testach odzyskiwania hasła oraz nowe wpisy dziennika logowania; nie są
  to nowe konta ani usługi. Nie usuwano niepotrzebnie serwerowego stanu Auth.
- Końcowy lokalny pilot **50 opiekunów + 1 prowadząca PASS**, 55 s,
  skompilowany build powyżej, DB65 w VM 2 vCPU / 4 GB. Przygotowano 50 psów,
  1050 zapisów, 200 konsultacji, 200 planów, 400 wpisów postępu, 50 pakietów
  i 666 wpłat. Sprawdzono izolację wszystkich 50 rzeczywistych sesji Auth.
  Odczyty HTTP miały współbieżność 1/5/50 opiekunów z równoległą sesją
  prowadzącej; zero błędów. Przy 50+1 p95 wyniosło 1056,50 ms dla startu,
  1099,64 ms dla zaleceń i 1254,01 ms dla rozliczeń opiekuna; dla prowadzącej
  odpowiednio 1550,60 / 1264,67 / 1433,25 ms. Wszystkie grupy spełniły
  lokalny próg 2000 ms. W rzeczywistej przeglądarce otwarto 153 widoki przy
  najwyżej 5 równoległych kartach, szerokości 320/390/1440: p95 791 ms,
  zero błędów JS, cudzych danych i poziomego przepełnienia.
  Pięćdziesiąt równoczesnych zapisów przy limicie czterech dało dokładnie
  4 przyjęcia i 46 jawnych odmów; p95 67,04 ms. Pięćdziesiąt ponowień
  tej samej ręcznej wpłaty dało jeden wpływ 10 000 gr; p95 41,05 ms.
  Wszystkie własne dane/konta usunięto; porównanie public, kont Auth i migracji
  potwierdziło zachowanie źródła. Prywatny raport:
  `.local/pilot-load/215e285b-3b1b-4090-bef5-19bd88281b05.json`.
  Wynik nie jest pomiarem rzeczywistego Tpay, SMTP ani pojemności Vercel/Supabase.
- Przed ostatnimi pomiarami usunięto dokładnie rozpoznane pozostałości własnego
  testu kursu przerwanego wcześniej sygnałem SIGINT: trzy konta syntetyczne
  i powiązany graf fixture. Pozostało pięć wcześniejszych kont; porównanie
  liczników i hashy 125 niezwiązanych tabel public/Auth/Storage oraz ustawień
  potwierdziło ich zachowanie. Prywatny journal naprawy jest kompletny;
  nie wykonywano zbiorczego usuwania danych według prefiksu.

## Wynik lokalnego odbioru

Lokalny kandydat przeszedł powyższe kontrole; znane uwagi z niezależnego
przeglądu zamknięto. Końcowy odczyt po cleanup: 65 migracji, pięć wcześniejszych
kont i pięć profili, business SMTP wyłączony. Zachowano wcześniejsze lokalne
ustawienie symulatora płatności; nie przenoszono go do chmury. Build, ESLint,
TypeScript, testy reguł i rzeczywiste procesy przeszły. Produkcji nie zmieniono.
Nie jest to gwarancja zera błędów ani zgoda na przyjęcie prawdziwych pieniędzy.
[Instrukcja konfiguracji i publikacji](../PAYMENT-EMAIL-RELEASE.md) opisuje
oddzielne wyłączniki, wymagane odbiory i bezpieczne wstrzymanie pracy.

## Aktualizacja zabezpieczeń zależności

Audyt produkcyjnych zależności 23.10 zgłosił trzy advisories dla Next 16.3.8.
Lokalnie zaktualizowano Next i eslint-config-next do **16.4.1**; ponowny
`pnpm audit --prod --json` zwrócił **0 zgłoszeń**. Nowy build z typowaniem i
pełny Vitest powyżej dotyczą poprawionej wersji. Zero zgłoszeń audytu nie
oznacza dowodu braku wszystkich podatności aplikacji.

Źródła producenta: [Server Actions DoS](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r),
[Cache Components RCE](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr),
[Image Optimization](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw).
Ostatni ma także obejście przez sharp >=0.35.5, które projekt już miał;
nie przypisujemy każdemu zgłoszeniu dowodu wykorzystania w tej aplikacji.
Opublikowane wydanie nie zostało automatycznie zaktualizowane.

## Bramki przed przyjęciem prawdziwych pieniędzy

- Rzeczywisty sandbox Tpay: konto merchant, OAuth, przekierowanie/BLIK,
  otrzymana kwota, podpisane powiadomienia i ponowienia. Atrapa nie zalicza tej bramki.
- SMTP: zweryfikowana domena/nadawca, docelowe szablony i adresy Auth,
  zaproszenie oraz odzyskanie na rzeczywistej skrzynce.
- Plan Supabase, rzeczywista kopia DB/Auth i osobna kopia Storage poza komputerem,
  harmonogramy, monitoring oraz kontrolowany odbiór hostingu po publikacji.
- Potwierdzone przez właściciela ceny i robocze zasady rezygnacji przed live;
  uzgodniona obsługa wyjątków. Audyt techniczny nie ustala polityki biznesowej.

Źródła: istniejące AC-B i AC-L, bieżący kod, dokumentacja Next dostarczona
z zainstalowanym pakietem oraz oficjalne dokumentacje
[Tpay](https://docs-api.tpay.com/en/webhooks/),
[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
i [kopii Supabase](https://supabase.com/docs/guides/platform/backups).
