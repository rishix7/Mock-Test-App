"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { addDoc, collection, getDocs, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AnswerRecord, Attempt, TestDefinition, TestQuestion } from "@/lib/types";

type Screen = "home" | "create" | "preview" | "attend" | "quiz" | "analytics";
const demoTest: TestDefinition = {
  name: "JavaScript Basics", description: "A short sample test to try the timer.", questions: [
    { id: "demo-1", question: "Which keyword creates a block-scoped variable?", choices: ["var", "let", "define", "static"], correctAnswer: 1, category: "Variables", timeLimitSeconds: 30 },
    { id: "demo-2", question: "Which method converts JSON text into a JavaScript value?", choices: ["JSON.stringify()", "JSON.parse()", "Object.fromJSON()", "parse.JSON()"], correctAnswer: 1, category: "JSON", timeLimitSeconds: 25 },
  ], demo: true,
};

const promptText = `Create a multiple-choice test as valid JSON only, with no markdown. Use this exact shape:\n{\n  "name": "Test name",\n  "description": "Short description",\n  "questions": [{ "id": "q1", "question": "Question text", "choices": ["A", "B", "C", "D"], "correctAnswer": 0, "category": "Topic", "timeLimitSeconds": 30 }]\n}\ncorrectAnswer is a zero-based choice index. Give every question a unique id and a positive timeLimitSeconds.`;

