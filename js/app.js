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
  addDoc,
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
  getUserCourseHistory,
  COURSE_SITE_URL,
  debounce,
  openModal,
  getGreeting,
  getClockTime,
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
const courseSiteLinkMobile = document.getElementById("course-site-link-mobile");
if (courseSiteLinkMobile) courseSiteLinkMobile.href = COURSE_SITE_URL;

document.getElementById("hamburger")?.addEventListener("click", () => {
  document.getElementById("nav-links")?.classList.toggle("open");
});

document.getElementById("nav-login-btn")?.addEventListener("click", () => {
  location.hash = "#/login";
});

/* ---------- Header greeting clock + user dropdown ---------- */
function updateGreeting() {
  const name = currentUser ? currentUser.displayName || userProfile?.displayName || currentUser.email?.split("@")[0] || "" : "";
  const msg = getGreeting(name);
  document.querySelectorAll("[data-greet-msg]").forEach((el) => (el.textContent = msg));
  document.querySelectorAll("[data-greet-time]").forEach((el) => (el.textContent = getClockTime()));
}
updateGreeting();
setInterval(updateGreeting, 30000);

const userChipBtn = document.getElementById("user-chip");
const userDropdown = document.getElementById("user-dropdown");
userChipBtn?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentUser) return;
  const isOpen = !userDropdown.classList.contains("hidden");
  userDropdown.classList.toggle("hidden", isOpen);
  userChipBtn.setAttribute("aria-expanded", String(!isOpen));
});
document.addEventListener("click", (e) => {
  if (!userDropdown || userDropdown.classList.contains("hidden")) return;
  if (!e.target.closest("#user-menu")) {
    userDropdown.classList.add("hidden");
    userChipBtn?.setAttribute("aria-expanded", "false");
  }
});
document.getElementById("user-signout-btn")?.addEventListener("click", () => {
  userDropdown?.classList.add("hidden");
  signOutUser();
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
    userDropdown?.classList.add("hidden");
  }
  updateGreeting();
  route();
});

window.addEventListener("hashchange", route);

