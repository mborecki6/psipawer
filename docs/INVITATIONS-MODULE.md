# Zaproszenia i lokalne konta testowe

Stan lokalny: 02.10.2026. Migracje `202609190006_client_invitations.sql`, `202610020001_invitation_history.sql`, `202610020002_invitation_password_status.sql` i `202610020003_invitation_archive.sql`, moduł `src/modules/invitations/`. Nie zastosowano zmian w chmurze ani nie zaproszono rzeczywistych klientów.

## Praca prowadzącej

**Psy i opiekunowie → Zaproszenia opiekunów** otwiera `/admin/invitations`. Przygotowanie imienia i adresu zapisuje szkic na liście, bez tworzenia konta Auth i bez wysyłki. Panel jest dostępny tylko zespołowi, także przy bezpośrednim wywołaniu operacji.

Adres jest normalizowany do małych liter i ma jeden wpis. Powtórne zapisanie tego samego formularza zachowuje istniejący wpis. Inna próba dla tego samego adresu wskazuje, że jest on już na liście. Adres już potwierdzonego konta albo konta zespołu nie otrzymuje nowego zaproszenia; istniejący opiekun korzysta z odzyskania hasła. Moduł nie nadaje roli administratora i nie usuwa ani nie blokuje kont.

Wysyłka wymaga osobnego kliknięcia. Jest obecnie ograniczona do lokalnego Supabase i lokalnego adresu aplikacji oraz dwóch włączonych flag: `AUTH_EMAIL_ENABLED` i `CLIENT_INVITATIONS_ENABLED`. Domyślna konfiguracja ma obie wyłączone. Samo ustawienie SMTP albo flagi w środowisku chmurowym nie uruchomi zaproszeń: obecny adapter odrzuca adres zdalny również w trybie produkcyjnym. Zewnętrzne zaproszenia wymagają osobnego etapu po konfiguracji i odbiorze poczty.

Stan dostarczenia i stan konta są rozdzielone:

| Dostarczenie | Znaczenie |
| --- | --- |
| Przygotowane | Nie rozpoczęto próby wysyłki |
| Wysyłka w toku | Zarejestrowano próbę; wynik jeszcze nie jest zapisany |
| Wysyłka przyjęta | Auth przyjął operację; nie potwierdza to odbioru e-maila |
| Błąd wysyłki | Jawne odrzucenie żądania lub ograniczenie liczby wiadomości |
| Wynik nieznany | Przerwana odpowiedź, błąd serwera albo niepotwierdzony zapis wyniku; wiadomość mogła już dotrzeć |

Oddzielnie panel pokazuje: oczekiwanie na aktywację, konieczność ustawienia hasła, uzupełnienia profilu oraz gotowość do korzystania. Te stany wynikają z potwierdzenia adresu w Auth, odnotowanej zmiany hasła po potwierdzeniu konta i podstawowych danych profilu, a nie ze statusu e-maila. Opiekun nigdy nie otrzymuje podglądu tej listy ani danych Auth innych osób.

