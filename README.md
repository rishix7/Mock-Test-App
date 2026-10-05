# Minute — source-based test MVP

Minute is a Next.js static frontend backed by Firebase Authentication and Firestore. Creators can publish tests from reviewed JSON or generate them from a prompt plus image using a hosted vision model. Participant attempts are private to the signed-in account; a trusted Firebase Function writes anonymous timing aggregates.

## Run the app

1. Install Node.js 20 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local`, fill in the Firebase web-app settings, and restart the app.
3. Enable **Email/Password** in Firebase Authentication.
4. Start the app with `npm run dev` and open `http://localhost:3000`.

The Attend screen and sample test can be explored without Firebase, but participant sign-in, test publishing, and saved attempts need Firebase and a Firestore database.

## Image + prompt question generation

The creator enters instructions, question count, and difficulty, then uploads up to 3 PNG/JPEG/WebP images (8 MB each, 15 MB total). A Firebase HTTPS Function first asks the vision model whether every image is readable and relevant. If not, generation stops and the UI asks for a better image. If accepted, a second model request generates a validated multiple-choice JSON draft. The creator must review it before publishing. Uploaded images are sent in memory for inference and are not stored in Firebase.

The integration uses Groq's free-tier API with `qwen/qwen3.8-27b`, a hosted vision-capable open-weight model with JSON mode. Groq's current limits include a maximum of 3 images per request and account/model-specific rate limits; the provider can change its free tier. See [Groq image/JSON input docs](https://console.groq.com/docs/vision) and [rate limits](https://console.groq.com/docs/rate-limits).

The API key is never sent to the browser. After obtaining a Groq API key, store it as a Firebase secret (do not put it in `.env.local` or commit it):

```powershell
firebase functions:secrets:set GROQ_API_KEY
```

Deploy the generator and Hosting rewrite with Firebase CLI:

```powershell
firebase deploy --only functions:generateTest,hosting
```

**Billing note:** Groq inference has free-tier limits, but deploying Cloud Functions requires Firebase's Blaze plan and a linked billing account. Firebase's Functions usage may have no-cost quotas, but deployment/storage and usage are not guaranteed to cost exactly zero. Do not deploy until the project owner approves linking billing. The project code is implemented; no API secret has been set and no function has been deployed from this workspace.

The free inference API is rate-limited (the app also enforces a best-effort maximum of 5 generations per IP per hour). On quota exhaustion, generation stops with an error; there is no paid fallback. Model output may still be wrong, so human review remains required.

## Firebase setup and deployment

This branch builds a static export into `out/`; Firebase Hosting serves those files. In the Firebase console, enable Email/Password Authentication and create Firestore only after the team selects the database's permanent region. Do not create a database just to deploy this branch: Firestore region is a permanent setup choice.

After the team confirms the database location, configure Firebase CLI for the intended project, deploy `firestore.rules`, and deploy `functions/aggregateAttempt` in a supported region near Firestore. Cloud Functions deployment requires the project's Blaze plan. Do not deploy the analytics trigger until the team approves that requirement and confirms the database region. The function stores only attempt count, total active duration, per-question time totals/counts, and a processed-attempt marker; it does not expose individual attempts.

Then run `npm run build` and deploy Hosting with Firebase CLI. Participants can take published tests from the hosted site.

## Data and privacy notes

- `tests` are publicly readable and can be created without creator accounts, matching the public-creator requirement. Client rules prohibit changing/deleting a published test.
- `attempts` require Firebase sign-in; rules allow a participant to create and read only documents whose `userId` matches their Firebase UID.
- `testStats` are publicly readable anonymized aggregates and are writable only by the trusted function. `processedAttempts` prevents a retried event from being counted twice.
- Test documents contain correct answers delivered to the browser. This is suitable for a low-stakes practice MVP, not a high-stakes/proctored exam.
- Run `npm run build` for a static production export. The hosted static app uses the HTTPS Function rewrite for AI generation; it does not contain the API key or model weights.
