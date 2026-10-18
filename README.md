# PrepVerse AI

PrepVerse AI is a study workspace for course materials, Drift AI tutoring, practice, planning, focus sessions, study rooms, and progress tracking.

## Local development

1. Install Node.js, pnpm, and Python 3.12 or newer.
2. In `apps/prepverse-api`, copy `.env.example` to `.env` or run `run-local.ps1` to create a local secret and SQLite database. Start the API on port 8001.
3. At the repository root, run `pnpm install` and `pnpm dev:prepverse`.
4. Open `http://localhost:3001`.

The app has no sample accounts or seeded study activity. Create an account and add your course details and study materials.

## Vercel deployment

The root vercel.json configures the Next.js frontend and FastAPI backend as one Vercel Services project. Requests under /api/ route to FastAPI; all other paths route to Next.js, so browser requests and secure cookies use the same origin. The API entrypoint is apps/prepverse-api/index.py.

Before deploying, set these project environment variables in Vercel:

- NEXT_PUBLIC_PREPVERSE_API_URL=/api/v1: same-origin API path; the production frontend also defaults to this path.
- PREPVERSE_DATABASE_URL: a persistent PostgreSQL URL. Use a pooled connection for serverless, formatted for psycopg as postgresql+psycopg://...
- PREPVERSE_JWT_SECRET: a new private random value of at least 32 characters.
- PREPVERSE_WEB_ORIGIN and PREPVERSE_API_ORIGIN: the production Vercel origin, for example https://prepverse-ai.vercel.app.
- PREPVERSE_COOKIE_SECURE=true.
- PREPVERSE_GEMINI_API_KEY for Drift AI, document analysis, and voice transcription.
- PREPVERSE_GOOGLE_CLIENT_ID and PREPVERSE_GOOGLE_CLIENT_SECRET, plus the matching provider callback URL, to enable Google sign-in.
- PREPVERSE_GITHUB_CLIENT_ID and PREPVERSE_GITHUB_CLIENT_SECRET, plus the matching provider callback URL, to enable GitHub sign-in.

The Vercel API stores source material and voice audio as PostgreSQL binary data instead of writing to temporary function disk. Vercel Functions have a 4.5 MB request and response payload limit, so the API defaults to a 4 MB upload limit on Vercel; larger uploads need a direct-to-object-storage upload flow.

The site requires a persistent PostgreSQL database to preserve accounts, study activity, uploaded materials, and audio across function restarts. The repository does not contain database or provider secrets. Do not deploy until the PostgreSQL URL and JWT secret are configured; set provider credentials in Vercel only after adding the production callback URLs to each provider.

## Supported material formats

PDF, PPTX, and DOCX files with extractable text are supported. Image-only scanned PDFs need OCR, which is not currently implemented.