Pełny test wykrył, że [Auth v2.196.0 tworzy losowe hasło techniczne przed potwierdzeniem zaproszonego konta](https://github.com/supabase/auth/blob/v2.196.0/internal/api/verify.go#L294-L327). Sama obecność hasha nie dowodzi ustawienia własnego hasła. Trigger zapisuje teraz wyłącznie czas późniejszej zmiany hasła już potwierdzonego konta, atomowo z operacją Auth. Nie kopiuje hasha ani hasła i nie wymaga dodatkowego wywołania z przeglądarki. Działa także po odzyskaniu hasła i utracie odpowiedzi serwera. Dla kont aktywowanych przed migracją, bez wiarygodnego dowodu, panel pokazuje „Ustawienie hasła niepotwierdzone”; istniejący dostęp pozostaje ważny, a kolejna zmiana hasła uzupełnia stan. Użytkownicy aplikacji nie mogą samodzielnie zmieniać tego znacznika.

Lista zawiera po 20 wpisów; przy zmianach aktualny stan pobiera przycisk odświeżenia. Widoki **Aktywna lista** i **Archiwum** mają wyszukiwanie po imieniu lub adresie e-mail. Wyszukiwanie ignoruje wielkość liter, traktuje znaki `%` i `_` dosłownie oraz zachowuje filtr przy zmianie strony i widoku. W bieżącej wersji szkicu nie edytujemy po przygotowaniu. Przy błędnym adresie przygotuj poprawny wpis, a niewysłany błędny szkic przenieś do archiwum.

## Archiwum niewysłanych szkiców

**Przenieś do archiwum** jest dostępne wyłącznie przed pierwszą próbą wysyłki. Archiwizacja wymaga potwierdzenia i przenosi do szczegółów wpisu, gdzie widać trwały stan z bazy. **Przywróć na listę** udostępnia go ponownie do wysłania. Obie czynności działają również przy wyłączonej poczcie; nie tworzą konta, wiadomości ani próby wysyłki. Dla adresu znajdującego się w archiwum przygotowanie kolejnego wpisu wskazuje konieczność przywrócenia oryginału.

Operacja blokuje rekord, sprawdza wersję, zapisuje zmianę i audyt w jednej transakcji. Powtórzenie tego samego zapisu przez tego samego autora nie tworzy kolejnej wersji ani audytu. Stary formularz nie odwraca późniejszej zmiany. Wyścig wysyłki i archiwizacji ma jeden wynik: archiwizacja zatwierdzona pierwsza blokuje rozpoczęcie wysyłki; rozpoczęta wysyłka uniemożliwia archiwizację. Zaproszenia z jakąkolwiek próbą wysyłki, również nieudaną lub niepotwierdzoną, pozostają na aktywnej liście z historią. Archiwum nie unieważnia linków ani dostępu do konta.

## Ponowienia i wynik nieznany

Każda próba ma własny identyfikator, autora, początek i wynik w `invitation_attempts`. Wywołanie blokuje zaproszenie, sprawdza jego wersję i aktualny stan konta. Przez dwie minuty nie dopuszcza następnej próby. Równoczesny/stary formularz nie rozpocznie drugiej wysyłki. Nie ma automatycznego ponawiania zaproszeń po błędzie sieci.

Po dwóch minutach niepotwierdzona próba jest w panelu prezentowana jako wynik nieznany. Sam odczyt niczego nie zmienia. Ręczne ponowienie zachowuje wcześniejszą historię i oznacza starą próbę jako niepotwierdzoną. Spóźniony wynik starej próby nie nadpisuje nowszej. Panel uprzedza, że nowy link może zastąpić wcześniejszy.

Wysłany formularz nie przekazuje adresata, roli ani adresu przekierowania do Auth. Adres pochodzi z zablokowanego rekordu, a docelowa strona z lokalnej konfiguracji serwera. Klient Auth do wysyłki jest oddzielony od sesji zalogowanej prowadzącej. Wynik operacji zapisuje wyłącznie adapter z uprawnieniem `service_role`; zwykła sesja, także administratora, nie może podrobić potwierdzenia dostawcy. Dziennik zapisuje bezpieczne kody, bez surowych odpowiedzi, tokenów ani haseł.

Każdy wpis ma przycisk **Historia zaproszenia**, otwierający `/admin/invitations/[id]`. Widok pokazuje bieżący etap konta, możliwość ponowienia oraz wszystkie próby po 20 na stronie: początek, autora, wynik, bezpieczne wyjaśnienie błędu i czas zapisania wyniku. Autor pochodzi z bieżącego profilu pracownika. Nie pokazujemy tokenów, haseł, metadanych Auth ani surowej odpowiedzi dostawcy. Osobne funkcje bazy autoryzują odczyt szczegółów i historii; sam dostęp do adresu strony nie wystarcza. Niepotwierdzona próba starsza niż dwie minuty jest prezentowana jako wynik nieznany również w historii, bez zmiany danych podczas odczytu.

Wynik ostatniej próby pozostaje w podsumowaniu także wtedy, gdy po wysyłce znika formularz ponowienia. Dotyczy to również jawnego odrzucenia lub ograniczenia liczby wiadomości. Historia rozróżnia pustą pierwszą stronę (jeszcze nie wysyłano) od strony poza zakresem zapisanych prób.

## Wejście opiekuna

Lokalny szablon `supabase/templates/invite.html` kieruje do `/auth/invitation?token_hash=…`. Odczyt strony ani skanowanie linku przez pocztę nie zużywa tokenu. Dopiero przycisk **Przyjmij zaproszenie** potwierdza stały typ `invite` i prowadzi do ustawienia własnego hasła. Typ tokenu i przekierowanie z formularza są odrzucane. Strona ma `no-store`, `no-referrer` i wyłączenie indeksowania.

Nowe konto zawsze otrzymuje rolę `client`. Tworzenie profilu korzysta z imienia zapisanego przy zaproszeniu; ponowna wysyłka nie nadpisuje istniejącego profilu. Po ustawieniu hasła opiekun uzupełnia brakujące dane i może dodać psa. Zwykły jednorazowy dostęp `/auth/access` oraz odzyskanie hasła `/auth/recovery` zachowują własne typy tokenów i działanie.

Implementację oparto na [API zaproszeń Supabase](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [szablonach wiadomości](https://supabase.com/docs/guides/auth/auth-email-templates) oraz [źródle endpointu invite](https://github.com/supabase/auth/blob/master/internal/api/invite.go), sprawdzonych 19.09.2026. Endpoint umożliwia ponowienie zaproszenia niepotwierdzonego adresu, a potwierdzone konto jest odrzucane.

## Konto do lokalnego pokazu

Po uruchomieniu lokalnego stosu i `pnpm local:env`:

```sh
PSI_ALLOW_DEMO_SEED=yes node --env-file=.env.test.local scripts/seed-demo.mjs
```

Skrypt tworzy trzy fikcyjne konta (prowadząca i dwóch opiekunów), hasła, psy i dane demonstracyjne. Przykładowe spacery kosztują 100 zł. Dane logowania trafiają do **`.local/accounts.json`**, z prawami odczytu/zapisu tylko dla właściciela. Katalog jest ignorowany przez Git i oddzielony od wyników Playwright, których uruchomienie mogłoby go wyczyścić. Konsola pokazuje wyłącznie fikcyjne adresy.

Skrypt odrzuca zdalny URL, przekierowania sieciowe i próbę nadpisania istniejącego pliku. Używaj już utworzonych kont; tworzenie kolejnego zestawu wymaga świadomego wyczyszczenia poprzedniego lokalnego zestawu i usunięcia pliku. Nie uruchamiaj resetu stosu z danymi, które chcesz zachować. Manifest ze statusem `creating` oznacza niepełne przygotowanie; może zawierać dane kont utworzonych przed przerwaniem. `ready` pojawia się dopiero po zapisaniu całego zestawu.

`local:env` zapisuje teraz klucz administracyjny lokalnego stosu także do `.env.development.local`, ponieważ serwerowy adapter zaproszeń go wymaga. Plik ma uprawnienia `0600`, również jeśli istniał wcześniej. Klucz nie trafia do zmiennych publicznych ani parametrów komponentów. Pozostałe operacje użytkownika nadal korzystają z jego własnej sesji.

## Weryfikacja i pozostałe prace

37 nowych testów obejmuje cykl zaproszenia w PostgreSQL/PGlite, role, normalizację, duplikaty, kontrolę wersji i czas ponowienia, utraconą odpowiedź, spóźniony wynik, etapy konta, 1005 wpisów, działania serwera, treść widoków, szablon i typ tokenu oraz przygotowanie kont z atrapą Auth. Istniejące minimalne modele `auth.users` w testach uzupełniono o kolumny używane do oceny potwierdzenia adresu i ustawienia hasła.

Pierwsza weryfikacja modułu obejmowała 453 testy w 46 plikach, ESLint, kontrolę typów i build. Aktualny zestaw po dalszych pracach: **514 testów w 50 plikach**, poprawny wynik 02.10.2026. Na tym komputerze działa lokalny Supabase z 26 migracjami, skrzynką Mailpit i trzema kontami demonstracyjnymi opisanymi powyżej.

01.10.2026 pełny scenariusz przeglądarkowy przeszedł od przygotowania i wysłania zaproszenia do Mailpit przez aktywację, własne hasło i profil, po ponowne logowanie oraz odzyskanie hasła. Panel prowadzącej potwierdził etap „Gotowe do korzystania” i ukrył ponowną wysyłkę dla aktywowanego konta. Sprawdzono brak wiadomości po samym przygotowaniu, ochronę użytego tokenu, rolę klienta i brak dostępu do panelu administratora. Widoki po ustawieniu hasła i lista zaproszeń sprawdzone na telefonie i komputerze.

02.10.2026 nowy `invitation-resend.spec.ts` sprawdził rzeczywiste lokalne Auth v2.196.0, PostgREST i Mailpit: wygaśnięcie nieużytego zaproszenia, brak sesji po błędzie, trzy wiadomości dla tego samego fikcyjnego konta, unieważnienie wcześniejszych linków po ponowieniu, aktywację najnowszym i odrzucenie ponownego użycia. Skracanie oczekiwania polega wyłącznie na zmianie znaczników czasu własnego konta testowego, bez zmiany czasu maszyny i bez modyfikacji tokenu. Test potwierdził dwuminutową blokadę ponowienia, trzy wpisy historii, odmowę odczytu przez opiekuna i gościa, etap ustawienia hasła oraz przejście do uzupełnienia profilu po jego zapisie. Cały zestaw sześciu E2E przeszedł w 1,4 minuty. Dane kont i wiadomości próbnych są usuwane.

Docelowy SMTP i zaproszenia klientów pozostają odłożone. Cały produkt nadal podlega odbiorowi według [MVP-50](MVP-50.md).

Archiwum sprawdzono 02.10.2026 przez 47 testów modułu oraz trzy nowe scenariusze niezależnych transakcji PostgreSQL (cztery potwierdzone oczekiwania na blokadę). Pełny E2E obejmuje archiwizację, wyszukiwanie po adresie, przejście między listami, przywrócenie i późniejszą wysyłkę; potwierdza brak wiadomości podczas zmian archiwum. Zrzut 320 px przedstawia gotową listę, z której można przywrócić wpis, bez poziomego przewijania. Cały zestaw sześciu E2E po tej zmianie przeszedł w 1,0 minuty.

Po dopracowaniu odstępów powtórzono oba scenariusze zaproszeń: **2/2 poprawne w 42,0 s**. Sprawdzono zrzuty historii przy 320, 390, 768 i 1440 px, w tym wizualnie telefon 320 px oraz komputer. Usunięto chwilowo widoczne linki zamkniętego menu przy zmianie szerokości: jego animacja nie obejmuje już właściwości `visibility`. Build z TypeScript i ESLint zmienionego kodu przeszły. Bieżący podgląd jest lokalną kompilacją z tymi zmianami.
