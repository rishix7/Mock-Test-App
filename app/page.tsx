"use client";

import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, User } from "firebase/auth";
import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, firebaseAuth } from "@/lib/firebase";
import type { AnswerRecord, Attempt, ImageCrop, TestDefinition, TestQuestion, TestStats } from "@/lib/types";
import { MathText } from "@/components/math-text";

type SavedTest = TestDefinition & { id: string };
type Screen = "home" | "auth" | "create" | "preview" | "attend" | "quiz" | "analytics" | "testAnalytics";
const demoTest: TestDefinition = { name: "JavaScript Basics", description: "A short sample test to try the experience.", demo: true, questions: [
  { id: "demo-1", question: "Which keyword creates a block-scoped variable?", choices: ["var", "let", "define", "static"], correctAnswer: 1, category: "Variables" },
  { id: "demo-2", question: "Which method converts JSON text into a JavaScript value?", choices: ["JSON.stringify()", "JSON.parse()", "Object.fromJSON()", "parse.JSON()"], correctAnswer: 1, category: "JSON" },
] };
const MAX_FILES = 3;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_STORED_DIAGRAM_BYTES = 600 * 1024;
const MAX_TOTAL_STORED_DIAGRAM_BYTES = 6 * 1024 * 1024;

function cropSourceImage(file: File, crop: ImageCrop): Promise<File> {
  return new Promise((resolve, reject) => {
    createImageBitmap(file).then(bitmap => {
      try {
        const sx = Math.max(0, Math.floor(crop.x * bitmap.width));
        const sy = Math.max(0, Math.floor(crop.y * bitmap.height));
        const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(crop.width * bitmap.width)));
        const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(crop.height * bitmap.height)));
        const canvas = document.createElement("canvas");
        canvas.width = sw;
        canvas.height = sh;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Your browser could not crop the selected diagram.");
        context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error("Could not crop the selected diagram."));
          resolve(new File([blob], `cropped-${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" }));
        }, "image/webp", 0.94);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not crop the selected diagram."));
      } finally {
        bitmap.close();
      }
    }).catch(() => reject(new Error(`Could not read ${file.name} for cropping.`)));
  });
}

function CropResultPreview({ file, crop, alt }: { file: File; crop: ImageCrop; alt: string }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file).then(bitmap => {
      const sx = Math.max(0, Math.floor(crop.x * bitmap.width));
      const sy = Math.max(0, Math.floor(crop.y * bitmap.height));
      const sw = Math.min(bitmap.width - sx, Math.max(1, Math.round(crop.width * bitmap.width)));
      const sh = Math.min(bitmap.height - sy, Math.max(1, Math.round(crop.height * bitmap.height)));
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
        if (!cancelled) setPreview(canvas.toDataURL("image/webp", 0.82));
      }
      bitmap.close();
    }).catch(() => setPreview(""));
    return () => { cancelled = true; };
  }, [file, crop]);
  return preview ? <img className="diagram-preview" src={preview} alt={alt}/> : <p className="muted small">Preparing cropped preview…</p>;
}

function CropAreaSelector({ src, initialCrop, onCancel, onSave }: {
  src: string;
  initialCrop?: ImageCrop | null;
  onCancel: () => void;
  onSave: (crop: ImageCrop) => void;
}) {
  const [selection, setSelection] = useState<ImageCrop | undefined>(initialCrop ?? undefined);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  function point(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  }
  function startCrop(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    dragStart.current = start;
    setSelection({ x: start.x, y: start.y, width: 0, height: 0 });
  }
  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const end = point(event);
    const start = dragStart.current;
    setSelection({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  }
  function endCrop() { dragStart.current = null; }
  const usable = Boolean(selection && selection.width >= 0.02 && selection.height >= 0.02);
  return <div className="crop-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title">
      <div className="eyebrow">CROP QUESTION DIAGRAM</div><h2 id="crop-title">Select only the diagram</h2>
      <p className="muted">Drag a box around the diagram or figure—not the whole question paper. Only this selected area will be saved with the test.</p>
      <div className="crop-stage" ref={stageRef} onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={endCrop} onPointerCancel={endCrop}>
        <img className="crop-source" src={src} alt="Uploaded source image to crop" draggable={false}/>
        {selection && <div className="crop-selection" style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }}/>}
      </div>
      <div className="crop-actions"><button className="text-button" type="button" onClick={onCancel}>Cancel</button><button className="button dark-button" type="button" disabled={!usable} onClick={() => usable && selection && onSave(selection)}>Use selected crop <span>→</span></button></div>
    </section>
  </div>;
}

function resizeDiagram(file: File): Promise<{ dataUrl: string; contentType: string; byteSize: number }> {
  return new Promise((resolve, reject) => {
    createImageBitmap(file).then(async bitmap => {
      const longestSide = Math.max(bitmap.width, bitmap.height);
      const attempts = [
        { maxSide: 1800, quality: 0.86 },
        { maxSide: 1500, quality: 0.78 },
        { maxSide: 1200, quality: 0.7 },
        { maxSide: 1000, quality: 0.62 },
      ];
      try {
        for (const attempt of attempts) {
          const scale = Math.min(1, attempt.maxSide / longestSide);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Your browser could not prepare the diagram image.");
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>(done => canvas.toBlob(done, "image/webp", attempt.quality));
          if (!blob) continue;
          if (blob.size <= MAX_STORED_DIAGRAM_BYTES) {
            const dataUrl = await new Promise<string>((done, fail) => {
              const reader = new FileReader();
              reader.onload = () => typeof reader.result === "string" ? done(reader.result) : fail(new Error("Could not encode diagram."));
              reader.onerror = () => fail(new Error("Could not encode diagram."));
              reader.readAsDataURL(blob);
            });
            return resolve({ dataUrl, contentType: blob.type || "image/webp", byteSize: blob.size });
          }
        }
        reject(new Error(`${file.name} is still too large after compression. Use a smaller image or crop it before uploading (maximum 600 KB per saved diagram).`));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Could not prepare a diagram image."));
      } finally {
        bitmap.close();
      }
    }).catch(() => reject(new Error(`Could not read ${file.name}. Try a PNG, JPEG, or WebP image.`)));
  });
}

function validateTest(value: unknown): TestDefinition {
  if (!value || typeof value !== "object") throw new Error("The test must be an object.");
  const test = value as Partial<TestDefinition>;
  if (typeof test.name !== "string" || !test.name.trim()) throw new Error("Add a test name.");
  if (!Array.isArray(test.questions) || test.questions.length === 0) throw new Error("Add at least one question.");
  const questions = test.questions.map((raw, index) => {
    const q = raw as Partial<TestQuestion>;
    if (typeof q.question !== "string" || !q.question.trim()) throw new Error(`Question ${index + 1}: add question text.`);
    if (!Array.isArray(q.choices) || q.choices.length !== 4 || q.choices.some(c => typeof c !== "string" || !c.trim())) throw new Error(`Question ${index + 1}: add four non-empty choices.`);
    if (!Number.isInteger(q.correctAnswer) || (q.correctAnswer as number) < 0 || (q.correctAnswer as number) >= q.choices.length) throw new Error(`Question ${index + 1}: choose a correct answer.`);
    if (typeof q.category !== "string" || !q.category.trim()) throw new Error(`Question ${index + 1}: add a category.`);
    const questionImageIndex = Number.isInteger(q.questionImageIndex) ? q.questionImageIndex as number : -1;
    const choiceImageIndexes = Array.isArray(q.choiceImageIndexes) && q.choiceImageIndexes.length === 4
      ? q.choiceImageIndexes.map(index => Number.isInteger(index) ? index : -1)
      : [-1, -1, -1, -1];
    const questionImageCrop = normalizeImageCrop(q.questionImageCrop);
    const choiceImageCrops = Array.isArray(q.choiceImageCrops) && q.choiceImageCrops.length === 4
      ? q.choiceImageCrops.map(normalizeImageCrop)
      : [undefined, undefined, undefined, undefined];
    return {
      id: q.id?.trim() || `q${index + 1}`,
      question: q.question.trim(), choices: q.choices.map(c => c.trim()), correctAnswer: q.correctAnswer as number,
      category: q.category.trim(), reviewNotes: Array.isArray(q.reviewNotes) ? q.reviewNotes.filter((n): n is string => typeof n === "string") : [],
      questionImageIndex, questionImageCrop, choiceImageIndexes, choiceImageCrops,
    };
  });
  return { name: test.name.trim(), description: typeof test.description === "string" ? test.description.trim() : "", questions };
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function normalizeImageCrop(value: unknown): ImageCrop | undefined {
  if (!value || typeof value !== "object") return undefined;
  const crop = value as ImageCrop;
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
      || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
      || crop.x + crop.width > 1 || crop.y + crop.height > 1) return undefined;
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [draft, setDraft] = useState<TestDefinition | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [tests, setTests] = useState<SavedTest[]>([]);
  const [selected, setSelected] = useState<SavedTest | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [participant, setParticipant] = useState("");
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState("medium");
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [sourcePreviewUrls, setSourcePreviewUrls] = useState<string[]>([]);
  const [cropTarget, setCropTarget] = useState<{ questionIndex: number; choiceIndex?: number } | null>(null);
  const [selectedDiagrams, setSelectedDiagrams] = useState<Record<string, string>>({});
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationBusy, setGenerationBusy] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focusMessage, setFocusMessage] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [result, setResult] = useState<Attempt | null>(null);
  const [selectedStats, setSelectedStats] = useState<TestStats | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const pausedRef = useRef(false);
  const questionStartedAt = useRef(0);
  const questionPausedMs = useRef(0);
  const totalStartedAt = useRef(0);
  const totalPausedMs = useRef(0);
  const fullscreenActive = typeof document !== "undefined" && Boolean(document.fullscreenElement);
  const currentQuestion = selected?.questions[questionIndex];
  const correctCount = useMemo(() => result?.answers.filter(a => a.correct).length ?? 0, [result]);

  useEffect(() => {
    setFirebaseReady(Boolean(db && firebaseAuth));
    if (!firebaseAuth) { setAuthReady(true); return; }
    return onAuthStateChanged(firebaseAuth, current => { setUser(current); setAuthReady(true); });
  }, []);
  useEffect(() => {
    const urls = sourceFiles.map(file => URL.createObjectURL(file));
    setSourcePreviewUrls(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [sourceFiles]);
  useEffect(() => {
    if (!db) return;
    getDocs(query(collection(db, "tests"), orderBy("createdAt", "desc"))).then(snapshot => {
      setTests(snapshot.docs.map(item => ({ ...(item.data() as TestDefinition), id: item.id })).filter(test => test.published !== false));
    }).catch(() => setError("Could not load tests. Check Firestore configuration and security rules."));
  }, []);
  useEffect(() => {
    if (screen !== "quiz" || paused || !currentQuestion) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((questionPausedMs.current + Date.now() - questionStartedAt.current) / 1000));
      if (document.visibilityState === "hidden" || !document.hasFocus()) pauseTest("You left the test. It is paused; return here and resume to continue.");
    }, 250);
    return () => window.clearInterval(timer);
  }, [screen, questionIndex, paused, currentQuestion]);
  useEffect(() => {
    if (screen !== "quiz") return;
    const onVisibility = () => { if (document.visibilityState === "hidden") pauseTest("You left the test. It is paused; return here and resume to continue."); };
    const onBlur = () => pauseTest("The test window lost focus. It is paused; return here and resume to continue.");
    const onFullscreen = () => { if (!document.fullscreenElement && !pausedRef.current) pauseTest("Fullscreen ended, so the test is paused. Resume when ready."); };
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = "Your test is still in progress."; };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => { document.removeEventListener("visibilitychange", onVisibility); document.removeEventListener("fullscreenchange", onFullscreen); window.removeEventListener("blur", onBlur); window.removeEventListener("beforeunload", onBeforeUnload); };
  }, [screen]);

  function clearError() { setError(""); }
  function beginCreate() { setGenerationPrompt(""); setDraft(null); setSourceFiles([]); clearError(); setScreen("create"); }
  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (files.length > MAX_FILES) { setError("Choose no more than 3 images."); event.target.value = ""; return; }
    if (files.some(file => file.size > MAX_FILE_BYTES)) { setError("Each image must be 8 MB or smaller."); event.target.value = ""; return; }
    if (total > MAX_TOTAL_BYTES) { setError("The combined file size must be 15 MB or less."); event.target.value = ""; return; }
    const supported = files.every(file => ["image/png", "image/jpeg", "image/webp"].includes(file.type));
    if (!supported) { setError("Use PNG, JPEG, or WebP images. PDF uploads are not supported by this API flow."); event.target.value = ""; return; }
    setSourceFiles(files); clearError();
  }
  async function generateFromFiles() {
    if (!sourceFiles.length) { setError("Choose at least one clear PNG, JPEG, or WebP image."); return; }
    if (generationPrompt.trim().length < 8) { setError("Add instructions describing the topic or what the test should cover."); return; }
    setGenerationBusy(true); clearError();
    try {
      const body = new FormData(); sourceFiles.forEach(file => body.append("images", file));
      body.set("prompt", generationPrompt.trim()); body.set("questionCount", String(questionCount)); body.set("difficulty", difficulty);
      const generatorUrl = process.env.NEXT_PUBLIC_TEST_GENERATOR_URL || "/api/generate-test";
      const response = await fetch(generatorUrl, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI generation failed.");
      const parsed = validateTest(payload);
      setDraft(parsed); setReviewConfirmed(false); setScreen("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the AI generation API.");
    } finally { setGenerationBusy(false); }
  }
  async function saveTest() {
    if (!draft) return;
    try { validateTest(draft); } catch (e) { setError(e instanceof Error ? e.message : "Check the test fields."); return; }
    if (!db) { setError("Firebase is not configured. Add NEXT_PUBLIC_FIREBASE values to .env.local, then restart the app."); return; }
    setBusy(true); clearError();
    try {
      const { id: _id, demo: _demo, ...data } = draft as TestDefinition & { id?: string; demo?: boolean };
      const assignments: Array<{ id: string; imageIndex: number; crop: ImageCrop }> = [];
      data.questions.forEach((question, questionIndex) => {
        const questionImageIndex = question.questionImageIndex ?? -1;
        const choiceImageIndexes = question.choiceImageIndexes ?? [-1, -1, -1, -1];
        if (questionImageIndex >= sourceFiles.length || questionImageIndex < -1
            || choiceImageIndexes.length !== 4
            || choiceImageIndexes.some(index => index < -1 || index >= sourceFiles.length)) {
          throw new Error("A question refers to an image that is no longer selected. Return to the creator and generate the draft again.");
        }
        if (questionImageIndex >= 0 && question.questionImageCrop) {
          assignments.push({ id: `diagram-question-${questionIndex}`, imageIndex: questionImageIndex, crop: question.questionImageCrop });
        }
        const choiceImageCrops = question.choiceImageCrops || [];
        choiceImageIndexes.forEach((imageIndex, choiceIndex) => {
          if (imageIndex < 0) return;
          const crop = choiceImageCrops[choiceIndex];
          if (!crop) return;
          assignments.push({ id: `diagram-choice-${questionIndex}-${choiceIndex}`, imageIndex, crop });
        });
      });
      const compressedDiagrams = await Promise.all(assignments.map(async assignment => ({
        id: assignment.id,
        ...await resizeDiagram(await cropSourceImage(sourceFiles[assignment.imageIndex], assignment.crop)),
      })));
      const totalDiagramBytes = compressedDiagrams.reduce((total, diagram) => total + diagram.byteSize, 0);
      if (totalDiagramBytes > MAX_TOTAL_STORED_DIAGRAM_BYTES) {
        throw new Error("The selected diagram crops are too large to publish together. Remove some diagram links or use smaller crop areas (maximum 6 MB total). ");
      }
      const diagramIds = compressedDiagrams.map(diagram => diagram.id);
      const questions = data.questions.map((question, questionIndex) => {
        const { questionImageIndex = -1, choiceImageIndexes = [-1, -1, -1, -1], questionImageCrop: _questionCrop, choiceImageCrops: _choiceCrops, ...textAndAnswer } = question;
        return {
          ...textAndAnswer,
          ...(questionImageIndex >= 0 && question.questionImageCrop ? { diagramId: `diagram-question-${questionIndex}` } : {}),
          choiceDiagramIds: choiceImageIndexes.map((imageIndex, choiceIndex) => imageIndex >= 0 && question.choiceImageCrops?.[choiceIndex] ? `diagram-choice-${questionIndex}-${choiceIndex}` : null),
        };
      });
      const testRef = doc(collection(db, "tests"));
      const batch = writeBatch(db);
      batch.set(testRef, { ...data, questions, diagramIds, published: true, createdAt: serverTimestamp() });
      for (const diagram of compressedDiagrams) {
        batch.set(doc(db, "tests", testRef.id, "diagrams", diagram.id), {
          dataUrl: diagram.dataUrl,
          contentType: diagram.contentType,
          byteSize: diagram.byteSize,
        });
      }
      await batch.commit();
      const published: SavedTest = { ...data, questions, diagramIds, published: true, id: testRef.id };
      setTests(existing => [published, ...existing]); setSourceFiles([]); setScreen("attend");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not publish this test. Apply firestore.rules and check Firebase setup."); }
    finally { setBusy(false); }
  }
  async function authenticate(event: FormEvent) {
    event.preventDefault(); clearError();
    if (!firebaseAuth) { setError("Firebase Authentication is not configured."); return; }
    setBusy(true);
    try {
      if (authMode === "register") await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
      else await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      setScreen("attend");
    } catch (e) { setError(e instanceof Error ? e.message.replace("Firebase:", "") : "Could not sign in."); }
    finally { setBusy(false); }
  }
  async function startTest(test: SavedTest) {
    if (!user) { setError("Sign in with email and password before starting a test."); setScreen("auth"); return; }
    clearError();
    setBusy(true);
    try {
      const diagramIds = [...new Set([
        ...(test.diagramIds || []),
        ...test.questions.flatMap(question => [question.diagramId, ...(question.choiceDiagramIds || [])].filter((id): id is string => Boolean(id))),
      ])];
      const diagrams: Record<string, string> = {};
      if (db && !test.demo && diagramIds.length) {
        const snapshot = await getDocs(collection(db, "tests", test.id, "diagrams"));
        snapshot.docs.forEach(item => {
          const data = item.data();
          if (diagramIds.includes(item.id) && typeof data.dataUrl === "string") diagrams[item.id] = data.dataUrl;
        });
        if (diagramIds.some(id => !diagrams[id])) throw new Error("A diagram for this test could not be loaded. Check Firestore rules and retry.");
      }
      setSelectedDiagrams(diagrams);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the test diagrams.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setSelected(test); setQuestionIndex(0); setElapsedSeconds(0); questionPausedMs.current = 0; totalPausedMs.current = 0;
    questionStartedAt.current = Date.now(); totalStartedAt.current = Date.now(); pausedRef.current = false;
    setAnswers([]); setChoice(null); setPaused(false); setFocusMessage("Elapsed time counts only while your test is active."); clearError(); setScreen("quiz");
    if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => setFocusMessage("Fullscreen is unavailable. Switching away will pause the test, but a website cannot lock your device."));
  }
  function pauseTest(message: string) {
    if (pausedRef.current || !totalStartedAt.current) return;
    const now = Date.now(); questionPausedMs.current += now - questionStartedAt.current; totalPausedMs.current += now - totalStartedAt.current;
    questionStartedAt.current = 0; totalStartedAt.current = 0; pausedRef.current = true; setPaused(true); setFocusMessage(message);
  }
  async function resumeTest() {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try { await document.documentElement.requestFullscreen(); } catch { setFocusMessage("Fullscreen could not start. The test will resume, but a website cannot prevent app switching."); }
    }
    questionStartedAt.current = Date.now(); totalStartedAt.current = Date.now(); pausedRef.current = false; setPaused(false);
  }
  function activeQuestionSeconds() {
    return Math.max(0, questionPausedMs.current + (pausedRef.current ? 0 : Date.now() - questionStartedAt.current)) / 1000;
  }
  function activeTotalSeconds() {
    return Math.max(0, totalPausedMs.current + (pausedRef.current ? 0 : Date.now() - totalStartedAt.current)) / 1000;
  }
  function advance() {
    if (!selected || !currentQuestion) return;
    const response: AnswerRecord = { questionId: currentQuestion.id, question: currentQuestion.question, category: currentQuestion.category, selectedAnswer: choice, correct: choice === currentQuestion.correctAnswer, timeSpent: activeQuestionSeconds(), correctAnswer: currentQuestion.correctAnswer, choices: currentQuestion.choices };
    const updated = [...answers, response]; setAnswers(updated); setChoice(null); questionPausedMs.current = 0;
    if (questionIndex + 1 < selected.questions.length) { questionStartedAt.current = Date.now(); setQuestionIndex(questionIndex + 1); setElapsedSeconds(0); }
    else { const duration = activeTotalSeconds(); totalStartedAt.current = 0; questionStartedAt.current = 0; void finish(updated, duration); }
  }
  async function finish(finalAnswers: AnswerRecord[], durationSeconds: number) {
    if (!selected || !user) return;
    const attempt: Attempt = { testId: selected.id, testName: selected.name, participantName: participant.trim() || user.email || "Participant", userId: user.uid, answers: finalAnswers, score: finalAnswers.filter(a => a.correct).length, totalQuestions: selected.questions.length, completedAt: new Date().toISOString(), durationSeconds };
    setResult(attempt); setScreen("analytics");
    if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    if (db && !selected.demo) {
      try { await addDoc(collection(db, "attempts"), { ...attempt, completedAt: serverTimestamp() }); }
      catch { setError("Your result is shown, but could not be saved. Check Firestore rules."); }
    }
  }
  async function openTestAnalytics(test: SavedTest) {
    setSelected(test); setSelectedStats(null); setStatsLoading(true); setScreen("testAnalytics"); clearError();
    if (db && test.id !== "demo") {
      try { const snapshot = await getDoc(doc(db, "testStats", test.id)); if (snapshot.exists()) setSelectedStats(snapshot.data() as TestStats); }
      catch { setError("Could not load aggregate test analytics."); }
    }
    setStatsLoading(false);
  }
  function updateQuestion(index: number, update: Partial<TestQuestion>) {
    if (!draft) return;
    setReviewConfirmed(false);
    setDraft({ ...draft, questions: draft.questions.map((question, i) => i === index ? { ...question, ...update } : question) });
  }
  function setQuestionImage(index: number, imageIndex: number) {
    const current = draft?.questions[index];
    updateQuestion(index, {
      questionImageIndex: imageIndex,
      ...(current?.questionImageIndex !== imageIndex ? { questionImageCrop: undefined } : {}),
    });
  }
  function setChoiceImage(questionIndex: number, choiceIndex: number, imageIndex: number) {
    const question = draft?.questions[questionIndex];
    if (!question) return;
    const choiceImageIndexes = [...(question.choiceImageIndexes || [-1, -1, -1, -1])];
    const choiceImageCrops = [...(question.choiceImageCrops || [undefined, undefined, undefined, undefined])];
    if (choiceImageIndexes[choiceIndex] !== imageIndex) choiceImageCrops[choiceIndex] = undefined;
    choiceImageIndexes[choiceIndex] = imageIndex;
    updateQuestion(questionIndex, { choiceImageIndexes, choiceImageCrops });
  }
  function saveCropArea(crop: ImageCrop) {
    if (!draft || !cropTarget) return;
    const question = draft.questions[cropTarget.questionIndex];
    if (!question) return;
    if (cropTarget.choiceIndex === undefined) {
      updateQuestion(cropTarget.questionIndex, { questionImageCrop: crop });
    } else {
      const choiceImageCrops = [...(question.choiceImageCrops || [undefined, undefined, undefined, undefined])];
      choiceImageCrops[cropTarget.choiceIndex] = crop;
      updateQuestion(cropTarget.questionIndex, { choiceImageCrops });
    }
    setCropTarget(null);
  }
  const cropQuestion = cropTarget ? draft?.questions[cropTarget.questionIndex] : undefined;
  const cropSourceIndex = cropTarget && cropQuestion
    ? cropTarget.choiceIndex === undefined
      ? cropQuestion.questionImageIndex ?? -1
      : cropQuestion.choiceImageIndexes?.[cropTarget.choiceIndex] ?? -1
    : -1;
  const activeCrop = cropTarget && cropQuestion
    ? cropTarget.choiceIndex === undefined
      ? cropQuestion.questionImageCrop
      : cropQuestion.choiceImageCrops?.[cropTarget.choiceIndex]
    : undefined;

  return <main className="app-shell">
    <header className="topbar"><button className="brand" disabled={screen === "quiz"} onClick={() => { setScreen("home"); clearError(); }} aria-label="Go home"><span className="brand-mark">m</span>minute</button><span className="top-note">A little practice, one question at a time.</span>{authReady && user && <button className="text-button" onClick={() => firebaseAuth && void signOut(firebaseAuth)}>Sign out</button>}</header>
    {error && <div className="toast" role="alert">{error}<button onClick={clearError} aria-label="Dismiss">×</button></div>}
    {screen === "home" && <section className="hero"><div className="eyebrow"><span className="live-dot"/> YOUR FOCUS, MEASURED</div><h1>Make every<br/><em>minute</em> count.</h1><p className="hero-copy">Create tests from study material, or take a focused practice test.</p><div className="home-actions"><button className="action-card primary-card" onClick={beginCreate}><span className="action-icon">＋</span><span><strong>Create a test</strong><small>Upload source material and generate a test</small></span><span className="arrow">↗</span></button><button className="action-card" onClick={() => { clearError(); setScreen("attend"); }}><span className="action-icon secondary-icon">◷</span><span><strong>Take a test</strong><small>{tests.length ? `${tests.length} ready to explore` : "Find something to learn"}</small></span><span className="arrow">↗</span></button></div>{!user && <button className="text-button" onClick={() => setScreen("auth")}>Participant sign in / create account</button>}<div className="hero-foot"><span>✳ &nbsp;Made for curious minds</span><span>01 — START HERE</span></div></section>}

    {screen === "auth" && <section className="panel"><button className="back" onClick={() => setScreen("attend")}>← Tests</button><div className="eyebrow">PARTICIPANT ACCOUNT</div><h1>{authMode === "signin" ? <>Welcome<br/><em>back.</em></> : <>Join the<br/><em>practice.</em></>}</h1><p className="muted">Sign in to take tests and keep your individual results private to your account.</p><form className="form-stack" onSubmit={authenticate}><label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}/></label><label>Password<input type="password" required minLength={6} autoComplete={authMode === "signin" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)}/></label><button className="button dark-button" disabled={busy}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}<span>→</span></button></form><button className="text-button" onClick={() => setAuthMode(authMode === "signin" ? "register" : "signin")}>{authMode === "signin" ? "New participant? Create an account" : "Already registered? Sign in"}</button></section>}

    {screen === "create" && <section className="panel">
      <button className="back" onClick={() => setScreen("home")}>← Home</button>
      <div className="eyebrow">01 / CREATE</div><h1>Build your<br/><em>own test.</em></h1>
      <p className="muted">Describe the test you want and upload up to 3 clear images (15 MB total). The AI checks that the images match your prompt, then creates an editable test draft.</p>
      <div className="form-stack source-generator">
        <label>Test instructions / topic<textarea value={generationPrompt} onChange={e => setGenerationPrompt(e.target.value)} placeholder="Example: Make a 10-question test about the water cycle shown in this diagram. Use medium difficulty and focus on evaporation and condensation." rows={4}/></label>
        <label>Source image(s)<input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" multiple onChange={handleFiles}/></label>
        {sourceFiles.length > 0 && <p className="file-summary">{sourceFiles.length} image(s) selected · {sourceFiles.map(file => file.name).join(", ")}</p>}
        <div className="edit-grid">
          <label>Question count<input type="number" min="1" max="10" value={questionCount} onChange={e => setQuestionCount(Math.min(10, Math.max(1, Number(e.target.value))))}/></label>
          <label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        </div>
        <button className="button dark-button" type="button" onClick={generateFromFiles} disabled={generationBusy}>{generationBusy ? "Checking image & creating test…" : "Check image & create test"}<span>→</span></button>
        <div className="setup-note"><strong>Hosted open-weight AI</strong><br/>The image is checked first. If it is blank, unrelated, or unreadable, generation stops and asks for a better image. Approved images and prompt are sent securely to the API; review the generated questions before publishing. API key is stored on the backend.</div>
      </div>
    </section>}

    {screen === "preview" && draft && <section className="panel wide-panel">
      <button className="back" onClick={() => setScreen("create")}>← Back to creator</button>
      <div className="eyebrow">02 / REQUIRED REVIEW</div><h1>Review &<br/><em>approve.</em></h1>
      <p className="muted">Edit the title, questions, options, answer key, and diagram links. Nothing is published until you approve it below.</p>
      <label className="edit-field">Test title<input value={draft.name} onChange={e => { setReviewConfirmed(false); setDraft({ ...draft, name: e.target.value }); }}/></label>
      <label className="edit-field">Description<input value={draft.description} onChange={e => { setReviewConfirmed(false); setDraft({ ...draft, description: e.target.value }); }}/></label>
      <div className="diagram-source-note">The AI tries to isolate each relevant figure automatically. Check the cropped previews below; you can adjust a crop if needed. Full question-paper pages are never attached to a published test.</div>
      <div className="question-list">{draft.questions.map((q, i) => <article className="question-preview" key={q.id}>
        <div className="question-meta"><span>QUESTION {String(i + 1).padStart(2, "0")}</span><button className="text-button" onClick={() => { setReviewConfirmed(false); setDraft({ ...draft, questions: draft.questions.filter((_, idx) => idx !== i) }); }}>Remove</button></div>
        {q.reviewNotes?.length ? <div className="review-warning"><strong>Needs source check</strong><ul>{q.reviewNotes.map((note, ni) => <li key={ni}>{note}</li>)}</ul></div> : null}
        <label className="edit-field">Question<input value={q.question} onChange={e => updateQuestion(i, { question: e.target.value })}/></label>
        <div className="math-preview"><span className="muted small">Preview</span><MathText text={q.question || "Question preview"}/></div>
        <div className="diagram-association"><label>Question diagram<select value={q.questionImageIndex ?? -1} onChange={e => setQuestionImage(i, Number(e.target.value))}><option value={-1}>No diagram</option>{sourceFiles.map((file, imageIndex) => <option key={imageIndex} value={imageIndex}>{`Image ${imageIndex + 1}: ${file.name}`}</option>)}</select></label>{(q.questionImageIndex ?? -1) >= 0 && <>{q.questionImageCrop ? <CropResultPreview file={sourceFiles[q.questionImageIndex!]} crop={q.questionImageCrop} alt={`Cropped diagram for question ${i + 1}`}/> : <p className="crop-missing-note">No figure crop was detected, so no image will be attached. You can crop it manually if needed.</p>}<button className="crop-button" type="button" onClick={() => setCropTarget({ questionIndex: i })}>{q.questionImageCrop ? "Adjust crop (optional)" : "Crop manually (optional)"}</button></>}</div>
        <div className="choice-edit-list">{q.choices.map((c, ci) => { const imageIndex = q.choiceImageIndexes?.[ci] ?? -1; const imageCrop = q.choiceImageCrops?.[ci]; return <div className="choice-edit" key={ci}>
          <input type="radio" name={`correct-${i}`} checked={q.correctAnswer === ci} aria-label={`Mark choice ${ci + 1} correct`} onChange={() => updateQuestion(i, { correctAnswer: ci })}/>
          <input value={c} aria-label={`Choice ${ci + 1}`} onChange={e => updateQuestion(i, { choices: q.choices.map((option, oi) => oi === ci ? e.target.value : option) })}/>
          {c.includes("$") || c.includes("\\(") || c.includes("\\[") ? <div className="math-preview choice-math-preview"><MathText text={c}/></div> : null}
          <span>Correct</span>
          <select aria-label={`Diagram for choice ${ci + 1}`} value={imageIndex} onChange={e => setChoiceImage(i, ci, Number(e.target.value))}><option value={-1}>No choice diagram</option>{sourceFiles.map((file, sourceIndex) => <option key={sourceIndex} value={sourceIndex}>{`Image ${sourceIndex + 1}: ${file.name}`}</option>)}</select>
          {imageIndex >= 0 && <>{imageCrop ? <div className="choice-diagram-preview"><CropResultPreview file={sourceFiles[imageIndex]} crop={imageCrop} alt={`Cropped diagram for choice ${String.fromCharCode(65 + ci)}`}/></div> : <p className="crop-missing-note choice-diagram-preview">No figure crop was detected; this image will not be attached.</p>}<button className="crop-button choice-diagram-preview" type="button" onClick={() => setCropTarget({ questionIndex: i, choiceIndex: ci })}>{imageCrop ? "Adjust crop (optional)" : "Crop manually (optional)"}</button></>}
        </div>; })}</div>
        <div className="edit-grid"><label>Category<input value={q.category} onChange={e => updateQuestion(i, { category: e.target.value })}/></label></div>
      </article>)}</div>
      <button className="text-button" onClick={() => { setReviewConfirmed(false); setDraft({ ...draft, questions: [...draft.questions, { id: `q-${Date.now()}`, question: "", choices: ["", "", "", ""], correctAnswer: 0, category: "General", questionImageIndex: -1, choiceImageIndexes: [-1, -1, -1, -1] }] }); }}>＋ Add question</button>
      <label className="review-confirm"><input type="checkbox" checked={reviewConfirmed} onChange={e => setReviewConfirmed(e.target.checked)}/> I reviewed the test questions, choices, diagrams, and answer key.</label>
      <button className="button dark-button publish-button" onClick={saveTest} disabled={busy || !draft.questions.length || !reviewConfirmed}>{busy ? "Preparing diagrams & publishing…" : "Approve & publish test"}<span>→</span></button>
    </section>}

    {screen === "attend" && <section className="panel"><button className="back" onClick={() => setScreen("home")}>← Home</button><div className="eyebrow">PICK YOUR NEXT CHALLENGE</div><h1>Ready when<br/><em>you are.</em></h1><p className="muted">Choose a test. Your score stays private to your account; anonymous averages are shown to everyone.</p>{user ? <p className="signed-in">Signed in as {user.email}</p> : <div className="setup-note"><strong>Sign-in required to attend</strong><br/>Create a participant account or sign in. Individual results are private to your account.<button className="text-button" onClick={() => setScreen("auth")}>Sign in / create account →</button></div>}<div className="test-list">{[...tests, { ...demoTest, id: "demo" }].map(test => <article className="test-item test-item-card" key={test.id}><div className="test-badge">✳</div><div className="test-info"><h3>{test.name}</h3><p>{test.questions.length} questions · {test.description || "A focused practice test"}</p></div><button aria-label={`Attend ${test.name}`} onClick={() => void startTest(test)} disabled={busy}>{busy ? "…" : "→"}</button><button aria-label={`Analytics for ${test.name}`} onClick={() => void openTestAnalytics(test)}>Stats</button></article>)}</div>{!firebaseReady && <div className="setup-note">Firebase is not configured. The sample test can be viewed, but sign-in, publishing, and saving results need Firebase.</div>}</section>}

    {screen === "quiz" && selected && currentQuestion && <section className="quiz-panel"><div className="quiz-top"><div><div className="eyebrow">{selected.name.toUpperCase()}</div><span className="muted small">QUESTION {questionIndex + 1} OF {selected.questions.length} · ELAPSED</span></div><div className="timer"><span>◷</span> {formatDuration(elapsedSeconds)}</div></div><div className="focus-notice">Elapsed time excludes pauses. Browser focus checks pause the test but cannot lock the device.</div><div className="progress-track"><span style={{ width: `${((questionIndex + 1) / selected.questions.length) * 100}%` }}/></div><div className="quiz-content"><div className="category-tag">{currentQuestion.category}</div><h1><MathText text={currentQuestion.question}/></h1>{currentQuestion.diagramId && selectedDiagrams[currentQuestion.diagramId] && <img className="test-diagram" src={selectedDiagrams[currentQuestion.diagramId]} alt="Diagram for this question"/>}<div className="choices">{currentQuestion.choices.map((c, i) => { const diagramId = currentQuestion.choiceDiagramIds?.[i]; return <button key={i} className={`choice ${choice === i ? "selected" : ""}`} onClick={() => setChoice(i)}><span className="choice-letter">{String.fromCharCode(65 + i)}</span><span className="choice-content"><MathText text={c}/>{diagramId && selectedDiagrams[diagramId] && <img className="choice-diagram" src={selectedDiagrams[diagramId]} alt={`Diagram for option ${String.fromCharCode(65 + i)}`}/>}</span><span className="choice-check">{choice === i ? "✓" : ""}</span></button>; })}</div><div className="quiz-controls"><button className="pause-button" onClick={() => pauseTest("The timer is stopped. Resume when you are ready to continue.")}>Ⅱ Pause</button><button className="button dark-button" onClick={advance} disabled={choice === null}>{questionIndex === selected.questions.length - 1 ? "Finish test" : "Next question"}<span>→</span></button></div></div>{paused && <div className="pause-overlay"><span className="pause-symbol">Ⅱ</span><div className="eyebrow">TEST PAUSED</div><h2>Test paused.</h2><p>{focusMessage}</p><button className="button dark-button" onClick={() => void resumeTest()}>Resume test <span>→</span></button></div>}</section>}

    {screen === "analytics" && result && <section className="panel wide-panel"><button className="back" onClick={() => { setScreen("attend"); setResult(null); }}>← Tests</button><div className="eyebrow">PRIVATE RESULT · {result.testName.toUpperCase()}</div><h1>Nice work,<br/><em>{result.participantName}.</em></h1><div className="score-card"><div><span className="muted small">YOUR SCORE</span><div className="score-number">{correctCount}<span> / {result.totalQuestions}</span></div><span className="muted small">ACTIVE TIME {formatDuration(result.durationSeconds)}</span></div><div className="score-ring" style={{ "--score": `${Math.round(100 * correctCount / result.totalQuestions)}%` } as React.CSSProperties}><span>{Math.round(100 * correctCount / result.totalQuestions)}<small>%</small></span></div></div><div className="stat-row"><div><strong>{correctCount}</strong><span>Correct</span></div><div><strong>{result.totalQuestions - correctCount}</strong><span>Incorrect</span></div><div><strong>{formatDuration(result.durationSeconds)}</strong><span>Active time</span></div></div><h2 className="section-title">By category</h2><div className="category-results">{Object.entries(result.answers.reduce<Record<string, { correct: number; total: number }>>((acc, answer) => { acc[answer.category] ??= { correct: 0, total: 0 }; acc[answer.category].total++; if (answer.correct) acc[answer.category].correct++; return acc; }, {})).map(([category, value]) => { const pct = Math.round(value.correct / value.total * 100); return <div className="category-result" key={category}><div><strong>{category}</strong><span>{value.correct} / {value.total}</span><b className={pct < 70 ? "weak" : ""}>{pct}% {pct < 70 ? "· revisit" : ""}</b></div><div className="result-track"><span className={pct < 70 ? "weak-fill" : ""} style={{ width: `${pct}%` }}/></div></div>; })}</div><h2 className="section-title">Question review</h2><div className="review-list">{result.answers.map((a, i) => <div className="review-item" key={a.questionId}><span className={a.correct ? "review-mark good" : "review-mark bad"}>{a.correct ? "✓" : "×"}</span><div><strong>Q{i + 1} · {a.correct ? "Correct" : "Review this one"} · {formatDuration(a.timeSpent)}</strong><small><MathText text={a.question}/></small>{!a.correct && <small className="answer-note"><MathText text={`Answer: ${a.choices[a.correctAnswer]}`}/></small>}</div></div>)}</div><button className="button dark-button" onClick={() => { setScreen("attend"); setResult(null); }}>Take another test <span>→</span></button></section>}

    {screen === "testAnalytics" && selected && <section className="panel wide-panel"><button className="back" onClick={() => setScreen("attend")}>← Tests</button><div className="eyebrow">ANONYMOUS TEST ANALYTICS</div><h1>{selected.name}</h1><p className="muted">Only aggregate timing and attempt counts are shown here. Individual answers are private.</p>{statsLoading ? <p className="muted">Loading aggregate statistics…</p> : selectedStats ? <><div className="stat-row"><div><strong>{selectedStats.attemptCount}</strong><span>Attempts</span></div><div><strong>{formatDuration(selectedStats.totalDurationSeconds / selectedStats.attemptCount)}</strong><span>Average active test time</span></div><div><strong>{selected.questions.length}</strong><span>Questions</span></div></div><h2 className="section-title">Average time by question</h2><div className="category-results">{selected.questions.map((question, index) => { const metric = selectedStats.questions?.[question.id]; return <div className="category-result question-stat" key={question.id}><div><strong><MathText text={`Q${index + 1} · ${question.question}`}/></strong><span>{metric?.count || 0} attempts</span><b>{metric?.count ? formatDuration(metric.totalTimeSeconds / metric.count) : "—"}</b></div><div className="result-track"><span style={{ width: `${metric?.count ? Math.min(100, metric.totalTimeSeconds / metric.count / 60 * 100) : 0}%` }}/></div></div>; })}</div></> : <div className="setup-note">No aggregate results yet. Complete attempts will appear here after the Firebase aggregate function has been deployed. Individual results are never listed on this page.</div>}</section>}

    <footer><span>minute<span className="footer-dot">.</span></span><span>SMALL STEPS. SHARP MINDS.</span></footer>
    {cropTarget && sourcePreviewUrls[cropSourceIndex] && <CropAreaSelector src={sourcePreviewUrls[cropSourceIndex]} initialCrop={activeCrop} onCancel={() => setCropTarget(null)} onSave={saveCropArea}/>}
  </main>;
}
