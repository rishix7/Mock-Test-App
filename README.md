# Minute — timed test MVP

A mobile-first Next.js and Firebase MVP for creating tests from JSON, taking them one timed question at a time, and reviewing scores by category.

## Run locally

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env.local` and fill in the Firebase web app configuration.
3. In Firebase, create a Firestore database.
4. Install dependencies with `npm install` and start the app with `npm run dev`.
5. Open `http://localhost:3000`.

Without Firebase configuration, the built-in sample test can still be taken. Creating or saving tests and persisting attempts require Firestore.

## Firestore

The app uses a `tests` collection for test definitions and an `attempts` collection for completed attempts. Configure Firestore security rules before sharing a deployment. This MVP has no authentication, so its client-side rules cannot identify individual participants. Also, correct answers are included in test documents delivered to the browser; this is suitable only for a low-stakes MVP.

## Branch and preview workflow

The current working branch is `rishi`. Push it and open a pull request into `dev` for review. Keep `main` for production. In Vercel, import the Git repository and use `dev` as the preview branch; configure the Firebase `NEXT_PUBLIC_FIREBASE_*` variables in the Vercel project settings for the Preview environment. Production can be connected to `main` when the team is ready.

## MVP behavior

- JSON import is validated before preview; the preview supports editing the test title, description, category, and timer.
- Each question has an independent timer. Pause stops the countdown and blocks the test screen; time expiry records an unanswered item and advances.
- Completed attempts are separate Firestore documents. Analytics show score, per-category performance, categories below 70%, and answer review.
- Unanswered questions count as incorrect. Category percentages use all questions answered or timed out in that category.
