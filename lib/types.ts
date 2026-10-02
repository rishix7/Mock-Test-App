export type TestQuestion = {
  id: string;
  question: string;
  choices: string[];
  correctAnswer: number;
  category: string;
  timeLimitSeconds: number;
};

export type TestDefinition = {
  name: string;
  description: string;
  questions: TestQuestion[];
  demo?: boolean;
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
};
