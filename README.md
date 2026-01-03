# ChordCraft 🎵
🎹 A modern CRUD web application that transforms piano performances into beautiful sheet music in real-time.

Built with the MERN stack (MongoDB, Express, React, Node.js).

## 🚀 Features

- **Interactive Piano**: A virtual keyboard that responds to user input with sound.
- **Real-time Notation**: Instant conversion of key presses into ABC notation.
- **Sheet Music Preview**: Dynamic rendering of sheet music as you play.
- **Composition Management**: Save, title, and manage your musical creations.
- **Secure Auth**: JWT-based user authentication to protect your work.

## 🛠️ Tech Stack

### Backend
- **Node.js & Express**: RESTful API server.
- **MongoDB & Mongoose**: Flexible NoSQL database for users and music storage.
- **JWT & Bcrypt**: Secure authentication and password hashing.

### Frontend
- **React**: Modern component-based UI.
- **Vite**: Ultra-fast build tool and dev server.
- **ABCJS**: Professional music notation rendering.
- **Axios**: Promised-based HTTP client for API requests.

## 🏗️ Project Structure

```
.
├── backend/           # Express.js API server
├── frontend/          # React + Vite web application
├── docs/             # Technical documentation
└── package.json      # Root package for workspace management
```

## 🚦 Prerequisites

- **Node.js** (v18 or higher)
- **npm** (v9 or higher)
- **MongoDB** (running locally or in the cloud)

## 🔧 Setup & Installation

### Root Setup
Install dependencies for both frontend and backend using npm workspaces:
```bash
npm run install-all
```

### Running Both
From the root directory, you can run both servers concurrently:
```bash
npm run dev
```

### Manual Setup
If you prefer to run them separately:

**Backend:**
```bash
cd backend
cp .env.example .env
npm run dev
```

**Frontend:**
```bash
cd frontend
cp .env.example .env
npm run dev
```

## 🔒 Environment Variables

### Backend (.env)
- `PORT` - Port for the backend server (default: 5001)
- `MONGODB_URI` - Your MongoDB connection string
- `JWT_SECRET` - Secret key for JWT signing

### Frontend (.env)
- `VITE_API_URL` - URL of the backend API

## 📄 License
This project is licensed under the MIT License.