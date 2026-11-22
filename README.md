# Chat App

A WhatsApp-style full-stack mobile chat app built with Expo, React Native, TypeScript, and a local Node.js backend powered by **Prisma ORM** and **PostgreSQL (Neon DB)**.

## Features

- Username/password login with automatic registration, salted `scrypt` password hashing, and persistent sessions (`AsyncStorage`)
- Chat list sorted by latest activity with message previews, relative timestamps, and pull-to-refresh
- Contact picker to start new DMs (reuses existing DMs instead of creating duplicates)
- Polling, cursor-based pagination for older messages, and delivery/read ticks (`✓` / `✓✓`)
- Image attachments with automatic downscaling, upload preview, optional captions, local disk storage, and authenticated image caching
- 100% local backend API with Prisma ORM + PostgreSQL (Neon DB)

## Prerequisites

- Node.js 20+
- A [Neon](https://console.neon.tech) PostgreSQL database connection string
- Expo Go app on iOS/Android (or a simulator/emulator)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file from `.env.example` and add your Neon PostgreSQL connection string:
   ```bash
   cp .env.example .env
   ```
   ```env
   DATABASE_URL="postgresql://<user>:<password>@<endpoint>.neon.tech/<dbname>?sslmode=require"
   PORT=3000
   ```
   *(Optional)* If you are testing on a physical phone over Wi-Fi instead of a simulator/emulator/web, also set your computer's local LAN IP in `.env`:
   ```env
   EXPO_PUBLIC_API_URL=http://<your-computer-lan-ip>:3000
   ```

3. Generate the Prisma client and push the schema to Neon DB:
   ```bash
   npm run db:generate
   npm run db:push
   ```

4. Start the local backend server (Terminal 1):
   ```bash
   npm run server
   ```

5. Start the Expo frontend (Terminal 2):
   ```bash
   npm start
   ```

## Scripts

- `npm run server` — start the local backend server on port `3000`
- `npm run db:generate` — generate the Prisma Client
- `npm run db:push` — push `prisma/schema.prisma` to Neon PostgreSQL
- `npm start` — start the Expo dev server
- `npm run android` — open on Android
- `npm run ios` — open on iOS
- `npm run web` — open in a web browser
- `npm run typecheck` — run `tsc --noEmit`

## Project Structure

```text
├── App.tsx                 # Auth bootstrap, session persistence, and screen switching
├── index.ts                # Expo entry point
├── prisma/
│   └── schema.prisma       # PostgreSQL (Neon DB) schema for Prisma ORM
├── server/
│   ├── index.mjs           # Local HTTP server with CORS and health check
│   ├── db.mjs              # Singleton PrismaClient instance
│   ├── auth.mjs            # Basic auth + salted scrypt password hashing
│   ├── routes.mjs          # Users, conversations, messages, and file routes
│   └── files.mjs           # Local file upload/download + Prisma metadata
└── src/
    ├── api.ts              # Typed REST client pointing to the local backend
    ├── theme.ts            # Colors, time formatting, and avatar colors
    ├── Avatar.tsx          # Initials avatar component
    ├── LoginScreen.tsx     # Login / auto-register screen
    ├── ChatListScreen.tsx  # Conversation list and contact picker modal
    └── ChatScreen.tsx      # Message thread, pagination, and image attachments
```
