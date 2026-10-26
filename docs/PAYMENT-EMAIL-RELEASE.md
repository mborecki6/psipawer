# Płatności i poczta — instrukcja przygotowania wydania

Aktualizacja 26.10: po nowej zgodzie opublikowano kod i migracje 61–65;
produkcja ma 65 migracji. Wszystkie nowe płatności i kanały poczty pozostają
wyłączone, nie kupowano Pro. Odbiór ujawnił błąd starego PostgREST 14.5;
restart przywrócił dostępność, lecz przed prawdziwymi klientami pozostaje
aktualizacja wersji projektu i jej odbiór. [Wydanie i otwarte warunki](iterations/2026-10-26-publikacja-poprawek.md).

Stan instrukcji: 23.10.2026. Opisuje kod przygotowany lokalnie według
[AC-R01–R20](iterations/2026-10-23-gotowosc-platnosci.md), a nie zgodę na jego
publikację. Użytkownik objął zakresem zaproszenia i hasła oraz wiadomości o
terminach, przypomnieniach i potwierdzonych wpłatach. Ta iteracja nie wykonuje
zewnętrznej wysyłki, prawdziwych transakcji, konfiguracji chmury, zmiany planu
Supabase ani wdrożenia. W historycznym stanie z 23.10 produkcja pozostawała
przy **60 migracjach**; od publikacji z 26.10 ma **65**.

Lokalne testy i symulator nie są odbiorem operatora ani poczty. Przed użyciem
prawdziwych pieniędzy potrzebne są osobne wyniki sandboxa Tpay, rzeczywistej
skrzynki, kopii i odtworzenia oraz hostingu. Nie deklarujemy braku wszystkich
możliwych błędów. Wyniki konkretnych przebiegów zapisuje koordynator w iteracji.

## 1. Konfiguracja początkowa i migracje

Punktem wyjścia jest [.env.example](../.env.example). Wszystkie przełączniki
wysyłki, nowych płatności i workerów są tam wyłączone, a sekrety puste. Nie
kopiuj lokalnego symulatora, lokalnych kluczy ani skrzynki do hostingu.
Poświadczenia trafiają wyłącznie do prywatnej konfiguracji serwera; nie do
repozytorium, raportów, klienta ani parametrów URL.

Przed zastosowaniem zmian zapisz wersję kodu, bieżącą listę migracji, środowisko,
identyfikator niepustej kopii i wynik próbnego odtworzenia. Po osobnej zgodzie
na wdrożenie stosuj migracje w tej kolejności:

| Numer | Plik                                       | Znaczenie                                                                                                                          |
| ----- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 61    | `202610180001_tpay_blik.sql`               | Próby online, powiązania wpłat i lokalny wariant Tpay; ustawienia nowych płatności domyślnie wyłączone.                            |
| 62    | `202610230001_payment_readiness.sql`       | Środowisko live, kontrola serwerowa rozpoczęcia, historia i prywatne potwierdzenia, odzyskanie powiązania oraz claimy uzgadniania. |
| 63    | `202610230002_business_email.sql`          | Prywatny outbox zdarzeń, wyłączone ustawienie poczty i trwałe claimy SMTP.                                                         |
| 64    | `202610230003_fitness_cancel_email.sql`    | Wiadomość o odwołaniu całego pakietu fitness i wycofanie jej po przywróceniu pakietu.                                              |
| 65    | `202610230004_fitness_cancel_identity.sql` | Tożsamość odwołania niezależna od rozliczeń; ograniczona adaptacja już oczekujących, aktualnych wiadomości.                        |

Nie poprawiaj migracji 61 w miejscu, jeśli została zastosowana. Nie resetuj bazy
użytkowników. Wgranie kodu wymagającego nowych RPC przed migracjami może dawać
jawny stan niedostępności; nie traktuj go jako pustej historii ani zerowej
należności. Po migracjach porównaj ich rzeczywistą listę ze źródłami. Sam plik
w repozytorium nie oznacza zastosowania migracji w lokalnej lub produkcyjnej DB.
W punkcie wyjścia lokalny kandydat miał 65 migracji, a produkcja 60;
po publikacji z 26.10 produkcja również ma 65. Migracje 64 i 65 dodano po
niezależnych reprodukcjach; zastosowanych wcześniej migracji nie przepisano.

