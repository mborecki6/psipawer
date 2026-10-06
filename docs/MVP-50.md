# Psi Pawer — plan MVP dla 50 opiekunów i jednej behawiorystki

Dokument zakresu i kolejności prac z 18.09.2026. Lokalny MVP ukończono i odebrano 03.10.2026; [aktualny wynik i przygotowania do live](PRODUCT-STATUS.md) są osobnym zapisem. Poniższy stan początkowy i proponowana kolejność pozostają historią planowania, nie opisem obecnej produkcji ani uruchomieniem klientów.

Aktualizacja po rozpoczęciu prac: pierwszy moduł „Plany pracy i postępy” został zaimplementowany lokalnie. [Opis funkcji, ograniczenia i uruchomienie](CARE-MODULE.md). Tabela stanu początkowego poniżej opisuje sytuację sprzed tej implementacji.

Decyzja użytkownika: rozwijamy i dopracowujemy cały uzgodniony zakres lokalnie, bez aktualizowania produkcji ani bazy w chmurze. [Tryb pracy i następne kroki](LOCAL-DEVELOPMENT.md). Powstały już lokalne konsultacje, zaproszenia i rzeczywiste testy obu ról; [aktualny stan i brakujące warunki odbioru](PRODUCT-STATUS.md) oddziela je od początkowego stanu opisanego niżej.

## Cel i założenia

Dodano lokalnie [usługi i cennik](SERVICES-MODULE.md) na podstawie strony Psi Pawer: 17 wariantów po robocze 100 zł, edycja przez prowadzącą i zachowanie warunków nowych zgłoszeń. Kursy mają oba panele, spotkania, zgłoszenia, obecności i ich korekty, rozliczenia, zalecenia, edycję nazwy/limitu, powrót po odmowie lub rezygnacji oraz powiadomienia i przypomnienia. Pozostały zakres kursów, fitness w pakiecie i realizację kart podarunkowych określa [aktualny stan produktu](PRODUCT-STATUS.md).

Opiekun potrafi wejść do aplikacji, odnaleźć swojego psa, umówić spotkanie, przeczytać zalecenia i przekazać informację o postępach. Behawiorystka obsługuje cały ten proces w jednym miejscu, bez przepisywania danych i odtwarzania materiałów z różnych plików.

Pierwszy zakres: jedna praktyka, jedna behawiorystka, do 50 kont opiekunów oraz konto administratora technicznego. Jeden opiekun może mieć kilka psów. Liczba 50 oznacza wielkość pilota, nie potwierdzoną przepustowość ani 50 jednoczesnych konsultacji.

Do odpowiedzi na pytanie o skład pilota przyjmujemy roboczo wejście przez zaproszenia. Jeśli dominować będą nowi klienci, pierwsze zgłoszenie i wybór usługi przesuwamy przed rozbudowę biblioteki zaleceń. Zaproszenie samo w sobie nie oznacza kwalifikacji psa do zajęć.

## Stan początkowy sprawdzony w repozytorium

| Obszar               | Stan                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dostęp               | Logowanie hasłem, jednorazowa aktywacja i ustawienie własnego hasła. Brakuje kompletnego procesu obsługi zaproszeń i samodzielnego odzyskiwania dostępu dla grupy pilota. |
| Psy                  | Profile, kwestionariusz, kwalifikacja, prywatne i udostępniane notatki, zdjęcia.                                                                                          |
| Spacery              | Terminy, zapisy, akceptacja, rezerwa, rezygnacje, odwołanie, obecności.                                                                                                   |
| Rozliczenia          | Ewidencja wpłat otrzymanych poza aplikacją i pakietów wejść; bez operatora płatności.                                                                                     |
| Zalecenia i postępy  | Brak pełnego procesu: biblioteka → indywidualny opublikowany plan → odpowiedź opiekuna.                                                                                   |
| Konsultacje          | Brak odrębnej ścieżki konsultacji indywidualnej z planem i kontaktem kontrolnym.                                                                                          |
| Automatyzacje        | Brak wdrożonego procesu przypomnień i monitorowania ich dostarczenia.                                                                                                     |
| Dostęp wielu praktyk | Obecne role admin/client są globalne; nie stanowią izolacji między praktykami.                                                                                            |

18.09.2026 ponownie uruchomiono lokalny zestaw Vitest: **145 testów w 16 plikach zakończyło się poprawnie**. Obejmuje lokalne testy logiki i bazy. Nie uruchamiano w tej sesji testu przeglądarkowego, testu obciążenia, wysyłki poczty ani audytu działającej produkcji. Wynik nie potwierdza gotowości nowych funkcji opisanych poniżej.

## Zakres pierwszej wersji

### Dla opiekuna

- Zaproszenie, ustawienie hasła, logowanie i odzyskanie dostępu.
- Krótki profil opiekuna i psa, uzupełniany stopniowo; dane podaje się raz.
- Najbliższe spotkanie i czytelny status zapisu. Minimalna konsultacja indywidualna z terminem zatwierdzanym przez prowadzącą oraz istniejące zapisy na spacery.
- Aktualne zalecenia przypisane do psa i historia opublikowanych wersji.
- Prosta odpowiedź o postępach: co zrobiono, co się udało, co było trudne. Brak wpisu nie jest oceną realizacji ćwiczeń.
- Widoczne należności i odnotowane wpłaty, z jednoznaczną informacją, jak rozliczyć spotkanie.

