# CampusBytes

A lightweight hostel mess verification system built to make student check-ins faster and more secure. 

Instead of manual paper logs, this project uses QR code scanning and biometric authentication (like Face ID or Touch ID) to verify students at the mess quickly.

## Features

- **Biometric Check-ins**: Secure, passwordless authentication using WebAuthn.
- **QR Code Scanning**: Built-in QR scanner for quick student ID verification.
- **Student Dashboard**: A simple interface for students to manage their account and passkeys.
- **Admin Tools**: Straightforward monitoring and management of daily mess check-ins.

## Tech Stack

- **Framework**: Next.js 
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: WebAuthn (SimpleWebAuthn) & JWTs
- **Styling**: Tailwind CSS 

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up your environment variables (you'll need a PostgreSQL database URL).

3. Generate the Prisma client and push the schema to your database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app.
