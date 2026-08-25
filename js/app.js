// ==========================================================================
// Tech Verse Exam — SPA router + pages
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast,
  escapeHtml,
  getUserProfile,
  formatDateTime,
  formatDuration,
  formatScore,
  shuffleArray,
  signOutUser,
  touchLastActive,
  userHasCourseAccess,
  getCoursePricing,
  COURSE_SITE_URL,
} from "./utils.js";
import { bindAuthForms } from "./auth.js";
import { initTheme } from "./theme.js";

let currentUser = null;
let userProfile = null;
let coursesCache = [];

/* ---------- Boot ---------- */
initTheme();
bindAuthForms();
document.getElementById("course-site-link").href = COURSE_SITE_URL;
document.getElementById("footer-course-link").href = COURSE_SITE_URL;

document.getElementById("hamburger")?.addEventListener("click", () => {
  document.getElementById("nav-links")?.classList.toggle("open");
});

document.getElementById("nav-login-btn")?.addEventListener("click", () => {
  location.hash = "#/login";
});

document.getElementById("user-chip")?.addEventListener("click", () => {
  if (!currentUser) return;
  if (confirm("Sign out?")) signOutUser();
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    userProfile = await getUserProfile(user.uid);
    touchLastActive(user.uid);
    document.getElementById("user-chip")?.classList.remove("hidden");
    document.getElementById("nav-login-btn")?.classList.add("hidden");
    const name = user.displayName || userProfile?.displayName || user.email?.split("@")[0] || "User";
    document.getElementById("nav-name").textContent = name;
    document.getElementById("nav-avatar").textContent = name.charAt(0).toUpperCase();
    document.getElementById("nav-admin-link")?.classList.toggle("hidden", !userProfile?.isAdmin);
  } else {
    userProfile = null;
    document.getElementById("user-chip")?.classList.add("hidden");
    document.getElementById("nav-login-btn")?.classList.remove("hidden");
    document.getElementById("nav-admin-link")?.classList.add("hidden");
  }
  route();
});

window.addEventListener("hashchange", route);

function parseHash() {
  const raw = (location.hash || "#/").replace(/^#/, "") || "/";
  const [pathPart, queryPart] = raw.split("?");
  const path = pathPart.replace(/^\//, "") || "home";
  const params = Object.fromEntries(new URLSearchParams(queryPart || ""));
  return { path, params };
}

function showPage(id) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === id.replace("page-", ""));
  });
  document.getElementById("nav-links")?.classList.remove("open");
  window.scrollTo(0, 0);
}

async function route() {
  const { path, params } = parseHash();
  const publicPaths = ["login", "signup", "forgot"];

  if (!currentUser && !publicPaths.includes(path)) {
    location.hash = "#/login";
    return;
  }
  if (currentUser && publicPaths.includes(path)) {
    location.hash = "#/";
    return;
  }

  if (path === "home" || path === "") {
    showPage("page-home");
    loadDashboard();
  } else if (path === "exams") {
    showPage("page-exams");
    loadExamList();
  } else if (path === "take" && params.id) {
    showPage("page-take");
    loadTakeExam(params.id);
  } else if (path === "results") {
    showPage("page-results");
    loadMyResults();
  } else if (path === "leaderboard") {
    showPage("page-leaderboard");
    loadLeaderboard();
  } else if (path === "profile") {
    showPage("page-profile");
    loadProfile();
  } else if (path === "login") {
    showPage("page-login");
  } else if (path === "signup") {
    showPage("page-signup");
  } else if (path === "forgot") {
    showPage("page-forgot");
  } else {
    showPage("page-home");
    loadDashboard();
  }
}

/* ---------- Courses cache ---------- */
async function ensureCourses() {
  if (coursesCache.length) return coursesCache;
  const snap = await getDocs(collection(db, "courses"));
  coursesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return coursesCache;
}

