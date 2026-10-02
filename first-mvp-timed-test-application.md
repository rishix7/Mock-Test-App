# First MVP — Timed Test Application

## MVP Goal

Build a simple mobile-friendly test application where users can create tests using Claude-generated JSON, preview/edit them, attend tests, answer one question at a time with an individual timer, pause/resume, complete tests, and view score, analytics, and weaker areas. The same test can be attended multiple times.

**MVP 1 should stay focused. Do not add authentication, admin roles, payments, leaderboards, notifications, or complex dashboards.**

## 1. First Screen

The home screen contains only two options:

- **Create Test**
- **Attend Test**

## 2. Create Test

The creator can enter:

- Test Name
- Test Description

## 3. Claude JSON Prompt

Display a ready-made prompt with a **Copy Prompt** button. The creator pastes the prompt into Claude, provides questions and answers, and Claude returns JSON in the required structure.

Example:

```json
{
  "name": "JavaScript Basics",
  "description": "Basic JavaScript test",
  "questions": [
    {
      "id": "q1",
      "question": "Which keyword creates a block scoped variable?",
      "choices": ["var", "let", "const", "define"],
      "correctAnswer": 1,
      "category": "Variables",
      "timeLimitSeconds": 30
    }
  ]
}
```

## 4. Paste JSON

Provide a large text area for the creator to paste the Claude JSON.

When **Preview Test** is clicked, validate:

- Valid JSON
- Test name
- Questions
- Choices
- Correct answer
- Timer
- Category

Show clear errors when invalid.

## 5. Test Preview

Show the complete test before saving. The creator must be able to edit:

- Test name
- Description
- Question
- Choices
- Correct answer
- Category
- Timer

Then provide **Submit / Create Test** and save the test to Firebase.

## 6. Firebase Database

Use two main Firestore collections.

### `tests`

```text
tests
 └── testId
      ├── name
      ├── description
      ├── questions
      │    ├── id
      │    ├── question
      │    ├── choices
      │    ├── correctAnswer
      │    ├── category
      │    └── timeLimitSeconds
      └── createdAt
```

### `attempts`

```text
attempts
 └── attemptId
      ├── testId
      ├── testName
      ├── participantName
      ├── answers
      ├── score
      ├── totalQuestions
      └── completedAt
```

Every attempt is a separate document so the same person can attend the same test multiple times.

## 7. Attend Test

Show all created tests with test name, question count, and an **Attend** action.

## 8. Before Starting

After selecting a test, ask for the participant's name. The test cannot start until the name is entered.

## 9. Test Screen

Keep the core screen simple. Show:

- Question number
- Question
- Choices
- Timer
- Pause
- Next / Finish

## 10. Individual Question Timer

The timer belongs to the current question only.

Example:

```text
Question 1 → 30 seconds
Question 2 → 20 seconds
Question 3 → 45 seconds
Question 4 → 30 seconds
```

There is **no single timer for the whole test**.

## 11. Timer Expiry

When the timer reaches zero:

- Automatically move to the next question.
- Record the current question as unanswered if no answer was selected.
- Start the next question's timer.

## 12. Pause Requirement

When the user clicks **Pause**, the entire test screen must be blocked.

While paused:

- Questions cannot be accessed.
- Choices cannot be selected.
- Next cannot be clicked.
- Timer must stop.
- User cannot continue until Resume.

The timer must **not restart from the beginning** after Resume.

## 13. Next Question

After answering, save:

```text
questionId
selectedAnswer
correct
timeSpent
```

Then load the next question.

## 14. Last Question

On the final question show **Finish Test**. Save the attempt and redirect to Analytics.

## 15. Analytics

Show:

- Score
- Correct answers
- Wrong answers
- Total questions

## 16. Weaker Areas

Every question has a `category`. Group results by category.

Example:

```text
Variables       4 / 4    100%
Functions       2 / 3     67%
Arrays          1 / 3     33%
Promises        0 / 2      0%
```

For MVP, define a weaker area as **less than 70%**.

## 17. Multiple Attempts

The same test can be taken multiple times. Never overwrite an earlier attempt.

## 18. MVP Analytics

Include:

### Overall
- Score
- Correct
- Incorrect
- Total Questions

### Category
- Category
- Correct
- Total
- Percentage

### Weaker Areas
- Category
- Percentage

### Question Review

```text
Q1  Correct
Q2  Correct
Q3  Wrong
Q4  Correct
```

## 19. Mobile-First Requirement

The application must primarily be designed for phones, especially 375px, 390px, and 414px widths.

Priorities:

- Large question text
- Large answer buttons
- Large timer
- Easy Pause button
- Easy Next button
- No horizontal scrolling
- Minimal navigation
- Simple analytics cards
- Responsive charts

Desktop should work, but **mobile is the first priority**.

## 20. Suggested Next.js Structure

```text
app/
│
├── page.tsx
├── create-test/
│   └── page.tsx
├── attend/
│   └── page.tsx
├── test/
│   └── [testId]/
│       └── page.tsx
└── analytics/
    └── [attemptId]/
        └── page.tsx
│
components/
├── TestCard
├── QuestionCard
├── Timer
├── PauseOverlay
├── ChoiceButton
├── TestPreview
├── Analytics
└── WeakAreas
│
lib/
├── firebase.ts
├── firestore.ts
└── types.ts
```

## 21. Suggested Team Responsibilities

### Developer 1 — Next.js / UI

Build Home, Create Test, Attend Test, Test screen, and mobile responsive design.

### Developer 2 — Firebase

Build Firebase configuration, Firestore, save/retrieve tests, save attempts, and retrieve analytics data.

### Developer 3 — Test Engine

Build question navigation, individual timers, timer expiry, pause/resume, answer tracking, and test completion.

### Developer 4 — Analytics

Build score calculation, category calculation, weak-area detection, attempt history, and charts.

If there are fewer developers, combine responsibilities.

## 22. MVP Definition of Done

The complete flow must work:

```text
HOME
  │
  ├───────────────┐
  ↓               ↓
CREATE TEST     ATTEND TEST
  │               │
  ↓               ↓
Claude JSON     Test List
  │               │
  ↓               ↓
Preview         Select Test
  │               │
  ↓               ↓
Edit            Enter Name
  │               │
  ↓               ↓
Create           Start
                  │
                  ↓
              Question 1
                  │
              Timer 30s
                  │
            Pause / Resume
                  │
                  ↓
              Question 2
                  │
              Timer 20s
                  │
                  ↓
                 ...
                  │
                  ↓
             Finish Test
                  │
                  ↓
              ANALYTICS
                  │
          ┌───────┴────────┐
          ↓                ↓
        Score          Weak Areas
```

## 23. Key MVP Principle

**Do not build anything that is not required for this flow.**

Do not include in MVP 1 if possibe just done:

- Authentication
- Admin dashboard
- Social login
- Leaderboards
- Payments
- Notifications
- Advanced permissions
- Complex test management

The purpose of this MVP is to test whether the team can successfully build a **complete Next.js + Firebase application with state management, timers, persistence, mobile UI, JSON processing, and analytics**.
