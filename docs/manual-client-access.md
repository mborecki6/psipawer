# Ręczne wejście opiekunów bez SMTP

Wariant na testy do 50 osób, wybrany przez użytkownika 16.10.2026.
Narzędzie obsługuje administrator. Nie wysyła wiadomości i nie ustala hasła
opiekuna. Kanałem aplikacji pozostaje skrzynka powiadomień; ten proces nie
konfiguruje e-maili ani fizycznego push.

## Przygotowanie

1. Potwierdź adres i odbiorcę znanym kanałem. Nie wysyłaj zbiorczej listy linków.
2. Przygotuj prywatny katalog poza checkoutem projektu z prawami 0700;
   pliki wejścia i konfiguracji muszą mieć prawa 0600. Katalog nie wchodzi
   do Gita ani plików wdrożenia. Nie przenoś go do repozytorium ani publicznego Drive.
   Wskaż go przez `PSI_MANUAL_PRIVATE_DIR`; domyślna lokalizacja narzędzia jest
   poza projektem. Wszystkie pliki wejściowe i wynikowe muszą należeć do tego
   katalogu. Ignorowany `.local` checkoutu również nie jest lokalizacją wydania.
3. W procesie narzędzia ustaw `PSI_MANUAL_SUPABASE_URL`, `PSI_MANUAL_APP_ORIGIN`
   i serwerowy `SUPABASE_SECRET_KEY`. Narzędzie celowo nie wczytuje `.env`.
   Nie wpisuj klucza do komendy, dokumentu ani rozmowy. Produkcja wymaga
   `--allow-hosted` i dokładnego potwierdzenia adresu projektu przy apply.
4. Odczytaj aktualne `mailer_otp_exp` z Supabase Management
   `GET /v1/projects/{ref}/config/auth`. Prywatny snapshot ma format
   `{ "seconds": 3600, "source": "Supabase Management GET /v1/projects/{ref}/config/auth:mailer_otp_exp", "checkedAt": "data ISO" }`.
   Wstaw rzeczywiste ref i datę. Odczyt z 16.10 potwierdził 3600 sekund;
   nie jest to stała zaszyta w aplikacji. Bez dowodu wynik jawnie nie potwierdza TTL.

Wejście `recipients.json`:

```json
{
  "version": 1,
  "recipients": [
    { "email": "nowy@example.test", "intent": "new" },
    { "email": "istniejacy@example.test", "intent": "access" }
  ]
}
```

`new` wymaga braku konta; `access` wymaga istniejącego klienta. Każdy admin,
brak profilu/roli lub niezgodna tożsamość zatrzymuje wydanie. Podczas partii
nie zmieniaj równolegle kont ani ról z innego komputera.

## Plan i wydanie

```sh
pnpm manual:clients plan --input "$PSI_MANUAL_PRIVATE_DIR/recipients.json" --expiry "$PSI_MANUAL_PRIVATE_DIR/otp-config.json" --out "$PSI_MANUAL_PRIVATE_DIR/plan.json" --allow-hosted
pnpm manual:clients apply --plan "$PSI_MANUAL_PRIVATE_DIR/plan.json" --out "$PSI_MANUAL_PRIVATE_DIR/result.jsonl" --confirm-project https://gzzfbqepajyaquwxdslz.supabase.co --allow-hosted
```

Sprawdź plan przed drugim poleceniem. Sam plan nie tworzy kont ani tokenów.
`apply` ponownie sprawdza tożsamość. Wynik jest prywatnym dziennikiem JSONL;
link wolno przekazać dopiero z wiersza `status: "ready"`. Narzędzie nie nadpisuje
plików i zapisuje checkpoint przed wywołaniem Auth. Przy `uncertain` albo
przerwanym procesie nie ponawiaj w ciemno: sprawdź konto i przygotuj nowy plan
dla jego rzeczywistego stanu. Nie usuwaj blokady działającego procesu.

## Przekazanie jednej osobie

Przekaż tylko jej własny link, zanim upłynie `expiresAt`. Nowa osoba przyjmuje
zaproszenie; istniejący klient świadomie otwiera jednorazowy dostęp. Odczyt GET
nie zużywa tokenu. Poproś o sprawdzenie wyświetlonego e-maila, ustawienie własnego
hasła, uzupełnienie profilu, wylogowanie i ponowne logowanie hasłem. Link daje
dostęp jego posiadaczowi; nie przekazuje się go dalej.

Zapisanie hasła nie jest wymuszone przed przejściem do panelu, dlatego potwierdź
ten krok z testerem. Rozróżniaj: link przygotowany, przekazany, wejście potwierdzone.
Przy wygaśnięciu lub zapomnieniu hasła administrator potwierdza tożsamość znanym
kanałem i wydaje nowy link do tego samego klienta. Nie obiecuj wylogowania innych
sesji ani unieważnienia wszystkich wcześniejszych linków. Nie generujemy tokenów
automatycznie po błędzie transportu.