/* ---------- Dashboard ---------- */
async function loadDashboard() {
  const statsEl = document.getElementById("home-stats");
  const examsEl = document.getElementById("home-exams");
  const resultsEl = document.getElementById("home-results");
  try {
    const [examsSnap, resultsSnap] = await Promise.all([
      getDocs(collection(db, "exams")),
      getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid))),
    ]);
    const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const results = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const available = await filterAccessibleExams(exams);

    statsEl.innerHTML = [
      { n: available.length, l: "Available Exams" },
      { n: results.length, l: "Attempts" },
      {
        n: results.length
          ? Math.round(results.reduce((s, r) => s + (r.percent || 0), 0) / results.length) + "%"
          : "—",
        l: "Avg Score",
      },
    ]
      .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join("");

    if (!available.length) {
      examsEl.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams available yet</p></div>`;
    } else {
      examsEl.innerHTML = `<div class="exam-grid">${available
        .slice(0, 4)
        .map((ex) => examCardHtml(ex, results.find((r) => r.examId === ex.id)))
        .join("")}</div>`;
    }

    const recent = results
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
      .slice(0, 5);
    if (!recent.length) {
      resultsEl.innerHTML = `<div class="empty-state"><p>No results yet — take an exam to see scores here</p></div>`;
    } else {
      resultsEl.innerHTML = `<ul class="list-clean">${recent
        .map(
          (r) => `
        <li>
          <div>
            <strong>${escapeHtml(r.examTitle || "Exam")}</strong>
            <div class="muted" style="font-size:0.82rem">${formatDateTime(r.submittedAt)}</div>
          </div>
          <div style="font-weight:800;font-family:var(--mono)">${formatScore(r.score)}/${r.total} (${r.percent}%)</div>
        </li>`
        )
        .join("")}</ul>`;
    }
  } catch (e) {
    console.error(e);
    statsEl.innerHTML = `<div class="empty-state"><p>Could not load dashboard</p></div>`;
  }
}

/* ---------- Exam list ---------- */
async function loadExamList() {
  const grid = document.getElementById("exams-grid");
  grid.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(collection(db, "exams"));
    const exams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const resultsSnap = await getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid)));
    const results = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const available = await filterAccessibleExams(exams);
    if (!available.length) {
      grid.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams available</p></div>`;
      return;
    }
    grid.innerHTML = available
      .map((ex) => examCardHtml(ex, results.find((r) => r.examId === ex.id)))
      .join("");
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div class="empty-state"><p>Could not load exams</p></div>`;
  }
}

async function filterAccessibleExams(exams) {
  await ensureCourses();
  const enrolled = userProfile?.enrolledCourses || [];
  const results = await Promise.all(exams.map((ex) => isExamAccessible(ex, enrolled)));
  return exams.filter((_, i) => results[i]);
}

/* ---------- Per-course access check, cached so repeated exam checks against
   the same course (dashboard + exam list + take page) don't re-query Firestore ---------- */
const courseAccessCache = {};
async function isExamAccessible(ex, enrolled) {
  if (!ex.courseId) return true; // exam not tied to any course — open to everyone
  const course = coursesCache.find((c) => c.id === ex.courseId);
  const pricing = getCoursePricing(course);
  if (!pricing.isPaid) return true; // free course — no purchase needed
  if (courseAccessCache[ex.courseId] === undefined) {
    courseAccessCache[ex.courseId] = await userHasCourseAccess(currentUser.uid, ex.courseId, enrolled);
  }
  return courseAccessCache[ex.courseId];
}

function examCardHtml(ex, result) {
  const done = !!result;
  return `
    <div class="exam-card">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-start">
        <h3>${escapeHtml(ex.title)}</h3>
        ${done ? `<span class="badge badge-done">Done</span>` : `<span class="badge badge-open">Open</span>`}
      </div>
      <div class="exam-meta">
        <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} Q</span>
        ${ex.duration ? `<span><i class="fa-solid fa-clock"></i> ${ex.duration} min</span>` : ""}
        ${ex.courseName ? `<span><i class="fa-solid fa-book"></i> ${escapeHtml(ex.courseName)}</span>` : ""}
      </div>
      ${
        done
          ? `<div class="muted" style="font-size:0.85rem">Last score: <strong>${formatScore(result.score)}/${result.total}</strong> (${result.percent}%)</div>`
          : ""
      }
      <a class="btn btn-primary btn-sm" href="#/take?id=${ex.id}" style="margin-top:auto">
        ${done ? "Retake / View" : "Start Exam"}
      </a>
    </div>`;
}

/* ---------- Take exam ---------- */
let takeState = null;

async function loadTakeExam(examId) {
  const view = document.getElementById("take-view");
  view.innerHTML = `<div class="loading-screen"><span class="spinner"></span> Loading…</div>`;
  try {
    const examSnap = await getDoc(doc(db, "exams", examId));
    if (!examSnap.exists()) {
      view.innerHTML = `<div class="empty-state"><p>Exam not found</p></div>`;
      return;
    }
    const exam = { id: examSnap.id, ...examSnap.data() };

    // Access check — only users who've purchased (or been granted access to) a paid
    // linked course may take its exam; free/unlinked exams stay open to everyone.
    if (exam.courseId) {
      await ensureCourses();
      const ok = await isExamAccessible(exam, userProfile?.enrolledCourses || []);
      if (!ok) {
        const course = coursesCache.find((c) => c.id === exam.courseId);
        view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-lock"></i></div><p>This exam is locked — it's only open to students who've purchased${course ? ` "${escapeHtml(course.title)}"` : " the linked course"}.</p>
          <a class="btn btn-primary" href="${COURSE_SITE_URL}" target="_blank">Go to Course Site</a></div>`;
        return;
      }
    }

    const qSnap = await getDocs(query(collection(db, "exams", examId, "questions"), orderBy("order", "asc")));
    let questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!questions.length) {
      view.innerHTML = `<div class="empty-state"><p>This exam has no questions</p></div>`;
      return;
    }

    if (exam.shuffle !== false) {
      questions = shuffleArray(questions).map((q) => {
        const optionOrder = shuffleArray(q.options.map((_, i) => i));
        return {
          ...q,
          options: optionOrder.map((i) => q.options[i]),
          correctIndex: optionOrder.indexOf(q.correctIndex),
          _origCorrect: q.correctIndex,
        };
      });
    }

    takeState = {
      exam,
      questions,
      answers: {},
      locked: new Set(),
      index: 0,
      startedAt: Date.now(),
      timerInterval: null,
      remainingSec: (exam.duration || 0) * 60 || null,
    };

    renderTakeShell();
    if (takeState.remainingSec) startTimer();
    if (exam.showAll) renderAllQuestions();
    else renderQuestion();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty-state"><p>Could not load exam</p></div>`;
  }
}

