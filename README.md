# Chat App

A WhatsApp-style mobile chat client built with Expo, React Native, and TypeScript.

## Features

- Username/password login with automatic registration and persistent sessions (`AsyncStorage`)
- Chat list sorted by latest activity with message previews, relative timestamps, and pull-to-refresh
- Contact picker to start new DMs (reuses existing DMs instead of creating duplicates)
- Real-time-style polling, cursor-based pagination for older messages, and delivery/read ticks (`✓` / `✓✓`)
- Image attachments with automatic downscaling, upload preview, optional captions, and authenticated image caching

## Prerequisites

- Node.js 18+
- Expo Go app on iOS/Android (or a simulator/emulator)
- The chat backend server running on your local network

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure the backend URL by creating a `.env` file in the project root (optional — defaults to `http://10.7.1.89:3000`):
   ```env
   EXPO_PUBLIC_API_URL=http://<your-server-ip>:3000
   ```

3. Start the Expo dev server:
   ```bash
   npm start
   ```

## Scripts

- `npm start` — start the Expo dev server
- `npm run android` — open on Android
- `npm run ios` — open on iOS
- `npm run web` — open in a web browser
- `npm run typecheck` — run `tsc --noEmit`

## Project Structure

```text
├── App.tsx                 # Auth bootstrap, session persistence, and screen switching
├── index.ts                # Expo entry point
└── src/
    ├── api.ts              # Typed REST client and Basic auth helper
    ├── theme.ts            # Colors, time formatting, and avatar colors
    ├── Avatar.tsx          # Initials avatar component
    ├── LoginScreen.tsx     # Login / auto-register screen
    ├── ChatListScreen.tsx  # Conversation list and contact picker modal
    └── ChatScreen.tsx      # Message thread, pagination, and image attachments
```
