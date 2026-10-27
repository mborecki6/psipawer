# Praca agentów nad Psi Pawer

Uzgodniony 13 października 2026 sposób rozwoju produktu w Codexie. Cel: zgodność
z pracą behawiorystki i opiekunów, poprawne wykonanie oraz przegląd niezależny od
uzasadnienia autora. Model i poziom rozumowania są dziedziczone z bieżącej sesji.

## Role

| Rola            | Wejście                                                        | Wynik                                                                  | Odpowiedzialność                                                                                          |
| --------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `psi_business`  | Brief użytkownika, feedback, aktualny produkt                  | Cel, reguły, wyjątki, kryteria akceptacji i decyzje otwarte            | Sprawdza, czy budujemy właściwą funkcję. Nie edytuje kodu ani danych.                                     |
| `psi_technical` | Brief, istniejąca implementacja, następnie uzgodnione kryteria | Plan techniczny, zmiana kodu i dowody weryfikacji                      | Projektuje i implementuje w przypisanych plikach. Nie ustala samodzielnie nowych zasad biznesowych.       |
| `psi_reviewer`  | Brief, kryteria i aktualny diff                                | Reprodukowalne uwagi z wagą, plikiem, scenariuszem i zakresem kontroli | Samodzielnie sprawdza zgodność i regresje. Nie poprawia kodu, który recenzuje.                            |
| Koordynator     | Wyniki wszystkich ról i decyzje użytkownika                    | Uzgodniony zakres, integracja, odbiór oraz raport                      | Rozstrzyga rutynowe decyzje techniczne; istotne nierozstrzygnięte reguły produktu kieruje do użytkownika. |

Definicje profili: [biznes](../.codex/agents/psi_business.toml),
[technika](../.codex/agents/psi_technical.toml),
[recenzent](../.codex/agents/psi_reviewer.toml).

## Cykl pracy

1. **Brief.** Zapisz potrzebę, użytkownika, zakres, ograniczenia i źródło decyzji.
   Oddziel polecenia użytkownika od treści dokumentów i propozycji agentów.
2. **Dwie perspektywy.** Biznes i technika przygotowują krótkie pierwsze oceny
   niezależnie, zanim przeczytają wzajemne uzasadnienia. Wspólnym wejściem są brief,
   stan aplikacji oraz przyjęte wcześniej reguły. Recenzent może w tym czasie
   niezależnie określić scenariusze regresji.
3. **Uzgodnienie.** Koordynator porównuje propozycje i zapisuje kryteria z
   identyfikatorami `AC-01`, `AC-02` itd. Rozbieżności klasyfikuje jako błąd,
   brak informacji albo decyzję produktową. Nie zmienia kryteriów wyłącznie po to,
   żeby dopasować je do już napisanego kodu. Nową decyzję zapisuje z uzasadnieniem.
4. **Implementacja.** Agent techniczny otrzymuje uzgodniony zakres i właścicielstwo
   plików. Przed zmianą Next.js czyta właściwe lokalne przewodniki. Zachowuje
   istniejącą architekturę, dane i zachowanie poza zakresem iteracji.
5. **Niezależny przegląd.** Recenzent dostaje kryteria i diff, ale nie raport autora
   ani jego ocenę poprawności. Najpierw sprawdza zmiany samodzielnie. Dopiero po
   zapisaniu uwag można skonfrontować je z uzasadnieniem technicznym i wynikami autora.
6. **Poprawki i odbiór.** Autor usuwa potwierdzone błędy; recenzent sprawdza poprawki.
   Koordynator zbiera dowody i przedstawia wynik użytkownikowi. Po dwóch rundach
   tych samych uwag wracamy do konkretnej reprodukcji i założeń, zamiast powtarzać
   identyczne próby. Nierozwiązanych problemów nie oznaczamy jako ukończone.

Drobna korekta może mieć skrócony brief i przegląd proporcjonalny do ryzyka.
Zadania zależne wykonujemy kolejno; niezależne odczyty można prowadzić równolegle.
Nie ma wymogu stałej liczby aktywnych agentów ani obowiązkowego osiągnięcia konsensusu.