// Warn before leaving/reloading mid-exam so an in-progress attempt isn't lost by accident.
window.addEventListener("beforeunload", (e) => {
  if (takeState && !takeState.submitted) {
    e.preventDefault();
    e.returnValue = "";
  }
});

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

  // Leaving the take-exam page mid-attempt (nav click etc.) confirms first.
  if (takeState && !takeState.submitted && path !== "take") {
    const ok = confirm("The exam isn't finished yet. Leaving this page will lose your progress. Are you sure?");
    if (!ok) {
      location.hash = "#/take?id=" + takeState.exam.id;
      return;
    }
    stopTakeState();
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

/* ---------- Exam status / scheduling helpers ---------- */
function tsToDate(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}

function examScheduleState(ex) {
  const now = new Date();
  const start = tsToDate(ex.startAt);
  const end = tsToDate(ex.endAt);
  if (start && now < start) return { state: "upcoming", start, end };
  if (end && now > end) return { state: "closed", start, end };
  return { state: "open", start, end };
}

function myAttemptsFor(examId, allMyResults) {
  return allMyResults.filter((r) => r.examId === examId);
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
    const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((ex) => ex.status !== "draft");
    const results = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const available = await filterAccessibleExams(exams);
    const attemptedExamIds = new Set(results.map((r) => r.examId));

    const bestPercent = results.length ? Math.max(...results.map((r) => r.percent || 0)) : null;

    statsEl.innerHTML = [
      { n: available.length, l: "Available Exams" },
      { n: results.length, l: "Total Attempts" },
      {
        n: results.length
          ? Math.round(results.reduce((s, r) => s + (r.percent || 0), 0) / results.length) + "%"
          : "—",
        l: "Avg Score",
      },
      { n: bestPercent != null ? bestPercent + "%" : "—", l: "Best Score" },
    ]
      .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join("");

    const unattempted = available.filter((ex) => !attemptedExamIds.has(ex.id));
    const toShow = (unattempted.length ? unattempted : available).slice(0, 4);
    if (!available.length) {
      examsEl.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>No exams available yet</p></div>`;
    } else {
      examsEl.innerHTML = `<div class="exam-grid">${toShow
        .map((ex) => examCardHtml(ex, myAttemptsFor(ex.id, results)))
        .join("")}</div>`;
      bindExamCardEvents(examsEl);
    }

    const recent = results
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
      .slice(0, 5);
    if (!recent.length) {
      resultsEl.innerHTML = `<div class="empty-state"><div class="icon" style="font-size:1.6rem">📋</div><p style="font-weight:600">No results yet</p><p class="muted" style="font-size:0.83rem">Results will appear here once you take an exam</p></div>`;
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
let examListCache = { exams: [], results: [] };

async function loadExamList() {
  const grid = document.getElementById("exams-grid");
  grid.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(collection(db, "exams"));
    const exams = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((ex) => ex.status !== "draft");
    const resultsSnap = await getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid)));
    const results = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const available = await filterAccessibleExams(exams);
    examListCache = { exams: available, results };

    populateCategoryFilter(available);
    bindExamToolbar();
    renderExamGrid();
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div class="empty-state"><p>Could not load exams</p></div>`;
  }
}

function populateCategoryFilter(exams) {
  const sel = document.getElementById("exam-filter-category");
  if (!sel) return;
  const cats = [...new Set(exams.map((e) => (e.category || "").trim()).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML =
    `<option value="">All Categories</option>` +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  sel.value = cats.includes(current) ? current : "";
}

let examToolbarBound = false;
function bindExamToolbar() {
  if (examToolbarBound) {
    renderExamGrid();
    return;
  }
  examToolbarBound = true;
  const search = document.getElementById("exam-search");
  const status = document.getElementById("exam-filter-status");
  const category = document.getElementById("exam-filter-category");
  const sort = document.getElementById("exam-sort");
  search?.addEventListener("input", debounce(renderExamGrid, 200));
  status?.addEventListener("change", renderExamGrid);
  category?.addEventListener("change", renderExamGrid);
  sort?.addEventListener("change", renderExamGrid);
}

function renderExamGrid() {
  const grid = document.getElementById("exams-grid");
  if (!grid) return;
  const { exams, results } = examListCache;
  const q = (document.getElementById("exam-search")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("exam-filter-status")?.value || "";
  const categoryFilter = document.getElementById("exam-filter-category")?.value || "";
  const sortBy = document.getElementById("exam-sort")?.value || "new";
  const attemptedIds = new Set(results.map((r) => r.examId));

  let list = exams.filter((ex) => {
    if (q && !`${ex.title} ${ex.category || ""} ${ex.courseName || ""}`.toLowerCase().includes(q)) return false;
    if (statusFilter === "open" && attemptedIds.has(ex.id)) return false;
    if (statusFilter === "done" && !attemptedIds.has(ex.id)) return false;
    if (categoryFilter && (ex.category || "") !== categoryFilter) return false;
    return true;
  });

  if (sortBy === "az") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  else if (sortBy === "duration") list = [...list].sort((a, b) => (a.duration || 0) - (b.duration || 0));
  else list = [...list].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-file-pen"></i></div><p>${
      exams.length ? "No exams matched — try adjusting the filters" : "No exams available"
    }</p></div>`;
    return;
  }
  grid.innerHTML = list.map((ex) => examCardHtml(ex, myAttemptsFor(ex.id, results))).join("");
  bindExamCardEvents(grid);
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

function examCardHtml(ex, myAttempts) {
  const done = myAttempts.length > 0;
  const best = done ? myAttempts.reduce((a, b) => ((b.percent || 0) > (a.percent || 0) ? b : a)) : null;
  const maxAttempts = Number(ex.maxAttempts) || 0;
  const attemptsLeft = maxAttempts ? Math.max(0, maxAttempts - myAttempts.length) : null;
  const locked = maxAttempts > 0 && myAttempts.length >= maxAttempts;
  const sched = examScheduleState(ex);

  let statusBadge = `<span class="badge badge-open">Open</span>`;
  if (done) statusBadge = `<span class="badge badge-done">Done</span>`;
  if (sched.state === "upcoming") statusBadge = `<span class="badge badge-locked"><i class="fa-solid fa-clock"></i> Coming Soon</span>`;
  if (sched.state === "closed") statusBadge = `<span class="badge badge-locked"><i class="fa-solid fa-lock"></i> Ended</span>`;
  if (locked) statusBadge = `<span class="badge badge-locked"><i class="fa-solid fa-ban"></i> Attempts Used</span>`;

  let actionHtml = `<a class="btn btn-primary btn-sm" href="#/take?id=${ex.id}" style="margin-top:auto">${done ? "Retake / View" : "Start Exam"}</a>`;
  if (sched.state === "upcoming") {
    actionHtml = `<button class="btn btn-outline btn-sm" disabled style="margin-top:auto">${sched.start ? "Starts " + formatDateTime(Timestamp.fromDate(sched.start)) : "Coming soon"}</button>`;
  } else if (sched.state === "closed") {
    actionHtml = `<button class="btn btn-outline btn-sm" disabled style="margin-top:auto">Exam has closed</button>`;
  } else if (locked) {
    actionHtml = `<button class="btn btn-outline btn-sm" disabled style="margin-top:auto">Max attempts reached</button>`;
  }

  return `
    <div class="exam-card">
      <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-start">
        <h3>${escapeHtml(ex.title)}</h3>
        ${statusBadge}
      </div>
      <div class="exam-meta">
        <span><i class="fa-solid fa-circle-question"></i> ${ex.questionCount || 0} Q</span>
        ${ex.duration ? `<span><i class="fa-solid fa-clock"></i> ${ex.duration} min</span>` : ""}
        ${ex.courseName ? `<span><i class="fa-solid fa-book"></i> ${escapeHtml(ex.courseName)}</span>` : ""}
        ${ex.category ? `<span><i class="fa-solid fa-tag"></i> ${escapeHtml(ex.category)}</span>` : ""}
        ${maxAttempts ? `<span><i class="fa-solid fa-rotate"></i> ${attemptsLeft}/${maxAttempts} left</span>` : ""}
      </div>
      ${
        done
          ? `<div class="muted" style="font-size:0.85rem">Best score: <strong>${formatScore(best.score)}/${best.total}</strong> (${best.percent}%) · attempted ${myAttempts.length} time(s)</div>`
          : ""
      }
      ${actionHtml}
    </div>`;
}

function bindExamCardEvents(root) {
  /* room for future per-card JS bindings; buttons are plain links/disabled for now */
  void root;
}

/* ---------- Take exam ---------- */
let takeState = null;

function stopTakeState() {
  if (takeState?.timerInterval) clearInterval(takeState.timerInterval);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  takeState = null;
}

function onVisibilityChange() {
  if (!takeState || takeState.submitted) return;
  if (document.hidden) {
    takeState.tabSwitches = (takeState.tabSwitches || 0) + 1;
  }
}

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

    if (exam.status === "draft") {
      view.innerHTML = `<div class="empty-state"><p>This exam hasn't been published yet</p></div>`;
      return;
    }

    const sched = examScheduleState(exam);
    if (sched.state === "upcoming") {
      view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-clock"></i></div><p>This exam hasn't started yet${
        sched.start ? " — starts " + sched.start.toLocaleString() : ""
      }</p></div>`;
      return;
    }
    if (sched.state === "closed") {
      view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-lock"></i></div><p>This exam's time window has closed</p></div>`;
      return;
    }

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

    // Attempt-limit check
    const maxAttempts = Number(exam.maxAttempts) || 0;
    let attemptsSoFar = 0;
    if (maxAttempts) {
      const rSnap = await getDocs(
        query(collection(db, "results"), where("uid", "==", currentUser.uid), where("examId", "==", examId))
      );
      attemptsSoFar = rSnap.size;
      if (attemptsSoFar >= maxAttempts) {
        view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-ban"></i></div><p>You've reached the maximum of ${maxAttempts} attempt(s).</p>
          <a class="btn btn-outline" href="#/results">View My Results</a></div>`;
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
      flagged: new Set(),
      locked: new Set(),
      index: 0,
      startedAt: Date.now(),
      timerInterval: null,
      remainingSec: (exam.duration || 0) * 60 || null,
      tabSwitches: 0,
      attemptNumberGuess: attemptsSoFar + 1,
      submitted: false,
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    renderTakeShell();
    if (takeState.remainingSec) startTimer();
    if (exam.showAll) renderAllQuestions();
    else renderQuestion();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty-state"><p>Could not load exam</p></div>`;
  }
}

function navigatorHtml() {
  const { questions, index, answers, flagged } = takeState;
  const answeredCount = Object.keys(answers).length;
  const flaggedCount = flagged.size;
  return `
    <button type="button" class="q-map-toggle" id="q-map-toggle" aria-expanded="false">
      <i class="fa-solid fa-table-cells"></i>
      <span>Question Map</span>
      <span class="q-map-toggle-stats">
        <i class="fa-solid fa-check"></i> ${answeredCount}
        ${flaggedCount ? `· <i class="fa-solid fa-flag"></i> ${flaggedCount}` : ""}
      </span>
      <i class="fa-solid fa-chevron-down q-map-chevron"></i>
    </button>
    <div class="q-navigator" id="q-navigator">
      ${questions
        .map((q, i) => {
          const isAnswered = answers[q.id] !== undefined;
          const isCurrent = i === index && !takeState.exam.showAll;
          const cls = ["q-nav-btn", isAnswered ? "answered" : "", flagged.has(q.id) ? "flagged" : "", isCurrent ? "current" : ""]
            .filter(Boolean)
            .join(" ");
          const label = isAnswered && !isCurrent ? `<i class="fa-solid fa-check"></i>` : i + 1;
          return `<button type="button" class="${cls}" data-goto="${i}" title="Question ${i + 1}">${label}</button>`;
        })
        .join("")}
    </div>
    <div class="q-nav-legend" id="q-nav-legend">
      <span><i class="dot answered"></i> Answered</span>
      <span><i class="dot flagged"></i> Flagged</span>
      <span><i class="dot"></i> Remaining</span>
    </div>`;
}

function bindNavigator(root) {
  root.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.goto);
      if (takeState.exam.showAll) {
        document.getElementById(`qcard-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        takeState.index = i;
        renderQuestion();
      }
    });
  });
  const toggle = root.querySelector("#q-map-toggle");
  const nav = root.querySelector("#q-navigator");
  const legend = root.querySelector("#q-nav-legend");
  toggle?.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    nav?.classList.toggle("open", !open);
    legend?.classList.toggle("open", !open);
  });
}

function renderTakeShell() {
  const { exam, questions, remainingSec } = takeState;
  document.getElementById("take-view").innerHTML = `
    <div class="exam-topbar">
      <div>
        <strong>${escapeHtml(exam.title)}</strong>
        <div class="exam-meta-row">
          <span class="exam-meta-chip"><i class="fa-solid fa-list-ol"></i> ${questions.length} Question(s)</span>
          ${exam.negativeMarking ? `<span class="exam-meta-chip warn"><i class="fa-solid fa-minus"></i> −${exam.negativeMarking}/wrong</span>` : ""}
        </div>
      </div>
      ${
        remainingSec != null
          ? `<div class="exam-timer" id="exam-timer"><i class="fa-solid fa-hourglass-half"></i> <span id="timer-text">${fmtTime(remainingSec)}</span></div>`
          : ""
      }
    </div>
    <div class="progress-track"><div class="progress-fill" id="q-progress-fill" style="width:0%"></div></div>
    <div id="q-nav-wrap">${navigatorHtml()}</div>
    <div id="question-area"></div>
    ${
      exam.showAll
        ? `<div class="exam-nav"><button type="button" class="btn btn-primary" id="q-submit">Submit Exam</button></div>`
        : `<div class="exam-nav">
            <button type="button" class="btn btn-outline" id="q-prev">Previous</button>
            <button type="button" class="btn btn-ghost" id="q-flag"><i class="fa-regular fa-flag"></i> Flag</button>
            <button type="button" class="btn btn-primary" id="q-next">Next</button>
            <button type="button" class="btn btn-accent hidden" id="q-submit">Submit Exam</button>
          </div>`
    }
  `;
  bindNavigator(document.getElementById("q-nav-wrap"));
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
  document.getElementById("q-flag")?.addEventListener("click", () => {
    const q = takeState.questions[takeState.index];
    if (takeState.flagged.has(q.id)) takeState.flagged.delete(q.id);
    else takeState.flagged.add(q.id);
    renderQuestion();
  });
  document.getElementById("q-submit")?.addEventListener("click", () => confirmSubmit());
}

function confirmSubmit() {
  const { questions, answers } = takeState;
  const unanswered = questions.length - Object.keys(answers).length;
  const msg = unanswered
    ? `You have ${unanswered} unanswered question(s). Submit now anyway?`
    : "Submit the exam?";
  if (confirm(msg)) submitExam();
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function playBeep(freq = 880, duration = 200) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration / 1000);
  } catch (_) {}
}

function startTimer() {
  const el = document.getElementById("timer-text");
  const wrap = document.getElementById("exam-timer");
  let warned5 = false, warned1 = false;
  takeState.timerInterval = setInterval(() => {
    if (!takeState) return;
    takeState.remainingSec--;
    if (el) el.textContent = fmtTime(Math.max(0, takeState.remainingSec));

    // 5-minute warning
    if (takeState.remainingSec <= 300 && takeState.remainingSec > 290 && !warned5) {
      warned5 = true;
      wrap?.classList.add("warn");
      toast("⏳ Only 5 minutes left!", "info");
      playBeep(660, 300);
      wrap?.classList.add("timer-pulse");
      setTimeout(() => wrap?.classList.remove("timer-pulse"), 1000);
    }
    // 1-minute warning
    if (takeState.remainingSec <= 60 && !warned1) {
      warned1 = true;
      wrap?.classList.remove("warn");
      wrap?.classList.add("danger");
      toast("🚨 Only 1 minute left! Submit quickly.", "error");
      playBeep(1047, 400);
      wrap?.classList.add("timer-pulse");
      setTimeout(() => wrap?.classList.remove("timer-pulse"), 1200);
    }
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
  const flagged = takeState.flagged.has(q.id);
  document.getElementById("question-area").innerHTML = `
    <div class="question-card paper">
      <div class="q-index">Question ${index + 1} / ${questions.length} ${flagged ? '<i class="fa-solid fa-flag" style="color:var(--warning);margin-left:0.4rem"></i>' : ""}</div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`;
  bindOptionClicks();
  const navWrap = document.getElementById("q-nav-wrap");
  if (navWrap) {
    navWrap.innerHTML = navigatorHtml();
    bindNavigator(navWrap);
  }
  const prev = document.getElementById("q-prev");
  const next = document.getElementById("q-next");
  const submit = document.getElementById("q-submit");
  const flagBtn = document.getElementById("q-flag");
  if (prev) prev.disabled = index === 0;
  if (flagBtn) flagBtn.innerHTML = flagged ? '<i class="fa-solid fa-flag"></i> Unflag' : '<i class="fa-regular fa-flag"></i> Flag';
  const last = index === questions.length - 1;
  next?.classList.toggle("hidden", last);
  submit?.classList.toggle("hidden", !last);
}

function renderAllQuestions() {
  document.getElementById("q-progress-fill").style.width = "100%";
  document.getElementById("question-area").innerHTML = takeState.questions
    .map((q, i) => {
      const flagged = takeState.flagged.has(q.id);
      return `
    <div class="question-card paper mb-16" style="margin-bottom:1rem" id="qcard-${i}">
      <div class="q-index" style="display:flex;justify-content:space-between;align-items:center">
        <span>Question ${i + 1} / ${takeState.questions.length}</span>
        <button type="button" class="btn btn-ghost btn-sm" data-flag-i="${i}">${flagged ? '<i class="fa-solid fa-flag" style="color:var(--warning)"></i>' : '<i class="fa-regular fa-flag"></i>'}</button>
      </div>
      <h2>${escapeHtml(q.text)}</h2>
      ${renderOptionsHtml(q)}
    </div>`;
    })
    .join("");
  bindOptionClicks();
  document.querySelectorAll("[data-flag-i]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const q = takeState.questions[Number(btn.dataset.flagI)];
      if (takeState.flagged.has(q.id)) takeState.flagged.delete(q.id);
      else takeState.flagged.add(q.id);
      renderAllQuestions();
    });
  });
  const navWrap = document.getElementById("q-nav-wrap");
  if (navWrap) {
    navWrap.innerHTML = navigatorHtml();
    bindNavigator(navWrap);
  }
}

async function submitExam() {
  if (!takeState || takeState.submitted) return;
  takeState.submitted = true;
  if (takeState.timerInterval) {
    clearInterval(takeState.timerInterval);
    takeState.timerInterval = null;
  }
  document.removeEventListener("visibilitychange", onVisibilityChange);
  const { exam, questions, answers, startedAt, flagged, tabSwitches } = takeState;
  const neg = Number(exam.negativeMarking) || 0;
  let correct = 0,
    wrong = 0,
    unanswered = 0,
    earnedMarks = 0,
    totalMarks = 0;
  const review = [];

  questions.forEach((q) => {
    const marks = Number(q.marks) > 0 ? Number(q.marks) : 1;
    totalMarks += marks;
    const ans = answers[q.id];
    const isUn = ans === undefined || ans === null;
    const isOk = !isUn && ans === q.correctIndex;
    if (isUn) unanswered++;
    else if (isOk) {
      correct++;
      earnedMarks += marks;
    } else {
      wrong++;
      earnedMarks -= neg;
    }
    review.push({
      text: q.text,
      options: q.options,
      correctIndex: q.correctIndex,
      selected: isUn ? null : ans,
      status: isUn ? "unanswered" : isOk ? "correct" : "wrong",
      explanation: q.explanation || "",
      marks,
      flagged: flagged.has(q.id),
    });
  });

  const score = Math.round(earnedMarks * 100) / 100;
  const total = totalMarks || questions.length;
  const percent = total ? Math.max(0, Math.round((Math.max(0, score) / total) * 100)) : 0;
  const timeTakenSeconds = Math.round((Date.now() - startedAt) / 1000);
  const passingPercent = Number(exam.passingPercent) || 0;
  const passed = passingPercent ? percent >= passingPercent : null;

  let attemptNumber = takeState.attemptNumberGuess || 1;
  try {
    const prevSnap = await getDocs(
      query(collection(db, "results"), where("uid", "==", currentUser.uid), where("examId", "==", exam.id))
    );
    attemptNumber = prevSnap.size + 1;
  } catch {
    /* fall back to the guess made before the attempt started */
  }

  try {
    await addDoc(collection(db, "results"), {
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
      passed,
      tabSwitches: tabSwitches || 0,
      studentName: currentUser.displayName || userProfile?.displayName || currentUser.email,
      studentEmail: currentUser.email,
      submittedAt: serverTimestamp(),
      review,
    });
  } catch (e) {
    console.error(e);
    toast("Could not save result — check Firestore rules", "error");
  }

  showResultScreen({ score, total, percent, correct, wrong, unanswered, timeTakenSeconds, review, examTitle: exam.title, neg, passed, passingPercent });
  stopTakeState();
}

function reviewListHtml(review) {
  return `
    <div class="review-list">
      ${review
        .map(
          (r, i) => `
        <div class="review-item ${r.status === "correct" ? "correct" : r.status === "wrong" ? "wrong" : ""}">
          <div class="status">${r.status}${r.flagged ? ' <i class="fa-solid fa-flag" style="color:var(--warning)"></i>' : ""}${r.marks && r.marks !== 1 ? ` · ${r.marks} marks` : ""}</div>
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

function showResultScreen({ score, total, percent, correct, wrong, unanswered, timeTakenSeconds, review, examTitle, neg, passed, passingPercent }) {
  const emoji = percent >= 80 ? "🎉" : percent >= 50 ? "👍" : "💪";
  const shareText = `${emoji} I scored ${percent}% on "${examTitle}"! Correct: ${correct}, Wrong: ${wrong}, Time: ${formatDuration(timeTakenSeconds)} · Tech Verse Exam`;
  const shareUrl = location.href.split("#")[0];

  document.getElementById("take-view").innerHTML = `
    <div class="result-hero">
      <div class="score-ring" style="--p:${percent}"><span>${percent}%</span></div>
      <h2>${escapeHtml(examTitle)}</h2>
      <p class="muted">Score: <strong>${formatScore(score)}</strong> / ${total}</p>
      ${passed != null ? `<span class="badge ${passed ? "badge-open" : "badge-locked"}">${passed ? "✓ Passed" : "✗ Failed"} (pass mark ${passingPercent}%)</span>` : ""}
      <div class="result-stats">
        <div class="s"><div class="v" style="color:#22c55e">${correct}</div><div class="l">Correct</div></div>
        <div class="s"><div class="v" style="color:#ef4444">${wrong}</div><div class="l">Wrong</div></div>
        <div class="s"><div class="v">${unanswered}</div><div class="l">Skipped</div></div>
        <div class="s"><div class="v">${formatDuration(timeTakenSeconds)}</div><div class="l">Time</div></div>
      </div>
      ${neg > 0 ? `<p class="muted" style="margin-top:0.75rem;font-size:0.85rem">Negative marking: −${neg} per wrong</p>` : ""}
      <div style="margin-top:1.25rem;display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap">
        <a class="btn btn-primary" href="#/exams">Back to Exams</a>
        <a class="btn btn-outline" href="#/results">My Results</a>
        <button class="btn btn-ghost" id="share-result-btn" style="display:flex;align-items:center;gap:0.4rem"><i class="fa-solid fa-share-nodes"></i> Share</button>
      </div>
    </div>
    <h3 style="margin-bottom:0.75rem">Answer Review</h3>
    ${reviewListHtml(review)}`;

  document.getElementById("share-result-btn")?.addEventListener("click", () => {
    if (navigator.share) {
      navigator.share({ title: "Tech Verse Exam Result", text: shareText, url: shareUrl }).catch(() => {});
    } else {
      // Fallback — copy to clipboard + show WhatsApp link
      const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText + "\n" + shareUrl)}`;
      openModal(`
        <div class="modal-head">
          <h3><i class="fa-solid fa-share-nodes"></i> Share Result</h3>
          <button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="share-text-box">${escapeHtml(shareText)}</div>
          <div style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap">
            <a href="${waUrl}" target="_blank" class="btn btn-primary" style="background:#25D366;border-color:#25D366">
              <i class="fa-brands fa-whatsapp"></i> WhatsApp
            </a>
            <button class="btn btn-outline" id="copy-share-btn"><i class="fa-regular fa-copy"></i> Copy Text</button>
          </div>
        </div>`);
      document.getElementById("copy-share-btn")?.addEventListener("click", () => {
        navigator.clipboard.writeText(shareText + "\n" + shareUrl).then(() => toast("Copied!", "success")).catch(() => {});
      });
    }
  });
}

/* ---------- My Results — with Detailed Analytics ---------- */
async function loadMyResults() {
  const el = document.getElementById("results-list");
  const statsEl = document.getElementById("results-stats");
  el.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const snap = await getDocs(query(collection(db, "results"), where("uid", "==", currentUser.uid)));
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));

    if (!rows.length) {
      if (statsEl) statsEl.innerHTML = "";
      el.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem">
        <div class="icon"><i class="fa-solid fa-file-circle-question"></i></div>
        <p style="font-weight:700;font-size:1.05rem">No exams taken yet</p>
        <p class="muted" style="font-size:0.85rem;max-width:280px;margin:0 auto">Take an exam to see your detailed results and analytics here!</p>
        <a class="btn btn-primary btn-sm" href="#/exams" style="margin-top:1rem">View Exam List →</a>
      </div>`;
      return;
    }

    // ---- KPI stats ----
    if (statsEl) {
      const avg = Math.round(rows.reduce((s, r) => s + (r.percent || 0), 0) / rows.length);
      const best = Math.max(...rows.map((r) => r.percent || 0));
      const distinctExams = new Set(rows.map((r) => r.examId)).size;
      const totalCorrect = rows.reduce((s, r) => s + (r.correctCount || 0), 0);
      const totalWrong = rows.reduce((s, r) => s + (r.wrongCount || 0), 0);
      const totalTimeSec = rows.reduce((s, r) => s + (r.timeTakenSeconds || 0), 0);
      const passRows = rows.filter((r) => r.passed === true || r.passed === false);
      const passRate = passRows.length ? Math.round((passRows.filter((r) => r.passed).length / passRows.length) * 100) : null;
      statsEl.innerHTML = [
        { n: rows.length, l: "Total Attempts" },
        { n: distinctExams, l: "Exams Taken" },
        { n: avg + "%", l: "Average Score" },
        { n: best + "%", l: "Best Score" },
        { n: totalCorrect, l: "Total Correct ✓" },
        { n: totalWrong, l: "Total Wrong ✗" },
        { n: formatDuration(totalTimeSec), l: "Total Time" },
        { n: passRate != null ? passRate + "%" : "—", l: "Pass Rate" },
      ]
        .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
        .join("");
    }

    // ---- Score trend mini chart ----
    const trendHtml = rows.length >= 2 ? (() => {
      const sorted = [...rows].reverse().slice(-15);
      const max = Math.max(...sorted.map((r) => r.percent || 0), 1);
      return `<div class="my-results-trend card" style="margin-bottom:1rem;padding:1rem 1rem 0.5rem">
        <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:0.65rem;text-transform:uppercase;letter-spacing:.04em">
          <i class="fa-solid fa-chart-line" style="color:var(--primary-hover)"></i> Score Trend (last ${sorted.length})
        </div>
        <div style="display:flex;align-items:flex-end;gap:4px;height:52px">
          ${sorted.map((r) => {
            const h = Math.max(4, (r.percent / max) * 48);
            const color = r.percent >= 70 ? "#22c55e" : r.percent >= 40 ? "#f59e0b" : "#ef4444";
            return `<div style="flex:1;min-width:10px;height:${h}px;background:${color};border-radius:3px 3px 0 0;opacity:.85" title="${r.examTitle||''}: ${r.percent}%"></div>`;
          }).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:0.68rem;color:var(--text-dim)">
          <span>Oldest</span><span>Recent</span>
        </div>
      </div>`;
    })() : "";

    // ---- Exam-wise breakdown ----
    const examGroups = {};
    rows.forEach((r) => {
      if (!examGroups[r.examId]) examGroups[r.examId] = { title: r.examTitle || "Exam", attempts: [] };
      examGroups[r.examId].attempts.push(r);
    });
    const breakdownHtml = `<div class="card" style="margin-bottom:1rem;padding:1rem">
      <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:0.75rem;text-transform:uppercase;letter-spacing:.04em">
        <i class="fa-solid fa-layer-group" style="color:var(--accent)"></i> Exam-wise Breakdown
      </div>
      ${Object.values(examGroups).map((g) => {
        const best = Math.max(...g.attempts.map((r) => r.percent || 0));
        const avgG = Math.round(g.attempts.reduce((s, r) => s + (r.percent || 0), 0) / g.attempts.length);
        const barColor = best >= 70 ? "#22c55e" : best >= 40 ? "#f59e0b" : "#ef4444";
        return `<div style="margin-bottom:0.85rem">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
            <span style="font-size:0.85rem;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.title)}</span>
            <span style="font-size:0.78rem;color:var(--text-dim);margin-left:0.5rem;flex-shrink:0">${g.attempts.length} attempt · avg ${avgG}%</span>
            <span style="font-size:0.85rem;font-weight:800;font-family:var(--mono);color:${barColor};margin-left:0.5rem;flex-shrink:0">Best: ${best}%</span>
          </div>
          <div style="height:7px;background:var(--bg-soft);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${best}%;background:${barColor};border-radius:4px;transition:width .5s"></div>
          </div>
        </div>`;
      }).join("")}
    </div>`;

    // ---- History table ----
    el.innerHTML = trendHtml + breakdownHtml + `
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:0.85rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:0.82rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Full Exam History</span>
          <span style="font-size:0.78rem;color:var(--text-dim)">${rows.length} attempt(s)</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Exam</th><th>Score</th><th>Correct</th><th>Wrong</th><th>Time</th><th>Attempt</th><th>Date</th><th></th></tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>
                <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.examTitle || "Exam")}</td>
                <td>
                  <strong style="font-family:var(--mono)">${formatScore(r.score)}/${r.total}</strong>
                  <span style="color:var(--text-dim);font-size:0.82rem"> (${r.percent}%)</span>
                  ${r.passed === true ? ' <span class="badge badge-open" style="font-size:0.68rem">Pass</span>' : r.passed === false ? ' <span class="badge badge-locked" style="font-size:0.68rem">Fail</span>' : ""}
                </td>
                <td style="color:#22c55e;font-weight:700">${r.correctCount ?? "—"}</td>
                <td style="color:#ef4444;font-weight:700">${r.wrongCount ?? "—"}</td>
                <td style="font-size:0.8rem;font-family:var(--mono)">${formatDuration(r.timeTakenSeconds || 0)}</td>
                <td style="color:var(--text-dim)">#${r.attemptNumber || 1}</td>
                <td style="font-size:0.78rem;color:var(--text-dim);white-space:nowrap">${formatDateTime(r.submittedAt)}</td>
                <td>
                  <div style="display:flex;gap:0.3rem">
                    <button class="btn btn-ghost btn-sm" data-view-review="${r.id}" style="padding:0.3rem 0.55rem">Review</button>
                    <a class="btn btn-ghost btn-sm" href="#/take?id=${r.examId}" style="padding:0.3rem 0.55rem">Retake</a>
                  </div>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;

    el.querySelectorAll("[data-view-review]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = rows.find((x) => x.id === btn.dataset.viewReview);
        if (!r) return;
        openModal(`
          <div class="modal-head">
            <h3>${escapeHtml(r.examTitle || "Exam")} — Attempt #${r.attemptNumber || 1}</h3>
            <button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p class="muted" style="margin-top:-0.5rem">Score: <strong>${formatScore(r.score)}/${r.total}</strong> (${r.percent}%) · ${formatDateTime(r.submittedAt)}</p>
            <div style="display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
              <span style="color:#22c55e;font-weight:700"><i class="fa-solid fa-check"></i> ${r.correctCount ?? "?"} Correct</span>
              <span style="color:#ef4444;font-weight:700"><i class="fa-solid fa-xmark"></i> ${r.wrongCount ?? "?"} Wrong</span>
              <span style="color:var(--text-dim)"><i class="fa-solid fa-clock"></i> ${formatDuration(r.timeTakenSeconds || 0)}</span>
            </div>
            ${Array.isArray(r.review) && r.review.length ? reviewListHtml(r.review) : '<p class="muted">No saved review for this attempt.</p>'}
          </div>`, true);
      });
    });
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty-state"><p>Could not load results</p></div>`;
  }
}

