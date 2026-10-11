# Minute — source-based test MVP

Minute is a Next.js static frontend backed by Firebase Authentication and Firestore. Creators can generate test drafts from a prompt and images, edit the generated questions and answers, and publish approved tests. Participant attempts are private to the signed-in account; a Firebase Function writes anonymized timing aggregates.

## Run the app

1. Install Node.js 20 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local`, fill in the Firebase web-app settings, and restart the app.
3. Enable **Email/Password** in Firebase Authentication.
4. Start the app with `npm run dev` and open `http://localhost:3000`.

The Attend screen and sample test can be explored without Firebase, but participant sign-in, test publishing, and saved attempts need Firebase and a Firestore database.

## Image + prompt question generation

The creator enters instructions, question count, and difficulty, then uploads up to 3 PNG/JPEG/WebP images (8 MB each, 15 MB total). The Firebase HTTPS Function sends the images and prompt to Google's `gemini-flash-latest` vision model. The model first assesses whether every image is readable and relevant; unsuitable images are rejected with a helpful message. For accepted images, it generates a schema-constrained multiple-choice JSON draft with optional source-image indexes for the question and each choice. The backend validates those references and sends the structured test to the editable review screen. Raw JSON is not shown in the UI.

During review, the creator can change which source diagram appears with the question or any choice. Only linked diagrams are resized and compressed (maximum 600 KiB each), then saved as separate documents under `tests/{testId}/diagrams`; the test list does not download these images. The attendee loads diagrams when opening the selected test. This uses Firestore, not Firebase Storage, and is intended to stay within Firestore's document and free-usage limits; it is not unlimited storage. Images that are not linked to an approved question are discarded.

The Gemini API key is server-only. Never put it in `.env.local`, frontend code, Git, or chat. Store a newly created/rotated key as a Firebase secret:

```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

### Test image generation locally

The Next.js dev server does not apply Firebase Hosting rewrites. For local development, this repo uses a development-only URL in `.env.development.local` to send the browser request directly to the Functions emulator. The key belongs in the ignored `functions/.secret.local` file, not in any `NEXT_PUBLIC_` variable.

1. In `functions/.secret.local`, add `GEMINI_API_KEY=<your newly rotated Gemini key>`. Do not commit or share that file.
2. Install the function dependencies once with `npm install --prefix functions`.
3. In one terminal, start the local function using the demo project ID:

   ```powershell
   firebase emulators:start --only functions --project demo-mocktest
   ```

4. In another terminal, start Next.js with `npm run dev`. Open `http://localhost:3000`, upload an image, and generate a draft. The request should go to `http://127.0.0.1:5001/demo-mocktest/us-central1/generateTest`.

The `demo-` project keeps emulator traffic from reaching a real Firebase project. This local setup does not require deploying a function. The hosted site continues to use the `/api/generate-test` Hosting rewrite.

Deploy the generator and Hosting rewrite with Firebase CLI:

```powershell
firebase deploy --only functions:generateTest,hosting
```

Gemini API access, quotas, and pricing depend on Google's current terms and the selected account; do not assume API use is always free. The app applies a best-effort maximum of 5 generations per IP per hour, but this is not a guaranteed billing cap. There is no paid fallback. Model output can be wrong, so the creator must review and edit the draft before publishing.

**Billing note:** Deploying Cloud Functions requires Firebase's Blaze plan and a linked billing account, even if the inference API is free. Firebase Functions usage is not guaranteed to cost exactly zero. Do not deploy until the project owner approves linking billing. No API secret has been set and no function has been deployed from this workspace.

## Firebase setup and deployment

This branch builds a static export into `out/`; Firebase Hosting serves those files. In the Firebase console, enable Email/Password Authentication and create Firestore only after the team selects the database's permanent region. Do not create a database just to deploy this branch: Firestore region is a permanent setup choice.

After the team confirms the database location, configure Firebase CLI for the intended project and deploy `firestore.rules`. The rules allow public test creation and reading, permit public reading and one-time creation of small diagram documents alongside a test, and keep participant attempts private. Deploy `functions/aggregateAttempt` only after the project owner approves the Functions billing requirements and the function region is aligned with Firestore. The function stores only attempt count, total active duration, per-question time totals/counts, and a processed-attempt marker; it does not expose individual attempts.

Then run `npm run build` and deploy Hosting with Firebase CLI. Participants can take published tests from the hosted site.

## Data and privacy notes

- `tests` are publicly readable and can be created without creator accounts, matching the public-creator requirement. Client rules prohibit changing/deleting a published test.
- `attempts` require Firebase sign-in; rules allow a participant to create and read only documents whose `userId` matches their Firebase UID.
- `testStats` are publicly readable anonymized aggregates and are writable only by the trusted function. `processedAttempts` prevents a retried event from being counted twice.
- Test documents contain correct answers delivered to the browser. This is suitable for a low-stakes practice MVP, not a high-stakes/proctored exam.
- Run `npm run build` for a static production export. The hosted static app uses the HTTPS Function rewrite for AI generation; it does not contain the API key or model weights.