function validateTest(value: unknown): TestDefinition {
  if (!value || typeof value !== "object") throw new Error("The JSON must be an object.");
  const test = value as Partial<TestDefinition>;
  if (typeof test.name !== "string" || !test.name.trim()) throw new Error("Add a test name.");
  if (!Array.isArray(test.questions) || test.questions.length === 0) throw new Error("Add at least one question.");
  const questions = test.questions.map((raw, index) => {
    const q = raw as Partial<TestQuestion>;
    if (typeof q.question !== "string" || !q.question.trim()) throw new Error(`Question ${index + 1}: add question text.`);
    if (!Array.isArray(q.choices) || q.choices.length < 2 || q.choices.some(c => typeof c !== "string" || !c.trim())) throw new Error(`Question ${index + 1}: add at least two answer choices.`);
    if (!Number.isInteger(q.correctAnswer) || (q.correctAnswer as number) < 0 || (q.correctAnswer as number) >= q.choices.length) throw new Error(`Question ${index + 1}: correctAnswer must be a valid zero-based choice index.`);
    if (typeof q.category !== "string" || !q.category.trim()) throw new Error(`Question ${index + 1}: add a category.`);
    if (!Number.isFinite(q.timeLimitSeconds) || (q.timeLimitSeconds as number) < 1) throw new Error(`Question ${index + 1}: timer must be at least one second.`);
    return { id: q.id?.trim() || `q${index + 1}`, question: q.question.trim(), choices: q.choices, correctAnswer: q.correctAnswer as number, category: q.category.trim(), timeLimitSeconds: Math.floor(q.timeLimitSeconds as number) };
  });
  return { name: test.name.trim(), description: typeof test.description === "string" ? test.description.trim() : "", questions };
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [testName, setTestName] = useState("");
  const [description, setDescription] = useState("");
  const [json, setJson] = useState("");
  const [draft, setDraft] = useState<TestDefinition | null>(null);
  const [tests, setTests] = useState<Array<TestDefinition & { id: string }>>([]);
  const [selected, setSelected] = useState<TestDefinition & { id: string } | null>(null);
  const [participant, setParticipant] = useState("");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [choice, setChoice] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [result, setResult] = useState<Attempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const currentQuestion = selected?.questions[questionIndex];

  useEffect(() => { setFirebaseReady(Boolean(db)); }, []);
  useEffect(() => {
    if (!db) return;
    getDocs(query(collection(db, "tests"), orderBy("createdAt", "desc"))).then(snapshot => {
      setTests(snapshot.docs.map(doc => ({ ...(doc.data() as TestDefinition), id: doc.id })));
    }).catch(() => setError("Could not load saved tests. Check Firebase setup and Firestore rules."));
  }, []);
  useEffect(() => {
    if (screen !== "quiz" || paused || !currentQuestion) return;
    const timer = window.setInterval(() => setSeconds(s => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [screen, paused, questionIndex, currentQuestion]);
  useEffect(() => {
    if (screen === "quiz" && seconds === 0 && currentQuestion && !paused) advance(true);
    // advance() is intentionally invoked only when a question's countdown reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const correctCount = useMemo(() => result?.answers.filter(a => a.correct).length ?? 0, [result]);
  function resetMessage() { setError(""); }
  function beginCreate() { setTestName(""); setDescription(""); setJson(""); setDraft(null); resetMessage(); setScreen("create"); }
  function preview(event: FormEvent) {
    event.preventDefault(); resetMessage();
    try {
      const parsed = validateTest(JSON.parse(json));
      setDraft({ ...parsed, name: testName.trim() || parsed.name, description: description.trim() || parsed.description });
      setScreen("preview");
    } catch (e) { setError(e instanceof Error ? e.message : "Please check the JSON."); }
  }
  async function saveTest() {
    if (!draft) return;
    try { validateTest(draft); } catch (e) { setError(e instanceof Error ? e.message : "Check the test fields."); return; }
    if (!db) { setError("Firebase is not configured yet. Add the NEXT_PUBLIC_FIREBASE values to .env.local, then restart the app."); return; }
    setBusy(true); resetMessage();
    try {
      const { id: _id, demo: _demo, ...data } = draft as TestDefinition & { id?: string; demo?: boolean };
      const ref = await addDoc(collection(db, "tests"), { ...data, createdAt: serverTimestamp() });
      setTests(existing => [{ ...data, id: ref.id }, ...existing]); setScreen("attend");
    } catch { setError("Could not save the test. Check your Firebase configuration and Firestore rules."); }
    finally { setBusy(false); }
  }
  function startTest(test: TestDefinition & { id: string }) {
    if (!participant.trim()) { setError("Enter your name before starting."); return; }
    setSelected(test); setQuestionIndex(0); setSeconds(test.questions[0].timeLimitSeconds); setAnswers([]); setChoice(null); setPaused(false); setError(""); setScreen("quiz");
  }
  function advance(timedOut = false) {
    if (!selected || !currentQuestion) return;
    const elapsed = Math.max(0, currentQuestion.timeLimitSeconds - seconds);
    const response: AnswerRecord = { questionId: currentQuestion.id, question: currentQuestion.question, category: currentQuestion.category, selectedAnswer: timedOut ? null : choice, correct: !timedOut && choice === currentQuestion.correctAnswer, timeSpent: elapsed, correctAnswer: currentQuestion.correctAnswer, choices: currentQuestion.choices };
    const updated = [...answers, response]; setAnswers(updated); setChoice(null);
    if (questionIndex + 1 < selected.questions.length) {
      const nextIndex = questionIndex + 1; setQuestionIndex(nextIndex); setSeconds(selected.questions[nextIndex].timeLimitSeconds);
    } else void finish(updated);
  }
  async function finish(finalAnswers: AnswerRecord[]) {
    if (!selected) return;
    const attempt: Attempt = { testId: selected.id, testName: selected.name, participantName: participant.trim(), answers: finalAnswers, score: finalAnswers.filter(a => a.correct).length, totalQuestions: selected.questions.length, completedAt: new Date().toISOString() };
    setResult(attempt); setScreen("analytics");
    if (db && !selected.demo) {
      try { await addDoc(collection(db, "attempts"), { ...attempt, completedAt: serverTimestamp() }); }
      catch { setError("Results are shown, but this attempt could not be saved to Firebase."); }
    }
  }

  return <main className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => { setScreen("home"); setError(""); }} aria-label="Go home"><span className="brand-mark">m</span>minute</button><span className="top-note">A little practice, one question at a time.</span></header>
    {error && <div className="toast" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
    {screen === "home" && <section className="hero"><div className="eyebrow"><span className="live-dot"/> YOUR FOCUS, MEASURED</div><h1>Make every<br/><em>minute</em> count.</h1><p className="hero-copy">Create a quick test or pick up where curiosity takes you. No fuss, just focused practice.</p><div className="home-actions"><button className="action-card primary-card" onClick={beginCreate}><span className="action-icon">＋</span><span><strong>Create a test</strong><small>Bring your questions to life</small></span><span className="arrow">↗</span></button><button className="action-card" onClick={() => { resetMessage(); setScreen("attend"); }}><span className="action-icon secondary-icon">◷</span><span><strong>Take a test</strong><small>{tests.length ? `${tests.length} ready to explore` : "Find something to learn"}</small></span><span className="arrow">↗</span></button></div><div className="hero-foot"><span>✳ &nbsp;Made for curious minds</span><span>01 — START HERE</span></div></section>}
    {screen === "create" && <section className="panel"><button className="back" onClick={() => setScreen("home")}>← Home</button><div className="eyebrow">01 / CREATE</div><h1>Build your<br/><em>own test.</em></h1><p className="muted">Add a title, then paste question JSON. Need a hand? Copy the prompt to Claude.</p><form onSubmit={preview} className="form-stack"><label>Test name<input value={testName} onChange={e => setTestName(e.target.value)} placeholder="e.g. JavaScript Basics" /></label><label>Short description<input value={description} onChange={e => setDescription(e.target.value)} placeholder="What will this test cover?" /></label><div className="prompt-row"><span>Need JSON? Start with a prompt</span><button type="button" className="text-button" onClick={() => navigator.clipboard.writeText(promptText).then(() => setError("Prompt copied. Paste it into Claude."))}>Copy prompt ↗</button></div><label>Claude JSON<textarea required value={json} onChange={e => setJson(e.target.value)} placeholder={'{\n  "name": "My test",\n  "questions": [...]\n}'} rows={10}/></label><button className="button dark-button" type="submit">Preview test <span>→</span></button></form></section>}
    {screen === "preview" && draft && <section className="panel wide-panel"><button className="back" onClick={() => setScreen("create")}>← Edit JSON</button><div className="eyebrow">02 / REVIEW</div><h1>Looking<br/><em>good.</em></h1><label className="edit-field">Test name<input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label><label className="edit-field">Description<input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label><p className="muted">{draft.questions.length} questions · review and edit all imported content before saving</p><div className="question-list">{draft.questions.map((q, i) => <article className="question-preview" key={q.id}><div className="question-meta"><span>QUESTION {String(i + 1).padStart(2, "0")}</span><span>{q.timeLimitSeconds}s · {q.category}</span></div><label className="edit-field">Question<input value={q.question} onChange={e => setDraft({ ...draft, questions: draft.questions.map((item, idx) => idx === i ? { ...item, question: e.target.value } : item) })}/></label><div className="choice-edit-list">{q.choices.map((c, ci) => <label className="choice-edit" key={ci}><input type="radio" name={`correct-${i}`} checked={q.correctAnswer === ci} aria-label={`Mark choice ${ci + 1} correct`} onChange={() => setDraft({ ...draft, questions: draft.questions.map((item, idx) => idx === i ? { ...item, correctAnswer: ci } : item) })}/><input value={c} aria-label={`Choice ${ci + 1}`} onChange={e => setDraft({ ...draft, questions: draft.questions.map((item, idx) => idx === i ? { ...item, choices: item.choices.map((option, oi) => oi === ci ? e.target.value : option) } : item) })}/><span>Correct</span></label>)}</div><div className="edit-grid"><label>Category<input value={q.category} onChange={e => setDraft({ ...draft, questions: draft.questions.map((item, idx) => idx === i ? { ...item, category: e.target.value } : item) })}/></label><label>Seconds<input type="number" min="1" value={q.timeLimitSeconds} onChange={e => setDraft({ ...draft, questions: draft.questions.map((item, idx) => idx === i ? { ...item, timeLimitSeconds: Number(e.target.value) } : item) })}/></label></div></article>)}</div><button className="button dark-button" onClick={saveTest} disabled={busy}>{busy ? "Saving…" : "Save test"}<span>→</span></button></section>}
    {screen === "attend" && <section className="panel"><button className="back" onClick={() => setScreen("home")}>← Home</button><div className="eyebrow">PICK YOUR NEXT CHALLENGE</div><h1>Ready when<br/><em>you are.</em></h1><p className="muted">Choose a test, find a quiet minute, and see what you know.</p><label className="name-field">Your name<input value={participant} onChange={e => setParticipant(e.target.value)} placeholder="First name is fine" autoComplete="name"/></label>{!firebaseReady && <div className="setup-note"><strong>Firebase setup needed</strong><br/>Saved tests appear after Firebase is configured. Try the sample test below in the meantime.</div>}<div className="test-list">{[...tests, { ...demoTest, id: "demo" }].map(test => <article className="test-item" key={test.id}><div className="test-badge">{test.demo ? "✳" : "⌁"}</div><div className="test-info"><h3>{test.name}</h3><p>{test.questions.length} questions · {test.description || "A focused practice test"}</p></div><button aria-label={`Attend ${test.name}`} onClick={() => startTest(test)}>→</button></article>)}</div></section>}
    {screen === "quiz" && selected && currentQuestion && <section className="quiz-panel"><button className="back" onClick={() => setScreen("attend")}>← Exit test</button><div className="quiz-top"><div><div className="eyebrow">{selected.name.toUpperCase()}</div><span className="muted small">QUESTION {questionIndex + 1} OF {selected.questions.length}</span></div><div className={`timer ${seconds <= 10 ? "timer-urgent" : ""}`}><span>◷</span> {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</div></div><div className="progress-track"><span style={{ width: `${((questionIndex + 1) / selected.questions.length) * 100}%` }}/></div><div className="quiz-content"><div className="category-tag">{currentQuestion.category}</div><h1>{currentQuestion.question}</h1><div className="choices">{currentQuestion.choices.map((c, i) => <button key={i} className={`choice ${choice === i ? "selected" : ""}`} onClick={() => setChoice(i)}><span className="choice-letter">{String.fromCharCode(65 + i)}</span>{c}<span className="choice-check">{choice === i ? "✓" : ""}</span></button>)}</div><div className="quiz-controls"><button className="pause-button" onClick={() => setPaused(true)}>Ⅱ Pause</button><button className="button dark-button" onClick={() => advance()} disabled={choice === null}>{questionIndex === selected.questions.length - 1 ? "Finish test" : "Next question"}<span>→</span></button></div></div>{paused && <div className="pause-overlay"><span className="pause-symbol">Ⅱ</span><div className="eyebrow">TAKE YOUR TIME</div><h2>Test paused.</h2><p>Your time is saved. Pick up right where you left off.</p><button className="button dark-button" onClick={() => setPaused(false)}>Resume test <span>→</span></button></div>}</section>}
    {screen === "analytics" && result && <section className="panel wide-panel"><button className="back" onClick={() => setScreen("attend")}>← Tests</button><div className="eyebrow">TEST COMPLETE · {result.testName.toUpperCase()}</div><h1>Nice work,<br/><em>{result.participantName}.</em></h1><div className="score-card"><div><span className="muted small">YOUR SCORE</span><div className="score-number">{correctCount}<span> / {result.totalQuestions}</span></div></div><div className="score-ring" style={{ "--score": `${Math.round(100 * correctCount / result.totalQuestions)}%` } as React.CSSProperties}><span>{Math.round(100 * correctCount / result.totalQuestions)}<small>%</small></span></div></div><div className="stat-row"><div><strong>{correctCount}</strong><span>Correct</span></div><div><strong>{result.totalQuestions - correctCount}</strong><span>Incorrect</span></div><div><strong>{result.totalQuestions}</strong><span>Total</span></div></div><h2 className="section-title">By category</h2><div className="category-results">{Object.entries(result.answers.reduce<Record<string, { correct: number; total: number }>>((acc, answer) => { acc[answer.category] ??= { correct: 0, total: 0 }; acc[answer.category].total++; if (answer.correct) acc[answer.category].correct++; return acc; }, {})).map(([category, value]) => { const pct = Math.round(value.correct / value.total * 100); return <div className="category-result" key={category}><div><strong>{category}</strong><span>{value.correct} / {value.total}</span><b className={pct < 70 ? "weak" : ""}>{pct}% {pct < 70 ? "· revisit" : ""}</b></div><div className="result-track"><span className={pct < 70 ? "weak-fill" : ""} style={{ width: `${pct}%` }}/></div></div>; })}</div><h2 className="section-title">Question review</h2><div className="review-list">{result.answers.map((a, i) => <div className="review-item" key={a.questionId}><span className={a.correct ? "review-mark good" : "review-mark bad"}>{a.correct ? "✓" : "×"}</span><div><strong>Q{i + 1} · {a.correct ? "Correct" : a.selectedAnswer === null ? "Unanswered" : "Review this one"}</strong><small>{a.question}</small>{!a.correct && <small className="answer-note">Answer: {a.choices[a.correctAnswer]}</small>}</div></div>)}</div><button className="button dark-button" onClick={() => { setScreen("attend"); setResult(null); }}>Take another test <span>→</span></button></section>}
    <footer><span>minute<span className="footer-dot">.</span></span><span>SMALL STEPS. SHARP MINDS.</span></footer>
  </main>;
}
