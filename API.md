# API Documentation - IT Equipment Outlet

Szczegółowa dokumentacja REST API dla aplikacji IT Equipment Outlet.

## Spis treści

- [Przegląd](#przegląd)
- [Autentykacja](#autentykacja)
- [Endpointy Auth](#endpointy-auth)
- [Endpointy Items](#endpointy-items)
- [Endpointy Reservations](#endpointy-reservations)
- [Endpointy Users](#endpointy-users)
- [Kody błędów](#kody-błędów)
- [Przykłady użycia](#przykłady-użycia)

## Przegląd

### Base URL

```
http://localhost:3000
```

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
1. User loguje się przez `/auth/microsoft` lub `/auth/local-login`
2. Serwer ustawia cookie `connect.sid` (HTTPOnly, Secure w prod)
3. Przeglądarka automatycznie wysyła cookie z każdym requestem
4. Middleware `requireAuth` sprawdza sesję

**Cookie:**
```
Name: connect.sid
Value: s%3A<session-id>.<signature>
Path: /
HttpOnly: true
Secure: true (production)
Max-Age: 86400 (24h)
```

### Middleware

Wszystkie endpointy (poza `/auth/*`) wymagają autentykacji.

```typescript
// src/middleware/auth.middleware.ts

// Wymaga zalogowania
export function requireAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Wymaga uprawnień admina
export function requireAdmin(req, res, next) {
  if (!req.isAuthenticated() || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}
```

## Endpointy Auth

### GET /auth/login

Strona wyboru metody logowania (HTML).

**Autentykacja:** Nie wymagana

**Odpowiedź:**
```html
<!DOCTYPE html>
<html>
  <!-- Formularz wyboru: Microsoft / Local -->
</html>
```

---

### GET /auth/microsoft

Redirect do Microsoft OAuth login.

**Autentykacja:** Nie wymagana

**Flow:**
1. Redirect do `login.microsoftonline.com`
2. User loguje się w Microsoft
3. Callback do `/auth/callback`

**Parametry:** Brak

**Odpowiedź:** 302 Redirect

---

### GET /auth/callback

Microsoft OAuth callback (nie wywoływać ręcznie).

**Autentykacja:** Nie wymagana

**Parametry query:**
- `code` - Authorization code z Microsoft
- `state` - CSRF token

**Odpowiedź:**
- Sukces: 302 Redirect do `/`
- Błąd: 302 Redirect do `/auth/login?error=...`

---

### GET /auth/local-login

Formularz logowania lokalnego (HTML).

**Autentykacja:** Nie wymagana

**Parametry query:**
- `error` (opcjonalny) - Komunikat błędu do wyświetlenia

**Odpowiedź:**
```html
<!DOCTYPE html>
<html>
  <!-- Formularz: username + password -->
</html>
```

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

**Rate limiting:**
- 5 prób per konto
- Blokada: 15 minut

**Przykład (curl):**
```bash
curl -X POST http://localhost:3000/auth/local \
  -d "username=admin&password=haslo123" \
  -c cookies.txt
```

---

### POST /auth/logout

Wylogowanie użytkownika.

**Autentykacja:** Wymagana sesja użytkownika

**Odpowiedź:** 302 Redirect do `/auth/login`

**Przykład:**
```bash
curl -X POST http://localhost:3000/auth/logout \
  -b cookies.txt
```

---

### GET /auth/me

Informacje o zalogowanym użytkowniku.

**Autentykacja:** Wymagana (requireAuth)

**Odpowiedź (zalogowany):**
```json
{
  "id": "4947083a-cc9c-429f-9050-6a23cac87562",
  "email": "jan.kowalski@example.com",
  "displayName": "Jan Kowalski",
  "isAdmin": true
}
```

**Odpowiedź (niezalogowany):**
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

**Filtry:** Automatyczne - tylko `status = 'available'`

**Odpowiedź:**
```json
[
  {
    "id": 1,
    "name": "Dell Monitor 24 cale",
    "description": "Stan bardzo dobry, full HD",
    "category": "monitor",
    "imagePath": "/images/item-123.jpg",
    "price": 150.00,
    "status": "available",
    "createdAt": "2026-01-15T10:00:00.000Z",
    "images": [
      {
        "id": 1,
        "imagePath": "/images/item-123.jpg",
        "sortOrder": 0
      },
      {
        "id": 2,
        "imagePath": "/images/item-124.jpg",
        "sortOrder": 1
      }
    ]
  }
]
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/items \
  -b cookies.txt
```

---

### GET /api/items/all

Lista wszystkich przedmiotów (w tym zarezerwowane i sprzedane).

**Autentykacja:** Wymagana (requireAdmin)

**Odpowiedź:** Jak `/api/items`, ale wszystkie statusy.

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
  "name": "Dell Monitor 24 cale",
  "description": "Stan bardzo dobry, full HD",
  "category": "monitor",
  "imagePath": "/images/item-123.jpg",
  "price": 150.00,
  "status": "available",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "images": [
    {
      "id": 1,
      "imagePath": "/images/item-123.jpg",
      "sortOrder": 0
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
| images | file[] | NIE | Zdjęcia (max 10, max 10MB/plik, JPEG/PNG/GIF/WebP) |

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
  "images": [
    {
      "id": 10,
      "imagePath": "/images/item-1737373200000-123456789.jpg",
      "sortOrder": 0
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

**Przykład (curl):**
```bash
curl -X POST http://localhost:3000/api/items \
  -b cookies.txt \
  -F "name=iPhone 12 Pro" \
  -F "category=phone" \
  -F "description=Stan dobry" \
  -F "price=800" \
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
| category | string | Kategoria |
| description | string | Opis |
| price | number | Cena |
| status | string | Status (available/reserved/sold) |
| image | file | Nowe główne zdjęcie (legacy, lepiej użyć `/api/items/:id/images`) |

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Monitor 24\" (zaktualizowany)",
  "description": "Nowy opis",
  "category": "monitor",
  "imagePath": "/images/item-123.jpg",
  "price": 120.00,
  "status": "available",
  "createdAt": "2026-01-15T10:00:00.000Z"
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
  -F "name=Dell Monitor 24\" (refurbished)" \
  -F "price=120"
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

**Uwaga:** Usuwa też wszystkie zdjęcia (CASCADE) i pliki z dysku.

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/items/1 \
  -b cookies.txt
```

---

### POST /api/items/:id/images

Dodaj zdjęcia do istniejącego przedmiotu.

**Autentykacja:** Wymagana (requireAdmin)

**Content-Type:** `multipart/form-data`

**Parametry URL:**
- `id` - ID przedmiotu

**Parametry body:**
- `images` - Pliki zdjęć (max 10)

**Odpowiedź (sukces 200):**
```json
{
  "id": 1,
  "name": "Dell Monitor 24",
  ...
  "images": [
    { "id": 1, "imagePath": "/images/item-123.jpg", "sortOrder": 0 },
    { "id": 2, "imagePath": "/images/item-124.jpg", "sortOrder": 1 },
    { "id": 3, "imagePath": "/images/item-125.jpg", "sortOrder": 2 }
  ]
}
```

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/items/1/images \
  -b cookies.txt \
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
  "name": "Dell Monitor 24",
  ...
  "images": [
    { "id": 1, "imagePath": "/images/item-123.jpg", "sortOrder": 0 }
  ]
}
```

**Odpowiedź (błąd 404):**
```json
{
  "error": "Image not found"
}
```

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/items/1/images/2 \
  -b cookies.txt
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
  "name": "Dell Monitor 24",
  ...
  "images": [
    { "id": 2, "imagePath": "/images/item-124.jpg", "sortOrder": 0 },
    { "id": 1, "imagePath": "/images/item-123.jpg", "sortOrder": 1 },
    { "id": 3, "imagePath": "/images/item-125.jpg", "sortOrder": 2 }
  ]
}
```

**Przykład:**
```bash
curl -X PUT http://localhost:3000/api/items/1/images/order \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"imageOrder":[{"id":2,"sortOrder":0},{"id":1,"sortOrder":1}]}'
```

---

## Endpointy Reservations

### GET /api/reservations

Lista wszystkich rezerwacji (dla adminów).

**Autentykacja:** Wymagana (requireAdmin)

**Odpowiedź:**
```json
[
  {
    "id": 1,
    "itemId": 1,
    "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
    "status": "pending",
    "createdAt": "2026-01-20T10:00:00.000Z",
    "item": {
      "id": 1,
      "name": "Dell Monitor 24",
      "imagePath": "/images/item-123.jpg"
    },
    "user": {
      "id": "4947083a-cc9c-429f-9050-6a23cac87562",
      "email": "jan.kowalski@example.com",
      "displayName": "Jan Kowalski"
    }
  }
]
```

**Przykład:**
```bash
curl -X GET http://localhost:3000/api/reservations \
  -b cookies.txt
```

---

### POST /api/reservations

Utwórz nową rezerwację.

**Autentykacja:** Wymagana (requireAuth)

**Rate Limit:** 10 rezerwacji/godzinę per user

**Content-Type:** `application/json`

**Parametry body:**
```json
{
  "itemId": 1
}
```

**Odpowiedź (sukces 201):**
```json
{
  "id": 5,
  "itemId": 1,
  "userId": "4947083a-cc9c-429f-9050-6a23cac87562",
  "status": "pending",
  "createdAt": "2026-01-20T10:30:00.000Z"
}
```

**Odpowiedź (błąd 400 - przedmiot niedostępny):**
```json
{
  "error": "Item not available"
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
  -H "Content-Type: application/json" \
  -d '{"itemId":1}'
```

**Co się dzieje po utworzeniu:**
1. Status przedmiotu zmienia się na `reserved`
2. Email wysyłany do `NOTIFICATION_EMAIL` z danymi użytkownika

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
1. Status rezerwacji zmienia się na `completed`
2. Status przedmiotu zmienia się na `sold`

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/reservations/1/complete \
  -b cookies.txt
```

---

### POST /api/reservations/:id/cancel

Anuluj rezerwację.

**Autentykacja:** Wymagana (requireAdmin)

**Parametry URL:**
- `id` - ID rezerwacji

**Odpowiedź (sukces 200):**
```json
{
  "success": true
}
```

**Co się dzieje:**
1. Status rezerwacji zmienia się na `cancelled`
2. Status przedmiotu zmienia się na `available`
3. Przedmiot wraca do katalogu

**Przykład:**
```bash
curl -X POST http://localhost:3000/api/reservations/1/cancel \
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
    "lastLogin": "2026-01-20T09:17:19.607Z",
    "createdAt": "2026-01-15T10:00:00.000Z"
  }
]
```

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

**Odpowiedź (błąd 400 - próba odebrania sobie uprawnień):**
```json
{
  "error": "Cannot remove your own admin rights"
}
```

**Co się dzieje:**
- Email wysyłany do użytkownika o zmianie uprawnień
- Akcja logowana w audit log

**Przykład:**
```bash
curl -X PUT http://localhost:3000/api/users/abc123/admin \
  -b cookies.txt \
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

**Przykład:**
```bash
curl -X DELETE http://localhost:3000/api/users/abc123 \
  -b cookies.txt
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
  "error": "Unauthorized"
}
```

**Przyczyny:**
- Brak sesji (nie zalogowany)
- Sesja wygasła (>24h)

**Rozwiązanie:** Zaloguj się ponownie

### 403 Forbidden

Brak uprawnień.

```json
{
  "error": "Forbidden"
}
```

**Przyczyny:**
- Endpoint wymaga uprawnień admina
- Użytkownik nie jest adminem

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
  -F "images=@iphone_screen.jpg"
```

### Scenariusz 3: Rezerwacja przez pracownika

```bash
# 1. Utwórz rezerwację
curl -X POST http://localhost:3000/api/reservations \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"itemId":5}'

# Odpowiedź: {"id":10,"status":"pending",...}
# Email wysłany do admina
```

### Scenariusz 4: Finalizacja przez admina

```bash
# 1. Pobierz listę rezerwacji
curl -X GET http://localhost:3000/api/reservations \
  -b cookies.txt

# 2. Finalizuj rezerwację #10
curl -X POST http://localhost:3000/api/reservations/10/complete \
  -b cookies.txt

# Przedmiot zmienia status na "sold"
```

### Scenariusz 5: JavaScript Fetch API

```javascript
// Login (redirect)
// Potem w aplikacji:

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
**Ostatnia aktualizacja:** 2026-01-20