function renderTakeShell() {
  const { exam, questions, remainingSec } = takeState;
  document.getElementById("take-view").innerHTML = `
    <div class="exam-topbar">
      <div>
        <strong>${escapeHtml(exam.title)}</strong>
        <div class="muted" style="font-size:0.82rem">${questions.length} questions</div>
      </div>
      ${
        remainingSec != null
          ? `<div class="exam-timer" id="exam-timer"><i class="fa-solid fa-hourglass-half"></i> <span id="timer-text">${fmtTime(remainingSec)}</span></div>`
          : ""
      }
    </div>
    <div class="progress-track"><div class="progress-fill" id="q-progress-fill" style="width:0%"></div></div>
    <div id="question-area"></div>
    ${
      exam.showAll
        ? `<div class="exam-nav"><button type="button" class="btn btn-primary" id="q-submit">Submit Exam</button></div>`
        : `<div class="exam-nav">
            <button type="button" class="btn btn-outline" id="q-prev">Previous</button>
            <button type="button" class="btn btn-primary" id="q-next">Next</button>
            <button type="button" class="btn btn-accent hidden" id="q-submit">Submit Exam</button>
          </div>`
    }
  `;
  document.getElementById("q-prev")?.addEventListener("click", () => {
    if (takeState.index > 0) {
      takeState.index--;
      renderQuestion();
    }
  });
  document.getElementById("q-next")?.addEventListener("click", () => {
    if (takeState.index < takeState.questions.length - 1) {
      takeState.index++;
      renderQuestion();
    }
  });
  document.getElementById("q-submit")?.addEventListener("click", () => submitExam());
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startTimer() {
  const el = document.getElementById("timer-text");
  const wrap = document.getElementById("exam-timer");
  takeState.timerInterval = setInterval(() => {
    takeState.remainingSec--;
    if (el) el.textContent = fmtTime(Math.max(0, takeState.remainingSec));
    if (takeState.remainingSec <= 60 && wrap) wrap.classList.add("danger");
    else if (takeState.remainingSec <= 180 && wrap) wrap.classList.add("warn");
    if (takeState.remainingSec <= 0) {
      clearInterval(takeState.timerInterval);
      toast("Time is up — submitting", "info");
      submitExam();
    }
  }, 1000);
}

function renderOptionsHtml(q) {
  const locked = takeState.locked.has(q.id);
  return `
    <div class="options-list">
      ${q.options
        .map(
          (opt, i) => `
        <div class="option-item ${takeState.answers[q.id] === i ? "selected" : ""} ${locked ? "disabled" : ""}" data-qid="${q.id}" data-i="${i}">
          <span class="option-letter">${String.fromCharCode(65 + i)}</span>
          <span>${escapeHtml(opt)}</span>
          ${takeState.answers[q.id] === i && locked ? '<i class="fa-solid fa-lock option-lock-icon"></i>' : ""}
        </div>`
        )
        .join("")}
    </div>
    ${locked ? `<div class="option-locked-hint"><i class="fa-solid fa-circle-info"></i> Answer locked</div>` : ""}
  `;
}

function bindOptionClicks() {
  document.querySelectorAll(".option-item").forEach((el) => {
    el.addEventListener("click", () => {
      const qid = el.dataset.qid;
      if (takeState.locked.has(qid)) return;
      takeState.answers[qid] = Number(el.dataset.i);
      takeState.locked.add(qid);
      if (takeState.exam.showAll) renderAllQuestions();
      else renderQuestion();
    });
  });
}

function renderQuestion() {
  const { questions, index } = takeState;
  const q = questions[index];
  document.getElementById("q-progress-fill").style.width = `${((index + 1) / questions.length) * 100}%`;
  document.getElementById("question-area").innerHTML = `
    <div class="question-card paper">
      <div class="q-index">Question ${index + 1} / ${questions.length}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`;
  bindOptionClicks();
  const prev = document.getElementById("q-prev");
  const next = document.getElementById("q-next");
  const submit = document.getElementById("q-submit");
  if (prev) prev.disabled = index === 0;
  const last = index === questions.length - 1;
  next?.classList.toggle("hidden", last);
  submit?.classList.toggle("hidden", !last);
}

function renderAllQuestions() {
  document.getElementById("q-progress-fill").style.width = "100%";
  document.getElementById("question-area").innerHTML = takeState.questions
    .map(
      (q, i) => `
    <div class="question-card paper mb-16" style="margin-bottom:1rem">
      <div class="q-index">Question ${i + 1} / ${takeState.questions.length}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`
    )
    .join("");
  bindOptionClicks();
}

async function submitExam() {
  if (!takeState) return;
  if (takeState.timerInterval) {
    clearInterval(takeState.timerInterval);
    takeState.timerInterval = null;
  }
  const { exam, questions, answers, startedAt } = takeState;
  const neg = Number(exam.negativeMarking) || 0;
  let correct = 0,
    wrong = 0,
    unanswered = 0;
  const review = [];

  questions.forEach((q) => {
    const ans = answers[q.id];
    const isUn = ans === undefined || ans === null;
    const isOk = !isUn && ans === q.correctIndex;
    if (isUn) unanswered++;
    else if (isOk) correct++;
    else wrong++;
    review.push({
      text: q.text,
      options: q.options,
      correctIndex: q.correctIndex,
      selected: isUn ? null : ans,
      status: isUn ? "unanswered" : isOk ? "correct" : "wrong",
      explanation: q.explanation || "",
    });
  });

  const raw = correct - wrong * neg;
  const score = Math.round(raw * 100) / 100;
  const total = questions.length;
  const percent = total ? Math.max(0, Math.round((Math.max(0, score) / total) * 100)) : 0;
  const timeTakenSeconds = Math.round((Date.now() - startedAt) / 1000);

  const resultId = `${currentUser.uid}_${exam.id}`;
  let attemptNumber = 1;
  try {
    const prev = await getDoc(doc(db, "results", resultId));
    if (prev.exists()) attemptNumber = (prev.data().attemptNumber || 1) + 1;
  } catch {
    /* ignore */
  }

  try {
    await setDoc(doc(db, "results", resultId), {
      uid: currentUser.uid,
      examId: exam.id,
      examTitle: exam.title,
      courseId: exam.courseId || null,
      score,
      total,
      percent,
      correctCount: correct,
      wrongCount: wrong,
      unansweredCount: unanswered,
      negativeMarking: neg,
      timeTakenSeconds,
      attemptNumber,
      studentName: currentUser.displayName || userProfile?.displayName || currentUser.email,
      studentEmail: currentUser.email,
      submittedAt: serverTimestamp(),
      review,
    });
  } catch (e) {
    console.error(e);
    toast("Could not save result — check Firestore rules", "error");
  }

  showResultScreen({ score, total, percent, correct, wrong, unanswered, timeTakenSeconds, review, examTitle: exam.title, neg });
  takeState = null;
}

function showResultScreen({ score, total, percent, correct, wrong, unanswered, timeTakenSeconds, review, examTitle, neg }) {
  document.getElementById("take-view").innerHTML = `
    <div class="result-hero">
      <div class="score-ring" style="--p:${percent}"><span>${percent}%</span></div>
      <h2>${escapeHtml(examTitle)}</h2>
      <p class="muted">Score: <strong>${formatScore(score)}</strong> / ${total}</p>
      <div class="result-stats">
        <div class="s"><div class="v">${correct}</div><div class="l">Correct</div></div>
        <div class="s"><div class="v">${wrong}</div><div class="l">Wrong</div></div>
        <div class="s"><div class="v">${unanswered}</div><div class="l">Skipped</div></div>
        <div class="s"><div class="v">${formatDuration(timeTakenSeconds)}</div><div class="l">Time</div></div>
      </div>
      ${neg > 0 ? `<p class="muted" style="margin-top:0.75rem;font-size:0.85rem">Negative marking: −${neg} per wrong</p>` : ""}
      <div style="margin-top:1.25rem;display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/exams">Back to Exams</a>
        <a class="btn btn-outline" href="#/results">My Results</a>
      </div>
    </div>
    <h3 style="margin-bottom:0.75rem">Answer Review</h3>
    <div class="review-list">
      ${review
        .map(
          (r, i) => `
        <div class="review-item ${r.status === "correct" ? "correct" : r.status === "wrong" ? "wrong" : ""}">
          <div class="status">${r.status}</div>
          <strong>Q${i + 1}. ${escapeHtml(r.text)}</strong>
          <div class="muted" style="margin-top:0.4rem;font-size:0.88rem">
            Your answer: ${r.selected == null ? "—" : escapeHtml(r.options[r.selected])}<br/>
            Correct: ${escapeHtml(r.options[r.correctIndex])}
          </div>
          ${r.explanation && r.explanation.trim() ? `<div class="review-explanation"><i class="fa-solid fa-lightbulb"></i><span><b>Explanation:</b> ${escapeHtml(r.explanation)}</span></div>` : ""}
        </div>`
        )
        .join("")}
    </div>`;
}

/* ---------- My results ---------- */
async function loadMyResults() {
  const el = document.getElementById("results-list");
  el.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid)));
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    if (!rows.length) {
      el.innerHTML = `<div class="empty-state"><p>No results yet</p></div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Exam</th><th>Score</th><th>Attempt</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr>
              <td>${escapeHtml(r.examTitle || "Exam")}</td>
              <td><strong>${formatScore(r.score)}/${r.total}</strong> (${r.percent}%)</td>
              <td>#${r.attemptNumber || 1}</td>
              <td>${formatDateTime(r.submittedAt)}</td>
              <td><a class="btn btn-ghost btn-sm" href="#/take?id=${r.examId}">Retake</a></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty-state"><p>Could not load results</p></div>`;
  }
}

