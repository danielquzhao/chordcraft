# ChordCraft API Contract

This document defines the API contract between the frontend and backend.

## Base URL
```
http://localhost:5000/api
```

## Authentication

### Sign Up
**Endpoint:** `POST /api/auth/signup`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (201):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com"
  }
}
```

**Errors:**
- 400: Invalid email or password format
- 409: Email already exists

---

### Sign In
**Endpoint:** `POST /api/auth/signin`

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com"
  }
}
```

**Errors:**
- 400: Missing email or password
- 401: Invalid credentials
- 404: User not found

---

## Music (Protected Routes)

All music endpoints require authentication via JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

### Get All Music
**Endpoint:** `GET /api/music`

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
[
  {
    "_id": "507f1f77bcf86cd799439011",
    "userId": "507f1f77bcf86cd799439012",
    "notation": "C D E F | G A B c |",
    "title": "My First Song",
    "description": "A simple melody",
    "timestamp": 1704240000000,
    "createdAt": "2024-01-02T12:00:00.000Z"
  },
  {
    "_id": "507f1f77bcf86cd799439013",
    "userId": "507f1f77bcf86cd799439012",
    "notation": "[C E G] [D F A] |",
    "title": "Chord Progression",
    "description": "",
    "timestamp": 1704326400000,
    "createdAt": "2024-01-03T12:00:00.000Z"
  }
]
```

**Errors:**
- 401: Unauthorized (invalid or missing token)

---

### Save New Music
**Endpoint:** `POST /api/music`

**Headers:**
```
Authorization: Bearer <token>
```

**Request:**
```json
{
  "notation": "C D E F | G A B c |",
  "title": "My Song",
  "description": "Optional description"
}
```

**Response (201):**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "userId": "507f1f77bcf86cd799439012",
  "notation": "C D E F | G A B c |",
  "title": "My Song",
  "description": "Optional description",
  "timestamp": 1704240000000,
  "createdAt": "2024-01-02T12:00:00.000Z"
}
```

**Errors:**
- 400: Missing required fields (notation, title)
- 401: Unauthorized

---

### Delete Music
**Endpoint:** `DELETE /api/music/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**URL Parameters:**
- `id` - MongoDB ObjectId of the music document

**Response (200):**
```json
{
  "message": "Sheet music deleted successfully"
}
```

**Errors:**
- 401: Unauthorized
- 403: Forbidden (user doesn't own this music)
- 404: Music not found

---

### Update Music
**Endpoint:** `PUT /api/music/:id`

**Headers:**
```
Authorization: Bearer <token>
```

**URL Parameters:**
- `id` - MongoDB ObjectId of the music document

**Request:**
```json
{
  "notation": "C D E F | G A B c | [CEG] |",
  "title": "Updated Song Title",
  "description": "Updated description"
}
```

All fields are optional. Only provided fields will be updated.

**Response (200):**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "userId": "507f1f77bcf86cd799439012",
  "notation": "C D E F | G A B c | [CEG] |",
  "title": "Updated Song Title",
  "description": "Updated description",
  "timestamp": 1704240000000,
  "createdAt": "2024-01-02T12:00:00.000Z",
  "updatedAt": "2024-01-02T14:30:00.000Z"
}
```

**Errors:**
- 400: Invalid data
- 401: Unauthorized
- 403: Forbidden (user doesn't own this music)
- 404: Music not found

---

## Error Response Format

All errors follow this format:

```json
{
  "message": "Error description",
  "error": "Optional detailed error information"
}
```

## Token Format

JWT tokens should contain:
```javascript
{
  "userId": "507f1f77bcf86cd799439012",
  "email": "user@example.com",
  "iat": 1704240000,
  "exp": 1704326400
}
```

Token expiration: 24 hours recommended

## CORS Configuration

Backend should allow requests from:
- `http://localhost:5173` (Vite dev server)
- Your production frontend domain

## Notes

1. All timestamps are in milliseconds (Unix timestamp)
2. Password must be hashed using bcrypt before storing
3. All music queries should be filtered by userId from the token
4. MongoDB `_id` field is used throughout (not `id`)
5. The frontend handles both `_id` and `id` for compatibility
