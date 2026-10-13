# Kontrola i uprawnienia do raportowania

Uzupełnienie AC-08 i AC-10 iteracji po feedbacku. Użytkownik potwierdził datę
kontroli wybieraną przez behawiorystkę oraz konfigurowalne raportowanie i okres.
Implementacja oraz odbiór są lokalne; bez wysyłki do chmury i bez publikacji.

## AC-08

- Szkic ma niezależną opcjonalną datę zaproszenia opiekuna do **zgłoszenia
  konsultacji kontrolnej**. Dotychczasowy `follow_up_on` jest zadaniem zespołu.
- Zaproszenie powstaje dopiero przy publikacji, dla jej psa i dokładnego
  kontekstu. Migracja nie tworzy zaproszeń z historycznych dat.
- W wybranym dniu o 9:00 Europe/Warsaw istniejący trwały proces przypomnień
  zapisuje jedną prośbę w skrzynce. Jest to ta sama konwencja daty bez godziny
  co przy istniejących kontaktach kontrolnych, nie przypomnienie 24 h.
- Link otwiera zwykły formularz zgłoszenia konsultacji z ustalonym psem.
  Opiekun wybiera aktualną usługę i opisuje potrzebę. Zapis nie rezerwuje
  terminu ani nie zamyka zadania prowadzącej. Dwa formularze i ponowienie
  prowadzą do jednego zgłoszenia przypisanego do zaproszenia.
- Nowa publikacja zastępuje tylko otwarte zaproszenie tego samego kontekstu.
  Prowadząca może zmienić datę albo wycofać zaproszenie. Poprzednia generacja
  przypomnienia i jej nieaktualna pozycja w skrzynce są wycofywane; zachowujemy
  historię zaproszenia oraz prób dostarczenia. Dostarczonego systemowego push
  nie da się cofnąć; otwarcie zawsze sprawdza bieżący stan.
- Zmiana opiekuna odbiera dostęp do zaproszenia staremu opiekunowi i nie
  przenosi automatycznie jego zaproszenia ani zgłoszenia na nowego.

## AC-10

- Oferta ma osobne ustawienie: raportowanie włączone oraz opcjonalna liczba
  dni. Domyślnie włączone bez limitu. Brak nazw pakietów i zmian cen.
- Przy nowym zgłoszeniu konsultacji, kursu lub fitness zapisujemy niezmienny
  snapshot ustawienia usługi. Zmiana oferty dotyczy następnych przypisań.
  Stare przypisania zachowują włączony, nielimitowany dostęp.
- Okres startuje przy pierwszej publikacji dla tego przypisania. Wszystkie
  spotkania tego samego kursu/pakietu dzielą okres; kolejne publikacje go nie
  odnawiają. Początek i koniec są widoczne w panelu zaleceń. To zapobiega
  wygaśnięciu dostępu podczas oczekiwania na pierwsze zalecenia.
- Prowadząca może jawnie włączyć/wyłączyć raportowanie albo ustawić koniec
  dostępu lub brak limitu dla konkretnego przypisania, z notatką i audytem.
  Ogólny plan psa ma domyślnie dotychczasowy dostęp bez limitu.
- UI oraz `submit_care_progress` sprawdzają to samo uprawnienie. Wygaśnięcie
  blokuje nowe odpowiedzi; poprawne ponowienie już zapisanego raportu pozostaje
  idempotentne. Historycznych raportów i odczytu zaleceń nie usuwamy.

## Weryfikacja

Testy SQL obejmują izolację opiekunów, konteksty, ponowienia, wycofanie,
zmianę daty i opiekuna, brak backfill, snapshot polityki, wspólny okres sesji,
domyślne zachowanie dawnych danych, jawny override i historię po wygaśnięciu.
Dwa rzeczywiste scenariusze E2E przeszły na końcowym lokalnym buildzie:
prośba o kontrolę z dwóch kart tworzy jedno zgłoszenie, a zmiana cennika nie
zmienia istniejącego uprawnienia i serwer odrzuca raport ze starego formularza
po wygaśnięciu. Wcześniejsze odpowiedzi pozostają widoczne. [Łączne wyniki
i granice odbioru](2026-10-13-funkcje-po-feedbacku.md#wyniki).
