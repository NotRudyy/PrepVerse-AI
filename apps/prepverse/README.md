# PrepVerse AI

This is a separate Next.js application. The existing StudyVerse app is not used or modified by it.

## Run locally

1. From `apps/prepverse-api`, run `./run-local.ps1`. On first launch it creates a local `.env` with a private session secret and starts the API on `http://localhost:8001`. The local API uses a persistent SQLite database at `apps/prepverse-api/var/prepverse.db`; Docker is not required for account sign-in.
2. From the repository root, run `pnpm install`, then `pnpm dev:prepverse`.
3. Open `http://localhost:3001` and create your account.

The first API launch may create a Python virtual environment and install `requirements.txt` if this new API does not already have one. You can use PostgreSQL instead with `docker compose up --build` from `apps/prepverse-api`.

The app does not create sample accounts or seeded study data. Use your own sign-in and upload your own course content. Documents must be text-readable PDF, PPTX, or DOCX files; scanned PDFs currently need OCR and are rejected with a clear message.

## Configure sign-in providers

Google and GitHub OAuth credentials are optional for local development but required to enable those buttons. Register callback URLs `http://localhost:8001/api/v1/auth/google/callback` and `http://localhost:8001/api/v1/auth/github/callback`, then set the matching client ID and secret in `apps/prepverse-api/.env` and restart the API. In production, register the matching HTTPS API callback URLs, set `PREPVERSE_WEB_ORIGIN`, `PREPVERSE_API_ORIGIN`, and `PREPVERSE_COOKIE_SECURE=true`.

## Configure Drift AI

Set `PREPVERSE_GEMINI_API_KEY` in the API environment. The configured model is `gemini-3.8-flash`; `PREPVERSE_GEMINI_MODEL` can select a supported model for the account and project. Drift, topic extraction, practice generation, planner drafts, and voice transcription are unavailable until a model key is configured and each learner has opted into AI data use in Settings.

Google's Gemini API free tier may use submitted content to improve Google products. PrepVerse therefore asks for explicit consent before sending notes, prompts, answers, or recordings. A published deployment must provide its privacy notice, set appropriate retention and access policies, and use HTTPS. The local Compose storage volume is for development; deploy uploads to a private durable object store before relying on it for production.

## Current service scope

The new API stores accounts, subjects, topic outlines, documents and extracted text, tutor history, practice results, mistakes, planner blocks, focus sessions, XP ledger entries, room membership and chat, voice-note transcriptions, and activity summaries in PostgreSQL. OAuth credentials and Gemini keys stay in the API environment. Password sessions use HttpOnly cookies.

This initial implementation does not provide email verification or password reset, OCR for image-only scans, a managed production object store, browser-to-browser video, automated email, or custom domain deployment. Configure those product and hosting services before publishing for public users.

