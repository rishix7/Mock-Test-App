# Minute — source-based test MVP

Minute is a Next.js static frontend backed by Firebase Authentication and Firestore. Creators can generate test drafts from a prompt and images, edit the generated questions and answers, and publish approved tests. Participant attempts are private to the signed-in account; a Firebase Function writes anonymized timing aggregates.

## Run the app

1. Install Node.js 20 or newer and run `npm install`.
2. Copy `.env.example` to `.env.local`, fill in the Firebase web-app settings, and restart the app.
3. Enable **Email/Password** in Firebase Authentication.
4. Start the app with `npm run dev` and open `http://localhost:3000`.

The Attend screen and sample test can be explored without Firebase, but participant sign-in, test publishing, and saved attempts need Firebase and a Firestore database.

## Image + prompt question generation

The creator enters instructions, question count, and difficulty, then uploads up to 3 PNG/JPEG/WebP images. The Vercel API sends the images and prompt to OpenRouter's `~openai/gpt-sol-latest` vision model. The model first assesses whether every image is readable and relevant; unsuitable images are rejected with a helpful message. For accepted images, it generates a multiple-choice JSON draft with optional source-image indexes for the question and each choice. The backend validates those references and sends the structured test to the editable review screen. Raw JSON is not shown in the UI.

The model returns normalized crop coordinates for each detected diagram, and the review UI previews the automatically cropped regions. Creators can optionally adjust a crop or provide a manual crop when the model cannot isolate a figure. Only cropped regions are resized (maximum 600 KiB each) and saved as separate documents under `tests/{testId}/diagrams`; the full uploaded paper is never attached to the test. The test list does not download these images. The attendee loads cropped diagrams when opening the selected test. This uses Firestore, not Firebase Storage, and is intended to stay within Firestore's document and free-usage limits; it is not unlimited storage. Images that are not linked to an approved question are discarded.

The OpenRouter API key is server-only. Never put it in `.env.local`, frontend code, Git, or chat. The hosted Vercel backend reads it from the `OPENROUTER_API_KEY` production environment secret. OpenRouter image input uses base64 data URLs over its Chat Completions API.

### Test image generation locally

The Next.js dev server does not apply Firebase Hosting rewrites. For local development, this repo uses a development-only URL in `.env.development.local` to send the browser request directly to the Functions emulator. Put the OpenRouter key in the ignored `functions/.secret.local` file, not in any `NEXT_PUBLIC_` variable.

1. In `functions/.secret.local`, set `OPENROUTER_API_KEY=<your OpenRouter API key>`. Do not commit or share that file.
2. Install the function dependencies once with `npm install --prefix functions`.
3. In one terminal, start the local function using the demo project ID:

   ```powershell
   firebase emulators:start --only functions --project demo-mocktest
   ```

4. In another terminal, start Next.js with `npm run dev`. Open `http://localhost:3000`, upload an image, and generate a draft. The request should go to `http://127.0.0.1:5001/demo-mocktest/us-central1/generateTest`.

The `demo-` project keeps emulator traffic from reaching a real Firebase project. This local setup does not require deploying a function. The hosted site calls the separately deployed Vercel backend; no Firebase Hosting rewrite or deployed Firebase generation function is used.

To use the Vercel-hosted generator, add the key to Vercel (from `vercel-backend`):

```powershell
npx vercel env add OPENROUTER_API_KEY production
npx vercel --prod
```

OpenRouter usage is not free for the model currently configured; check current model and provider pricing before use. Each generation is capped at 1,200 output tokens to fit the currently reported key allowance; larger drafts may need fewer questions or a higher key limit. The app applies a best-effort maximum of 5 generations per IP per hour, but this is not a guaranteed billing cap. Model output can be wrong, so the creator must review and edit the draft before publishing.

The Vercel Hobby plan is limited to personal/non-commercial use. Check Vercel's current plan terms and function limits before deployment or commercial use. This project does not deploy its Firebase generation function.

## Firebase setup and deployment

This branch builds a static export into `out/`; Firebase Hosting serves those files, and the hosted app calls the Vercel API for generation. In the Firebase console, enable Email/Password Authentication and create Firestore only after the team selects the database's permanent region. Do not create a database just to deploy this branch: Firestore region is a permanent setup choice.

After the team confirms the database location, configure Firebase CLI for the intended project and deploy `firestore.rules`. The rules allow public test creation and reading, permit public reading and one-time creation of small diagram documents alongside a test, and keep participant attempts private. Deploy `functions/aggregateAttempt` only after the project owner approves the Functions billing requirements and the function region is aligned with Firestore. The function stores only attempt count, total active duration, per-question time totals/counts, and a processed-attempt marker; it does not expose individual attempts.

Then run `npm run build` and deploy Hosting with Firebase CLI. Participants can take published tests from the hosted site.

## Data and privacy notes

- `tests` are publicly readable and can be created without creator accounts, matching the public-creator requirement. Client rules prohibit changing/deleting a published test.
- `attempts` require Firebase sign-in; rules allow a participant to create and read only documents whose `userId` matches their Firebase UID.
- `testStats` are publicly readable anonymized aggregates and are writable only by the trusted function. `processedAttempts` prevents a retried event from being counted twice.
- Test documents contain correct answers delivered to the browser. This is suitable for a low-stakes practice MVP, not a high-stakes/proctored exam.
- Run `npm run build` for a static production export. The hosted static app calls the separate Vercel API for AI generation; it does not contain the API key or model weights.
