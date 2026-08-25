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
    const ok = confirm("এক্সাম এখনো শেষ হয়নি। এই পেজ ছেড়ে গেলে অগ্রগতি হারিয়ে যাবে। আপনি কি নিশ্চিত?");
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
    `<option value="">সব ক্যাটাগরি</option>` +
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
      exams.length ? "কোনো এক্সাম মিলেনি — ফিল্টার বদলে দেখুন" : "No exams available"
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
  if (sched.state === "upcoming") statusBadge = `<span class="badge badge-locked"><i class="fa-solid fa-clock"></i> শীঘ্রই</span>`;
  if (sched.state === "closed") statusBadge = `<span class="badge badge-locked"><i class="fa-solid fa-lock"></i> শেষ</span>`;
  if (locked) statusBadge = `<span class="badge badge-locked"><i class="fa-solid fa-ban"></i> সীমা শেষ</span>`;

  let actionHtml = `<a class="btn btn-primary btn-sm" href="#/take?id=${ex.id}" style="margin-top:auto">${done ? "Retake / View" : "Start Exam"}</a>`;
  if (sched.state === "upcoming") {
    actionHtml = `<button class="btn btn-outline btn-sm" disabled style="margin-top:auto">${sched.start ? formatDateTime(Timestamp.fromDate(sched.start)) + "-এ শুরু হবে" : "শীঘ্রই আসছে"}</button>`;
  } else if (sched.state === "closed") {
    actionHtml = `<button class="btn btn-outline btn-sm" disabled style="margin-top:auto">এক্সাম বন্ধ হয়ে গেছে</button>`;
  } else if (locked) {
    actionHtml = `<button class="btn btn-outline btn-sm" disabled style="margin-top:auto">সর্বোচ্চ চেষ্টা শেষ</button>`;
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
        ${maxAttempts ? `<span><i class="fa-solid fa-rotate"></i> ${attemptsLeft}/${maxAttempts} বাকি</span>` : ""}
      </div>
      ${
        done
          ? `<div class="muted" style="font-size:0.85rem">সর্বোচ্চ স্কোর: <strong>${formatScore(best.score)}/${best.total}</strong> (${best.percent}%) · ${myAttempts.length} বার দেওয়া হয়েছে</div>`
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
      view.innerHTML = `<div class="empty-state"><p>এই এক্সাম এখনো প্রকাশিত হয়নি</p></div>`;
      return;
    }

    const sched = examScheduleState(exam);
    if (sched.state === "upcoming") {
      view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-clock"></i></div><p>এই এক্সাম এখনো শুরু হয়নি${
        sched.start ? " — শুরু হবে " + sched.start.toLocaleString() : ""
      }</p></div>`;
      return;
    }
    if (sched.state === "closed") {
      view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-lock"></i></div><p>এই এক্সামের সময়সীমা শেষ হয়ে গেছে</p></div>`;
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
        view.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-ban"></i></div><p>আপনার সর্বোচ্চ ${maxAttempts} বার চেষ্টার সীমা শেষ হয়ে গেছে।</p>
          <a class="btn btn-outline" href="#/results">আমার রেজাল্ট দেখুন</a></div>`;
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
      <span>প্রশ্ন ম্যাপ</span>
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
      <span><i class="dot answered"></i> উত্তর দেওয়া</span>
      <span><i class="dot flagged"></i> ফ্ল্যাগ করা</span>
      <span><i class="dot"></i> বাকি আছে</span>
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
          <span class="exam-meta-chip"><i class="fa-solid fa-list-ol"></i> ${questions.length}টি প্রশ্ন</span>
          ${exam.negativeMarking ? `<span class="exam-meta-chip warn"><i class="fa-solid fa-minus"></i> −${exam.negativeMarking}/ভুল</span>` : ""}
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
    ? `আপনার ${unanswered}টি প্রশ্নের উত্তর দেওয়া হয়নি। এখনই সাবমিট করতে চান?`
    : "এক্সাম সাবমিট করতে চান?";
  if (confirm(msg)) submitExam();
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
    if (!takeState) return;
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
  document.getElementById("take-view").innerHTML = `
    <div class="result-hero">
      <div class="score-ring" style="--p:${percent}"><span>${percent}%</span></div>
      <h2>${escapeHtml(examTitle)}</h2>
      <p class="muted">Score: <strong>${formatScore(score)}</strong> / ${total}</p>
      ${passed != null ? `<span class="badge ${passed ? "badge-open" : "badge-locked"}">${passed ? "Passed" : "Failed"} (pass mark ${passingPercent}%)</span>` : ""}
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
    ${reviewListHtml(review)}`;
}

/* ---------- My results ---------- */
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
      el.innerHTML = `<div class="empty-state"><p>No results yet</p></div>`;
      return;
    }

    if (statsEl) {
      const avg = Math.round(rows.reduce((s, r) => s + (r.percent || 0), 0) / rows.length);
      const best = Math.max(...rows.map((r) => r.percent || 0));
      const distinctExams = new Set(rows.map((r) => r.examId)).size;
      statsEl.innerHTML = [
        { n: rows.length, l: "Total Attempts" },
        { n: distinctExams, l: "Exams Attempted" },
        { n: avg + "%", l: "Average" },
        { n: best + "%", l: "Best" },
      ]
        .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
        .join("");
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
              <td><strong>${formatScore(r.score)}/${r.total}</strong> (${r.percent}%)${r.passed === true ? ' <span class="badge badge-open">Pass</span>' : r.passed === false ? ' <span class="badge badge-locked">Fail</span>' : ""}</td>
              <td>#${r.attemptNumber || 1}</td>
              <td>${formatDateTime(r.submittedAt)}</td>
              <td style="display:flex;gap:0.35rem">
                <button class="btn btn-ghost btn-sm" data-view-review="${r.id}">Review</button>
                <a class="btn btn-ghost btn-sm" href="#/take?id=${r.examId}">Retake</a>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table></div>`;

    el.querySelectorAll("[data-view-review]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const r = rows.find((x) => x.id === btn.dataset.viewReview);
        if (!r) return;
        openModal(
          `
          <div class="modal-head">
            <h3>${escapeHtml(r.examTitle || "Exam")} — Attempt #${r.attemptNumber || 1}</h3>
            <button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p class="muted" style="margin-top:-0.5rem">Score: <strong>${formatScore(r.score)}/${r.total}</strong> (${r.percent}%) · ${formatDateTime(r.submittedAt)}</p>
            ${Array.isArray(r.review) && r.review.length ? reviewListHtml(r.review) : '<p class="muted">No saved review for this attempt.</p>'}
          </div>`,
          true
        );
      });
    });
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="empty-state"><p>Could not load results</p></div>`;
  }
}

/* ---------- Leaderboard ---------- */
async function loadLeaderboard() {
  const select = document.getElementById("lb-exam-select");
  const list = document.getElementById("lb-list");
  const search = document.getElementById("lb-search");
  try {
    const examsSnap = await getDocs(collection(db, "exams"));
    const exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((ex) => ex.status !== "draft");
    const currentVal = select.value;
    select.innerHTML =
      `<option value="">All exams</option>` +
      exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");
    select.value = currentVal;
    select.onchange = () => renderLb(select.value, list);
    search?.addEventListener("input", debounce(() => renderLb(select.value, list), 200));

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
    const searchQ = (document.getElementById("lb-search")?.value || "").trim().toLowerCase();
    let rows = [...best.values()].sort((a, b) => (b.percent || 0) - (a.percent || 0));
    if (searchQ) rows = rows.filter((r) => (r.studentName || r.studentEmail || "").toLowerCase().includes(searchQ));
    rows = rows.slice(0, 50);
    if (!rows.length) {
      list.innerHTML = `<div class="empty-state"><p>No scores yet</p></div>`;
      return;
    }
    list.innerHTML = rows
      .map((r, i) => {
        const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
        const isMe = r.uid === currentUser?.uid;
        return `
        <div class="lb-row ${isMe ? "lb-row-me" : ""}">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-name">
            ${escapeHtml(r.studentName || r.studentEmail || "Student")}${isMe ? ' <span class="badge badge-free">You</span>' : ""}
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
              <div class="field"><label>নাম</label><input type="text" id="pf-name" value="${escapeHtml(p?.displayName || currentUser.displayName || "")}" /></div>
              <div class="field"><label>ফোন নম্বর</label><input type="tel" id="pf-phone" placeholder="+8801XXXXXXXXX" value="${escapeHtml(p?.phone || "")}" /></div>
            </div>
            <div class="field"><label>ঠিকানা</label><input type="text" id="pf-address" placeholder="জেলা, বিভাগ" value="${escapeHtml(p?.address || "")}" /></div>
            <div class="admin-grid">
              <div class="field"><label>জন্মতারিখ</label><input type="date" id="pf-dob" value="${escapeHtml(p?.dob || "")}" /></div>
              <div class="field"><label>ইমেইল</label><input type="email" value="${escapeHtml(currentUser.email || "")}" disabled /></div>
            </div>
            <div class="field-group-label">সোশ্যাল লিংক</div>
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
        <h3 style="margin:0 0 0.35rem"><i class="fa-solid fa-graduation-cap"></i> আমার কোর্স ও পারচেজ হিস্ট্রি</h3>
        <p class="muted" style="margin:0 0 0.9rem;font-size:0.85rem">Course সাইট থেকে লাইভ — একই Firebase অ্যাকাউন্টে যুক্ত।</p>
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
            : `<div class="empty-state" style="padding:1.5rem 1rem"><p>এখনো কোনো কোর্স আনলক করা হয়নি — <a href="${COURSE_SITE_URL}" target="_blank" rel="noopener">Course Site এ দেখুন</a></p></div>`
        }
      </div>
    </div>`;

  document.getElementById("pf-logout")?.addEventListener("click", () => signOutUser());
  document.getElementById("pf-export-pdf")?.addEventListener("click", () => {
    document.title = `Profile — ${p?.displayName || currentUser.displayName || currentUser.email || "TechVerse"}`;
    window.print();
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
