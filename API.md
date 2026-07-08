# API Documentation - IT Equipment Outlet

Szczegółowa dokumentacja REST API dla aplikacji IT Equipment Outlet.

## Spis treści

- [Przegląd](#przegląd)
- [Autentykacja](#autentykacja)
- [Endpointy Auth](#endpointy-auth)
- [Endpointy Items](#endpointy-items)
- [Endpointy Reservations](#endpointy-reservations)
- [Endpointy Favorites](#endpointy-favorites)
- [Endpointy Users](#endpointy-users)
- [Kody błędów](#kody-błędów)
- [Przykłady użycia](#przykłady-użycia)

## Przegląd

### Base URL

```
http://localhost:3000
```

Powyższy adres to domyślna konfiguracja developerska. Port i publiczny adres aplikacji pochodzą ze zmiennych środowiskowych `PORT` oraz `BASE_URL`.

### Format odpowiedzi

Wszystkie endpointy zwracają JSON.

**Sukces:**
```json
{
  "id": 1,
  "name": "Dell Monitor 24",
  "status": "available"
}
```

**Błąd:**
```json
{
  "error": "Item not found"
}
```

### HTTP Status Codes

| Code | Opis |
|------|------|
| 200 | OK - Sukces |
| 201 | Created - Zasób utworzony |
| 400 | Bad Request - Błędne dane wejściowe |
| 401 | Unauthorized - Brak autentykacji |
| 403 | Forbidden - Brak uprawnień |
| 404 | Not Found - Zasób nie znaleziony |
| 429 | Too Many Requests - Rate limit |
| 500 | Internal Server Error - Błąd serwera |

## Autentykacja

### Session-based (Cookie)

Aplikacja używa session-based auth z cookies.

**Login flow:**
1. User loguje się przez `/auth/microsoft` lub `/auth/local`
2. Serwer ustawia cookie `connect.sid` (HTTPOnly, Secure w prod)
3. Przeglądarka automatycznie wysyła cookie z każdym requestem
4. Middleware `requireAuth` sprawdza sesję

**Cookie:**
```
Name: connect.sid
Value: s%3A<session-id>.<signature>
Path: /
HttpOnly: true
Secure: true (production, gdy BASE_URL zaczyna się od https)
Max-Age: 604800 (7 dni, rolling)
SameSite: (celowo nieustawione)
```

**Uwagi:**
- Cookie działa w trybie **rolling** - każdy request odświeża ważność sesji o kolejne 7 dni.
- Sesje są utrwalane po stronie serwera w SQLite, więc restart serwera nie wylogowuje użytkowników.
- Atrybut `sameSite` jest celowo nieustawiony - Microsoft OAuth callback to cross-site POST i wymaga wysłania cookie sesji. Ochronę przed CSRF zapewnia parametr `state` OAuth oraz middleware sprawdzający nagłówek Origin (patrz niżej).

### Middleware

Wszystkie endpointy `/api/*` (i część `/auth/*`) wymagają autentykacji.

```typescript
// src/middleware/auth.middleware.ts

// Wymaga zalogowania
export function requireAuth(req, res, next) {
  if (req.isAuthenticated() && req.user) {
    return next();
  }
  // Dla żądań API - 401
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  // Dla żądań stron HTML - redirect do logowania
  res.redirect('/auth/login');
}

// Wymaga uprawnień admina
export function requireAdmin(req, res, next) {
  if (!req.isAuthenticated() || !req.user) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.redirect('/auth/login');
  }
  if (!req.user.isAdmin) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.status(403).json({ error: 'Brak uprawnień administratora' });
  }
  next();
}
```

### Ochrona CSRF (nagłówek Origin)

Middleware `csrfProtection` (`src/middleware/csrf.middleware.ts`) odrzuca cross-site żądania zmieniające stan:

- Sprawdzane są wszystkie metody poza `GET`, `HEAD` i `OPTIONS`.
- Sprawdzenie dotyczy tylko żądań z **uwierzytelnioną sesją** - żądania bez sesji (np. logowanie) przechodzą bez kontroli.
- Ścieżka `/auth/callback` jest wyłączona spod kontroli (cross-site POST z domeny Microsoft).
- Origin żądania (nagłówek `Origin`, a w razie jego braku origin z nagłówka `Referer`) musi być identyczny z originem `BASE_URL`. Gdy oba nagłówki są nieobecne lub wskazują inny origin, żądanie jest blokowane.
- Zablokowane żądanie `/api/*` dostaje `403` z body `{"error": "Invalid request origin"}`; pozostałe ścieżki dostają `403` z tekstem `Forbidden`.

Przeglądarki wysyłają nagłówek `Origin` automatycznie przy takich żądaniach, więc frontend nie wymaga żadnych zmian. Natomiast **curl i skrypty muszą dodać nagłówek ręcznie**:

```bash
curl -X POST http://localhost:3000/api/reservations \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"itemId":1}'
```

## Endpointy Auth

### GET /auth/login

Punkt wejścia logowania (redirect).

**Autentykacja:** Nie wymagana

**Odpowiedź:** 302 Redirect
- Gdy Azure AD jest włączone i nie skonfigurowano kont lokalnych: od razu rozpoczyna logowanie Microsoft.
- W pozostałych przypadkach: redirect do `/auth/login-page`.

---

### GET /auth/login-page

Strona wyboru metody logowania (HTML).

**Autentykacja:** Nie wymagana

**Parametry query:**
- `error` (opcjonalny) - Komunikat błędu do wyświetlenia (przed renderowaniem jest HTML-escapowany)

**Odpowiedź:**
```html
<!DOCTYPE html>
<html>
  <!-- Przycisk "Zaloguj się kontem Microsoft"
       + (jeśli skonfigurowano konta lokalne) link do /auth/local-login -->
</html>
```

**Przykład:**
```bash
curl -X GET "http://localhost:3000/auth/login-page?error=Sesja wygasła"
```

---

### GET /auth/microsoft

Redirect do Microsoft OAuth login.

**Autentykacja:** Nie wymagana

**Flow:**
1. Redirect do `login.microsoftonline.com`
2. User loguje się w Microsoft
3. Microsoft odsyła przeglądarkę na `POST /auth/callback` (form_post)

**Parametry:** Brak

**Odpowiedź:**
- Sukces: 302 Redirect do Microsoft
- Azure AD nieskonfigurowane: 302 Redirect do `/auth/login-page?error=Logowanie Microsoft nie jest skonfigurowane`
- Błąd logowania: 302 Redirect do `/auth/login-page?error=Logowanie Microsoft nie powiodło się`

---

### POST /auth/callback

Microsoft OAuth callback (nie wywoływać ręcznie). Azure AD odsyła odpowiedź metodą **POST** (`response_mode=form_post`), nie GET.

**Autentykacja:** Nie wymagana

**Content-Type:** `application/x-www-form-urlencoded`

**Parametry body (wysyłane przez Microsoft):**
- `code` / `id_token` - Odpowiedź autoryzacyjna z Microsoft
- `state` - Token anti-CSRF

**Odpowiedź:**
- Sukces: 302 Redirect do `/`
- Błąd: 302 Redirect do `/auth/login-page?error=Logowanie Microsoft nie powiodło się`

**Uwaga:** Endpoint jest wyłączony spod kontroli nagłówka Origin (CSRF) - to cross-site POST z domeny Microsoft.

---

### GET /auth/local-login

Formularz logowania lokalnego (HTML) - tylko dla testerów/administratorów.

**Autentykacja:** Nie wymagana

**Parametry query:**
- `error` (opcjonalny) - Komunikat błędu do wyświetlenia (przed renderowaniem jest HTML-escapowany)

**Odpowiedź:**
```html
<!DOCTYPE html>
<html>
  <!-- Formularz: username + password -->
</html>
```

**Uwaga:** Gdy nie skonfigurowano kont lokalnych: 302 Redirect do `/auth/login-page?error=Logowanie lokalne nie jest dostępne`.

---

### POST /auth/local

Logowanie lokalne (form submit).

**Autentykacja:** Nie wymagana

**Content-Type:** `application/x-www-form-urlencoded`

**Parametry body:**
```
username=admin
password=haslo123
```

**Odpowiedź:**
  - Sukces: 302 Redirect do `/`
  - Błąd: 302 Redirect do `/auth/local-login?error=Nieprawidłowy login lub hasło`
  - Błąd serwera: 302 Redirect do `/auth/local-login?error=Błąd serwera` (lub `error=Błąd logowania`)
  - Konta lokalne wyłączone: 302 Redirect do `/auth/login-page?error=Logowanie lokalne nie jest dostępne`

**Blokada konta (rate limiting):**
- Limity konfigurowane zmiennymi środowiskowymi: `LOGIN_MAX_ATTEMPTS` (domyślnie 5 prób) i `LOGIN_LOCKOUT_MINUTES` (domyślnie 15 minut blokady)
- Nieudane próby liczone per login (username)
- Stan trzymany w pamięci procesu - restart serwera zeruje liczniki i blokady
- Przeglądarka zawsze otrzymuje ogólny redirect z komunikatem `Nieprawidłowy login lub hasło` - szczegółowy komunikat o blokadzie nie jest ujawniany (trafia tylko do logów serwera)

**Przykład (curl):**
```bash
curl -X POST http://localhost:3000/auth/local \
  -d "username=admin&password=haslo123" \
  -c cookies.txt
```

---

### GET /auth/logout

Strona potwierdzenia wylogowania (HTML) - dla zapisanych zakładek lub ręcznej nawigacji. Zawiera formularz wysyłający `POST /auth/logout`.

**Autentykacja:** Nie wymagana (niezalogowany: 302 Redirect do `/auth/login-page`)

**Odpowiedź (zalogowany):**
```html
<!DOCTYPE html>
<html>
  <!-- Potwierdzenie: przycisk "Wyloguj" (POST /auth/logout) + "Anuluj" -->
</html>
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/auth/logout \
  -b cookies.txt
```

---

### POST /auth/logout

Wylogowanie użytkownika (niszczy sesję).

**Autentykacja:** Nie wymagana (żądanie bez sesji również kończy się przekierowaniem)

**Odpowiedź:** 302 Redirect do `/auth/login-page`

**Uwaga:** Dla zalogowanej sesji obowiązuje kontrola CSRF - żądanie musi mieć poprawny nagłówek `Origin` lub `Referer`.

**Przykład:**
```bash
curl -X POST http://localhost:3000/auth/logout \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### GET /auth/me

Informacje o zalogowanym użytkowniku.

**Autentykacja:** Nie wymagana (endpoint nie używa middleware - nigdy nie zwraca 401)

**Odpowiedź (zalogowany, 200):**
```json
{
  "id": "4947083a-cc9c-429f-9050-6a23cac87562",
  "email": "jan.kowalski@example.com",
  "displayName": "Jan Kowalski",
  "isAdmin": true
}
```

**Odpowiedź (niezalogowany, 200):**
```json
null
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/auth/me \
  -b cookies.txt
```

---

## Endpointy Items

### GET /api/items

Lista dostępnych przedmiotów (dla pracowników).

**Autentykacja:** Wymagana (requireAuth)

**Filtry:** Automatyczne - tylko `status = 'available'` i `isVisible = 1`

**Parametry query:**
| Pole | Typ | Wymagane | Opis |
|------|-----|----------|------|
| limit | int | NIE | Jeśli podany, odpowiedź jest paginowana. Max 50, domyślnie 15 (przy wartości nieliczbowej) |
| offset | int | NIE | Przesunięcie paginacji (domyślnie 0, używane tylko razem z `limit`) |
| sort | string | NIE | Sortowanie: `newest` (domyślnie), `oldest`, `price_asc`, `price_desc` |
| category | string | NIE | Filtr kategorii (phone/desktop/laptop/monitor/other) |

**Odpowiedź (bez `limit` - zwykła tablica):**
```json
[
  {
    "id": 1,
    "name": "Dell Latitude 5420",
    "description": "Stan bardzo dobry, bateria 90%",
    "category": "laptop",
    "price": 1200.00,
    "status": "available",
    "imagePath": "/images/item-123.jpg",
    "createdAt": "2026-01-15T10:00:00.000Z",
    "createdBy": "4947083a-cc9c-429f-9050-6a23cac87562",
    "quantity": 1,
    "isVisible": 1,
    "images": [
      {
        "id": 1,
        "itemId": 1,
        "imagePath": "/images/item-123.jpg",
        "thumbnailPath": "/images/thumb-item-123.jpg",
        "sortOrder": 0,
        "createdAt": "2026-01-15T10:00:00.000Z"
      },
      {
        "id": 2,
        "itemId": 1,
        "imagePath": "/images/item-124.jpg",
        "thumbnailPath": "/images/thumb-item-124.jpg",
        "sortOrder": 1,
        "createdAt": "2026-01-15T10:00:00.000Z"
      }
    ]
  }
]
```

**Odpowiedź (z `limit` - paginowana):**
```json
{
  "items": [ { "id": 1, "name": "Dell Latitude 5420", "...": "..." } ],
  "total": 42,
  "hasMore": true
}
```

**Uwaga:** Pole `adminNote` jest usuwane z odpowiedzi tego endpointu (dla wszystkich użytkowników).

**Przykład:**
```bash
curl -X GET "http://localhost:3000/api/items?limit=15&offset=0&sort=price_asc&category=laptop" \
  -b cookies.txt
```

---

### GET /api/items/all

Lista wszystkich przedmiotów (w tym zarezerwowane, sprzedane i ukryte).

**Autentykacja:** Wymagana (requireAdmin)

**Odpowiedź:** Jak `/api/items` (zwykła tablica, bez paginacji), ale wszystkie statusy. Każdy przedmiot zawiera dodatkowo `adminNote` oraz pola statystyk: `favoriteCount`, `reservedCount`, `soldCount`, `soldValue`, `buyers`, `buyerEmails`, `reservingUsers`, `reservingEmails`, `lastSoldAt`, `lastReservedAt`.

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/items/all \
  -b cookies.txt
```

---

### GET /api/items/:id

Szczegóły pojedynczego przedmiotu.

**Autentykacja:** Wymagana (requireAuth)

**Parametry URL:**
- `id` - ID przedmiotu (INTEGER)

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Latitude 5420",
  "description": "Stan bardzo dobry, bateria 90%",
  "category": "laptop",
  "price": 1200.00,
  "status": "available",
  "imagePath": "/images/item-123.jpg",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "quantity": 1,
  "isVisible": 1,
  "images": [
    {
      "id": 1,
      "itemId": 1,
      "imagePath": "/images/item-123.jpg",
      "thumbnailPath": "/images/thumb-item-123.jpg",
      "sortOrder": 0,
      "createdAt": "2026-01-15T10:00:00.000Z"
    }
  ]
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Uwagi:**
- Nie-admin widzi tylko przedmioty widoczne (`isVisible = 1`) i dostępne (`status = 'available'`) - pozostałe zwracają 404.
- Dla nie-adminów z odpowiedzi usuwane są pola `adminNote`, `createdBy`, `createdByEmail` i `createdByDisplayName`. Admin otrzymuje pełny obiekt razem z tymi polami.

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/items/1 \
  -b cookies.txt
```

---

### POST /api/items

Dodaj nowy przedmiot.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `multipart/form-data`

**Parametry body:**
| Pole | Typ | Wymagane | Opis |
|------|-----|----------|------|
| name | string | TAK | Nazwa przedmiotu |
| category | string | TAK | Kategoria (phone/desktop/laptop/monitor/other) |
| description | string | NIE | Opis |
| price | number | NIE | Cena (PLN) |
| adminNote | string | NIE | Notatka widoczna tylko dla adminów |
| quantity | int | NIE | Ilość sztuk (>= 0, domyślnie 1) |
| isVisible | int | NIE | Widoczność w katalogu (1 = widoczny, 0 = ukryty; domyślnie 1) |
| images | file[] | NIE | Zdjęcia (max 10 plików, max 50MB/plik, JPEG/PNG/GIF/WebP) |

**Odpowiedź (sukces 201):**
```json
{
  "id": 5,
  "name": "iPhone 12 Pro",
  "description": "Stan dobry, bateria 85%",
  "category": "phone",
  "imagePath": "/images/item-1737373200000-123456789.jpg",
  "price": null,
  "status": "available",
  "createdAt": "2026-01-20T10:00:00.000Z",
  "createdBy": "4947083a-cc9c-429f-9050-6a23cac87562",
  "adminNote": null,
  "quantity": 1,
  "isVisible": 1,
  "images": [
    {
      "id": 10,
      "itemId": 5,
      "imagePath": "/images/item-1737373200000-123456789.jpg",
      "thumbnailPath": null,
      "sortOrder": 0,
      "createdAt": "2026-01-20T10:00:00.000Z"
    }
  ]
}
```

**Odpowiedź (błąd 400):**
```json
{
  "error": "Name and category are required"
}
```
```json
{
  "error": "Invalid category"
}
```
```json
{
  "error": "Quantity must be a non-negative number"
}
```

**Uwaga:** Miniatury (`thumbnailPath`) generowane są asynchronicznie - bezpośrednio po utworzeniu pole może być `null`.

**Przykład (curl):**
```bash
curl -X POST http://localhost:3000/api/items \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -F "name=iPhone 12 Pro" \
  -F "category=phone" \
  -F "description=Stan dobry" \
  -F "price=800" \
  -F "quantity=2" \
  -F "images=@photo1.jpg" \
  -F "images=@photo2.jpg"
```

**Przykład (JavaScript Fetch):**
```javascript
const formData = new FormData();
formData.append('name', 'iPhone 12 Pro');
formData.append('category', 'phone');
formData.append('description', 'Stan dobry');
formData.append('price', '800');
formData.append('images', fileInput.files[0]);
formData.append('images', fileInput.files[1]);

const response = await fetch('/api/items', {
  method: 'POST',
  body: formData
});
const item = await response.json();
```

---

### PUT /api/items/:id

Edytuj przedmiot.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `multipart/form-data`

**Parametry URL:**
- `id` - ID przedmiotu

**Parametry body (wszystkie opcjonalne):**
| Pole | Typ | Opis |
|------|-----|------|
| name | string | Nazwa |
| category | string | Kategoria (phone/desktop/laptop/monitor/other) |
| description | string | Opis |
| price | number | Cena |
| status | string | Status (available/reserved/sold) |
| adminNote | string | Notatka widoczna tylko dla adminów |
| quantity | int | Ilość sztuk (>= 0); ustawienie 0 automatycznie ukrywa przedmiot (`isVisible = 0`) |
| isVisible | int | Widoczność w katalogu (1/0) |
| image | file | Nowe główne zdjęcie (pojedynczy plik; legacy, lepiej użyć `/api/items/:id/images`) |

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Latitude 5420 (zaktualizowany)",
  "description": "Nowy opis",
  "category": "laptop",
  "imagePath": "/images/item-123.jpg",
  "price": 1100.00,
  "status": "available",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "createdBy": "4947083a-cc9c-429f-9050-6a23cac87562",
  "adminNote": null,
  "quantity": 1,
  "isVisible": 1
}
```

**Uwaga:** Odpowiedź to zaktualizowany przedmiot **bez** tablicy `images`.

**Odpowiedź (błąd 400):**
```json
{
  "error": "Invalid category"
}
```
```json
{
  "error": "Quantity must be a non-negative number"
}
```
```json
{
  "error": "Invalid image file"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Przykład:**
```bash
curl -X PUT http://localhost:3000/api/items/1 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -F "name=Dell Latitude 5420 (refurbished)" \
  -F "price=1100"
```

---

### DELETE /api/items/:id

Usuń przedmiot.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID przedmiotu

**Odpowiedź (sukces 200):**
```json
{
  "success": true
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Uwaga:** Usuwa też wszystkie zdjęcia (CASCADE) wraz z miniaturami i plikami z dysku.

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/items/1 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### POST /api/items/:id/images

Dodaj zdjęcia do istniejącego przedmiotu.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `multipart/form-data`

**Parametry URL:**
- `id` - ID przedmiotu

**Parametry body:**
- `images` - Pliki zdjęć (max 10, max 50MB/plik, JPEG/PNG/GIF/WebP)

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Latitude 5420",
  ...
  "images": [
    { "id": 1, "itemId": 1, "imagePath": "/images/item-123.jpg", "thumbnailPath": "/images/thumb-item-123.jpg", "sortOrder": 0, "createdAt": "2026-01-15T10:00:00.000Z" },
    { "id": 2, "itemId": 1, "imagePath": "/images/item-124.jpg", "thumbnailPath": "/images/thumb-item-124.jpg", "sortOrder": 1, "createdAt": "2026-01-15T10:00:00.000Z" },
    { "id": 3, "itemId": 1, "imagePath": "/images/item-125.jpg", "thumbnailPath": null, "sortOrder": 2, "createdAt": "2026-01-20T10:00:00.000Z" }
  ]
}
```

**Odpowiedź (błąd 400 - żaden plik nie przeszedł walidacji):**
```json
{
  "error": "No valid images provided"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/items/1/images \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -F "images=@photo3.jpg" \
  -F "images=@photo4.jpg"
```

---

### DELETE /api/items/:id/images/:imageId

Usuń pojedyncze zdjęcie.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID przedmiotu
- `imageId` - ID zdjęcia

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Latitude 5420",
  ...
  "images": [
    { "id": 1, "itemId": 1, "imagePath": "/images/item-123.jpg", "thumbnailPath": "/images/thumb-item-123.jpg", "sortOrder": 0, "createdAt": "2026-01-15T10:00:00.000Z" }
  ]
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```
```json
{
  "error": "Image not found"
}
```

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/items/1/images/2 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### PUT /api/items/:id/images/order

Zmień kolejność zdjęć.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `application/json`

**Parametry URL:**
- `id` - ID przedmiotu

**Parametry body:**
```json
{
  "imageOrder": [
    { "id": 2, "sortOrder": 0 },
    { "id": 1, "sortOrder": 1 },
    { "id": 3, "sortOrder": 2 }
  ]
}
```

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Latitude 5420",
  ...
  "images": [
    { "id": 2, "itemId": 1, "imagePath": "/images/item-124.jpg", "thumbnailPath": "/images/thumb-item-124.jpg", "sortOrder": 0, "createdAt": "2026-01-15T10:00:00.000Z" },
    { "id": 1, "itemId": 1, "imagePath": "/images/item-123.jpg", "thumbnailPath": "/images/thumb-item-123.jpg", "sortOrder": 1, "createdAt": "2026-01-15T10:00:00.000Z" },
    { "id": 3, "itemId": 1, "imagePath": "/images/item-125.jpg", "thumbnailPath": "/images/thumb-item-125.jpg", "sortOrder": 2, "createdAt": "2026-01-15T10:00:00.000Z" }
  ]
}
```

**Odpowiedź (błąd 400):**
```json
{
  "error": "imageOrder must be an array"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Przykład:**
```bash
curl -X PUT http://localhost:3000/api/items/1/images/order \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"imageOrder":[{"id":2,"sortOrder":0},{"id":1,"sortOrder":1}]}'
```

---

### GET /api/items/:id/history

Historia przedmiotu: zakończone/anulowane rezerwacje, aktywne rezerwacje i historia edycji.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID przedmiotu

**Odpowiedź (sukces 200):**
```json
{
  "history": [
    {
      "id": 3,
      "itemId": 1,
      "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
      "status": "cancelled",
      "createdAt": "2026-01-18T09:00:00.000Z",
      "completedAt": null,
      "cancelledAt": "2026-01-19T14:30:00.000Z",
      "price": 1200.00,
      "adminNote": null,
      "adminOrderId": null,
      "customPrice": null,
      "userEmail": "jan.kowalski@example.com",
      "userDisplayName": "Jan Kowalski"
    }
  ],
  "activeReservations": [
    {
      "id": 5,
      "itemId": 1,
      "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
      "status": "pending",
      "createdAt": "2026-01-20T10:30:00.000Z",
      "adminNote": null,
      "adminOrderId": null,
      "customPrice": null,
      "userEmail": "jan.kowalski@example.com",
      "userDisplayName": "Jan Kowalski"
    }
  ],
  "editHistory": [
    {
      "id": 12,
      "itemId": 1,
      "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
      "changes": "{\"price\":1100}",
      "createdAt": "2026-01-19T16:00:00.000Z",
      "userEmail": "jan.kowalski@example.com",
      "userDisplayName": "Jan Kowalski"
    }
  ]
}
```

**Uwaga:** Pole `changes` w `editHistory` to JSON zserializowany do stringa.

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/items/1/history \
  -b cookies.txt
```

---

### GET /api/items/:id/favorites/count

Liczba użytkowników, którzy dodali przedmiot do ulubionych.

**Autentykacja:** Wymagana (requireAuth)

**Parametry URL:**
- `id` - ID przedmiotu

**Odpowiedź (sukces 200):**
```json
{
  "count": 3
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Item not found"
}
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/items/1/favorites/count \
  -b cookies.txt
```

---

## Endpointy Reservations

### GET /api/reservations

Lista wszystkich rezerwacji (dla adminów).

**Autentykacja:** Wymagana (requireAdmin)

**Odpowiedź:** Płaska tablica obiektów rezerwacji (bez zagnieżdżonych obiektów `item`/`user`):
```json
[
  {
    "id": 1,
    "itemId": 1,
    "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
    "status": "pending",
    "createdAt": "2026-01-20T10:00:00.000Z",
    "adminNote": null,
    "adminOrderId": null,
    "customPrice": null,
    "itemName": "Dell Latitude 5420",
    "itemCategory": "laptop",
    "itemPrice": 1200.00,
    "userEmail": "jan.kowalski@example.com",
    "userDisplayName": "Jan Kowalski",
    "discountType": null,
    "discountValue": null,
    "orderAdminNote": null
  }
]
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/reservations \
  -b cookies.txt
```

---

### GET /api/reservations/my

Lista rezerwacji zalogowanego użytkownika.

**Autentykacja:** Wymagana (requireAuth)

**Odpowiedź:** Jak `GET /api/reservations`, ale tylko własne rezerwacje i **bez pól administracyjnych** - z każdego obiektu usuwane są `adminNote`, `orderAdminNote`, `discountType` i `discountValue`:
```json
[
  {
    "id": 1,
    "itemId": 1,
    "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
    "status": "pending",
    "createdAt": "2026-01-20T10:00:00.000Z",
    "adminOrderId": null,
    "customPrice": null,
    "itemName": "Dell Latitude 5420",
    "itemCategory": "laptop",
    "itemPrice": 1200.00,
    "userEmail": "jan.kowalski@example.com",
    "userDisplayName": "Jan Kowalski"
  }
]
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/reservations/my \
  -b cookies.txt
```

---

### GET /api/reservations/:id

Szczegóły pojedynczej rezerwacji.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID rezerwacji

**Odpowiedź (sukces 200):** Płaski obiekt rezerwacji (bez pól z tabeli zamówień admina: `discountType`, `discountValue`, `orderAdminNote`):
```json
{
  "id": 1,
  "itemId": 1,
  "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
  "status": "pending",
  "createdAt": "2026-01-20T10:00:00.000Z",
  "adminNote": null,
  "adminOrderId": null,
  "customPrice": null,
  "itemName": "Dell Latitude 5420",
  "itemCategory": "laptop",
  "itemPrice": 1200.00,
  "userEmail": "jan.kowalski@example.com",
  "userDisplayName": "Jan Kowalski"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Reservation not found"
}
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/reservations/1 \
  -b cookies.txt
```

---

### POST /api/reservations

Utwórz nową rezerwację.

**Autentykacja:** Wymagana (requireAuth)

**Rate Limit:** 10 rezerwacji/godzinę per user (klucz: ID zalogowanego użytkownika)

**Content-Type:** `application/json`

**Parametry body:**
```json
{
  "itemId": 1
}
```

**Odpowiedź (sukces 201):** Rezerwacja bez pól administracyjnych (`adminNote`, `orderAdminNote`, `discountType`, `discountValue`) plus pole `emailSent`:
```json
{
  "id": 5,
  "itemId": 1,
  "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
  "status": "pending",
  "createdAt": "2026-01-20T10:30:00.000Z",
  "adminOrderId": null,
  "customPrice": null,
  "itemName": "Dell Latitude 5420",
  "itemCategory": "laptop",
  "itemPrice": 1200.00,
  "userEmail": "jan.kowalski@example.com",
  "userDisplayName": "Jan Kowalski",
  "emailSent": true
}
```

**Odpowiedź (błąd 400 - brak itemId):**
```json
{
  "error": "itemId is required"
}
```

**Odpowiedź (błąd 400 - limit aktywnych rezerwacji):**
```json
{
  "error": "Osiągnięto limit 3 aktywnych rezerwacji. Anuluj jedną z istniejących rezerwacji, aby móc zarezerwować nowy przedmiot."
}
```

**Odpowiedź (błąd 400 - przedmiot niedostępny):**
```json
{
  "error": "Ten przedmiot nie jest już dostępny. Odśwież stronę, aby zobaczyć aktualną listę."
}
```

**Odpowiedź (błąd 429 - rate limit):**
```json
{
  "error": "Zbyt wiele prób rezerwacji. Spróbuj ponownie za godzinę."
}
```

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/reservations \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"itemId":1}'
```

**Co się dzieje po utworzeniu:**
1. Ilość (`quantity`) przedmiotu zmniejsza się o 1
2. Gdy `quantity` spadnie do 0, status przedmiotu zmienia się na `reserved`
3. Email wysyłany do `NOTIFICATION_EMAIL` z danymi użytkownika (wynik w polu `emailSent`)

---

### POST /api/reservations/admin-order

Ręczne zamówienie admina - zbiorcza rezerwacja z opcjonalnym rabatem, omija limit 3 aktywnych rezerwacji i limiter 10/h.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `application/json`

**Parametry body:**
| Pole | Typ | Wymagane | Opis |
|------|-----|----------|------|
| itemId | int | TAK | ID przedmiotu |
| userId | string | TAK | ID użytkownika, dla którego składane jest zamówienie |
| quantity | int | NIE | Ilość sztuk (min 1, domyślnie 1) |
| adminNote | string | TAK | Notatka admina (niepusta) |
| discountType | string | NIE | Typ rabatu: `percent` lub `fixed` |
| discountValue | number | NIE | Wartość rabatu (>= 0; dla `percent` max 100, dla `fixed` max cena przedmiotu) |

**Odpowiedź (sukces 201):**
```json
{
  "success": true,
  "adminOrderId": "f2b9c9a4-8f4e-4c1a-9c2d-6a23cac87562",
  "count": 2,
  "reservations": [
    {
      "id": 8,
      "itemId": 1,
      "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
      "status": "pending",
      "createdAt": "2026-01-20T11:00:00.000Z",
      "adminOrderId": "f2b9c9a4-8f4e-4c1a-9c2d-6a23cac87562",
      "customPrice": 1080.00,
      "itemName": "Dell Latitude 5420",
      "itemCategory": "laptop",
      "itemPrice": 1200.00,
      "userEmail": "jan.kowalski@example.com",
      "userDisplayName": "Jan Kowalski"
    }
  ],
  "emailSent": true
}
```

**Odpowiedź (błąd 400):**
```json
{
  "error": "itemId i userId są wymagane"
}
```
```json
{
  "error": "Notatka admina jest wymagana"
}
```
```json
{
  "error": "Ilość musi być co najmniej 1"
}
```
```json
{
  "error": "Typ rabatu musi być \"percent\" lub \"fixed\""
}
```
```json
{
  "error": "Wartość rabatu musi być >= 0"
}
```
```json
{
  "error": "Rabat procentowy nie może przekroczyć 100%"
}
```
```json
{
  "error": "Rabat stały nie może przekroczyć ceny przedmiotu"
}
```
```json
{
  "error": "Użytkownik nie istnieje"
}
```
```json
{
  "error": "Nie udało się utworzyć zamówienia. Sprawdź czy przedmiot jest dostępny i ma wystarczającą ilość."
}
```

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/reservations/admin-order \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"itemId":1,"userId":"4947083a-cc9c-429f-9050-6a23cac87562","quantity":2,"adminNote":"Zamówienie działowe","discountType":"percent","discountValue":10}'
```

---

### POST /api/reservations/:id/complete

Finalizuj rezerwację (oznacz jako sprzedane).

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID rezerwacji

**Odpowiedź (sukces 200):**
```json
{
  "success": true
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Reservation not found"
}
```

**Co się dzieje:**
1. Rezerwacja jest przenoszona do historii ze statusem `completed` (z ceną z chwili sprzedaży)
2. Gdy to była ostatnia rezerwacja przedmiotu i jego `quantity` wynosi 0, status przedmiotu zmienia się na `sold`

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/reservations/1/complete \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### DELETE /api/reservations/my/:id

Anuluj własną rezerwację (dla pracowników).

**Autentykacja:** Wymagana (requireAuth)

**Parametry URL:**
- `id` - ID rezerwacji

**Odpowiedź (sukces 200):**
```json
{
  "success": true,
  "emailSent": true
}
```

**Odpowiedź (błąd 403 - cudza rezerwacja):**
```json
{
  "error": "You can only cancel your own reservations"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Reservation not found"
}
```

**Co się dzieje:**
1. Rezerwacja jest przenoszona do historii ze statusem `cancelled`
2. Ilość (`quantity`) przedmiotu zwiększa się o 1, a status wraca do `available`
3. Email o anulowaniu wysyłany do `NOTIFICATION_EMAIL`

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/reservations/my/5 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### DELETE /api/reservations/:id

Anuluj rezerwację (dla adminów).

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID rezerwacji

**Odpowiedź (sukces 200):**
```json
{
  "success": true,
  "emailSent": true
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Reservation not found"
}
```

**Co się dzieje:**
1. Rezerwacja jest przenoszona do historii ze statusem `cancelled`
2. Ilość (`quantity`) przedmiotu zwiększa się o 1, a status wraca do `available`
3. Przedmiot wraca do katalogu
4. Email o anulowaniu wysyłany do `NOTIFICATION_EMAIL`

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/reservations/1 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### PUT /api/reservations/:id/note

Ustaw lub wyczyść notatkę admina przy rezerwacji.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `application/json`

**Parametry URL:**
- `id` - ID rezerwacji

**Parametry body:**
```json
{
  "adminNote": "Odbiór w piątek"
}
```

Wartość `null` (lub pusty string / same białe znaki) czyści notatkę. Tekst jest trimowany przed zapisem.

**Odpowiedź (sukces 200):**
```json
{
  "success": true,
  "adminNote": "Odbiór w piątek"
}
```

**Odpowiedź (błąd 400):**
```json
{
  "error": "adminNote must be a string or null"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Reservation not found"
}
```

**Odpowiedź (błąd 500):**
```json
{
  "error": "Failed to update note"
}
```

**Przykład:**
```bash
curl -X PUT http://localhost:3000/api/reservations/1/note \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"adminNote":"Odbiór w piątek"}'
```

---

### GET /api/reservations/export/excel

Eksport rezerwacji do pliku Excel.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry query:**
| Pole | Typ | Wymagane | Opis |
|------|-----|----------|------|
| sort | string | NIE | Sortowanie: `date` (domyślnie), `user`, `item`, `category` |
| order | string | NIE | Kierunek: `asc` lub `desc` (domyślnie `desc`) |
| status | string | NIE | Filtr statusu (domyślnie `pending`); wartość `all` wyłącza filtr |

**Odpowiedź (sukces 200):** Plik `.xlsx` (binarny), nie JSON.
- `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- `Content-Disposition: attachment; filename="rezerwacje_<status>_<YYYY-MM-DD>.xlsx"` - gdzie `<status>` to `aktywne` (dla `pending`), `wszystkie` (dla `all`) lub nazwa statusu, np. `rezerwacje_aktywne_2026-07-08.xlsx`

Kolumny arkusza: ID, Data rezerwacji, Użytkownik, Email, Przedmiot, Kategoria, Cena katalogowa, Rabat, Cena końcowa, Status, Zam. admina, Nr zamówienia, Notatka admina.

**Przykład:**
```bash
curl -X GET "http://localhost:3000/api/reservations/export/excel?sort=user&order=asc&status=all" \
  -b cookies.txt \
  -o rezerwacje.xlsx
```

---

## Endpointy Favorites

Ulubione pozwalają pracownikom oznaczać przedmioty, do których chcą wrócić. Dotyczą wyłącznie przedmiotów widocznych w katalogu (`isVisible = 1`).

### GET /api/favorites/my

Lista ulubionych zalogowanego użytkownika (z danymi przedmiotów).

**Autentykacja:** Wymagana (requireAuth)

**Odpowiedź (sukces 200):**
```json
[
  {
    "id": 1,
    "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
    "itemId": 1,
    "createdAt": "2026-01-20T10:00:00.000Z",
    "itemName": "Dell Latitude 5420",
    "itemCategory": "laptop",
    "itemPrice": 1200.00,
    "itemImagePath": "/images/item-123.jpg",
    "itemStatus": "available"
  }
]
```

**Uwaga:** Zwracane są tylko ulubione dotyczące widocznych przedmiotów, posortowane od najnowszych.

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/favorites/my \
  -b cookies.txt
```

---

### GET /api/favorites/my/ids

Same ID ulubionych przedmiotów (szybkie sprawdzenie stanu, np. do renderowania serduszek w katalogu).

**Autentykacja:** Wymagana (requireAuth)

**Odpowiedź (sukces 200):**
```json
[1, 5, 12]
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/favorites/my/ids \
  -b cookies.txt
```

---

### POST /api/favorites

Dodaj przedmiot do ulubionych.

**Autentykacja:** Wymagana (requireAuth)

**Content-Type:** `application/json`

**Parametry body:**
```json
{
  "itemId": 5
}
```

**Odpowiedź (sukces 201):**
```json
{
  "id": 7,
  "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
  "itemId": 5,
  "createdAt": "2026-01-20T10:30:00.000Z"
}
```

**Odpowiedź (błąd 400 - brak itemId):**
```json
{
  "error": "itemId is required"
}
```

**Odpowiedź (błąd 400 - przedmiot nie istnieje, jest ukryty lub już jest w ulubionych):**
```json
{
  "error": "Nie można dodać do ulubionych"
}
```

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/favorites \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"itemId":5}'
```

---

### DELETE /api/favorites/:itemId

Usuń przedmiot z ulubionych.

**Autentykacja:** Wymagana (requireAuth)

**Parametry URL:**
- `itemId` - ID przedmiotu (nie ID wpisu ulubionych)

**Odpowiedź (sukces 200):**
```json
{
  "success": true
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Favorite not found"
}
```

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/favorites/5 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

### GET /api/favorites/history

Historia dodawania/usuwania ulubionych (dla adminów).

**Autentykacja:** Wymagana (requireAdmin)

**Parametry query:**
| Pole | Typ | Wymagane | Opis |
|------|-----|----------|------|
| limit | int | NIE | Liczba wpisów (domyślnie 50) |
| offset | int | NIE | Przesunięcie (domyślnie 0) |

**Odpowiedź (sukces 200):**
```json
[
  {
    "id": 21,
    "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
    "itemId": 5,
    "action": "add",
    "createdAt": "2026-01-20T10:30:00.000Z",
    "userEmail": "jan.kowalski@example.com",
    "userDisplayName": "Jan Kowalski",
    "itemName": "Dell Latitude 5420",
    "itemCategory": "laptop"
  }
]
```

Pole `action` przyjmuje wartości `add` lub `remove`. Wpisy posortowane od najnowszych.

**Przykład:**
```bash
curl -X GET "http://localhost:3000/api/favorites/history?limit=50&offset=0" \
  -b cookies.txt
```

---

## Endpointy Users

### GET /api/users

Lista wszystkich użytkowników.

**Autentykacja:** Wymagana (requireAdmin)

**Odpowiedź:**
```json
[
  {
    "id": "4947083a-cc9c-429f-9050-6a23cac87562",
    "email": "jan.kowalski@example.com",
    "displayName": "Jan Kowalski",
    "isAdmin": true,
    "createdAt": "2026-01-15T10:00:00.000Z",
    "lastLoginAt": "2026-01-20T09:17:19.607Z",
    "lastActivity": "2026-01-20T11:42:03.115Z"
  }
]
```

Pole `isAdmin` jest booleanem. Użytkownicy posortowani wg ostatniego logowania (najnowsi pierwsi).

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/users \
  -b cookies.txt
```

---

### PUT /api/users/:id/admin

Nadaj/odbierz uprawnienia admina.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `application/json`

**Parametry URL:**
- `id` - ID użytkownika

**Parametry body:**
```json
{
  "isAdmin": true
}
```

**Odpowiedź (sukces 200):**
```json
{
  "success": true
}
```

**Odpowiedź (błąd 400 - isAdmin nie jest booleanem):**
```json
{
  "error": "isAdmin must be a boolean"
}
```

**Odpowiedź (błąd 400 - próba odebrania sobie uprawnień):**
```json
{
  "error": "Cannot remove your own admin rights"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "User not found"
}
```

**Co się dzieje:**
- Email wysyłany do użytkownika o zmianie uprawnień
- Akcja logowana w audit log

**Przykład:**
```bash
curl -X PUT http://localhost:3000/api/users/abc123/admin \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"isAdmin":true}'
```

---

### DELETE /api/users/:id

Usuń użytkownika.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID użytkownika

**Odpowiedź (sukces 200):**
```json
{
  "success": true
}
```

**Odpowiedź (błąd 400 - próba usunięcia siebie):**
```json
{
  "error": "Cannot delete your own account"
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "User not found"
}
```

**Odpowiedź (błąd 500):**
```json
{
  "error": "Failed to delete user"
}
```

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/users/abc123 \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"
```

---

## Kody błędów

### 400 Bad Request

Błędne dane wejściowe.

```json
{
  "error": "Name and category are required"
}
```

**Przyczyny:**
- Brak wymaganych pól
- Nieprawidłowy format danych
- Walidacja nie przeszła

### 401 Unauthorized

Brak autentykacji.

```json
{
  "error": "Not authenticated"
}
```

**Przyczyny:**
- Brak sesji (nie zalogowany)
- Sesja wygasła (>7 dni bez żadnego requestu - cookie jest odświeżane przy każdym żądaniu)

**Rozwiązanie:** Zaloguj się ponownie

### 403 Forbidden

Brak uprawnień.

```json
{
  "error": "Admin access required"
}
```

**Przyczyny:**
- Endpoint wymaga uprawnień admina
- Użytkownik nie jest adminem

```json
{
  "error": "Invalid request origin"
}
```

**Przyczyny:**
- Ochrona CSRF: żądanie zmieniające stan (POST/PUT/DELETE/PATCH) z uwierzytelnioną sesją nie miało nagłówka `Origin`/`Referer` albo jego origin różni się od `BASE_URL`

**Rozwiązanie:** W skryptach/curl dodaj nagłówek `-H "Origin: http://localhost:3000"` (origin musi odpowiadać `BASE_URL`)

### 404 Not Found

Zasób nie znaleziony.

```json
{
  "error": "Item not found"
}
```

**Przyczyny:**
- Przedmiot/użytkownik/rezerwacja o danym ID nie istnieje
- Zasób został usunięty

### 429 Too Many Requests

Rate limit przekroczony.

```json
{
  "error": "Zbyt wiele prób rezerwacji. Spróbuj ponownie za godzinę."
}
```

**Przyczyny:**
- 10 rezerwacji/godzinę przekroczone

**Rozwiązanie:** Poczekaj 1 godzinę

### 500 Internal Server Error

Błąd serwera.

```json
{
  "error": "Internal server error"
}
```

**Przyczyny:**
- Bug w kodzie
- Błąd bazy danych
- Błąd SMTP (email)

**Rozwiązanie:** Skontaktuj się z IT, sprawdź logi serwera

---

## Przykłady użycia

### Scenariusz 1: Logowanie i przeglądanie katalogu

```bash
# 1. Zaloguj się (local)
curl -X POST http://localhost:3000/auth/local \
  -d "username=admin&password=haslo123" \
  -c cookies.txt \
  -L  # Follow redirect

# 2. Sprawdź kim jesteś
curl -X GET http://localhost:3000/auth/me \
  -b cookies.txt

# 3. Pobierz katalog
curl -X GET http://localhost:3000/api/items \
  -b cookies.txt
```

### Scenariusz 2: Dodanie przedmiotu przez admina

```bash
# 1. Dodaj przedmiot z 2 zdjęciami
curl -X POST http://localhost:3000/api/items \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -F "name=iPhone 12 Pro 128GB" \
  -F "category=phone" \
  -F "description=Stan bardzo dobry, bateria 85%" \
  -F "price=800" \
  -F "images=@iphone_front.jpg" \
  -F "images=@iphone_back.jpg"

# Odpowiedź: {"id":5,...}

# 2. Dodaj jeszcze jedno zdjęcie
curl -X POST http://localhost:3000/api/items/5/images \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -F "images=@iphone_screen.jpg"
```

### Scenariusz 3: Rezerwacja przez pracownika

```bash
# 1. Utwórz rezerwację
curl -X POST http://localhost:3000/api/reservations \
  -b cookies.txt \
  -H "Origin: http://localhost:3000" \
  -H "Content-Type: application/json" \
  -d '{"itemId":5}'

# Odpowiedź: {"id":10,"status":"pending",...,"emailSent":true}
# Email wysłany do admina
```

### Scenariusz 4: Finalizacja przez admina

```bash
# 1. Pobierz listę rezerwacji
curl -X GET http://localhost:3000/api/reservations \
  -b cookies.txt

# 2. Finalizuj rezerwację #10
curl -X POST http://localhost:3000/api/reservations/10/complete \
  -b cookies.txt \
  -H "Origin: http://localhost:3000"

# Przedmiot zmienia status na "sold"
```

### Scenariusz 5: JavaScript Fetch API

```javascript
// Login (redirect)
// Potem w aplikacji (przeglądarka wysyła nagłówek Origin automatycznie):

// Pobierz katalog
const items = await fetch('/api/items').then(r => r.json());

// Zarezerwuj przedmiot
const reservation = await fetch('/api/reservations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ itemId: 5 })
}).then(r => r.json());

// Dodaj przedmiot (admin)
const formData = new FormData();
formData.append('name', 'Laptop Dell');
formData.append('category', 'laptop');
formData.append('images', fileInput.files[0]);

const newItem = await fetch('/api/items', {
  method: 'POST',
  body: formData
}).then(r => r.json());
```

---

**Wersja API:** 1.0.0
**Ostatnia aktualizacja:** 2026-07-08
