# Marka, spokojniejsza oferta i edycja profilu

Zakres użytkownika z 14 października 2026. Po lokalnym odbiorze użytkownik
zatwierdził wygląd i osobno zlecił publikację. Wersja działa online.
Logo i hasło zostały teraz wyraźnie zlecone; wcześniejsze odłożenie ich na koniec
nie obowiązuje w tym zakresie. ClickMeeting i MailerLite pozostają poza iteracją.

## Uzgodnione kryteria

- AC-01: oryginalne logo ze strony Psi Pawer i dokładne hasło
  „Problemy to wyzwania, którym stawiaMY czoła!” na logowaniu i w panelu.
- AC-02: autentyczne zdjęcia na logowaniu i delikatne tło panelu; czytelność,
  brak przewijania poziomego przy 320/390 px i na desktopie; telefon pokazuje
  formularz logowania przed sekcją zdjęć.
- AC-03: oferta opiekuna zaczyna się od Indywidualne / Grupowe. Lista dopiero
  po wyborze, działające odnośniki kategorii, przełączanie i powrót.
- AC-04: zachowanie istniejących klasyfikacji, cen i ścieżek zapisów;
  nieprzypisana oferta jest dostępna pod podporządkowanym odnośnikiem.
- AC-05: voucher poza listą i licznikami usług opiekuna; osobny produkt w
  Więcej → Karty podarunkowe. Zachowane wystawianie, aktywacja, saldo, historia
  oraz zarządzanie cenami przez prowadzącą. Bez nowego procesu płatności.
- AC-06: kliknięcie nazwy / „Panel opiekuna” otwiera edycję własnego profilu;
  zapis, błędy, powrót właściwy dla roli i obsługa klawiaturą.
- AC-07: edycja istniejącej nazwy full_name widocznej w panelu, telefonu i okolicy.
  E-mail służy do logowania i jest tylko do odczytu. Nie dodajemy osobnego
  publicznego username ani migracji bazy: użytkownik prosi o edycję informacji,
  a pole full_name już pełni funkcję nazwy wyświetlanej.
- AC-08: po odczycie VCF użytkownik wybrał bezpośredni czat z kontaktem Psi Pawer,
  zamiast grupy. Pływający przycisk opiekuna otwiera https://wa.me/48695351796.
  Bez automatycznej wiadomości i danych konta w adresie. Dostępny klawiaturą,
  z miejscem na dole strony, ukryty w prywatnym czacie aplikacji oraz podczas
  edycji pól na telefonie.
- AC-09: lokalny build, ukierunkowane testy i rzeczywisty odbiór przeglądarkowy;
  obie role, zmiana własnego profilu i odmowa zmiany cudzego; niezależny przegląd.
  Produkcja wymaga autoryzacji użytkownika dla tej iteracji.

## Źródła materiałów

Witryna: https://www.psipawer.pl/ i https://www.psipawer.pl/omnie.
Hasło pochodzi z wcześniej przekazanego feedbacku behawiorystki.
Kontakt został podany przez użytkownika w „Psi Pawer.vcf”.

- Logo: https://static.wixstatic.com/media/847aaa_05adfa545c254efd8c5ded1e77d39b96~mv2.png
- Asia z psami: https://static.wixstatic.com/media/847aaa_76fb18055f034e568a1e09bf7dfb5815~mv2.jpg
- Portret: https://static.wixstatic.com/media/847aaa_2fbe374451e74b239d61137be16aed66~mv2.jpg
- Psy na łące: https://static.wixstatic.com/media/847aaa_971def1d59344131b46ca39d4a0f7618~mv2.jpg

Materiały są przechowywane lokalnie w public/brand. Fotografie zoptymalizowano
do WebP; logo zachowuje oryginalną przezroczystość i proporcje.

## Odbiór lokalny

- Lokalny build Next.js zakończony poprawnie; serwer podglądu działa na localhost:3000.
- 25 ukierunkowanych testów profilu, kategorii i dostępu do kont przeszło.
- Test rzeczywistej aplikacji dla obu ról przeszedł: wejście bez sesji, zapis
  własnego profilu i odświeżenie nazwy, klawiatura/menu mobilne, odmowa zmiany
  cudzego profilu, wybór obu kategorii, przekierowanie vouchera i WhatsApp.
- Ten sam test potwierdził odświeżenie i zapis cookies po symulowanym wygaśnięciu
  sesji w jej lokalnym cache. Nie modyfikowano podpisanego JWT.
- Runner katalogu: 28 scenariuszy przy różnych szerokościach, obsługa wyboru,
  bezpośrednie linki, powrót, `other`, puste kategorie, brak vouchera u klienta,
  zachowany edytor cen i jego stany błędów — poprawnie.
- Obejrzenie lokalnego logowania w przeglądarce Codex oraz zrzutów mobilnych
  i desktopowych; poprawiono wygaszenie zdjęcia tła i powierzchnię kart wyboru.
- Niezależny recenzent zamknął uwagi: dodano /profile do proxy sesji oraz
  poprawiono testowy odczyt set-cookie na Playwright allHeaders(). Brak otwartych
  uwag w sprawdzonym zakresie.
- ESLint całego projektu i sprawdzenie TypeScript bez błędów. Bez migracji
  bazy oraz publikacji produkcyjnej. Tymczasowe konta testowe były lokalne.

Logi i zrzuty pozostają w .local/brand-refresh-20261014 oraz test-results.

## Publikacja i odbiór hostingu — 14.10.2026

Kod `9a2a60e` opublikowano na produkcyjnej gałęzi `main`. Vercel zakończył
build `dpl_Cio7PTJqANyejY6VoaB1BPJBAV4J` ze stanem READY; publiczny alias
[psipawer.vercel.app](https://psipawer.vercel.app/login) wskazywał ten build.
Późniejszy commit dokumentacji może utworzyć kolejny build z tym samym kodem.

Odczytowy test hostingu przeszedł 11 kontroli tras (w tym przekierowanie
vouchera) i 30 wariantów responsywności: 10 ekranów przy 320/390/1440 px.
Sprawdzono logowanie, oba panele, ofertę i obie kategorie, karty podarunkowe,
własny profil, odnośniki edycji i powrotu oraz WhatsApp. Trzy anonimowe
wejścia do stron chronionych przekierowano do logowania. Cztery publiczne
zasoby marki mają te same skróty co pliki przygotowane lokalnie.

Nie wystąpiły błędy skryptów ani konsoli i nie wykonywano zapisów biznesowych.
Użyto istniejących kont i własnych tymczasowych sesji Auth, bez zmiany haseł,
zaproszeń lub wysyłania e-maili. Sesje tej próby zakończono. Zapis profilu
oraz odmowę zmiany cudzego sprawdzono wcześniej w lokalnym E2E; odbiór online
był odczytowy. Nie klikał on kontaktu WhatsApp ani nie wysyłał wiadomości.

Wydanie nie zawiera migracji ani zmian konfiguracji Supabase/Vercel;
baza nadal korzysta z 57 wcześniejszych migracji. Publiczny przycisk kontaktu
nie jest integracją wysyłającą automatyczne wiadomości WhatsApp. Prywatny czat
Psiutków i kanały powiadomień zachowują dotychczasową implementację.
Raport i zrzuty pozostają w ignorowanym .local/brand-release-20261014.