Lokalny launcher bierze business SMTP wyłącznie z prywatnego
`.env.test.local`, domyślnie wyłącza wysyłkę i wymaga loopback SMTP. Nie
dziedziczy tożsamości hosted SMTP z `.env.local`. Dla lokalnego launchera usuń
hosted opt-iny zamiast kopiować je jako ciąg `false`: helper odrzuca także
niepuste oznaczenia hosted. `TPAY_RECONCILIATION_ENABLED` pozostaje w nim
wyłączone, sekret workera pusty; lokalne testy workerów wywołują ich adaptery
bezpośrednio. Nie zakładaj uruchomienia workerów przez samo `local:dev`.

Dwa dodatkowe przełączniki znajdują się w DB:
`public.online_payment_settings.enabled` oraz
`public.business_email_settings.enabled`. Oba rozpoczynają od `false` i są
zmieniane administracyjnie przez uprawniony kanał serwerowy. Nie udostępniamy
klucza serwerowego przeglądarce. Włączenie poczty nie uzupełnia historycznych
zdarzeń; dopiero nowe zdarzenia mogą utworzyć zadanie.

## 2. Dwa niezależne transporty poczty

### Supabase Auth: zaproszenia i odzyskanie hasła

SMTP Auth konfiguruje się **w Supabase Auth**. Zmienne `BUSINESS_EMAIL_SMTP_*`
nie konfigurują tego transportu. Przygotuj domenę i nadawcę u dostawcy, właściwy
Site URL oraz dozwolone adresy powrotu. Odbiór obejmuje ustawienia DNS i domeny
według wymagań wybranego dostawcy oraz rzeczywiste dostarczenie do skrzynki.
Domyślna usługa pocztowa Supabase ma ograniczenia i nie zastępuje tego odbioru.
[Dokumentacja SMTP Auth](https://supabase.com/docs/guides/auth/auth-smtp).

Wgraj odpowiednie szablony z `supabase/templates/invite.html` i
`supabase/templates/recovery.html`. Ich linki korzystają z `.SiteURL` i
`.TokenHash`:

```text
{{ .SiteURL }}/auth/invitation?token_hash={{ .TokenHash }}
{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}
```

Zachowaj ekran potwierdzenia: GET ani skaner poczty nie aktywuje konta i nie
zużywa tokenu. Dopiero formularz weryfikuje stały typ tokenu. Nie zastępuj linków
automatycznie konsumowanym `.ConfirmationURL`.
[Zmienne szablonów Supabase](https://supabase.com/docs/guides/auth/auth-email-templates).

Do przyszłego hosted Auth wymagane są:

- `AUTH_EMAIL_ENABLED=true`;
- `AUTH_EMAIL_HOSTED_ENABLED=true`;
- `AUTH_EMAIL_APP_ORIGIN` dokładnie równe originowi `NEXT_PUBLIC_APP_URL`;
- HTTPS bez dodatkowego portu, właściwy projekt `*.supabase.co`, produkcyjny
  runtime oraz brak oznaczenia preview/dev;
- osobne `CLIENT_INVITATIONS_ENABLED=true`, gdy wolno wysyłać zaproszenia,
  oraz serwerowy `SUPABASE_SECRET_KEY`.

Flagi nie ustawiają SMTP, szablonów ani odbiorców. Przygotowanie zaproszenia
nie wysyła go; wysłanie wymaga osobnej akcji. Dla istniejącego konta sprawdź
odzyskanie hasła, zamiast tworzyć drugie konto. Odbiór obejmuje nowe hasło,
profil, wylogowanie i ponowne logowanie, token wygasły/użyty oraz błąd SMTP.
Przyjęcie przez API nie oznacza doręczenia; otwarcie linku nie oznacza ukończenia
aktywacji. Odpowiedź odzyskiwania pozostaje jednakowa dla istniejącego i
nieistniejącego adresu. Szczegóły: [odzyskanie](ACCESS-RECOVERY.md).

### SMTP aplikacji: terminy, przypomnienia i potwierdzone wpłaty

To oddzielny kanał `src/modules/email`, uruchamiany przez własny worker.
Korzysta z trwałego outboxu, nie z transportu Supabase Auth. Zakres obejmuje
utworzenie/potwierdzenie, zmianę i odwołanie terminów lub udziału dla usług,
przypomnienia oraz potwierdzone wpłaty. Treść jest krótka, bez prywatnych
notatek, informacji zdrowotnych i rozmów; szczegóły prowadzą do panelu po
zalogowaniu. Potwierdzenie wpłaty nie jest fakturą ani paragonem.

| Zmienna                                                    | Wymaganie dla hosted                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `BUSINESS_EMAIL_ENABLED`                                   | Jawne `true`; zatrzymanie workera przez `false`.                                               |
| `BUSINESS_EMAIL_DEPLOYMENT`                                | `hosted`; lokalne testy używają `local` wyłącznie na loopback aplikacji, DB i SMTP.            |
| `BUSINESS_EMAIL_HOSTED_ENABLED`                            | Osobne `true`; runtime produkcyjny, Vercel wyłącznie production.                               |
| `BUSINESS_EMAIL_SMTP_HOST`                                 | Publiczna nazwa hosta, bez URL, portu ani poświadczeń w wartości.                              |
| `BUSINESS_EMAIL_SMTP_PORT`                                 | Port dostawcy; `587` z STARTTLS lub `465` z implicit TLS, jeżeli dostawca tak wymaga.          |
| `BUSINESS_EMAIL_SMTP_SECURE`                               | `false` dla STARTTLS; `true` dla implicit TLS. Hosted zawsze wymaga TLS i sprawdza certyfikat. |
| `BUSINESS_EMAIL_SMTP_USER`, `BUSINESS_EMAIL_SMTP_PASSWORD` | Prywatne poświadczenia dostawcy SMTP; obowiązkowe hosted.                                      |
| `BUSINESS_EMAIL_SMTP_FROM`                                 | Jeden zweryfikowany adres, bez nazwy wyświetlanej i listy adresów.                             |
| `BUSINESS_EMAIL_REPLY_TO`                                  | Opcjonalny pojedynczy adres; brak lub pusta wartość pomija osobny Reply-To.                    |
| `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`          | Właściwe HTTPS originy; linki nie powstają z nagłówka Host ani formularza.                     |
| `SUPABASE_SECRET_KEY`                                      | Klucz serwerowy właściwej DB, wyłącznie po stronie serwera.                                    |
| `BUSINESS_EMAIL_SECRET`                                    | Osobny sekret autoryzacji schedulera, opis poniżej.                                            |

Kolejność przyszłego włączania: konfiguracja i odbiór testowego transportu,
worker z pustą/wyłączoną kolejką, dopiero potem świadome
`business_email_settings.enabled=true` i nowe kontrolowane zdarzenia. Nie
twórz historycznej wysyłki przez kopiowanie dawnych wiadomości do outboxu.
Przed SMTP worker sprawdza aktualność źródła i uprawnień odbiorcy; cofnięty
termin lub nieaktualne przypomnienie może zostać anulowane.

Stany outboxu mają precyzyjne znaczenie:

- `pending`, `claimed`, `sending`: zapisano zadanie, zarezerwowano je lub
  rozpoczęto transport. Żaden z tych stanów nie potwierdza przyjęcia SMTP.
- `accepted`: serwer SMTP przyjął wiadomość dla odbiorcy. Nie oznacza
  doręczenia, przeczytania ani otwarcia. Nie ma tu trackingu otwarć.
- `retry`: pewny przejściowy błąd **przed DATA**. Maksymalnie 5 prób; backoff
  wynika z numeru próby (60/120/240/480 sekund przed piątą, ostatnią próbą).
- `failed`: trwałe odrzucenie przed DATA albo wyczerpanie prób.
- `uncertain`: możliwe przyjęcie po DATA lub wygaśnięty `sending` po 90 s.
  Bez automatycznego ponawiania; najpierw wyjaśnienie u dostawcy po Message-ID.
- `cancelled`: wyłączony kanał lub nieaktualne źródło. Historia pozostaje.

Restart nie resetuje statusów. Claim bez rozpoczęcia SMTP po wygaśnięciu
90 s może wrócić do bezpiecznego ponowienia; rozpoczętego SMTP nie powtarzamy
na podstawie utraconej odpowiedzi HTTP. Błąd maila nie cofa wpłaty, terminu ani
wiadomości w aplikacji. Skrzynka, e-mail i Web Push mają osobne dostawy.

## 3. Tpay: hosted sandbox przed osobnym live

`TPAY_MODE` wybiera dokładnie `simulator`, `sandbox` albo `live`.
Symulator działa wyłącznie z lokalną aplikacją i DB, bez oznaczeń Vercel; nie
łączy się z operatorem i nie potwierdza gotowości prawdziwego BLIK.

Dla hosted sandbox przygotuj bez włączania nowych checkoutów:

```dotenv
TPAY_ENABLED=false
TPAY_MODE=sandbox
TPAY_HOSTED_ENABLED=true
TPAY_APP_ORIGIN=https://WŁAŚCIWA-DOMENA
TPAY_LIVE_ENABLED=false
TPAY_RECONCILIATION_ENABLED=false
```

Uzupełnij prywatne `TPAY_CLIENT_ID`, `TPAY_CLIENT_SECRET`, `TPAY_MERCHANT_ID`
i `TPAY_SECURITY_CODE` z **tego samego środowiska merchant**. Jawnie pusty
security code jest poprawny tylko wtedy, gdy merchant rzeczywiście nie ma
ustawionego kodu. `TPAY_APP_ORIGIN` musi odpowiadać originowi
`NEXT_PUBLIC_APP_URL`, aplikacja i Supabase muszą korzystać z HTTPS.
Endpointy operatora są stałe w kodzie; zmienne nadpisujące bazowy URL są
odrzucane. [Niezależne środowiska Tpay](https://docs-api.tpay.com/en/first-steps/environments/).

Hosted callback ma stały adres
`https://WŁAŚCIWA-DOMENA/api/payments/tpay/notification`. W panelu merchanta
ustaw właściwy URL oraz pozwolenie jego przekazania w
`callbacks.notification.url`. Sprawdź publiczną osiągalność końcowego HTTPS
bez przekierowań i ochrony preview blokującej operatora. Podpisany webhook
sprawdza dokładne bajty, algorytm RS256, przypięte CA i URL certyfikatu właściwego
środowiska, merchant, test mode, checksum, powiązanie próby i kwoty.
Adapter tworzy wyłącznie PLN; jawnie inna waluta jest odrzucana. Opcjonalnie
pominięte `tr_currency` jest interpretowane jako PLN w tym kontrakcie i musi
pasować do zachowanej próby PLN. [Umowa webhooka Tpay](https://docs-api.tpay.com/en/webhooks/).

Dopiero po zgodzie na rzeczywisty odbiór sandboxa włącz ustawienie nowych
płatności w DB i `TPAY_ENABLED=true` dla izolowanego środowiska testowego.
Przejdź OAuth, przekierowanie/BLIK, wpłatę, powrót, podpisany webhook, duplikat,
spóźnione potwierdzenie, nadpłatę/niedopłatę, przerwane żądanie i odzyskanie
próby. Sam powrót do aplikacji nie księguje pieniędzy. Nie powtarzaj tworzenia
transakcji, gdy wynik jest niepewny; administrator odzyskuje identyfikator i
porównuje zweryfikowany odczyt z niezmiennymi danymi próby.

**Granica GET:** obecny publiczny schemat `GET /transactions/{transactionId}`
w [OpenAPI Tpay](https://api.tpay.com/) nie gwarantuje `payments.amountPaid`.
Brak rzeczywistej kwoty przy statusie paid/refund daje `paidCents=null`.
Pozwala odtworzyć powiązanie identyfikatora, ale nie finalizuje wpłaty ani
zwrotu. Nie podstawiaj zamówionej kwoty `amount`. Weryfikowany webhook używa
udokumentowanego `tr_paid`; brak potwierdzenia wymaga wyjaśnienia z operatorem.

Live to osobny etap po odbiorze sandboxa, kopii i hostingu oraz osobnej zgodzie
użytkownika. Wymaga `TPAY_MODE=live`, `TPAY_HOSTED_ENABLED=true`,
`TPAY_LIVE_ENABLED=true`, produkcyjnego runtime i braku preview/dev; jeśli są
oznaczenia Vercel, `VERCEL_ENV=production`. Loopback live jest odrzucany.
Użyj oddzielnych danych konta live. Nie przełączaj konfiguracji merchant lub
środowiska, dopóki nierozstrzygnięte próby poprzedniej konfiguracji wymagają
jej webhooków i uzgodnienia. Obecne wdrożenie obsługuje jeden skonfigurowany
merchant/tryb naraz.

## 4. Harmonogramy i utrzymanie

Repozytorium przygotowuje endpointy, ale nie tworzy harmonogramu hostingu.
Każdy ma własny sekret z kryptograficznego generatora: **43–128 znaków
base64url** (`A–Z`, `a–z`, `0–9`, `_`, `-`), przykładowo 32 losowe bajty
zakodowane bez paddingu. Nie używaj tej samej wartości w trzech kanałach i nie
przekazuj jej w URL. Scheduler ma wysyłać nagłówek `Authorization: Bearer …`
do właściwego HTTPS originu, bez podążania za przekierowaniem.

| Wywołanie POST, bez body    | Sekret                   | Zakres i przełącznik                                                                                                     |
| --------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `/api/internal/payments`    | `PAYMENTS_WORKER_SECRET` | Jedna przypisana próba na wywołanie; `TPAY_RECONCILIATION_ENABLED=true` i konfiguracja Tpay. Nie tworzy checkoutów.      |
| `/api/internal/email`       | `BUSINESS_EMAIL_SECRET`  | Jedna wiadomość na wywołanie; konfiguracja business SMTP oraz ustawienie DB.                                             |
| `/api/internal/maintenance` | `MAINTENANCE_SECRET`     | Istniejąca kolejka przypomnień aplikacji i odrębny Web Push. Nie wysyła business SMTP i nie zastępuje workera płatności. |

Obecny maintenance wymaga **`VERCEL_ENV=production`** oraz standardowego
adresu HTTPS Supabase z 20-znakowym identyfikatorem projektu
(`https://<20 znaków a–z/0–9>.supabase.co`). Kod jest przygotowany dla
uzgodnionego hostingu Vercel + Supabase. Poza tym środowiskiem zwraca 503;
nie ustawiaj fałszywego oznaczenia Vercel, żeby obejść tę kontrolę. Osobne
workery płatności i business SMTP mają własne bramki opisane powyżej.

Endpointy przyjmują POST i mają limit czasu 60 s; odczyt GET nie jest
wywołaniem workera. Wbudowany Vercel Cron wykonuje GET, dlatego samo dodanie
tych ścieżek do `vercel.json` nie wystarczy; potrzebny jest uzgodniony scheduler
obsługujący POST i prywatny nagłówek albo osobno przygotowany adapter.
[Sposób wywołania Vercel Cron](https://vercel.com/docs/cron-jobs).

Na odbiorze zacznij od osobnego wywołania każdego kanału. Kolejnym konkretnym
wariantem do pomiaru jest **do 5 POST na minutę na kanał, najwyżej 5 żądań
naraz**, rozłożonych w czasie, jeśli dostawca i hosting pozwalają na taki ruch.
Trwałe claimy rozdzielają równoległą pracę. Nie zwiększaj partii wewnątrz
żądania: jedna pozycja chroni budżet czasu OAuth/SMTP. To propozycja do próby,
nie uruchomiony harmonogram ani deklaracja pojemności produkcji.

Jedna wiadomość na minutę oznacza około 50 minut opróżniania 50 zadań, pięć
na minutę około 10 minut bez błędów transportu. Przed live zmierz opóźnienie
potwierdzeń finansowych i przypomnień dla 50+1 oraz dobierz częstotliwość,
ograniczoną współbieżność, limity dostawcy i hostingu. Samo ustawienie
minutowego harmonogramu nie spełnia odbioru czasów dostarczenia. Nie
uruchamiaj duplikatów lokalnych procesów ani prób obciążenia równocześnie
z kopią lub migracjami.

Odpowiedź 401 oznacza brak poprawnej autoryzacji. 503 wymaga sprawdzenia
konfiguracji, kolejki lub transportu; nie upoważnia do ręcznego odtworzenia
transakcji lub wiadomości. Powtórne wywołanie schedulera respektuje trwałe
claimy i stany DB. Dla płatności lease trwa 2 minuty; pending jest ponownie
sprawdzane po 2 minutach, błędy mają ograniczony backoff do godziny. Wartość
`configured:false` przy wyłączonym workerze nie oznacza wykonania jego pracy.
Nie alarmuj danymi osobowymi ani surowymi payloadami; obserwuj liczniki,
opóźnienie, statusy `uncertain`/`requires_review` i błędy autoryzacji.

## 5. Kopia, odbiór i bezpieczne wstrzymanie

Przed przyszłym live potrzebne są niepusta kopia DB **wraz z Auth** oraz
osobna kopia rzeczywistych obiektów Storage poza komputerem, z kontrolą dostępu
i osobno trzymanym kluczem szyfrowania. Kopia zdjęć marki nie zastępuje kopii
bazy. Plan Supabase i harmonogram kopii wymagają oddzielnej decyzji; ta
instrukcja nie włącza Pro. [Kopia Supabase nie zawiera plików Storage](https://supabase.com/docs/guides/platform/backups).

Próbne odtworzenie do odseparowanych zasobów ma zachować logowanie, role,
metadane i bajty plików, należności, wpłaty, alokacje, próby, potwierdzenia oraz
outbox. Ponowienie wcześniejszego potwierdzenia po odtworzeniu nie może
podwoić wpływu. Odtworzone środowisko ma wyłączone zewnętrzne wysyłki,
checkouty i harmonogramy; przyjętych lub niepewnych maili nie wysyła ponownie.
[Lokalne narzędzie kopii](LOCAL-BACKUPS.md) nie jest automatycznie kopią ani
procedurą odzyskania hostowanego projektu.

W przyszłym incydencie płatniczym ustaw `TPAY_ENABLED=false` i wyłącz nowe
płatności w `online_payment_settings.enabled`. **Pozostaw konfigurację
merchant, webhook i `TPAY_RECONCILIATION_ENABLED=true` wraz z harmonogramem**,
aby przyjąć rozpoczęte wpływy. Zachowaj historię i dostęp do wyjątków. Nie
usuwaj prób, potwierdzeń, wpłat ani alokacji; nie wycofuj migracji i nie
odtwarzaj starego snapshotu na aktywnej bazie z nowymi wpływami. Powrót aplikacji
musi zachowywać zgodność z nowym schematem i obsługą potwierdzeń. Zwrot do
banku nie jest automatyczną procedurą tego wydania.

Gdy trzeba zatrzymać business SMTP, ustaw `BUSINESS_EMAIL_ENABLED=false`
i administracyjnie `business_email_settings.enabled=false`. DB anuluje
`pending`/`retry`/`claimed`, a rozpoczęte `sending` oznacza jako `uncertain`;
transportu będącego już w drodze nie da się cofnąć. Samo wyłączenie workera
bez przełącznika DB pozostawia kolejkę do późniejszej obsługi. Nie resetuj
`accepted` lub `uncertain` do `pending`. `CLIENT_INVITATIONS_ENABLED=false`
zatrzymuje nowe wysyłki zaproszeń z aplikacji, pozostawiając odzyskiwanie
hasła. `AUTH_EMAIL_ENABLED=false` zatrzymuje inicjowanie z aplikacji zarówno
zaproszeń, jak i odzyskiwania hasła. Nie cofnie wiadomości już przyjętej przez
Supabase Auth; transport i ewentualne inne wywołania Auth kontroluj też
w ustawieniach Supabase.

Przed dopuszczeniem klientów koordynator zapisuje: wersję kodu, faktyczne
migracje i środowisko, wyniki lokalne i niezależny przegląd, realny sandbox,
rzeczywiste doręczenia i linki Auth, wynik odtworzenia, odbiór hostingu i
pojemności oraz listę niewykonanych prób. Niezamknięta bramka pozostaje
jawnym ograniczeniem; nie zastępuje jej włączenie flagi.

Przed prawdziwymi opłatami Asia potwierdza ceny i robocze zasady odwołań;
obecne wartości 100 zł nie są automatycznie zatwierdzonym cennikiem live.
Przejrzyj też widoczne w produkcji wydarzenia i konta DEMO: fikcyjna zbiórka
nie może stać się ofertą płatną dla prawdziwego opiekuna. Uporządkuj publikację
wyłącznie w osobno zatwierdzonym zakresie; nie usuwaj wpłat ani historii.
