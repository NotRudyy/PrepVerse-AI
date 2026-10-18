# PrepVerse AI

PrepVerse AI is a study workspace for course materials, Drift AI tutoring, practice, planning, focus sessions, study rooms, and progress tracking.

## Local development

1. Install Node.js, pnpm, and Python 3.12 or newer.
2. In `apps/prepverse-api`, copy `.env.example` to `.env` or run `run-local.ps1` to create a local secret and SQLite database. Start the API on port 8001.
3. At the repository root, run `pnpm install` and `pnpm dev:prepverse`.
4. Open `http://localhost:3001`.

The app has no sample accounts or seeded study activity. Create an account and add your course details and study materials.

## Deployment layout

This repository contains the Next.js web app at `apps/prepverse` and its FastAPI service at `apps/prepverse-api`. They must be deployed as separate services, with the frontend configured to use the public HTTPS API URL.

The API needs a durable PostgreSQL database, private durable storage for source files and voice recordings, HTTPS cookie settings, and a private JWT secret. Google/GitHub sign-in and Drift AI also require provider credentials. The API currently writes uploaded files to local disk, so it needs a durable storage adapter before it can safely run on a serverless host. Do not publish a production deployment until those services and environment variables are configured.

## Supported material formats

PDF, PPTX, and DOCX files with extractable text are supported. Image-only scanned PDFs need OCR, which is not currently implemented.