### Dla behawiorystki

- Lista podopiecznych i spraw wymagających działania: zgłoszenia, nowe odpowiedzi, zaplanowany kontakt kontrolny.
- Karta psa łącząca historię spotkań, dokumentację, udostępnione plany i postępy.
- Krótka biblioteka własnych materiałów; wybór, personalizacja, zapis szkicu i publikacja planu.
- Prywatne notatki wyraźnie oddzielone od materiałów dla opiekuna.
- Obsługa terminów, uczestnictwa i dotychczasowej ewidencji rozliczeń.

Psiutki pozostają istniejącym modułem, ale ich rozbudowa i zmiana reguł dopasowania nie są warunkiem uruchomienia tego pilota. Abonament dla innych specjalistów, własny komunikator, automatyczne grupowe wiadomości WhatsApp, AI, OCR i rozbudowany sklep trafiają do późniejszego etapu.

## Kolejność budowy

| Etap                               | Dostarczany rezultat                                                                                   | Warunek odbioru                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 0. Przygotowanie pracy             | Oddzielne środowisko testowe, fikcyjne konta, zapis granic modułów i mapa obecnych uprawnień.          | Testy i nowe migracje można wykonać bez dotykania danych pilota; znana jest ścieżka odtworzenia danych.              |
| 1. Zalecenia i postępy             | Pierwsza kompletna funkcja dla obu stron, osadzona w istniejącej karcie psa.                           | Behawiorystka publikuje plan; właściwy opiekun go czyta i odpowiada; odpowiedź wraca do właściwego psa.              |
| 2. Wejście i spotkanie             | Obsługa zaproszeń, odzyskanie dostępu, krótki start, konsultacja i spójny ekran najbliższych działań.  | Nowa osoba przechodzi ścieżkę na telefonie; prowadząca widzi zgłoszenie i może ustalić termin.                       |
| 3. Kontakt kontrolny               | Termin pytania o postępy, trwałe zadania, powiadomienia w aplikacji i e-mail po konfiguracji dostawcy. | Zmiana lub odwołanie spotkania aktualizuje zadania; ponowienie nie tworzy duplikatów; błędy są widoczne prowadzącej. |
| 4. Próba i stopniowe udostępnienie | Testy pełnego procesu, weryfikacja uprawnień, obciążenia i obsługi problemów.                          | Kolejne grupy dołączają dopiero po przejściu warunków opisanych niżej.                                               |

Konfiguracja poczty biegnie równolegle z etapem 1. Nie blokuje lokalnego budowania planów i postępów, ale ma być gotowa przed zapraszaniem klientów w proponowanym procesie opartym na e-mailu.

## Pierwsze konkretne zadanie: plan pracy i odpowiedź opiekuna

Minimalny model:

- Biblioteka materiałów praktyki, z tytułem i treścią.
- Plan przypisany do psa, z autorem, szkicem i datą publikacji.
- Opublikowana wersja zachowuje własną treść. Edycja materiału w bibliotece nie zmienia wcześniej przekazanych zaleceń.
- Odpowiedź opiekuna ma psa, konkretną wersję planu, autora i czas zapisu.
- Termin kontaktu kontrolnego jest ustawiany przez prowadzącą; nie przyjmujemy automatycznie jednej częstotliwości dla każdej usługi.
- Zapis publikacji tworzy zdarzenie do późniejszego powiadomienia w tej samej transakcji. Dostawca komunikacji jest podłączany oddzielnie.

Pierwszy pokaz funkcji odbywa się na fikcyjnych danych w dwóch rolach. Nie wymaga wcześniejszego dodawania prawdziwych klientów.

Scenariusze odbioru:

1. Opiekun widzi wyłącznie plany udostępnione jego psom; szkic i prywatna notatka pozostają niewidoczne.
2. Publikacja, ponowienie zapisu i równoczesna edycja nie tworzą sprzecznych wersji.
3. Zmiana szablonu nie nadpisuje opublikowanego planu.
4. Odpowiedź opiekuna jest widoczna w karcie właściwego psa i na liście spraw prowadzącej.
5. Formularz zachowuje treść po błędzie; obsługa na małym ekranie nie wymaga przesuwania całej strony w poziomie.

## Architektura adekwatna do pilota

Pozostają Next.js, TypeScript i Supabase. Nową logikę grupujemy według modułów biznesowych. Widoki wywołują określone operacje modułu; nie stają się miejscem przechowywania reguł procesu.

Rdzeń zachowuje transakcyjną spójność zapisów i rozliczeń. Osobny proces obsługuje trwałe zadania komunikacyjne z ponowieniami, rejestrem prób i ochroną przed duplikatami. Pierwszy pilot nie wymaga niezależnego serwera ani bazy dla każdego modułu.