/* ---------- Leaderboard ---------- */
async function loadLeaderboard() {
  const select = document.getElementById("lb-exam-select");
  const list = document.getElementById("lb-list");
  try {
    const examsSnap = await getDocs(collection(db, "exams"));
    const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const currentVal = select.value;
    select.innerHTML =
      `<option value="">All exams</option>` +
      exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");
    select.value = currentVal;
    select.onchange = () => renderLb(select.value, list);

    await renderLb(select.value, list);
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty-state"><p>Could not load leaderboard</p></div>`;
  }
}

async function renderLb(examId, list) {
  list.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    let snap;
    if (examId) {
      snap = await getDocs(query(collection(db, "results"), where("examId", "==", examId)));
    } else {
      snap = await getDocs(collection(db, "results"));
    }
    // Best attempt per user (for selected exam) or overall by percent
    const best = new Map();
    snap.docs.forEach((d) => {
      const r = d.data();
      const key = examId ? r.uid : `${r.uid}_${r.examId}`;
      const prev = best.get(key);
      if (!prev || (r.percent || 0) > (prev.percent || 0)) best.set(key, { id: d.id, ...r });
    });
    const rows = [...best.values()].sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 50);
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state"><p>No scores yet</p></div>`;
      return;
    }
    list.innerHTML = rows
      .map((r, i) => {
        const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        return `
        <div class="lb-row">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-name">
            ${escapeHtml(r.studentName || r.studentEmail || "Student")}
            ${!examId ? `<div class="muted" style="font-size:0.78rem">${escapeHtml(r.examTitle || "")}</div>` : ""}
          </div>
          <div class="lb-score">${r.percent}%</div>
        </div>`;
      })
      .join("");
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty-state"><p>Could not load (check results read rules)</p></div>`;
  }
}