/* ---------- Leaderboard ---------- */
/* ---------- Leaderboard — slim rows, paginated, my-rank highlight ---------- */
const LB_PAGE_SIZE_APP = 20;
let lbPageApp = 1;
let lbAllRowsApp = [];
let lbExamIdApp = "";

async function loadLeaderboard() {
  const select = document.getElementById("lb-exam-select");
  const list = document.getElementById("lb-list");
  const search = document.getElementById("lb-search");
  try {
    const examsSnap = await getDocs(collection(db, "exams"));
    const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((ex) => ex.status !== "draft");
    select.innerHTML = `<option value="">All exams</option>` + exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");
    select.onchange = () => { lbPageApp = 1; lbExamIdApp = select.value; renderLbApp(); };
    search?.addEventListener("input", debounce(() => { lbPageApp = 1; renderLbApp(); }, 200));
    await renderLbApp();
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty-state"><p>Could not load leaderboard</p></div>`;
  }
}

async function renderLbApp() {
  const list = document.getElementById("lb-list");
  if (!list) return;
  list.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const examId = document.getElementById("lb-exam-select")?.value || "";
    lbExamIdApp = examId;
    let snap = examId
      ? await getDocs(query(collection(db, "results"), where("examId", "==", examId)))
      : await getDocs(collection(db, "results"));

    const best = new Map();
    snap.docs.forEach((d) => {
      const r = d.data();
      const key = examId ? r.uid : `${r.uid}_${r.examId}`;
      const prev = best.get(key);
      if (!prev || (r.percent || 0) > (prev.percent || 0)) best.set(key, { id: d.id, ...r });
    });

    const searchQ = (document.getElementById("lb-search")?.value || "").trim().toLowerCase();
    let rows = [...best.values()].sort((a, b) => (b.percent || 0) - (a.percent || 0));
    if (searchQ) rows = rows.filter((r) => (r.studentName || r.studentEmail || "").toLowerCase().includes(searchQ));
    lbAllRowsApp = rows;

    if (!rows.length) {
      list.innerHTML = `<div class="empty-state" style="padding:2.5rem 1rem">
        <div class="icon"><i class="fa-solid fa-ranking-star"></i></div>
        <p style="font-weight:600">No scores yet</p>
        <p class="muted" style="font-size:0.85rem">Rankings will appear here once exams are taken!</p>
      </div>`;
      return;
    }

    // My rank
    const myRank = rows.findIndex((r) => r.uid === currentUser?.uid);
    const totalPages = Math.ceil(rows.length / LB_PAGE_SIZE_APP);
    const page = Math.min(lbPageApp, totalPages);
    const pageRows = rows.slice((page - 1) * LB_PAGE_SIZE_APP, page * LB_PAGE_SIZE_APP);
    const globalOffset = (page - 1) * LB_PAGE_SIZE_APP;

    // My-position strip
    let myStripHtml = "";
    if (myRank >= 0 && (myRank < globalOffset || myRank >= globalOffset + LB_PAGE_SIZE_APP)) {
      const me = rows[myRank];
      myStripHtml = `<div class="lb-my-strip">
        <i class="fa-solid fa-location-dot"></i>
        Your Rank: <strong>#${myRank + 1}</strong> &nbsp;·&nbsp; ${me.percent}%
        ${totalPages > 1 ? `<button class="btn btn-ghost btn-sm" id="lb-jump-me">Go to My Page</button>` : ""}
      </div>`;
    }

    list.innerHTML = myStripHtml + pageRows.map((r, localIdx) => {
      const rank = globalOffset + localIdx + 1;
      const rankClass = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
      const isMe = r.uid === currentUser?.uid;
      const initials = (r.studentName || r.studentEmail || "?").slice(0, 2).toUpperCase();
      const attempts = lbAllRowsApp.filter ? 0 : 0; // will show in tooltip
      return `<div class="lb-slim-row-pub ${isMe ? "lb-row-me-pub" : ""}">
        <div class="lb-slim-rank-pub ${rankClass}">${rank}</div>
        <div class="lb-slim-av-pub">${initials}</div>
        <div class="lb-slim-info-pub">
          <div class="lb-slim-name-pub">${escapeHtml(r.studentName || r.studentEmail || "Student")}${isMe ? ' <span class="badge badge-free" style="font-size:0.68rem;padding:0.1rem 0.4rem">You</span>' : ""}</div>
          ${!examId ? `<div class="lb-slim-sub-pub">${escapeHtml(r.examTitle || "")}</div>` : ""}
        </div>
        <div class="lb-slim-score-pub ${rankClass}">${r.percent}%</div>
      </div>`;
    }).join("")
    + (totalPages > 1 ? `<div class="lb-pagination-pub" id="lb-pg-pub"></div>` : "");

    // Jump to my page
    list.querySelector("#lb-jump-me")?.addEventListener("click", () => {
      lbPageApp = Math.ceil((myRank + 1) / LB_PAGE_SIZE_APP);
      renderLbApp();
    });

    // Pagination
    const pgEl = list.querySelector("#lb-pg-pub");
    if (pgEl) {
      let ph = "";
      if (page > 1) ph += `<button class="btn btn-ghost btn-sm" data-pg="${page - 1}">← Prev</button>`;
      for (let p2 = Math.max(1, page - 2); p2 <= Math.min(totalPages, page + 2); p2++) {
        ph += `<button class="btn btn-sm ${p2 === page ? "btn-primary" : "btn-ghost"}" data-pg="${p2}">${p2}</button>`;
      }
      if (page < totalPages) ph += `<button class="btn btn-ghost btn-sm" data-pg="${page + 1}">Next →</button>`;
      pgEl.innerHTML = ph;
      pgEl.querySelectorAll("[data-pg]").forEach((btn) => {
        btn.addEventListener("click", () => { lbPageApp = Number(btn.dataset.pg); renderLbApp(); });
      });
    }
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty-state"><p>Could not load (check results read rules)</p></div>`;
  }
}