Model nowych funkcji ma jawne powiązanie z praktyką. Przed uruchomieniem drugiej praktyki potrzebna będzie pełna migracja członkostwa, ról, danych, plików i polityk dostępu wraz z testami między praktykami. Samo dodanie identyfikatora praktyki do nowych tabel nie zapewnia tej izolacji. W pilocie jednej praktyki nadal sprawdzamy granicę między każdym opiekunem a pozostałymi kontami.

Podczas pilota mierzymy czas odpowiedzi i liczbę pobieranych rekordów. Obecne zbiorcze pobieranie całej historii warto zastępować zapytaniami dla konkretnego ekranu w miejscach, w których pomiary pokażą potrzebę.

## Poczta i dostęp — zależność do rozwiązania

Proponujemy pozostać przy logowaniu hasłem i zapewnić zaproszenie oraz reset hasła przez pocztę. Wcześniejsze odłożenie zaproszeń klientów pozostaje aktualne do przygotowania i sprawdzenia tego procesu.

Potrzebne są dostawca wysyłki, uprawniony adres nadawcy oraz konfiguracja domeny wymagana przez wybranego dostawcę. Administrator domeny psipawer.pl może wykonać potrzebne zmiany; dane dostępowe nie powinny trafiać do planu ani repozytorium.

Domyślny SMTP Supabase jest przeznaczony do testów i ogranicza odbiorców do adresów zespołu projektu. Nie zakładamy, że obsłuży 50 klientów, ani nie dodajemy klientów do zespołu administracyjnego jako obejścia.

Źródło sprawdzone 18.09.2026: [Supabase — custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Warunki rozpoczęcia pilota i rozwoju do 50 osób

- Pełny przebieg na telefonie: zaproszenie → hasło → profil → spotkanie → zalecenia → odpowiedź → ponowne logowanie. Osobno odzyskanie dostępu, wygasły link i ponowienie zaproszenia.
- Testy odrzucenia odczytu i zmiany cudzych danych, prywatnych notatek oraz cudzych plików, także przez bezpośrednie żądanie.
- Próby równoczesnego zapisu na ostatnie miejsce, ponownego zatwierdzenia oraz odwołania spotkania; historia i rozliczenia pozostają zgodne.
- Dostarczenie wiadomości na skrzynki testowe, obsługa błędu dostawcy i brak duplikatów po ponowieniu. Obciążenie nie wysyła wiadomości do realnych klientów.
- Powtarzalny scenariusz obciążenia na 50 fikcyjnych kontach i realistycznej historii. Osobno krótki test do 50 jednoczesnych sesji; zapis czasu odpowiedzi p95 i błędów. Proponowany cel startowy: p95 operacji aplikacji poniżej 2 sekund w opisanym środowisku testowym, bez przekroczenia pojemności zajęć i bez podwójnego obciążenia. To cel do pomiaru, nie osiągnięty wynik.
- Monitorowanie błędów i nieudanych zadań bez zapisywania treści prywatnych notatek, haseł czy tokenów; wskazana osoba do obsługi problemów.
- Sprawdzony sposób wykonania i odtworzenia kopii danych oraz plików, ustalony z uwzględnieniem używanego planu hostingu.

Proponowana kolejność udostępnienia: zespół na danych testowych → 5 opiekunów → 15 → 50. Przejście zależy od poprawnego ukończenia procesu i usunięcia problemów blokujących, nie od samego upływu czasu. Nie oznacza to zgody na automatyczną wysyłkę zaproszeń.

## Jak ocenimy wartość MVP

- Czy opiekun samodzielnie kończy pierwszy proces i odnajduje zalecenia?
- Ile czasu zajmuje prowadzącej przygotowanie i publikacja planu względem obecnej pracy?
- Ile wiadomości poza systemem nadal potrzeba do umówienia i obsługi spotkania?
- Czy odpowiedzi o postępach pomagają zaplanować dalszą pracę?
- Ile spraw prowadząca musi ręcznie odtwarzać po błędach lub zmianach?

Przed pilotem zapisujemy punkt odniesienia i uzgadniamy oczekiwane wyniki. Sama liczba 50 utworzonych kont nie jest miarą sukcesu.

## Decyzje potrzebne przed odpowiednimi etapami

1. Skład pilota: obecni klienci, nowi czy grupa mieszana — pytanie zadane użytkownikowi.
2. Usługi pierwszej wersji, kwalifikacja przed zapisem oraz zasady zmian i rezygnacji. Dotychczasowych zasad spacerów nie zmieniamy przez samo dodanie konsultacji.
3. Nadawca i dostawca poczty. Konfiguracja poczty autoryzacyjnej nie oznacza automatycznie gotowej wysyłki przypomnień z aplikacji.
4. Sposób odnotowania płatności na czas pilota. Operator internetowy nie jest warunkiem pierwszego zakresu, chyba że użytkownik uzna przedpłatę w aplikacji za konieczną.
5. Kilka rzeczywistych typów zaleceń i pytań o postępy do uzgodnienia z behawiorystką; nie tworzymy zaleceń specjalistycznych w jej imieniu.

Powyższe decyzje nie blokują przygotowania modułu planów i postępów na fikcyjnych treściach.
