# Flappy.one React Frontend

A React-based frontend for the Flappy.one multiplayer battle royale game.

## Quick Setup (3 steps)

### Step 1: Copy your assets folder
Your `public` folder needs the game sprites. Copy them from your original project:

```
flappy-one-react/
└── public/
    └── assets/
        └── sprites/
            ├── birds/
            │   ├── yellow/
            │   ├── blue/
            │   └── ... (all bird folders)
            ├── feathers/
            └── map/
```

If you extracted this next to your original project:
```bash
cp -r ../public/assets ./public/
```

### Step 2: Install dependencies
```bash
cd flappy-one-react
npm install
```

### Step 3: Run BOTH servers

**Terminal 1 - Your game server (in your ORIGINAL project folder):**
```bash
cd your-original-project
node server.js
```
This runs on port 3000.

**Terminal 2 - React dev server (in THIS folder):**
```bash
cd flappy-one-react
npm run dev
```
This runs on port 5173.

### Step 4: Open the game
Open http://localhost:5173 in your browser.

The React app connects to your game server at localhost:3000 for WebSocket communication.

---

## Why Two Servers?

```
┌─────────────────────────┐     WebSocket      ┌──────────────────────┐
│  React Dev Server       │ ───────────────►   │  Game Server         │
│  localhost:5173         │                    │  localhost:3000      │
│  (serves React UI)      │                    │  (game logic + WS)   │
└─────────────────────────┘                    └──────────────────────┘
         ▲
         │
      Browser
```

- **React server (5173)**: Hot-reloads your UI code
- **Game server (3000)**: Runs the actual multiplayer game

---

## Building for Production

When ready to deploy, build the React app and copy to your game server:

```bash
npm run build
cp -r dist/* ../public/
```

Then you only need to run `node server.js` - it will serve the built React files.

---

## Project Structure

```
flappy-one-react/
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── assets/sprites/   ← COPY YOUR SPRITES HERE
└── src/
    ├── main.jsx
    ├── App.jsx
    ├── config/gameConfig.js
    ├── hooks/useGameState.js
    └── components/
        ├── MainMenu.jsx/css
        ├── GameCanvas.jsx/css
        ├── GameHUD.jsx/css
        ├── DeathScreen.jsx/css
        └── CashoutScreen.jsx/css
```
