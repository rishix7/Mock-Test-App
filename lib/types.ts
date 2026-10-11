export type TestQuestion = {
  id: string;
  question: string;
  choices: string[];
  correctAnswer: number;
  category: string;
  /** Kept optional for tests created by earlier app versions. */
  timeLimitSeconds?: number;
  reviewNotes?: string[];
  /** 0-based source-image index while a draft is being reviewed. */
  questionImageIndex?: number;
  /** One 0-based source-image index per choice; -1 means no diagram. */
  choiceImageIndexes?: number[];
  /** Firestore subcollection document IDs after the test is published. */
  diagramId?: string;
  choiceDiagramIds?: Array<string | null>;
};

export type TestDefinition = {
  name: string;
  description: string;
  questions: TestQuestion[];
  demo?: boolean;
  published?: boolean;
  diagramIds?: string[];
};

export type AnswerRecord = {
  questionId: string;
  question: string;
  category: string;
  selectedAnswer: number | null;
  correct: boolean;
  timeSpent: number;
  correctAnswer: number;
  choices: string[];
};

export type Attempt = {
  testId: string;
  testName: string;
  participantName: string;
  answers: AnswerRecord[];
  score: number;
  totalQuestions: number;
  completedAt: string;
  userId: string;
  durationSeconds: number;
};

export type TestStats = {
  attemptCount: number;
  totalDurationSeconds: number;
  questions: Record<string, { count: number; totalTimeSeconds: number }>;
};
