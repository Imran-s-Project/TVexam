// ==========================================================================
// exam.js — Exam list, taking, scoring, result, PDF export
// examDb → সকল এক্সাম ডেটা
// mainDb → ইউজার enrollment চেক
// ==========================================================================
import { auth, examDb, mainDb } from "./firebase-config.js";
import {
  collection, getDocs, getDoc, doc,
  query, orderBy, where, limit,
  setDoc, addDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  requireAuth, toast, escapeHtml, formatTime, formatDuration,
  formatScore, formatDateTime, getExamAvailability, shuffleArray,
  checkCourseAccess, initNav,
} from "./utils.js";
import { navigate } from "./router.js";

// ── Per-visit state ────────────────────────────────────────────────────────
let currentUser    = null;
let examId         = null;
let questions      = [];
let currentIndex   = 0;
let answers        = {};
let lockedQs       = new Set();
let timerInterval  = null;
let secondsLeft    = 0;
let examLayout     = "one";
let attemptsSoFar  = 0;
let navToken       = 0;

// ── Static control binding guard ──────────────────────────────────────────
let controlsBound  = false;
function bindStaticControls() {
  if (controlsBound) return;
  controlsBound = true;
  document.getElementById("q-prev")?.addEventListener("click", () => {
    if (currentIndex > 0) { currentIndex--; renderQuestion(); }
  });
  document.getElementById("q-next")?.addEventListener("click", () => {
    if (currentIndex < questions.length - 1) { currentIndex++; renderQuestion(); }
  });
  document.getElementById("q-submit-btn")?.addEventListener("click", () => {
    submitExam(window.__currentExam);
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function initExamPage(params) {
  const myToken = ++navToken;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  examId       = params.get("id");
  questions    = [];
  currentIndex = 0;
  answers      = {};
  lockedQs     = new Set();
  secondsLeft  = 0;
  examLayout   = "one";
  attemptsSoFar = 0;

  const listView   = document.getElementById("exam-list-view");
  const takeView   = document.getElementById("exam-take-view");
  const resultView = document.getElementById("exam-result-view");

  listView?.classList.remove("hidden");
  takeView?.classList.add("hidden");
  resultView?.classList.add("hidden");
  if (resultView) resultView.innerHTML = "";

  bindStaticControls();
  initNav("exams");

  currentUser = await requireAuth();
  if (myToken !== navToken || !currentUser) return _cleanup;

  if (examId) {
    await _loadTaking(examId, myToken);
  } else {
    await _loadList(myToken);
  }

  return _cleanup;

  function _cleanup() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
}

// ── Exam list ──────────────────────────────────────────────────────────────
async function _loadList(myToken) {
  const grid = document.getElementById("exam-grid");
  const searchInput = document.getElementById("exam-search");
  const filterSelect = document.getElementById("exam-filter");

  grid.innerHTML = `<div class="loading-screen"><span class="spinner"></span> Loading exams…</div>`;

  try {
    const snap = await getDocs(collection(examDb, "exams"));
    if (myToken !== navToken) return;

    let exams = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (!exams.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams available yet</p></div>`;
      return;
    }

    // Build cards with access check
    const cards = await Promise.all(exams.map(ex => _buildCard(ex, currentUser.uid)));
    if (myToken !== navToken) return;

    function renderGrid(filter = "", category = "all") {
      const filtered = cards.filter((c, i) => {
        if (!c) return false;
        const ex = exams[i];
        const matchSearch = !filter || ex.title?.toLowerCase().includes(filter.toLowerCase());
        const matchCat = category === "all" || ex.courseId === category || (!ex.courseId && category === "general");
        return matchSearch && matchCat;
      });
      grid.innerHTML = filtered.length
        ? filtered.filter(Boolean).join("")
        : `<div class="empty-state"><div class="icon"><i class="fa-solid fa-magnifying-glass"></i></div><p>No matching exams</p></div>`;
      _startCountdowns(grid);
    }

    renderGrid();
    searchInput?.addEventListener("input", () => renderGrid(searchInput.value, filterSelect?.value));
    filterSelect?.addEventListener("change", () => renderGrid(searchInput?.value, filterSelect.value));

  } catch (err) {
    if (myToken !== navToken) return;
    grid.innerHTML = `<div class="empty-state"><p>Could not load exams. Please refresh.</p></div>`;
  }
}

async function _buildCard(ex, uid) {
  try {
    const { state, publishAt, closesAt } = getExamAvailability(ex);
    const hasAccess = await checkCourseAccess(uid, ex.courseId);

    if (ex.courseId && !hasAccess) return ""; // paid exam, not purchased

    let result = null;
    try {
      const rSnap = await getDoc(doc(examDb, "results", `${uid}_${ex.id}`));
      result = rSnap.exists() ? rSnap.data() : null;
    } catch {}

    const maxAttempts    = Number(ex.maxAttempts || 0);
    const attemptsUsed   = maxAttempts > 0 ? Number(result?.attemptNumber || 0) : 0;
    const exhausted      = maxAttempts > 0 && attemptsUsed >= maxAttempts;
    const attemptsBadge  = maxAttempts > 0
      ? `<span><i class="fa-solid fa-rotate"></i> ${attemptsUsed}/${maxAttempts} attempts</span>`
      : `<span><i class="fa-solid fa-infinity"></i> Unlimited</span>`;

    const isLocked = state === "upcoming" || state === "closed" || exhausted;

    const meta = `
      <div class="exam-meta">
        <span><i class="fa-solid fa-stopwatch"></i> ${ex.duration || 10} min</span>
        <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} questions</span>
        ${Number(ex.negativeMarking) > 0 ? `<span><i class="fa-solid fa-triangle-exclamation"></i> −${formatScore(ex.negativeMarking)} per wrong</span>` : ""}
        ${attemptsBadge}
      </div>`;

    const courseBadge = ex.courseName
      ? `<span class="badge badge-blue">${escapeHtml(ex.courseName)}</span>`
      : `<span class="badge badge-gray">General</span>`;

    if (state === "upcoming") {
      return `
        <div class="exam-card card exam-card-locked">
          <div class="flex gap-8 items-center">${courseBadge}
            <span class="countdown-chip" data-countdown="${publishAt.getTime()}">
              <i class="fa-solid fa-hourglass-half"></i> <span class="countdown-val">…</span>
            </span>
          </div>
          <div class="exam-card-title">${escapeHtml(ex.title)}</div>
          <div class="exam-card-desc">${escapeHtml(ex.description || "")}</div>
          ${meta}
          <span class="badge badge-amber"><i class="fa-solid fa-clock"></i> Opens ${formatDateTime(publishAt)}</span>
        </div>`;
    }

    if (state === "closed") {
      return `
        <div class="exam-card card exam-card-locked">
          ${courseBadge}
          <div class="exam-card-title">${escapeHtml(ex.title)}</div>
          ${meta}
          ${result ? `<span class="badge badge-blue">Last score: ${formatScore(result.score)}/${result.total}</span>` : ""}
          <span class="badge badge-red"><i class="fa-solid fa-lock"></i> Closed ${formatDateTime(closesAt)}</span>
        </div>`;
    }

    if (exhausted) {
      return `
        <div class="exam-card card exam-card-locked">
          ${courseBadge}
          <div class="exam-card-title">${escapeHtml(ex.title)}</div>
          ${meta}
          ${result ? `<span class="badge badge-blue">Best score: ${formatScore(result.score)}/${result.total}</span>` : ""}
          <span class="badge badge-red"><i class="fa-solid fa-ban"></i> All attempts used</span>
        </div>`;
    }

    return `
      <div class="exam-card card">
        ${courseBadge}
        <div class="exam-card-title">${escapeHtml(ex.title)}</div>
        <div class="exam-card-desc">${escapeHtml(ex.description || "")}</div>
        ${meta}
        ${result ? `<span class="badge badge-cyan">Previous: ${formatScore(result.score)}/${result.total} (${result.percent}%)</span>` : ""}
        ${closesAt ? `<span class="badge badge-amber"><i class="fa-solid fa-clock"></i> Closes ${formatDateTime(closesAt)}</span>` : ""}
        <div class="exam-card-footer">
          <a href="#/exam?id=${ex.id}" class="btn btn-primary btn-block">${result ? "Retake Exam" : "Start Exam"} <i class="fa-solid fa-arrow-right"></i></a>
        </div>
      </div>`;
  } catch {
    return "";
  }
}

// ── Taking an exam ─────────────────────────────────────────────────────────
async function _loadTaking(id, myToken) {
  const listView = document.getElementById("exam-list-view");
  const takeView = document.getElementById("exam-take-view");
  listView?.classList.add("hidden");
  takeView?.classList.remove("hidden");

  // Load exam doc from examDb
  const examSnap = await getDoc(doc(examDb, "exams", id));
  if (myToken !== navToken) return;
  if (!examSnap.exists()) {
    takeView.innerHTML = `<div class="empty-state"><p>Exam not found.</p><a href="#/" class="btn btn-outline mt-16">Go back</a></div>`;
    return;
  }
  const exam = examSnap.data();

  // Enrollment check
  const hasAccess = await checkCourseAccess(currentUser.uid, exam.courseId);
  if (myToken !== navToken) return;
  if (exam.courseId && !hasAccess) {
    toast("এই exam নেওয়ার জন্য course কিনতে হবে", "error");
    setTimeout(() => { if (myToken === navToken) navigate("#/"); }, 1500);
    return;
  }

  // Availability check
  const { state, publishAt, closesAt } = getExamAvailability(exam);
  if (state === "upcoming") {
    toast(`Exam এখনো শুরু হয়নি — শুরু হবে ${formatDateTime(publishAt)}`, "error");
    setTimeout(() => { if (myToken === navToken) navigate("#/"); }, 1500);
    return;
  }
  if (state === "closed") {
    toast(`Exam শেষ হয়ে গেছে (ছিল ${formatDateTime(closesAt)} পর্যন্ত)`, "error");
    setTimeout(() => { if (myToken === navToken) navigate("#/"); }, 1500);
    return;
  }

  // Attempts check
  const maxAttempts = Number(exam.maxAttempts || 0);
  if (maxAttempts > 0) {
    const rSnap = await getDoc(doc(examDb, "results", `${currentUser.uid}_${id}`));
    if (myToken !== navToken) return;
    attemptsSoFar = rSnap.exists() ? Number(rSnap.data().attemptNumber || 0) : 0;
    if (attemptsSoFar >= maxAttempts) {
      toast(`সর্বোচ্চ ${maxAttempts}টি attempt শেষ`, "error");
      setTimeout(() => { if (myToken === navToken) navigate("#/"); }, 1500);
      return;
    }
  }

  // Load questions from examDb subcollection
  const qSnap = await getDocs(query(collection(examDb, "exams", id, "questions"), orderBy("order", "asc")));
  if (myToken !== navToken) return;
  questions = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!questions.length) {
    takeView.innerHTML = `<div class="empty-state"><p>This exam has no questions yet.</p></div>`;
    return;
  }

  // Shuffle
  if (exam.shuffle !== false) {
    questions = shuffleArray(questions).map(q => {
      const ord = shuffleArray(q.options.map((_, i) => i));
      return { ...q, options: ord.map(i => q.options[i]), correctIndex: ord.indexOf(q.correctIndex) };
    });
  }

  window.__currentExam = exam;
  examLayout = exam.layout === "all" ? "all" : "one";
  answers = {}; lockedQs = new Set(); currentIndex = 0;

  // Update title
  const titleEl = document.getElementById("exam-take-title");
  if (titleEl) titleEl.textContent = exam.title;

  // Show/hide nav buttons
  const prevBtn   = document.getElementById("q-prev");
  const nextBtn   = document.getElementById("q-next");
  const submitBtn = document.getElementById("q-submit-btn");
  const progressEl = document.getElementById("q-progress");

  if (examLayout === "all") {
    prevBtn?.classList.add("hidden");
    nextBtn?.classList.add("hidden");
    submitBtn?.classList.remove("hidden");
    progressEl?.classList.add("hidden");
  } else {
    prevBtn?.classList.remove("hidden");
    nextBtn?.classList.remove("hidden");
    progressEl?.classList.remove("hidden");
  }
  document.getElementById("exam-nav-row")?.classList.remove("hidden");

  secondsLeft = (exam.duration || 10) * 60;
  _startTimer(exam);
  examLayout === "all" ? _renderAll() : renderQuestion();
}

// ── Timer ──────────────────────────────────────────────────────────────────
function _startTimer(exam) {
  if (timerInterval) clearInterval(timerInterval);
  const el = document.getElementById("exam-timer");
  timerInterval = setInterval(() => {
    secondsLeft--;
    if (el) {
      el.innerHTML = `<i class="fa-solid fa-stopwatch"></i> ${formatTime(Math.max(0, secondsLeft))}`;
      el.classList.toggle("low", secondsLeft <= 60);
    }
    if (secondsLeft <= 0) {
      clearInterval(timerInterval); timerInterval = null;
      toast("সময় শেষ! Submit হচ্ছে…", "error");
      submitExam(exam);
    }
  }, 1000);
}

// ── Render one question ────────────────────────────────────────────────────
function renderQuestion() {
  const q = questions[currentIndex];
  const fill = document.getElementById("q-progress-fill");
  if (fill) fill.style.width = `${((currentIndex + 1) / questions.length) * 100}%`;

  const area = document.getElementById("question-area");
  if (!area) return;
  area.innerHTML = `
    <div class="question-card">
      <div class="q-index">QUESTION ${currentIndex + 1} / ${questions.length}</div>
      <div class="q-text">${escapeHtml(q.text)}</div>
      ${_optionsHtml(q)}
    </div>
  `;
  _bindOptions(area, renderQuestion);

  const prevBtn   = document.getElementById("q-prev");
  const nextBtn   = document.getElementById("q-next");
  const submitBtn = document.getElementById("q-submit-btn");
  const counter   = document.getElementById("q-counter");
  if (prevBtn)   prevBtn.disabled = currentIndex === 0;
  if (counter)   counter.textContent = `${currentIndex + 1} / ${questions.length}`;
  const isLast = currentIndex === questions.length - 1;
  nextBtn?.classList.toggle("hidden", isLast);
  submitBtn?.classList.toggle("hidden", !isLast);
}

function _renderAll() {
  const area = document.getElementById("question-area");
  if (!area) return;
  area.innerHTML = questions.map((q, i) => `
    <div class="question-card mb-16">
      <div class="q-index">QUESTION ${i + 1} / ${questions.length}</div>
      <div class="q-text">${escapeHtml(q.text)}</div>
      ${_optionsHtml(q)}
    </div>`).join("");
  _bindOptions(area, _renderAll);
  document.getElementById("q-submit-btn")?.classList.remove("hidden");
}

// ── Options HTML ───────────────────────────────────────────────────────────
function _optionsHtml(q) {
  const locked = lockedQs.has(q.id);
  return `
    <div class="option-list ${locked ? "locked" : ""}" data-qid="${q.id}">
      ${q.options.map((opt, i) => `
        <div class="option-item ${answers[q.id] === i ? "selected" : ""} ${locked ? "disabled" : ""}"
             data-qid="${q.id}" data-i="${i}">
          <span class="option-letter">${String.fromCharCode(65 + i)}</span>
          <span class="option-text">${escapeHtml(opt)}</span>
          ${answers[q.id] === i && locked ? `<i class="fa-solid fa-lock option-lock-icon"></i>` : ""}
        </div>`).join("")}
    </div>
    ${locked ? `<div class="option-locked-hint"><i class="fa-solid fa-circle-info"></i> Answer locked</div>` : ""}
  `;
}

function _bindOptions(container, onLock) {
  container.querySelectorAll(".option-item").forEach(el => {
    el.addEventListener("click", () => {
      const qid = el.dataset.qid;
      if (lockedQs.has(qid)) return;
      answers[qid] = Number(el.dataset.i);
      lockedQs.add(qid);
      onLock();
    });
  });
}

// ── Submit ─────────────────────────────────────────────────────────────────
async function submitExam(exam) {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

  const negMark    = Math.max(0, Number(exam?.negativeMarking) || 0);
  let correct = 0, wrong = 0;
  questions.forEach(q => {
    if (answers[q.id] === undefined) return;
    if (answers[q.id] === q.correctIndex) correct++;
    else wrong++;
  });
  const unanswered    = questions.length - correct - wrong;
  const rawScore      = correct - wrong * negMark;
  const score         = Math.round(rawScore * 100) / 100;
  const percent       = Math.max(0, Math.min(100, Math.round((rawScore / questions.length) * 100)));
  const attemptNumber = attemptsSoFar + 1;
  const totalSeconds  = (exam?.duration || 10) * 60;
  const timeTaken     = Math.max(0, totalSeconds - secondsLeft);

  const payload = {
    uid: currentUser.uid,
    examId,
    examTitle:    exam?.title || "",
    score, total: questions.length,
    percent, correct, wrong, unanswered,
    negativeMarking: negMark,
    timeTakenSeconds: timeTaken,
    answers,
    attemptNumber,
    submittedAt: serverTimestamp(),
    passMark: Number(exam?.passMark || 60),
  };

  // Save to examDb
  await setDoc(doc(examDb, "results", `${currentUser.uid}_${examId}`), payload);
  try {
    await addDoc(collection(examDb, "attempts"), { ...payload, answers: undefined });
  } catch {}

  _showResult(score, questions.length, percent, exam, { correct, wrong, unanswered, negMark, timeTaken });
}

// ── Result view ─────────────────────────────────────────────────────────────
function _showResult(score, total, percent, exam, breakdown) {
  const takeView   = document.getElementById("exam-take-view");
  const resultView = document.getElementById("exam-result-view");
  takeView?.classList.add("hidden");
  resultView?.classList.remove("hidden");

  const passMark = Number(exam?.passMark || 60);
  const passed   = percent >= passMark;
  const ringClass = passed ? "passed" : "failed";

  const { correct = 0, wrong = 0, unanswered = 0, negMark = 0, timeTaken = 0 } = breakdown;

  resultView.innerHTML = `
    <div class="result-wrap">
      <div class="result-hero">
        <div class="result-ring-wrap">
          <div class="result-ring ${ringClass}" style="--pct:${percent}">
            <b>${percent}%</b>
          </div>
        </div>
        <h2>${passed
          ? `<i class="fa-solid fa-circle-check" style="color:var(--accent-green)"></i> Passed!`
          : `<i class="fa-solid fa-circle-xmark" style="color:var(--accent-red)"></i> Not passed`}
        </h2>
        <p class="result-score">Score: <b>${formatScore(score)} / ${total}</b> &nbsp;·&nbsp; Pass mark: ${passMark}%</p>
        <div class="breakdown-grid">
          <span class="badge badge-green"><i class="fa-solid fa-check"></i> Correct: ${correct}</span>
          <span class="badge badge-red"><i class="fa-solid fa-xmark"></i> Wrong: ${wrong}</span>
          <span class="badge badge-gray"><i class="fa-solid fa-minus"></i> Skipped: ${unanswered}</span>
          <span class="badge badge-blue"><i class="fa-solid fa-stopwatch"></i> ${formatDuration(timeTaken)}</span>
          ${negMark > 0 ? `<span class="badge badge-amber"><i class="fa-solid fa-triangle-exclamation"></i> −${formatScore(negMark)} per wrong</span>` : ""}
        </div>
        <div class="result-actions">
          <a href="#/" class="btn btn-outline">All Exams</a>
          <a href="#/exam?id=${examId}" class="btn btn-primary">Retake</a>
          <a href="#/history" class="btn btn-cyan">My History</a>
          <button class="btn btn-ghost" id="download-pdf-btn"><i class="fa-solid fa-file-pdf"></i> PDF</button>
        </div>
      </div>

      <div class="review-list mt-24">
        ${questions.map((q, i) => {
          const ua = answers[q.id];
          const ok = ua === q.correctIndex;
          const skipped = ua === undefined;
          return `
            <div class="review-item">
              <div class="q-num">QUESTION ${i + 1}</div>
              <div class="q-body">${escapeHtml(q.text)}</div>
              <div class="review-answer ${skipped ? "unanswered" : ok ? "correct" : "wrong"}">
                ${skipped
                  ? `<i class="fa-solid fa-minus"></i> Not answered`
                  : ok
                    ? `<i class="fa-solid fa-check"></i> ${escapeHtml(q.options[ua])}`
                    : `<i class="fa-solid fa-xmark"></i> ${escapeHtml(q.options[ua])}`
                }
              </div>
              ${!ok && !skipped
                ? `<div class="review-answer correct"><i class="fa-solid fa-check"></i> ${escapeHtml(q.options[q.correctIndex])}</div>`
                : ""}
              ${!ok && skipped
                ? `<div class="review-answer correct"><i class="fa-solid fa-check"></i> ${escapeHtml(q.options[q.correctIndex])}</div>`
                : ""}
            </div>`;
        }).join("")}
      </div>
    </div>
  `;

  document.getElementById("download-pdf-btn")?.addEventListener("click", () => {
    _downloadPDF(score, total, percent, exam?.title || "Exam", breakdown);
  });
}

// ── PDF export ─────────────────────────────────────────────────────────────
async function _downloadPDF(score, total, percent, title, breakdown) {
  const btn = document.getElementById("download-pdf-btn");
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) { toast("PDF engine লোড হয়নি", "error"); return; }

  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`; }

  try {
    const { correct = 0, wrong = 0, unanswered = 0, negMark = 0, timeTaken = 0 } = breakdown;
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    const mx = 40;

    // Logo watermark
    const logo = await _loadImg("assets/logo.png");
    const drawWM = () => {
      if (!logo) return;
      pdf.saveGraphicsState();
      pdf.setGState(new pdf.GState({ opacity: 0.06 }));
      const s = 280;
      pdf.addImage(logo, "PNG", (pw - s) / 2, (ph - s) / 2, s, s, undefined, undefined, 30);
      pdf.restoreGraphicsState();
    };
    drawWM();

    // Header
    if (logo) pdf.addImage(logo, "PNG", mx, 28, 34, 34);
    pdf.setFontSize(16); pdf.setFont(undefined, "bold");
    pdf.text("TV Exam", mx + 44, 44);
    pdf.setFontSize(10); pdf.setFont(undefined, "normal");
    pdf.setTextColor(120, 120, 120);
    pdf.text("Exam Result Report", mx + 44, 58);
    pdf.setTextColor(0, 0, 0);

    let y = 88;
    pdf.setDrawColor(200); pdf.line(mx, y, pw - mx, y); y += 22;

    pdf.setFontSize(13); pdf.setFont(undefined, "bold");
    pdf.text(title, mx, y); y += 18;
    pdf.setFontSize(10); pdf.setFont(undefined, "normal");
    pdf.text(`Student: ${currentUser?.displayName || currentUser?.email || "—"}`, mx, y); y += 14;
    pdf.text(`Date: ${new Date().toLocaleString()}`, mx, y); y += 14;
    pdf.setFont(undefined, "bold");
    pdf.text(`Score: ${formatScore(score)} / ${total}  (${percent}%)`, mx, y); y += 14;
    pdf.setFont(undefined, "normal");
    pdf.text(`Correct: ${correct}  Wrong: ${wrong}  Skipped: ${unanswered}  Time: ${formatDuration(timeTaken)}`, mx, y); y += 18;

    pdf.setFontSize(12); pdf.setFont(undefined, "bold");
    pdf.text("Answer Review", mx, y); y += 16;
    pdf.setFontSize(9);

    const cw = pw - mx * 2;
    questions.forEach((q, i) => {
      const ua = answers[q.id];
      const ok = ua === q.correctIndex;
      const lines = pdf.splitTextToSize(`${i + 1}. ${q.text}`, cw);
      const est = lines.length * 13 + (ok ? 14 : 28) + 16;
      if (y + est > ph - 40) { pdf.addPage(); drawWM(); y = 50; }

      pdf.setFont(undefined, "bold"); pdf.setTextColor(0, 0, 0);
      pdf.text(lines, mx, y); y += lines.length * 13;

      pdf.setFont(undefined, "normal");
      const yourText = ua !== undefined ? q.options[ua] : "Not answered";
      const yourLines = pdf.splitTextToSize(`Your: ${yourText}`, cw - 8);
      pdf.setTextColor(ok ? 20 : 200, ok ? 140 : 50, ok ? 80 : 50);
      pdf.text(yourLines, mx + 8, y); y += yourLines.length * 13;

      if (!ok) {
        const corrLines = pdf.splitTextToSize(`Correct: ${q.options[q.correctIndex]}`, cw - 8);
        pdf.setTextColor(20, 140, 80);
        pdf.text(corrLines, mx + 8, y); y += corrLines.length * 13;
      }
      pdf.setTextColor(0, 0, 0);
      y += 10;
    });

    const safe = (title).replace(/[^a-z0-9]+/gi, "_").slice(0, 60);
    pdf.save(`${safe}_result.pdf`);
  } catch {
    toast("PDF তৈরি ব্যর্থ হয়েছে", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-file-pdf"></i> PDF`; }
  }
}

function _loadImg(src) {
  return new Promise(res => {
    const img = new Image(); img.crossOrigin = "anonymous";
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = src;
  });
}

// ── Countdown ticks ────────────────────────────────────────────────────────
function _startCountdowns(container) {
  if (container._cdTimer) clearInterval(container._cdTimer);
  function tick() {
    const chips = container.querySelectorAll("[data-countdown]");
    if (!chips.length) { clearInterval(container._cdTimer); return; }
    const now = Date.now();
    chips.forEach(chip => {
      const diff = Math.max(0, Number(chip.dataset.countdown) - now);
      const el = chip.querySelector(".countdown-val");
      if (!el) return;
      if (!diff) { el.textContent = "Starting…"; return; }
      const s = Math.floor(diff / 1000);
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
            m = Math.floor((s % 3600) / 60), sec = s % 60;
      el.textContent = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
    });
  }
  tick();
  container._cdTimer = setInterval(tick, 1000);
}