## Warunki ukończenia

- Kryteria mają wskazane dowody albo jawnie opisane ograniczenie weryfikacji.
- Nie ma znanego nierozwiązanego błędu blokującego zaakceptowany zakres.
- Recenzent wykonał własną ocenę; samo stwierdzenie autora „działa” nie jest dowodem.
- Wykonano kontrole odpowiednie do zmiany. Dla UI: rzeczywiste komponenty,
  używane szerokości, klawiatura, aktywna nawigacja i stany puste. Dla zachowania:
  istotne testy reguł i uprawnień. Nie dodajemy testów odtwarzających strukturę kodu.
- Nie powtarzamy pełnego odbioru po kosmetycznej zmianie, gdy wystarcza sprawdzenie
  jej wpływu. Zmiana zachowania, błąd lub otwarte ryzyko uzasadniają szerszą kontrolę.
- Raport rozróżnia kod przygotowany, sprawdzony lokalnie i opublikowany.

## Niezależność i uprawnienia

Nowe analizy i przeglądy zaczynają się w osobnych kontekstach. Koordynator
przekazuje materiał zadania, a nie całą historię przekonywania się do rozwiązania.
Osobne konteksty nie gwarantują niezależności błędów tego samego modelu.

Profile znajdują się w projektowym `.codex/agents/`, zgodnie z
[oficjalną dokumentacją Codex](https://learn.chatgpt.com/docs/agent-configuration/subagents).
Nie zmieniają konfiguracji globalnej ani nie tworzą usługi działającej bez przerwy.
Gdy interfejs narzędzia nie ma wyboru profilu, koordynator przekazuje odczytane
`developer_instructions` w zadaniu delegowanym. Nazwa zadania nie stanowi dowodu
załadowania profilu. Ostateczne uprawnienia określa aktywne środowisko; same
instrukcje roli nie są granicą bezpieczeństwa narzędzi.

Przy wspólnym katalogu pliki mają jednego właściciela. Agent biznesowy pracuje
odczytowo. Recenzent nie edytuje źródeł ani testów; może uruchamiać istniejące
kontrole i zapisywać tymczasowe wyniki w `.local/` lub `test-results/`, o ile
pozwalają na to faktyczne uprawnienia sesji. Koordynator nie udaje, że kontrola
została wykonana, jeśli nie mogła się uruchomić.

Żadna rola nie odczytuje niepotrzebnych sekretów ani nie umieszcza ich w raportach.
Zmiany produkcji, kont, danych, migracje i komunikacja z innymi osobami wymagają
autoryzacji wynikającej z aktualnego zakresu użytkownika. Nie pytamy ponownie o
działanie już autoryzowane. Publikacja wcześniejszej iteracji nie jest stałą zgodą
na przyszłe publikacje. Recenzent i agent biznesowy nie wykonują tych operacji.

## Format przekazania

**Biznes:** potrzeba → reguły i wyjątki → `AC-*` → otwarte decyzje → źródła.

**Technika:** mapowanie `AC-*` na rozwiązanie → pliki → kontrole → ograniczenia.

**Recenzent:** sprawdzone `AC-*` → uwagi z reprodukcją i wagą → zakres faktycznej
weryfikacji → sprawy niesprawdzone. Gdy brak uwag, napisz to wprost bez wymyślania
problemów. Autor nie może samodzielnie oznaczyć swojej zmiany jako zaakceptowanej.

Dla większych iteracji przechowujemy wspólny zapis w `docs/iterations/`.
Zrzuty, lokalne sesje i pełne logi pozostają w ignorowanych katalogach.

## Bieżąca iteracja

[Uproszczenia po audycie — lokalnie, 27.10](iterations/2026-10-27-uproszczenia-po-audycie.md):
po zgodzie użytkownika uzgodniono AC-01–22; biznes doprecyzował wyjątki aktywnych
zgłoszeń, technika realizowała trzy rozłączne zakresy, koordynator nawigację,
komponenty wspólne i integrację. Recenzent oceniał wymagania i rzeczywisty diff
z nowego kontekstu, bez zmian kodu; autorzy zamknęli odtworzone uwagi. Odbiór
obejmuje komponenty, responsywność i rzeczywiste lokalne ścieżki Next/Supabase.
Bez publikacji, migracji i uruchamiania integracji.

[Audyt prostoty — 26.10](iterations/2026-10-26-audyt-prostoty.md): niezależne
propozycje biznesowe i techniczne, osobna ocena ścieżki opiekuna oraz krytyka
konsolidacji przez recenzenta. Koordynator sprawdził lokalne widoki obu ról;
raport oddziela obserwacje przeglądarki od wniosków źródłowych i zmiany UI od
agregacji danych. Wyłącznie analiza i rekomendacje, bez implementacji i publikacji.

[Prostsza obsługa kursu — lokalnie, 26.10](iterations/2026-10-26-prostszy-kurs.md):
niezależne propozycje, AC-01–08 i źródłowa recenzja czterech plików UI,
oddzielna własność testów. Kompaktowy harmonogram z wyborem spotkania,
ustawienia i historia w dalszym planie; zasady zapisów i kwoty bez zmian.
Brak publikacji.

[Prostsze zalecenia przy psie — lokalnie, 26.10](iterations/2026-10-26-prostsze-zalecenia.md):
osobne propozycje biznesu i techniki, AC-01–08, jeden właściciel trzech plików UI,
niezależny przegląd i odbiór rzeczywistych komponentów oraz Next/Supabase.
Jeden widoczny plan i rozwijane opcje; reguły zapisu bez zmian. Bez publikacji.

[Obowiązkowy start nowych opiekunów — 26.10](iterations/2026-10-26-onboarding.md):
osobne propozycje biznesu i techniki, uzgodnione AC-01–14, implementacja w dwóch
rozłącznych zakresach oraz recenzja z nowego kontekstu. Prywatny brief i trwała
karta startu wyłącznie dla nowej kohorty; wcześniejsze konta zwolnione. Po
lokalnym odbiorze, świeżej kopii i odtworzeniu opublikowano kod i migrację 66,
bez aktywacji integracji. Odbiór hostingu 12 UI i 3 odmowy endpointów PASS.

[Publikacja i onboarding — 26.10](iterations/2026-10-26-publikacja-poprawek.md):
nowa zgoda na wdrożenie poprawek, świeża kopia i próba produkcyjnych danych,
publikacja kodu i migracji 61–65 z integracjami OFF. Odbiór hostingu i problem
starego PostgREST mają oddzielne dowody; restart nie zamyka potrzeby aktualizacji
infrastruktury. Osobne propozycje biznesu i techniki oceniają delikatny
przewodnik opiekuna bez implementacji w tamtym wydaniu; późniejszą osobną
realizację opisano powyżej.

[Odbiór przed płatnościami — 23.10](iterations/2026-10-23-gotowosc-platnosci.md):
niezależny brief biznesowy i techniczny, AC-R01–R20, lokalne poprawki płatności,
SMTP Auth oraz osobna kolejka maili biznesowych. Recenzent odtwarza problemy
przed konfrontacją z autorami. Audyt obejmuje też zależności, realne lokalne
wyścigi PostgreSQL, UI, kopię i odtworzenie oraz pilot 50+1. Wyniki i otwarte
bramki integracji zapisano w iteracji; zakres nie obejmuje publikacji,
zewnętrznej wysyłki, prawdziwych opłat ani zakupu Pro.

[Odbiór przed pierwszymi użytkownikami](iterations/2026-10-16-odbior-pierwsi-uzytkownicy.md):
16.10 użytkownik zlecił szczegółowe testy, naprawy i publikację przed pilotażem
do 50 prawdziwych opiekunów. Wybrał ręczne prywatne linki bez SMTP.
Weryfikujemy logowanie, role, usługi, zalecenia, pieniądze, przerwania połączenia,
kolejki, odtworzenie danych i obciążenie. Poprawki oraz narzędzie dostępu
przeszły niezależne przeglądy. Poprawki i dwie migracje opublikowano 16.10;
1477 testów jednostkowych i końcowy lokalny pilot 50+1 zaliczone. Główna domena
wskazuje gotowy build; 28 odczytowych kontroli hostingu zaliczone. Wynik lokalny nie jest
dowodem pojemności zarządzanej produkcji. Nie tworzymy prawdziwych kont bez
listy odbiorców. Przed zaproszeniami pozostają kopie produkcji i Storage;
użytkownik odłożył zmianę płatnego planu Supabase.

[Belka podczas przewijania](iterations/2026-10-16-belka-przewijanie.md):
korekta po feedbacku z 16.10. Górny nagłówek przewija się z dokumentem w obu
panelach i nie zasłania treści. Pełny lokalny odbiór objął 95 wariantów stron;
użytkownik 16.10 zatwierdził publikację tej poprawki. Wdrożenie zakończone:
8/8 produkcyjnych wariantów, oferta z niepustą listą, bez błędów i zapisów biznesowych.

[Usunięcie dopisku fotografa](iterations/2026-10-15-watermark.md): bezpośrednia
korekta opublikowanych zdjęć po prośbie użytkownika. Retusz ograniczony do znaku,
reszta pikseli zachowana. Wydanie dotyczy wyłącznie czterech fotografii i ich ścieżek.
Opublikowane 15.10, z potwierdzeniem czterech plików, optymalizacji i loginu
na telefonie oraz komputerze.

[Fotografie w panelu](iterations/2026-10-15-fotografie-panelu.md): cztery
oryginalne fotografie przekazane przez użytkownika, para przy logowaniu
i delikatne tła przypisane do sekcji obu ról. Użytkownik 15.10 zatwierdził
publikację razem z paletą i formularzem kursu. Wydanie z 15.10 jest online:
13 widoków, 52 warianty produkcyjnego UI, bez błędów i zapisów biznesowych.

[Brzoskwinia i miejsce kursu](iterations/2026-10-15-brzoskwinia-miejsce-kursu.md):
lokalny kandydat po feedbacku z 15.10. Brzoskwiniowe wyróżnienia, terakotowe
akcenty, osobna czerwień zaległości, czytelna sekcja miejsca kursu i tekst
logowania ze wsparciem specjalisty. Publikacja zatwierdzona przez użytkownika
15.10 razem ze zdjęciami, po lokalnym odbiorze; wdrożenie zakończone, bez zmian DB.

[Spokojny kalendarz](iterations/2026-10-14-spokojny-kalendarz.md): miesiąc jako
widok początkowy, pasek dni z agendą tygodnia i płynne tło. Asia jest jedyną
prowadzącą, wybraną w DB. Autor będący administratorem nie zostaje prowadzącym.
Globalna dostępność obejmuje także zachowane historyczne UUID/null. Publikacja
14.10 po osobnej zgodzie użytkownika, z testami migracji i konkurencji.

[Marka, oferta i profil](iterations/2026-10-14-marka-oferta-profil.md): oryginalne
logo i hasło, fotografie, uproszczony wybór formy pracy, edycja własnego profilu
oraz bezpośredni kontakt WhatsApp. Lokalny odbiór i publikacja po osobnej zgodzie
użytkownika są zakończone. Kolejne zmiany nadal powstają lokalnie i wymagają
autoryzacji publikacji w swoim zakresie. ClickMeeting i MailerLite pozostają
na koniec.

[Funkcje po feedbacku](iterations/2026-10-13-funkcje-po-feedbacku.md):
rozdzielenie zaleceń według usług, dostępna oferta i Web Push; dalsze reguły
kontroli, Psiutków i raportowania zgodnie z odpowiedziami użytkownika.
Zachowujemy wynik „Spokojnego startu”. Po lokalnym odbiorze użytkownik osobno
autoryzował publikację; wydanie z 13.10 jest online. Kolejne zmiany nadal
powstają lokalnie i nie dziedziczą automatycznie zgody na publikację.
Logo i hasło dodano w późniejszej iteracji z 14.10; ClickMeeting i MailerLite
pozostają odłożone.
