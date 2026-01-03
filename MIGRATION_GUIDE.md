# ChordCraft: Firebase to MERN Migration Guide

## ✅ Completed: Frontend Extraction

The frontend has been successfully extracted and refactored to work with a MERN stack backend.

### Changes Made

1. **Removed Firebase Dependencies**
   - Removed `firebase` package from package.json
   - Deleted `src/firebase/firebase.js` configuration file
   - Removed all Firebase imports from components

2. **Added API Service Layer**
   - Created `src/services/api.js` - Axios instance with JWT interceptors
   - Created `src/services/auth.js` - Authentication operations
   - Created `src/services/music.js` - Music CRUD operations

3. **Updated Dependencies**
   - Added `axios@^1.6.5` for HTTP requests
   - Kept all other dependencies (React, React Router, ABCJS, React Toastify)

4. **Refactored Components**
   - `AuthContext.jsx` - Now uses localStorage and authService
   - `keyboard.jsx` - Uses musicService instead of Firebase Realtime Database
   - `saved.jsx` - Uses musicService with proper state management
   - All components now handle MongoDB `_id` field

5. **Environment Configuration**
   - Created `.env.example` with `VITE_API_URL`
   - Frontend expects backend at `http://localhost:5000/api` by default

### Frontend Structure

```
music-app/frontend/
├── src/
│   ├── components/
│   │   ├── AuthModal.jsx      ✅ Refactored
│   │   ├── keyboard.jsx       ✅ Refactored
│   │   ├── Modal.jsx          ✅ Compatible
│   │   └── saved.jsx          ✅ Refactored
│   ├── contexts/
│   │   └── AuthContext.jsx    ✅ Refactored
│   ├── services/              🆕 NEW
│   │   ├── api.js
│   │   ├── auth.js
│   │   └── music.js
│   ├── style/                 ✅ Preserved
│   ├── fonts/                 ✅ Preserved
│   └── images/                ✅ Preserved
├── .env.example               🆕 NEW
├── package.json               ✅ Updated
└── README.md                  ✅ Updated
```

## 🔄 Next Steps: Backend Implementation

To complete the MERN stack migration, you need to build the Express.js + MongoDB backend.

### Required API Endpoints

#### Authentication
```
POST /api/auth/signup
  Body: { email, password }
  Response: { token, user: { id, email } }

POST /api/auth/signin
  Body: { email, password }
  Response: { token, user: { id, email } }
```

#### Music (Protected Routes)
```
GET /api/music
  Headers: Authorization: Bearer <token>
  Response: [{ _id, notation, title, description, timestamp, userId }]

POST /api/music
  Headers: Authorization: Bearer <token>
  Body: { notation, title, description }
  Response: { _id, notation, title, description, timestamp, userId }

DELETE /api/music/:id
  Headers: Authorization: Bearer <token>
  Response: { message: "Deleted successfully" }

PUT /api/music/:id
  Headers: Authorization: Bearer <token>
  Body: { notation?, title?, description? }
  Response: { _id, notation, title, description, timestamp, userId }
```

### MongoDB Schema

#### User Model
```javascript
{
  email: String (required, unique),
  password: String (required, hashed),
  createdAt: Date
}
```

#### Music Model
```javascript
{
  userId: ObjectId (ref: 'User'),
  notation: String (required),
  title: String (required),
  description: String,
  timestamp: Number,
  createdAt: Date
}
```

### Backend Tech Stack Recommendations

- **Express.js** - Web framework
- **MongoDB + Mongoose** - Database and ODM
- **bcryptjs** - Password hashing
- **jsonwebtoken** - JWT authentication
- **cors** - CORS middleware
- **dotenv** - Environment variables

### Suggested Backend Structure

```
backend/
├── src/
│   ├── models/
│   │   ├── User.js
│   │   └── Music.js
│   ├── routes/
│   │   ├── auth.js
│   │   └── music.js
│   ├── middleware/
│   │   └── auth.js
│   ├── config/
│   │   └── db.js
│   └── server.js
├── .env
├── .env.example
└── package.json
```

## 🎨 Preserved Features

All existing UI/UX features have been preserved:
- ✅ Virtual piano keyboard with sound
- ✅ Real-time ABC notation rendering
- ✅ Sheet music preview
- ✅ Save/delete compositions
- ✅ User authentication flow
- ✅ Toast notifications
- ✅ Responsive design
- ✅ Custom purple theme styling
- ✅ Poppins font

## 🧪 Testing the Frontend

The frontend has been successfully built and compiles without errors:

```bash
cd music-app/frontend
npm install
npm run build  # ✅ Successful
```

To test the frontend with a backend:
1. Build the backend with the required endpoints
2. Start the backend server (port 5000)
3. Create `.env` in frontend with `VITE_API_URL=http://localhost:5000/api`
4. Run `npm run dev` in the frontend directory
5. Open http://localhost:5173

## 📝 Notes

- Frontend uses localStorage for JWT token persistence
- Tokens automatically included in all API requests via axios interceptor
- On 401 response, user is automatically logged out and redirected
- All styling has been preserved exactly as it was
- The app is ready to connect to a backend once it's implemented
