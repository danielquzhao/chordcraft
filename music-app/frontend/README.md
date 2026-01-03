# ChordCraft Frontend

This is the React frontend for ChordCraft, refactored from Firebase to work with a MERN stack backend.

## Features

- Virtual piano keyboard with real-time sound playback
- ABC notation rendering for sheet music visualization
- User authentication (JWT-based)
- Save and manage sheet music compositions
- Responsive design with custom styling

## Tech Stack

- **React 18** - UI framework
- **Vite** - Build tool and dev server
- **React Router** - Client-side routing
- **Axios** - HTTP client for API requests
- **ABCJS** - ABC notation rendering
- **React Toastify** - Toast notifications

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Update the `.env` file with your backend API URL:
   ```
   VITE_API_URL=http://localhost:5000/api
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Build for production:
   ```bash
   npm run build
   ```

## Project Structure

```
src/
├── components/          # React components
│   ├── AuthModal.jsx   # Authentication modal
│   ├── keyboard.jsx    # Piano keyboard component
│   ├── Modal.jsx       # Save music modal
│   └── saved.jsx       # Saved music list
├── contexts/           # React contexts
│   └── AuthContext.jsx # Authentication context
├── services/           # API service layer
│   ├── api.js         # Axios configuration & interceptors
│   ├── auth.js        # Authentication service
│   └── music.js       # Music CRUD operations
├── style/             # CSS styles
│   ├── keyboard.css   # Main styles
│   ├── saved.css      # Saved music styles
│   └── nav.css        # Navigation styles
├── fonts/             # Custom fonts
├── images/            # Static images
├── App.jsx            # Main app component
├── main.jsx           # Entry point
└── index.css          # Global styles
```

## API Integration

The frontend expects the following API endpoints:

### Authentication
- `POST /api/auth/signup` - Create new user account
- `POST /api/auth/signin` - Sign in existing user

### Music
- `GET /api/music` - Get all saved music for authenticated user
- `POST /api/music` - Save new sheet music
- `DELETE /api/music/:id` - Delete sheet music by ID
- `PUT /api/music/:id` - Update sheet music by ID

All authenticated requests include a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

## Authentication Flow

1. User signs up or signs in via the AuthModal
2. Backend returns a JWT token and user object
3. Token is stored in localStorage
4. Token is automatically included in all API requests via axios interceptor
5. On 401 response, token is cleared and user is redirected to home

## Development Notes

- The app uses localStorage for JWT token persistence
- Authentication state is managed via React Context
- All API calls go through the service layer for consistency
- MongoDB `_id` field is supported for document IDs
- Toast notifications provide user feedback for all operations

## Next Steps

To complete the MERN stack implementation:
1. Build the Express.js backend with MongoDB
2. Implement the authentication endpoints with JWT
3. Implement the music CRUD endpoints
4. Connect the frontend to the running backend
