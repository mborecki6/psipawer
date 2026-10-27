# Podgląd płatności online — 27.10.2026

## Zakres i zgoda

Podczas zatwierdzonej publikacji uproszczeń użytkownik rozszerzył zakres:
„mozesz wdrozyc plantosci wizualnie, po prostu pozniej aktywujemy modul payU albo
tpay, ale wizualnie juz wdrozmy jako placeholder i przeklik”. Zgoda obejmuje
wdrożenie klikalnego podglądu, bez uruchamiania bramki lub symulatora w chmurze.

Biznes i technika przygotowały osobne propozycje na podstawie tego samego briefu.
Koordynator przyjął poniższe kryteria przed implementacją. Podgląd korzysta
z istniejącego adresu i danych należności; nie jest demonstracyjną wpłatą.
Wybór i odbiór operatora, SMTP i aktualizacja Supabase pozostają osobnym etapem.

## Kryteria akceptacji

| AC     | Wymaganie                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-P01 | Opiekun otwiera jawnie nazwany „Podgląd płatności online” z własnej przyjętej, wycenionej, nierozliczonej usługi: spacer, konsultacja, kurs lub fitness.                                                                              |
| AC-P02 | Podsumowanie pokazuje aktualnego psa, usługę, termin, wcześniejsze wpłaty i pozostałą kwotę z istniejących rozliczeń. 100 zł minus wpłata 40 zł daje 60 zł. Zmiana URL nie ujawnia cudzego rekordu.                                   |
| AC-P03 | Nieprzyjęte, rezerwowe, odrzucone, anulowane, rozliczone i wymagające uzgodnienia usługi nie otrzymują podglądu płatności. Bezpośredni adres ma stan niedostępności. Istniejące przyjęcie automatyczne spaceru nadal się kwalifikuje. |
| AC-P04 | Otwarcie, ponowienie, odświeżenie i powrót tworzą zero prób, wpłat, zmian salda, przyjęć i rezerwacji. Bez wywołań operatora, symulatora lub poczty.                                                                                  |
| AC-P05 | Komunikat wyraźnie wskazuje niedostępność płatności online. Bez aktywnego „Zapłać”, kodu BLIK, formularza rozpoczęcia, statusu sukcesu i deklaracji integracji PayU. Działają linki do usługi i rozliczeń.                            |
| AC-P06 | Bez nowego zakupu pakietów spacerowych i kart. Bez zmian flag operatora/symulatora, SMTP, zaproszeń, bazy oraz zasad pieniędzy.                                                                                                       |
| AC-P07 | Ewidencja wpłat Asi i prawdziwe historie obu ról pozostają dostępne. Istniejąca creating/pending/uncertain/requires_review zachowuje ostrzeżenie; podgląd nie konkuruje z nią jako nowa płatność.                                     |
| AC-P08 | Telefon 320/390 px, komputer i klawiatura pozwalają odczytać kwotę, otworzyć podgląd i wrócić. Nieprawidłowy/cudzy/niedostępny cel i błąd odczytu mają czytelne stany, bez rzekomego rozpoczęcia płatności.                           |

## Własność i odbiór

Technika: typ i model kwalifikacji w `lib/finance.ts`, widok finansów i wiersz
należności, strona `app/payments/new`, odczytowy widok płatności, ewentualne
lokalne CSS i przypisane testy. Istniejące actions/runtime/config/provider,
konfiguracja infrastruktury oraz migracje są poza zakresem zmian.

Koordynator: lokalny rzeczywisty przeklik, kontrola salda/prób, dokumentacja
i publikacja. Recenzent oceni wymagania i faktyczny diff bez edycji aplikacji.

## Odbiór lokalny

Zaimplementowano powyższy zakres bez zmian actions/runtime/config/provider ani
migracji. Osobna kwalifikacja online nie rozszerza zwykłego `canPay` (które
obejmuje też część rozliczeń po rezygnacji). Istniejąca aktywna próba zachowuje
ostrzeżenie i odsyłacz; nie promujemy nowej płatności.

- Pełny zestaw **2057/2057 testów, 144 pliki PASS** po rozszerzeniu wydania.
  Lokalny build Next.js, TypeScript, lint i formatowanie PASS.
- Niezależny recenzent: własne **92/92 testy PASS** i źródłowa kontrola izolowanego
  diffu, bez nowych blokerów. Własność/RLS i granice operatora zachowane.
- Rzeczywisty Next/Supabase: **jeden scenariusz Chromium i jeden WebKit PASS**.
  Przyjęty kurs 100 zł, wpłata 40 zł, podgląd 60 zł; 320/390/1440 px, powrót do
  usługi i rozliczeń, odświeżenie, błędny cel i inne konto odmawiające dostępu.
  WebKit otwiera podgląd klawiaturą. Porównanie salda, wersji, wpłat i prób przed/po
  potwierdziło brak zmian oraz zero nowych prób; guard nie odnotował żądań zapisu
  lub ruchu do operatora. Własne dane scenariusza usunięto.
- Pierwszy test przeglądarkowy zatrzymał się na błędnie zagnieżdżonym selektorze
  testu podsumowania. Doprecyzowano selektor; aplikacja nie wymagała korekty.

To nie jest test operatora, odbiór prawdziwego BLIK ani symulowana wpłata.
Publikację i odczytowy odbiór hostingu opisze osobny zapis wydania.

## Późniejsza publikacja

Po osobnej zgodzie użytkownika zmianę opublikowano w wydaniu z 27.10.
[Zapis publikacji i odbioru](2026-10-27-publikacja-uproszczen.md) podaje bieżącą
wersję hostingu; powyższy zapis zachowuje dowody pierwotnego odbioru lokalnego.