/* ---------- Profile ---------- */
async function loadProfile() {
  const el = document.getElementById("profile-view");
  const p = userProfile || (await getUserProfile(currentUser.uid));
  userProfile = p;
  el.innerHTML = `
    <div class="profile-grid">
      <div class="profile-avatar-wrap">
        <div class="profile-avatar" style="display:grid;place-items:center;font-size:2.5rem;font-weight:800;color:var(--primary-hover)">
          ${(currentUser.displayName || currentUser.email || "U").charAt(0).toUpperCase()}
        </div>
        ${p?.isAdmin ? `<span class="badge badge-open">Admin</span>` : ""}
      </div>
      <div>
        <form id="profile-form">
          <div class="field"><label>Display name</label><input type="text" id="pf-name" value="${escapeHtml(p?.displayName || currentUser.displayName || "")}" /></div>
          <div class="field"><label>Email</label><input type="email" value="${escapeHtml(currentUser.email || "")}" disabled /></div>
          <div class="field"><label>Enrolled courses</label>
            <input type="text" value="${(p?.enrolledCourses || []).length} course(s) — managed on Course site" disabled />
          </div>
          <button type="submit" class="btn btn-primary">Save Profile</button>
          <button type="button" class="btn btn-outline" id="pf-logout" style="margin-left:0.5rem">Sign Out</button>
        </form>
        <p class="form-hint" style="margin-top:1rem">Profile data lives in the shared <code>users</code> collection. Full avatar & enrollment management is on the Course site.</p>
      </div>
    </div>`;
  document.getElementById("pf-logout")?.addEventListener("click", () => signOutUser());
  document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("pf-name").value.trim();
    try {
      await updateDoc(doc(db, "users", currentUser.uid), { displayName: name });
      const { updateProfile } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
      await updateProfile(currentUser, { displayName: name });
      toast("Profile updated", "success");
      userProfile = { ...userProfile, displayName: name };
      document.getElementById("nav-name").textContent = name || "User";
    } catch {
      toast("Could not update profile", "error");
    }
  });
}