/* ---------- Profile PDF export (jsPDF, content-fit page, logo watermark) ---------- */
async function loadImageAsDataUrl(url) {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function generateProfilePdf(p, history) {
  if (!window.jspdf) {
    toast("PDF library did not load", "error");
    return;
  }
  const { jsPDF } = window.jspdf;
  const logoDataUrl = await loadImageAsDataUrl("assets/logo.png").catch(() => null);

  const name = p?.displayName || currentUser.displayName || currentUser.email || "User";
  const email = currentUser.email || "";
  const phone = p?.phone || "—";
  const address = p?.address || "—";
  const dob = p?.dob || "—";
  const social = p?.social || {};
  const socialEntries = Object.entries(social).filter(([, v]) => v);

  const pageW = 480;
  const margin = 40;
  const contentW = pageW - margin * 2;

  // Use a throwaway doc purely to measure wrapped text so we can size the
  // real page to fit the content exactly (no big blank PDF pages).
  const measure = new jsPDF({ unit: "pt", format: [pageW, 2000] });
  measure.setFont("helvetica", "normal");
  measure.setFontSize(10);
  const addressLines = measure.splitTextToSize(address, contentW);

  let h = margin; // running height estimate
  h += 40 + 26; // header + divider gap
  h += 42; // avatar/name row
  h += 22 + 12; // phone row
  h += 22 + addressLines.length * 13 + 8; // address row
  h += 22 + 12; // dob row
  h += socialEntries.length ? 14 + socialEntries.length * 16 + 8 : 0;
  h += 20 + 18; // divider + section title
  h += history.length ? history.length * 34 + 10 : 22;
  h += 10 + 16 + 20; // footer divider + text + bottom margin

  const doc = new jsPDF({ unit: "pt", format: [pageW, h] });

  if (logoDataUrl) {
    doc.saveGraphicsState();
    doc.setGState(new doc.GState({ opacity: 0.06 }));
    const wm = pageW * 0.75;
    doc.addImage(logoDataUrl, "PNG", (pageW - wm) / 2, (h - wm) / 2, wm, wm, undefined, undefined, 20);
    doc.restoreGraphicsState();
  }

  let y = margin;
  if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", margin, y - 8, 28, 28);
  const titleX = margin + (logoDataUrl ? 36 : 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(30, 30, 45);
  doc.text("Tech Verse Exam", titleX, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(120, 120, 135);
  doc.text("Student Profile Report", titleX, y + 18);
  doc.setFontSize(8);
  doc.text(new Date().toLocaleDateString(), pageW - margin, y + 6, { align: "right" });
  y += 34;
  doc.setDrawColor(224, 224, 234);
  doc.line(margin, y, pageW - margin, y);
  y += 26;

  doc.setFillColor(124, 92, 255);
  doc.circle(margin + 16, y + 4, 16, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(name.charAt(0).toUpperCase(), margin + 16, y + 8, { align: "center" });

  doc.setTextColor(20, 20, 30);
  doc.setFontSize(12);
  doc.text(name, margin + 42, y);
  doc.setTextColor(120, 120, 135);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(email, margin + 42, y + 15);
  if (p?.isAdmin) {
    doc.setTextColor(242, 169, 78);
    doc.setFontSize(9);
    doc.text("Admin", pageW - margin, y, { align: "right" });
  }
  y += 40;

  function row(label, value) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(140, 140, 155);
    doc.text(label.toUpperCase(), margin, y);
    y += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 40);
    const lines = doc.splitTextToSize(value || "—", contentW);
    doc.text(lines, margin, y);
    y += lines.length * 13 + 9;
  }
  row("Phone", phone);
  row("Address", address);
  row("Date of Birth", dob);

  if (socialEntries.length) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(140, 140, 155);
    doc.text("SOCIAL", margin, y);
    y += 14;
    socialEntries.forEach(([k, v]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(60, 60, 140);
      doc.text(`${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`, margin, y);
      y += 16;
    });
    y += 8;
  }

  doc.setDrawColor(230, 230, 238);
  doc.line(margin, y, pageW - margin, y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 40);
  doc.text("Courses & Purchase History", margin, y);
  y += 18;

  if (history.length) {
    history.forEach((hItem) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(40, 40, 55);
      doc.text(hItem.course?.title || "Course", margin, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(52, 201, 143);
      doc.text("Unlocked", pageW - margin, y, { align: "right" });
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 165);
      doc.text(hItem.usedAt ? formatDateTime(hItem.usedAt) : "", margin, y);
      y += 20;
    });
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(140, 140, 155);
    doc.text("No courses unlocked yet.", margin, y);
    y += 22;
  }

  y += 8;
  doc.setDrawColor(230, 230, 238);
  doc.line(margin, y, pageW - margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(160, 160, 175);
  doc.text(`Generated on ${new Date().toLocaleString()} · Tech Verse Exam`, pageW / 2, y, { align: "center" });

  doc.save(`${name.replace(/\s+/g, "-")}-profile.pdf`);
}

/* ---------- Profile ---------- */
async function loadProfile() {
  const el = document.getElementById("profile-view");
  el.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  const p = userProfile || (await getUserProfile(currentUser.uid));
  userProfile = p;

  const courses = await ensureCourses();
  const history = await getUserCourseHistory(currentUser.uid, courses);

  el.innerHTML = `
    <div id="profile-print-area">
      <div class="profile-grid">
        <div class="profile-avatar-wrap">
          <div class="profile-avatar" style="display:grid;place-items:center;font-size:2.5rem;font-weight:800;color:var(--primary-hover)">
            ${(currentUser.displayName || currentUser.email || "U").charAt(0).toUpperCase()}
          </div>
          ${p?.isAdmin ? `<span class="badge badge-open">Admin</span>` : ""}
          <div class="muted" style="font-size:0.8rem;margin-top:0.5rem">${escapeHtml(currentUser.email || "")}</div>
        </div>
        <div>
          <form id="profile-form">
            <div class="admin-grid">
              <div class="field"><label>Name</label><input type="text" id="pf-name" value="${escapeHtml(p?.displayName || currentUser.displayName || "")}" /></div>
              <div class="field"><label>Phone Number</label><input type="tel" id="pf-phone" placeholder="+8801XXXXXXXXX" value="${escapeHtml(p?.phone || "")}" /></div>
            </div>
            <div class="field"><label>Address</label><input type="text" id="pf-address" placeholder="District, Division" value="${escapeHtml(p?.address || "")}" /></div>
            <div class="admin-grid">
              <div class="field"><label>Date of Birth</label><input type="date" id="pf-dob" value="${escapeHtml(p?.dob || "")}" /></div>
              <div class="field"><label>Email</label><input type="email" value="${escapeHtml(currentUser.email || "")}" disabled /></div>
            </div>
            <div class="field-group-label">Social Links</div>
            <div class="admin-grid">
              <div class="field"><label><i class="fa-brands fa-facebook"></i> Facebook</label><input type="url" id="pf-fb" placeholder="https://facebook.com/…" value="${escapeHtml(p?.social?.facebook || "")}" /></div>
              <div class="field"><label><i class="fa-brands fa-youtube"></i> YouTube</label><input type="url" id="pf-yt" placeholder="https://youtube.com/@…" value="${escapeHtml(p?.social?.youtube || "")}" /></div>
            </div>
            <div class="field"><label><i class="fa-brands fa-whatsapp"></i> WhatsApp</label><input type="tel" id="pf-wa" placeholder="+8801XXXXXXXXX" value="${escapeHtml(p?.social?.whatsapp || "")}" /></div>
            <div class="no-print" style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">
              <button type="submit" class="btn btn-primary"><i class="fa-solid fa-check"></i> Save Profile</button>
              <button type="button" class="btn btn-outline" id="pf-export-pdf"><i class="fa-solid fa-file-pdf"></i> Export as PDF</button>
              <button type="button" class="btn btn-ghost" id="pf-logout">Sign Out</button>
            </div>
          </form>
        </div>
      </div>

      <div class="card profile-courses-card">
        <h3 style="margin:0 0 0.35rem"><i class="fa-solid fa-graduation-cap"></i> My Courses & Purchase History</h3>
        <p class="muted" style="margin:0 0 0.9rem;font-size:0.85rem">Live from the Course site — linked to the same Firebase account.</p>
        ${
          history.length
            ? `<ul class="list-clean">${history
                .map(
                  (h) => `
              <li>
                <div>
                  <strong>${escapeHtml(h.course?.title || "Course")}</strong>
                  <div class="muted" style="font-size:0.78rem">${h.usedAt ? formatDateTime(h.usedAt) : ""}</div>
                </div>
                <span class="badge badge-open">Unlocked</span>
              </li>`
                )
                .join("")}</ul>`
            : `<div class="empty-state" style="padding:1.5rem 1rem"><p>No courses unlocked yet — <a href="${COURSE_SITE_URL}" target="_blank" rel="noopener">view on Course Site</a></p></div>`
        }
      </div>
    </div>`;

  document.getElementById("pf-logout")?.addEventListener("click", () => signOutUser());
  document.getElementById("pf-export-pdf")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating…`;
    try {
      await generateProfilePdf(p, history);
    } catch (err) {
      console.error(err);
      toast("Could not generate PDF", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });
  document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("pf-name").value.trim();
    const phone = document.getElementById("pf-phone").value.trim();
    const address = document.getElementById("pf-address").value.trim();
    const dob = document.getElementById("pf-dob").value;
    const social = {
      facebook: document.getElementById("pf-fb").value.trim(),
      youtube: document.getElementById("pf-yt").value.trim(),
      whatsapp: document.getElementById("pf-wa").value.trim(),
    };
    try {
      await updateDoc(doc(db, "users", currentUser.uid), { displayName: name, phone, address, dob, social });
      const { updateProfile } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
      await updateProfile(currentUser, { displayName: name });
      toast("Profile updated", "success");
      userProfile = { ...userProfile, displayName: name, phone, address, dob, social };
      document.getElementById("nav-name").textContent = name || "User";
    } catch {
      toast("Could not update profile", "error");
    }
  });
}
