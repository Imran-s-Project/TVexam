// ==========================================================================
// Tech Verse Exam — Admin panel
// Updated: Analytics Dashboard + Smart Leaderboard + PDF Export
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast,
  escapeHtml,
  getUserProfile,
  formatDateTime,
  formatScore,
  formatDuration,
  COURSE_SITE_URL,
  debounce,
  downloadFile,
  toCsv,
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  parseBulkQuestions,
  BULK_IMPORT_SAMPLE,
  openModal,
  getGreeting,
  getClockTime,
  getLessonsForCourse,
} from "./utils.js";
import { initTheme } from "./theme.js";

let courses = [];
let exams = [];
let allResults = [];

// Cache of course -> lessons lookups so switching back and forth in the
// exam modal (or the analytics filter) doesn't re-fetch every time.
let lessonsCache = {};
async function getCachedLessons(courseId) {
  if (lessonsCache[courseId]) return lessonsCache[courseId];
  const course = courses.find((c) => c.id === courseId);
  const lessons = await getLessonsForCourse(course);
  lessonsCache[courseId] = lessons;
  return lessons;
}

// Leaderboard pagination state
const LB_PAGE_SIZE = 25;
let lbCurrentPage = 1;
let lbAllRows = [];

initTheme();
document.getElementById("course-admin-link").href = COURSE_SITE_URL.replace(/\/?$/, "/") + "admin.html";

function updateAdminGreeting(name) {
  const msg = getGreeting(name);
  document.querySelectorAll("[data-greet-msg]").forEach((el) => (el.textContent = msg));
  document.querySelectorAll("[data-greet-time]").forEach((el) => (el.textContent = getClockTime()));
}
setInterval(() => updateAdminGreeting(window.__adminName), 30000);

function bindSignOut() {
  const doSignOut = () => {
    if (confirm("Sign out?")) signOut(auth).then(() => (location.href = "index.html#/login"));
  };
  document.getElementById("admin-signout-btn")?.addEventListener("click", doSignOut);
  document.getElementById("admin-signout-btn-mobile")?.addEventListener("click", doSignOut);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "index.html#/login"; return; }
  const profile = await getUserProfile(user.uid);
  if (!profile?.isAdmin) {
    document.getElementById("admin-gate").innerHTML = `
      <div class="empty-state">
        <div class="icon"><i class="fa-solid fa-shield-halved"></i></div>
        <p>Admin access required</p>
        <a class="btn btn-primary" href="index.html">Back to Exam Site</a>
      </div>`;
    return;
  }
  const name = user.displayName || profile?.displayName || user.email?.split("@")[0] || "Admin";
  window.__adminName = name;
  const avatarEl = document.getElementById("admin-nav-avatar");
  if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
  updateAdminGreeting(name);
  document.getElementById("admin-gate").classList.add("hidden");
  document.getElementById("admin-shell").classList.remove("hidden");
  bindSidebar();
  bindToolbars();
  bindSignOut();
  await refreshCourses();
  await Promise.all([loadOverview(), loadExamsTable(), loadResultsTable(), loadAdminLeaderboard()]);
  loadAnalytics();
});

function bindSidebar() {
  document.querySelectorAll(".admin-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`section-${btn.dataset.section}`)?.classList.add("active");
      document.getElementById("admin-sidebar")?.classList.remove("open");
      document.getElementById("admin-sidebar-toggle")?.classList.remove("open");
    });
  });
  document.getElementById("admin-sidebar-toggle")?.addEventListener("click", (e) => {
    document.getElementById("admin-sidebar")?.classList.toggle("open");
    e.currentTarget.classList.toggle("open");
  });
}

function bindToolbars() {
  document.getElementById("exams-search")?.addEventListener("input", debounce(renderExamsTableFiltered, 180));
  document.getElementById("exams-status-filter")?.addEventListener("change", renderExamsTableFiltered);
  document.getElementById("results-search")?.addEventListener("input", debounce(renderResultsTableFiltered, 180));
  document.getElementById("results-export-btn")?.addEventListener("click", exportResultsCsv);
  document.getElementById("analytics-refresh-btn")?.addEventListener("click", loadAnalytics);
  document.getElementById("analytics-exam-filter")?.addEventListener("change", loadAnalytics);
  document.getElementById("analytics-qd-exam")?.addEventListener("change", loadQuestionDifficulty);
  document.getElementById("lb-export-all-pdf-btn")?.addEventListener("click", exportFullLeaderboardPdf);
  document.getElementById("admin-lb-exam")?.addEventListener("change", () => { lbCurrentPage = 1; renderAdminLb(); });
  document.getElementById("admin-lb-search")?.addEventListener("input", debounce(() => { lbCurrentPage = 1; renderAdminLb(); }, 200));
}

async function refreshCourses() {
  const snap = await getDocs(collection(db, "courses"));
  courses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  lessonsCache = {};
}

function examStatusBadge(ex) {
  if (ex.status === "draft") return `<span class="badge badge-locked">Draft</span>`;
  const now = new Date();
  const start = ex.startAt?.toDate ? ex.startAt.toDate() : ex.startAt ? new Date(ex.startAt) : null;
  const end = ex.endAt?.toDate ? ex.endAt.toDate() : ex.endAt ? new Date(ex.endAt) : null;
  if (start && now < start) return `<span class="badge badge-free">Scheduled</span>`;
  if (end && now > end) return `<span class="badge badge-locked">Closed</span>`;
  return `<span class="badge badge-open">Published</span>`;
}

// ============================================================
// OVERVIEW
// ============================================================
async function loadOverview() {
  const grid = document.getElementById("stat-grid");
  const recent = document.getElementById("recent-results");
  const dist = document.getElementById("score-distribution");
  try {
    const [examsSnap, resultsSnap] = await Promise.all([
      getDocs(collection(db, "exams")),
      getDocs(collection(db, "results")),
    ]);
    exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allResults = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const results = allResults;
    const passRateResults = results.filter((r) => r.passed === true || r.passed === false);
    const passRate = passRateResults.length
      ? Math.round((passRateResults.filter((r) => r.passed).length / passRateResults.length) * 100)
      : null;

    grid.innerHTML = [
      { n: exams.length, l: "Exams", icon: "fa-file-pen" },
      { n: exams.filter((e) => e.status !== "draft").length, l: "Published", icon: "fa-circle-check" },
      { n: results.length, l: "Total Attempts", icon: "fa-pen-to-square" },
      { n: new Set(results.map((r) => r.uid)).size, l: "Active Students", icon: "fa-users" },
      {
        n: results.length ? Math.round(results.reduce((s, r) => s + (r.percent || 0), 0) / results.length) + "%" : "—",
        l: "Avg Score", icon: "fa-chart-simple"
      },
      { n: passRate != null ? passRate + "%" : "—", l: "Pass Rate", icon: "fa-trophy" },
    ]
      .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join("");

    if (dist) {
      const buckets = [0, 0, 0, 0, 0];
      results.forEach((r) => {
        const p = Math.min(99, Math.max(0, r.percent || 0));
        buckets[Math.floor(p / 20)]++;
      });
      const max = Math.max(1, ...buckets);
      const labels = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
      const colors = ["#ef4444","#f97316","#eab308","#22c55e","#06b6d4"];
      dist.innerHTML = buckets
        .map((b, i) => `
        <div class="bar-row">
          <span class="bar-label">${labels[i]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(b / max) * 100}%;background:${colors[i]}"></div></div>
          <span class="bar-value">${b}</span>
        </div>`)
        .join("");
    }

    const top = results
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
      .slice(0, 8);
    if (!top.length) {
      recent.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-inbox"></i></div><p>No submissions yet</p></div>`;
    } else {
      recent.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Exam</th><th>Score</th><th>Date</th></tr></thead><tbody>
        ${top.map((r) => `<tr>
            <td>${escapeHtml(r.studentName || r.studentEmail || "—")}</td>
            <td>${escapeHtml(r.examTitle || "—")}</td>
            <td>${formatScore(r.score)}/${r.total} (${r.percent}%)</td>
            <td>${formatDateTime(r.submittedAt)}</td>
          </tr>`).join("")}
      </tbody></table></div>`;
    }
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div class="empty-state"><p>Could not load — check results read rule includes isAdmin()</p></div>`;
  }
}

// ============================================================
// ANALYTICS
// ============================================================
async function loadAnalytics() {
  const kpiGrid = document.getElementById("analytics-kpi-grid");
  const dailyChart = document.getElementById("analytics-daily-chart");
  const passfailEl = document.getElementById("analytics-passfail");
  const topPerformersEl = document.getElementById("analytics-top-performers");
  const examFilterSel = document.getElementById("analytics-exam-filter");
  const qdExamSel = document.getElementById("analytics-qd-exam");

  if (kpiGrid) kpiGrid.innerHTML = `<div class="loading-screen" style="grid-column:1/-1"><span class="spinner"></span></div>`;

  try {
    const [examsSnap, resultsSnap] = await Promise.all([
      getDocs(collection(db, "exams")),
      getDocs(collection(db, "results")),
    ]);
    exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    allResults = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Populate exam filter dropdowns
    const examOpts = `<option value="">All Exams</option>` + exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");
    if (examFilterSel) examFilterSel.innerHTML = examOpts;
    if (qdExamSel) qdExamSel.innerHTML = `<option value="">Select exam…</option>` + exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");

    const filterVal = examFilterSel?.value || "";
    let results = filterVal ? allResults.filter((r) => r.examId === filterVal) : allResults;

    const totalAttempts = results.length;
    const uniqueStudents = new Set(results.map((r) => r.uid)).size;
    const avgScore = totalAttempts ? Math.round(results.reduce((s, r) => s + (r.percent || 0), 0) / totalAttempts) : 0;
    const totalTimeSec = results.reduce((s, r) => s + (r.timeTakenSeconds || 0), 0);
    const passResults = results.filter((r) => r.passed === true || r.passed === false);
    const passRate = passResults.length ? Math.round((passResults.filter((r) => r.passed).length / passResults.length) * 100) : null;
    const avgTimeSec = totalAttempts ? Math.round(totalTimeSec / totalAttempts) : 0;

    if (kpiGrid) {
      kpiGrid.innerHTML = [
        { n: totalAttempts, l: "Total Attempts" },
        { n: uniqueStudents, l: "Unique Students" },
        { n: avgScore + "%", l: "Avg Score" },
        { n: passRate != null ? passRate + "%" : "—", l: "Pass Rate" },
        { n: formatDuration(avgTimeSec), l: "Avg Time/Attempt" },
        { n: formatDuration(totalTimeSec), l: "Total Study Time" },
      ]
        .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
        .join("");
    }

    // Daily attempts — last 30 days
    if (dailyChart) {
      const now = Date.now();
      const dayMs = 86400000;
      const counts = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * dayMs);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        counts[key] = 0;
      }
      results.forEach((r) => {
        if (!r.submittedAt) return;
        const d = r.submittedAt.toDate ? r.submittedAt.toDate() : new Date(r.submittedAt);
        const age = (now - d.getTime()) / dayMs;
        if (age <= 30) {
          const key = `${d.getMonth() + 1}/${d.getDate()}`;
          if (key in counts) counts[key]++;
        }
      });
      const entries = Object.entries(counts);
      const maxCount = Math.max(1, ...Object.values(counts));
      dailyChart.innerHTML = `
        <div style="display:flex;align-items:flex-end;gap:2px;height:80px;overflow-x:auto;padding-bottom:4px">
          ${entries.map(([label, val]) => `
            <div style="flex:1;min-width:6px;display:flex;flex-direction:column;align-items:center;gap:2px" title="${label}: ${val} attempts">
              <div style="width:100%;background:var(--primary-hover);border-radius:3px 3px 0 0;height:${Math.max(2,(val/maxCount)*72)}px;transition:height 0.3s;opacity:${val===0?0.2:0.9}"></div>
            </div>`).join("")}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:0.68rem;color:var(--text-dim)">
          <span>${entries[0]?.[0]}</span><span>${entries[14]?.[0]}</span><span>${entries[29]?.[0]}</span>
        </div>`;
    }

    // Pass vs Fail
    if (passfailEl) {
      const passed = passResults.filter((r) => r.passed).length;
      const failed = passResults.filter((r) => !r.passed).length;
      const noTracking = results.length - passResults.length;
      if (!results.length) {
        passfailEl.innerHTML = `<p class="muted" style="text-align:center;font-size:0.88rem">No data yet</p>`;
      } else {
        const total = Math.max(1, passed + failed + noTracking);
        passfailEl.innerHTML = `
          <div style="display:flex;height:16px;border-radius:8px;overflow:hidden;margin-bottom:1rem">
            ${passed ? `<div style="flex:${passed};background:#22c55e" title="Passed: ${passed}"></div>` : ""}
            ${failed ? `<div style="flex:${failed};background:#ef4444" title="Failed: ${failed}"></div>` : ""}
            ${noTracking ? `<div style="flex:${noTracking};background:var(--bg-soft)" title="Not tracked: ${noTracking}"></div>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:0.5rem">
            ${passed ? `<div class="analytics-legend-row"><span style="background:#22c55e"></span><span>Passed</span><strong>${passed} (${Math.round(passed/total*100)}%)</strong></div>` : ""}
            ${failed ? `<div class="analytics-legend-row"><span style="background:#ef4444"></span><span>Failed</span><strong>${failed} (${Math.round(failed/total*100)}%)</strong></div>` : ""}
            ${noTracking ? `<div class="analytics-legend-row"><span style="background:var(--bg-soft)"></span><span>No pass mark</span><strong>${noTracking}</strong></div>` : ""}
          </div>`;
      }
    }

    // Top performers
    if (topPerformersEl) {
      const best = new Map();
      results.forEach((r) => {
        const prev = best.get(r.uid);
        if (!prev || (r.percent || 0) > (prev.percent || 0)) best.set(r.uid, r);
      });
      const top = [...best.values()].sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 5);
      if (!top.length) {
        topPerformersEl.innerHTML = `<p class="muted" style="font-size:0.88rem">No data yet</p>`;
      } else {
        topPerformersEl.innerHTML = top.map((r, i) => `
          <div class="lb-slim-row" style="border-bottom:1px solid var(--border);padding:0.65rem 0">
            <div class="lb-slim-rank ${["gold","silver","bronze"][i]||""}">${i+1}</div>
            <div class="lb-slim-avatar">${(r.studentName||r.studentEmail||"?").charAt(0).toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.studentName||r.studentEmail||"—")}</div>
              <div style="font-size:0.75rem;color:var(--text-dim)">${escapeHtml(r.examTitle||"")}</div>
            </div>
            <div style="font-weight:800;font-family:var(--mono);color:var(--primary-hover)">${r.percent}%</div>
          </div>`).join("");
      }
    }
  } catch (e) {
    console.error(e);
    if (kpiGrid) kpiGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>Could not load analytics</p></div>`;
  }
}

async function loadQuestionDifficulty() {
  const examId = document.getElementById("analytics-qd-exam")?.value;
  const el = document.getElementById("analytics-qdifficulty");
  if (!examId || !el) return;
  el.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    const [qSnap, rSnap] = await Promise.all([
      getDocs(query(collection(db, "exams", examId, "questions"), orderBy("order"))),
      getDocs(query(collection(db, "results"), where("examId", "==", examId))),
    ]);
    const questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const results = rSnap.docs.map((d) => d.data());
    if (!questions.length) { el.innerHTML = `<p class="muted" style="font-size:0.88rem">No questions found for this exam.</p>`; return; }
    if (!results.length) { el.innerHTML = `<p class="muted" style="font-size:0.88rem">No attempts yet for this exam.</p>`; return; }

    // Count correct/wrong per question index
    const stats = questions.map((q, idx) => ({ text: q.text, correct: 0, wrong: 0, skipped: 0, total: 0 }));
    results.forEach((r) => {
      if (!Array.isArray(r.review)) return;
      r.review.forEach((rv, idx) => {
        if (idx >= stats.length) return;
        stats[idx].total++;
        if (rv.status === "correct") stats[idx].correct++;
        else if (rv.status === "wrong") stats[idx].wrong++;
        else stats[idx].skipped++;
      });
    });

    el.innerHTML = `
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>#</th><th>Question</th><th>Correct</th><th>Wrong</th><th>Skipped</th><th>Accuracy</th><th>Difficulty</th></tr></thead>
          <tbody>
            ${stats.map((s, i) => {
              const acc = s.total ? Math.round((s.correct / s.total) * 100) : 0;
              const diff = acc >= 70 ? "Easy" : acc >= 40 ? "Medium" : "Hard";
              const diffColor = acc >= 70 ? "#22c55e" : acc >= 40 ? "#f59e0b" : "#ef4444";
              return `<tr>
                <td style="font-weight:700;color:var(--text-dim)">${i+1}</td>
                <td style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(s.text)}">${escapeHtml(s.text)}</td>
                <td style="color:#22c55e;font-weight:700">${s.correct}</td>
                <td style="color:#ef4444;font-weight:700">${s.wrong}</td>
                <td style="color:var(--text-dim)">${s.skipped}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:0.5rem">
                    <div style="width:60px;height:6px;background:var(--bg-soft);border-radius:3px;overflow:hidden">
                      <div style="width:${acc}%;height:100%;background:${diffColor}"></div>
                    </div>
                    <span style="font-family:var(--mono);font-size:0.82rem;font-weight:700">${acc}%</span>
                  </div>
                </td>
                <td><span style="font-size:0.78rem;font-weight:700;color:${diffColor};background:${diffColor}22;padding:0.2rem 0.5rem;border-radius:6px">${diff}</span></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<p style="color:var(--danger);font-size:0.88rem">Could not load question stats.</p>`;
  }
}

// ============================================================
// EXAMS TABLE
// ============================================================
async function loadExamsTable() {
  const tbody = document.querySelector("#exams-table tbody");
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading-screen"><span class="spinner"></span></div></td></tr>`;
  const snap = await getDocs(collection(db, "exams"));
  exams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderExamsTableFiltered();
}

function renderExamsTableFiltered() {
  const tbody = document.querySelector("#exams-table tbody");
  if (!tbody) return;
  const q = (document.getElementById("exams-search")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("exams-status-filter")?.value || "";
  let list = exams.filter((ex) => {
    if (q && !`${ex.title} ${ex.courseName || ""} ${ex.category || ""} ${ex.lessonName || ""}`.toLowerCase().includes(q)) return false;
    if (statusFilter === "draft" && ex.status !== "draft") return false;
    if (statusFilter === "published" && ex.status === "draft") return false;
    return true;
  });
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-file-circle-xmark"></i></div><p>No exams found</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((ex) => `<tr>
      <td><strong>${escapeHtml(ex.title)}</strong>${ex.category ? `<div class="muted" style="font-size:0.75rem">${escapeHtml(ex.category)}</div>` : ""}</td>
      <td>${escapeHtml(ex.courseName || "—")}${ex.lessonName ? `<div class="muted" style="font-size:0.75rem"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(ex.lessonName)}</div>` : ""}</td>
      <td>${ex.questionCount || 0}</td>
      <td>${ex.duration ? ex.duration + " min" : "—"}</td>
      <td>${examStatusBadge(ex)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${ex.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-dup="${ex.id}" title="Duplicate"><i class="fa-regular fa-copy"></i></button>
        <button class="icon-btn" data-export="${ex.id}" title="Export questions (JSON)"><i class="fa-solid fa-file-export"></i></button>
        <button class="icon-btn" data-del="${ex.id}" title="Delete" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`)
    .join("");
  tbody.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => openExamModal(b.dataset.edit)));
  tbody.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => deleteExam(b.dataset.del)));
  tbody.querySelectorAll("[data-dup]").forEach((b) => b.addEventListener("click", () => duplicateExam(b.dataset.dup)));
  tbody.querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => exportExamQuestions(b.dataset.export)));
}

document.getElementById("add-exam-btn")?.addEventListener("click", () => openExamModal(null));

async function exportExamQuestions(examId) {
  const ex = exams.find((e) => e.id === examId);
  if (!ex) return;
  const qSnap = await getDocs(query(collection(db, "exams", examId, "questions"), orderBy("order")));
  const questions = qSnap.docs.map((d) => {
    const q = d.data();
    return { text: q.text, options: q.options || [], correctIndex: q.correctIndex ?? 0, explanation: q.explanation || "", marks: q.marks || 1 };
  });
  downloadFile(
    `${(ex.title || "exam").replace(/[^\w\u0980-\u09FF -]/g, "").trim() || "exam"}-questions.json`,
    JSON.stringify(questions, null, 2)
  );
  toast(`${questions.length} question(s) exported`, "success");
}

async function duplicateExam(examId) {
  const ex = exams.find((e) => e.id === examId);
  if (!ex) return;
  if (!confirm(`Create a copy of "${ex.title}"?`)) return;
  try {
    const { id, ...rest } = ex;
    const newRef = await addDoc(collection(db, "exams"), { ...rest, title: (ex.title || "Exam") + " (Copy)", status: "draft", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const qSnap = await getDocs(query(collection(db, "exams", examId, "questions"), orderBy("order")));
    await Promise.all(qSnap.docs.map((d) => addDoc(collection(db, "exams", newRef.id, "questions"), d.data())));
    toast("Exam copied (as Draft)", "success");
    await loadExamsTable();
    await loadOverview();
  } catch (e) {
    console.error(e);
    toast("Could not copy exam", "error");
  }
}

async function openExamModal(examId) {
  const ex = examId ? exams.find((e) => e.id === examId) : null;
  let questionDrafts = [];
  if (ex) {
    const qSnap = await getDocs(query(collection(db, "exams", ex.id, "questions"), orderBy("order")));
    questionDrafts = qSnap.docs.map((d) => ({
      text: d.data().text,
      options: d.data().options && d.data().options.length ? d.data().options : ["", "", "", ""],
      correctIndex: d.data().correctIndex ?? 0,
      explanation: d.data().explanation || "",
      marks: d.data().marks || 1,
    }));
  }

  const backdrop = openModal(`
    <div class="modal-head">
      <h3>${ex ? "Edit Exam" : "Create Exam"}</h3>
      <button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
    </div>
    <form id="exam-form">
      <div class="exam-tabs">
        <button type="button" class="exam-tab-btn active" data-tab="settings">Settings</button>
        <button type="button" class="exam-tab-btn" data-tab="questions">Questions <span id="q-count">${questionDrafts.length}</span></button>
        <button type="button" class="exam-tab-btn" data-tab="bulk">Bulk Import</button>
      </div>
      <div class="exam-tab-panel active" id="panel-settings">
        <div class="field"><label>Title</label><input id="em-title" required value="${ex ? escapeHtml(ex.title) : ""}" /></div>
        <div class="admin-grid">
          <div class="field"><label>Course tag (display name)</label><input id="em-course-name" value="${ex ? escapeHtml(ex.courseName || "") : ""}" /></div>
          <div class="field"><label>Category / Subject</label><input id="em-category" placeholder="e.g. Physics, HSC" value="${ex ? escapeHtml(ex.category || "") : ""}" /></div>
        </div>
        <div class="field">
          <label>Link to course (locks exam if course is paid)</label>
          <select id="em-course-id">
            <option value="">— Open to everyone —</option>
            ${courses.map((c) => `<option value="${c.id}" ${ex?.courseId === c.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`).join("")}
          </select>
        </div>
        <div class="field" id="em-lesson-wrap" style="display:${ex?.courseId ? "block" : "none"}">
          <label><i class="fa-solid fa-location-dot"></i> Link to a specific lesson <span class="muted" style="font-weight:400;font-size:0.8rem">(optional — leave as "whole course" to keep it course-wide)</span></label>
          <select id="em-lesson-id">
            <option value="">— Whole course (no specific lesson) —</option>
          </select>
        </div>
        <div class="admin-grid">
          <div class="field"><label>Duration (minutes, 0 = unlimited)</label><input type="number" id="em-duration" min="0" value="${ex?.duration ?? 30}" /></div>
          <div class="field"><label>Negative marking per wrong</label><input type="number" id="em-neg" min="0" step="0.25" value="${ex?.negativeMarking ?? 0}" /></div>
        </div>
        <div class="admin-grid">
          <div class="field"><label>Max attempts (0 = unlimited)</label><input type="number" id="em-max-attempts" min="0" value="${ex?.maxAttempts ?? 0}" /></div>
          <div class="field"><label>Passing score % (0 = not tracked)</label><input type="number" id="em-passing" min="0" max="100" value="${ex?.passingPercent ?? 0}" /></div>
        </div>
        <div class="admin-grid">
          <div class="field"><label>Opens at (optional)</label><input type="datetime-local" id="em-start" value="${ex ? toDateTimeLocalValue(ex.startAt) : ""}" /></div>
          <div class="field"><label>Closes at (optional)</label><input type="datetime-local" id="em-end" value="${ex ? toDateTimeLocalValue(ex.endAt) : ""}" /></div>
        </div>
        <div class="field">
          <label>Status</label>
          <select id="em-status">
            <option value="published" ${ex?.status !== "draft" ? "selected" : ""}>Published (students can see it)</option>
            <option value="draft" ${ex?.status === "draft" ? "selected" : ""}>Draft (hidden from students)</option>
          </select>
        </div>
        <div class="field"><label><input type="checkbox" id="em-shuffle" ${ex?.shuffle !== false ? "checked" : ""} /> Shuffle questions & options</label></div>
        <div class="field"><label><input type="checkbox" id="em-showall" ${ex?.showAll ? "checked" : ""} /> Show all questions on one page</label></div>
      </div>
      <div class="exam-tab-panel" id="panel-questions">
        <div id="q-drafts"></div>
        <button type="button" class="btn btn-outline btn-sm" id="add-q-btn"><i class="fa-solid fa-plus"></i> Add question</button>
      </div>
      <div class="exam-tab-panel" id="panel-bulk">
        <div class="bulk-import-hint">
          <i class="fa-solid fa-bolt"></i> Add many questions at once — paste in <code>Q/A/B/C/D/Answer/Explanation</code> plain text, CSV, or JSON format.
        </div>
        <textarea id="bulk-import-text" rows="12" placeholder="Paste your questions here…"></textarea>
        <div id="bulk-import-report" class="muted"></div>
        <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap">
          <button type="button" class="btn btn-primary btn-sm" id="bulk-import-btn"><i class="fa-solid fa-upload"></i> Parse &amp; Add to Questions</button>
          <button type="button" class="btn btn-outline btn-sm" id="bulk-sample-btn">Load Sample</button>
          <button type="button" class="btn btn-ghost btn-sm" id="bulk-import-json-file-btn">Import JSON file…</button>
          <input type="file" id="bulk-import-json-file" accept=".json,application/json" class="hidden" />
        </div>
      </div>
      <button type="submit" class="btn btn-primary btn-block" style="margin-top:1rem" id="exam-save-btn">${ex ? "Save Changes" : "Create Exam"}</button>
    </form>
  `, true);

  const draftsEl = backdrop.querySelector("#q-drafts");
  function renderDrafts() {
    draftsEl.innerHTML = questionDrafts.map((q, i) => `
      <div class="q-draft" data-qi="${i}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;gap:0.4rem;flex-wrap:wrap">
          <strong>Q${i + 1}</strong>
          <div style="display:flex;gap:0.3rem;align-items:center">
            <label class="muted" style="font-size:0.78rem;display:flex;align-items:center;gap:0.3rem">Marks
              <input type="number" data-f="marks" min="0.25" step="0.25" value="${q.marks || 1}" style="width:60px;padding:0.3rem 0.4rem;border-radius:6px;border:1px solid var(--border-strong);background:var(--bg-elevated)" />
            </label>
            <button type="button" class="btn btn-ghost btn-sm" data-move-up="${i}" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" class="btn btn-ghost btn-sm" data-move-down="${i}" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="btn btn-ghost btn-sm" data-dup-q="${i}" title="Duplicate"><i class="fa-regular fa-copy"></i></button>
            <button type="button" class="btn btn-ghost btn-sm" data-rm-q="${i}" style="color:var(--danger)">Remove</button>
          </div>
        </div>
        <div class="field"><label>Question</label><textarea data-f="text" rows="2">${escapeHtml(q.text)}</textarea></div>
        <div id="opts-${i}">
          ${q.options.map((opt, oi) => `
          <div class="field" style="display:flex;gap:0.5rem;align-items:center">
            <input type="radio" name="correct-${i}" value="${oi}" ${q.correctIndex === oi ? "checked" : ""} title="Correct" />
            <input type="text" data-f="opt" data-oi="${oi}" value="${escapeHtml(opt || "")}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" />
            ${q.options.length > 2 ? `<button type="button" class="icon-btn" data-rm-opt="${oi}" title="Remove option" style="width:32px;height:32px"><i class="fa-solid fa-xmark"></i></button>` : ""}
          </div>`).join("")}
        </div>
        ${q.options.length < 6 ? `<button type="button" class="btn btn-ghost btn-sm" data-add-opt="${i}"><i class="fa-solid fa-plus"></i> Add option</button>` : ""}
        <div class="field" style="margin-top:0.5rem">
          <label><i class="fa-solid fa-lightbulb"></i> Explanation <span class="muted" style="font-weight:400;font-size:0.8rem">(optional)</span></label>
          <textarea data-f="explanation" rows="2" placeholder="e.g. Paris has been the capital of France since...">${escapeHtml(q.explanation || "")}</textarea>
        </div>
      </div>`).join("");
    backdrop.querySelector("#q-count").textContent = questionDrafts.length;

    draftsEl.querySelectorAll("[data-rm-q]").forEach((b) => b.addEventListener("click", () => { syncDraftsFromDom(); questionDrafts.splice(Number(b.dataset.rmQ), 1); renderDrafts(); }));
    draftsEl.querySelectorAll("[data-dup-q]").forEach((b) => b.addEventListener("click", () => { syncDraftsFromDom(); const i = Number(b.dataset.dupQ); questionDrafts.splice(i + 1, 0, { ...questionDrafts[i], options: [...questionDrafts[i].options] }); renderDrafts(); }));
    draftsEl.querySelectorAll("[data-move-up]").forEach((b) => b.addEventListener("click", () => { syncDraftsFromDom(); const i = Number(b.dataset.moveUp); if (i === 0) return; [questionDrafts[i-1], questionDrafts[i]] = [questionDrafts[i], questionDrafts[i-1]]; renderDrafts(); }));
    draftsEl.querySelectorAll("[data-move-down]").forEach((b) => b.addEventListener("click", () => { syncDraftsFromDom(); const i = Number(b.dataset.moveDown); if (i === questionDrafts.length - 1) return; [questionDrafts[i+1], questionDrafts[i]] = [questionDrafts[i], questionDrafts[i+1]]; renderDrafts(); }));
    draftsEl.querySelectorAll("[data-add-opt]").forEach((b) => b.addEventListener("click", () => { syncDraftsFromDom(); const i = Number(b.dataset.addOpt); if (questionDrafts[i].options.length < 6) questionDrafts[i].options.push(""); renderDrafts(); }));
    draftsEl.querySelectorAll("[data-rm-opt]").forEach((b) => b.addEventListener("click", () => { syncDraftsFromDom(); const qi = Number(b.closest(".q-draft").dataset.qi); const oi = Number(b.dataset.rmOpt); questionDrafts[qi].options.splice(oi, 1); if (questionDrafts[qi].correctIndex >= questionDrafts[qi].options.length) questionDrafts[qi].correctIndex = 0; renderDrafts(); }));
  }
  function syncDraftsFromDom() {
    draftsEl.querySelectorAll(".q-draft").forEach((el, i) => {
      if (!questionDrafts[i]) return;
      questionDrafts[i].text = el.querySelector('[data-f="text"]').value;
      questionDrafts[i].options = [...el.querySelectorAll('[data-f="opt"]')].map((inp) => inp.value);
      const checked = el.querySelector(`input[name="correct-${i}"]:checked`);
      questionDrafts[i].correctIndex = checked ? Number(checked.value) : 0;
      questionDrafts[i].explanation = el.querySelector('[data-f="explanation"]').value;
      const marksInput = el.querySelector('[data-f="marks"]');
      questionDrafts[i].marks = marksInput ? Number(marksInput.value) || 1 : 1;
    });
  }
  renderDrafts();

  // Course -> Lesson linking: the lesson dropdown is populated live from
  // whichever course is selected, and hides itself when the exam is open
  // to everyone (no course chosen).
  const courseSelect = backdrop.querySelector("#em-course-id");
  const lessonWrap = backdrop.querySelector("#em-lesson-wrap");
  const lessonSelect = backdrop.querySelector("#em-lesson-id");
  async function populateLessonSelect(courseId, selectedLessonId) {
    if (!courseId) {
      lessonWrap.style.display = "none";
      lessonSelect.innerHTML = `<option value="">— Whole course (no specific lesson) —</option>`;
      return;
    }
    lessonWrap.style.display = "block";
    lessonSelect.disabled = true;
    lessonSelect.innerHTML = `<option>Loading lessons…</option>`;
    const lessons = await getCachedLessons(courseId);
    lessonSelect.disabled = false;
    if (!lessons.length) {
      lessonSelect.innerHTML = `<option value="">— No lessons found for this course —</option>`;
      return;
    }
    lessonSelect.innerHTML =
      `<option value="">— Whole course (no specific lesson) —</option>` +
      lessons
        .map(
          (l) =>
            `<option value="${escapeHtml(l.id)}" data-title="${escapeHtml(l.title)}" ${l.id === selectedLessonId ? "selected" : ""}>${l.moduleTitle ? escapeHtml(l.moduleTitle) + " — " : ""}${escapeHtml(l.title)}</option>`
        )
        .join("");
  }
  courseSelect.addEventListener("change", () => populateLessonSelect(courseSelect.value, null));
  if (ex?.courseId) populateLessonSelect(ex.courseId, ex.lessonId || null);

  backdrop.querySelector("#add-q-btn").addEventListener("click", () => { syncDraftsFromDom(); questionDrafts.push({ text: "", options: ["", "", "", ""], correctIndex: 0, explanation: "", marks: 1 }); renderDrafts(); });
  backdrop.querySelectorAll(".exam-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "questions") syncDraftsFromDom();
      backdrop.querySelectorAll(".exam-tab-btn").forEach((b) => b.classList.remove("active"));
      backdrop.querySelectorAll(".exam-tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      backdrop.querySelector(`#panel-${btn.dataset.tab}`).classList.add("active");
    });
  });

  const bulkTextarea = backdrop.querySelector("#bulk-import-text");
  const bulkReport = backdrop.querySelector("#bulk-import-report");
  backdrop.querySelector("#bulk-sample-btn").addEventListener("click", () => { bulkTextarea.value = BULK_IMPORT_SAMPLE; });
  backdrop.querySelector("#bulk-import-btn").addEventListener("click", () => {
    const { questions: parsed, errors } = parseBulkQuestions(bulkTextarea.value);
    if (parsed.length) { syncDraftsFromDom(); parsed.forEach((q) => questionDrafts.push({ ...q, options: q.options.length ? q.options : ["", "", "", ""] })); renderDrafts(); backdrop.querySelectorAll(".exam-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "questions")); backdrop.querySelectorAll(".exam-tab-panel").forEach((p) => p.classList.toggle("active", p.id === "panel-questions")); }
    bulkReport.innerHTML = `${parsed.length} question(s) added.${errors.length ? ` <span style="color:var(--danger)">${errors.length} issue(s): ${errors.slice(0, 5).map(escapeHtml).join("; ")}</span>` : ""}`;
    if (parsed.length) toast(`${parsed.length} question(s) added`, "success");
  });
  const fileInput = backdrop.querySelector("#bulk-import-json-file");
  backdrop.querySelector("#bulk-import-json-file-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => { const file = fileInput.files?.[0]; if (!file) return; const text = await file.text(); bulkTextarea.value = text; fileInput.value = ""; toast("File loaded — now click Parse & Add", "info"); });

  backdrop.querySelector("#exam-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    syncDraftsFromDom();
    const btn = backdrop.querySelector("#exam-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    const startVal = backdrop.querySelector("#em-start").value;
    const endVal = backdrop.querySelector("#em-end").value;
    const startDate = fromDateTimeLocalValue(startVal);
    const endDate = fromDateTimeLocalValue(endVal);
    const validQs = questionDrafts.filter((q) => q.text.trim() && q.options.filter((o) => o.trim()).length >= 2);
    const totalMarks = validQs.reduce((s, q) => s + (Number(q.marks) > 0 ? Number(q.marks) : 1), 0);
    const payload = {
      title: backdrop.querySelector("#em-title").value.trim(),
      courseName: backdrop.querySelector("#em-course-name").value.trim(),
      category: backdrop.querySelector("#em-category").value.trim(),
      courseId: backdrop.querySelector("#em-course-id").value || null,
      lessonId: backdrop.querySelector("#em-course-id").value ? backdrop.querySelector("#em-lesson-id").value || null : null,
      lessonName: backdrop.querySelector("#em-course-id").value && backdrop.querySelector("#em-lesson-id").value
        ? backdrop.querySelector("#em-lesson-id").selectedOptions[0]?.dataset.title || ""
        : null,
      duration: Number(backdrop.querySelector("#em-duration").value) || 0,
      negativeMarking: Number(backdrop.querySelector("#em-neg").value) || 0,
      maxAttempts: Number(backdrop.querySelector("#em-max-attempts").value) || 0,
      passingPercent: Number(backdrop.querySelector("#em-passing").value) || 0,
      status: backdrop.querySelector("#em-status").value,
      startAt: startDate ? Timestamp.fromDate(startDate) : null,
      endAt: endDate ? Timestamp.fromDate(endDate) : null,
      shuffle: backdrop.querySelector("#em-shuffle").checked,
      showAll: backdrop.querySelector("#em-showall").checked,
      questionCount: validQs.length,
      totalMarks,
      updatedAt: serverTimestamp(),
    };
    if (!payload.title) { toast("Please enter an exam title", "error"); btn.disabled = false; btn.textContent = ex ? "Save Changes" : "Create Exam"; return; }
    if (!validQs.length) { toast("Add at least 1 question (with at least 2 options)", "error"); btn.disabled = false; btn.textContent = ex ? "Save Changes" : "Create Exam"; return; }
    try {
      let examRef;
      if (ex) {
        examRef = doc(db, "exams", ex.id);
        await updateDoc(examRef, payload);
        const oldQ = await getDocs(collection(db, "exams", ex.id, "questions"));
        const batch = writeBatch(db);
        oldQ.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      } else {
        examRef = await addDoc(collection(db, "exams"), { ...payload, createdAt: serverTimestamp() });
      }
      await Promise.all(validQs.map((q, i) => addDoc(collection(db, "exams", examRef.id, "questions"), {
        text: q.text.trim(), options: q.options.map((o) => o.trim()).filter((o) => o !== ""),
        correctIndex: Math.min(q.correctIndex, q.options.filter((o) => o.trim()).length - 1),
        explanation: (q.explanation || "").trim(), marks: Number(q.marks) > 0 ? Number(q.marks) : 1, order: i,
      })));
      toast(ex ? "Exam updated" : "Exam created", "success");
      backdrop.remove();
      await loadExamsTable();
      await loadOverview();
      await loadAdminLeaderboard();
    } catch (err) {
      console.error(err);
      toast("Could not save exam", "error");
      btn.disabled = false;
      btn.textContent = ex ? "Save Changes" : "Create Exam";
    }
  });
}

async function deleteExam(id) {
  if (!confirm("Delete this exam and all its questions?")) return;
  try {
    const qSnap = await getDocs(collection(db, "exams", id, "questions"));
    const batch = writeBatch(db);
    qSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "exams", id));
    await batch.commit();
    toast("Exam deleted", "success");
    await loadExamsTable();
    await loadOverview();
  } catch { toast("Could not delete", "error"); }
}

// ============================================================
// RESULTS TABLE
// ============================================================
async function loadResultsTable() {
  const tbody = document.querySelector("#results-table tbody");
  tbody.innerHTML = `<tr><td colspan="6"><div class="loading-screen"><span class="spinner"></span></div></td></tr>`;
  try {
    const snap = await getDocs(collection(db, "results"));
    allResults = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderResultsTableFiltered();
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>Need isAdmin() on results read rule</p></div></td></tr>`;
  }
}

function renderResultsTableFiltered() {
  const tbody = document.querySelector("#results-table tbody");
  if (!tbody) return;
  const q = (document.getElementById("results-search")?.value || "").trim().toLowerCase();
  let rows = allResults
    .filter((r) => !q || `${r.studentName || ""} ${r.studentEmail || ""} ${r.examTitle || ""}`.toLowerCase().includes(q))
    .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="icon"><i class="fa-solid fa-inbox"></i></div><p>No results</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `<tr>
      <td>${escapeHtml(r.studentName || r.studentEmail || "—")}</td>
      <td>${escapeHtml(r.examTitle || "—")}</td>
      <td>${formatScore(r.score)}/${r.total} (${r.percent}%)</td>
      <td>#${r.attemptNumber || 1}</td>
      <td>${formatDateTime(r.submittedAt)}</td>
      <td><button class="icon-btn" data-del-result="${r.id}" title="Delete result" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`).join("");
  tbody.querySelectorAll("[data-del-result]").forEach((b) => b.addEventListener("click", () => deleteResult(b.dataset.delResult)));
}

async function deleteResult(id) {
  if (!confirm("Delete this result?")) return;
  try {
    await deleteDoc(doc(db, "results", id));
    toast("Result deleted", "success");
    await loadResultsTable();
    await loadOverview();
    await loadAdminLeaderboard();
  } catch (e) { console.error(e); toast("Could not delete", "error"); }
}

function exportResultsCsv() {
  if (!allResults.length) { toast("No results to export", "info"); return; }
  const headers = ["Student", "Email", "Exam", "Score", "Total", "Percent", "Attempt", "Correct", "Wrong", "Unanswered", "TimeTakenSeconds", "SubmittedAt"];
  const rows = allResults.map((r) => [r.studentName || "", r.studentEmail || "", r.examTitle || "", r.score, r.total, r.percent, r.attemptNumber || 1, r.correctCount ?? "", r.wrongCount ?? "", r.unansweredCount ?? "", r.timeTakenSeconds ?? "", r.submittedAt?.toDate ? r.submittedAt.toDate().toISOString() : ""]);
  downloadFile("exam-results.csv", toCsv(rows, headers), "text/csv");
  toast("Downloading CSV", "success");
}

// ============================================================
// LEADERBOARD — Smart, slim, paginated, clickable
// ============================================================
async function loadAdminLeaderboard() {
  const select = document.getElementById("admin-lb-exam");
  if (!select) return;

  const snap = await getDocs(collection(db, "exams"));
  exams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  select.innerHTML = `<option value="">All Exams</option>` + exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");

  await renderAdminLb();
}

async function renderAdminLb() {
  const list = document.getElementById("admin-lb-list");
  const pagination = document.getElementById("lb-pagination");
  const summaryGrid = document.getElementById("lb-summary-grid");
  if (!list) return;

  list.innerHTML = `<div class="loading-screen" style="padding:2rem"><span class="spinner"></span></div>`;
  if (pagination) pagination.innerHTML = "";
  if (summaryGrid) summaryGrid.innerHTML = "";

  try {
    const examId = document.getElementById("admin-lb-exam")?.value || "";
    const searchQ = (document.getElementById("admin-lb-search")?.value || "").trim().toLowerCase();

    const rSnap = await getDocs(collection(db, "results"));
    let rows = rSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (examId) rows = rows.filter((r) => r.examId === examId);

    // Build per-student aggregates
    const studentMap = new Map();
    rows.forEach((r) => {
      const uid = r.uid;
      if (!studentMap.has(uid)) {
        studentMap.set(uid, {
          uid,
          name: r.studentName || r.studentEmail || "—",
          email: r.studentEmail || "—",
          attempts: [],
          bestPercent: 0,
          firstAt: null,
        });
      }
      const s = studentMap.get(uid);
      s.attempts.push(r);
      if ((r.percent || 0) > s.bestPercent) s.bestPercent = r.percent || 0;
      const ts = r.submittedAt?.seconds || 0;
      if (!s.firstAt || ts < s.firstAt) s.firstAt = ts;
    });

    let students = [...studentMap.values()].sort((a, b) => b.bestPercent - a.bestPercent);
    if (searchQ) students = students.filter((s) => s.name.toLowerCase().includes(searchQ) || s.email.toLowerCase().includes(searchQ));

    lbAllRows = students;

    // Summary
    if (summaryGrid) {
      const totalStudents = students.length;
      const totalAttempts = rows.length;
      const avgBest = totalStudents ? Math.round(students.reduce((acc, s) => acc + s.bestPercent, 0) / totalStudents) : 0;
      summaryGrid.innerHTML = [
        { n: totalStudents, l: "Students" },
        { n: totalAttempts, l: "Total Attempts" },
        { n: avgBest + "%", l: "Avg Best Score" },
      ].map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`).join("");
    }

    if (!students.length) {
      list.innerHTML = `<div class="empty-state" style="padding:3rem"><div class="icon"><i class="fa-solid fa-ranking-star"></i></div><p>No data available${searchQ ? " — try a different search" : ""}</p></div>`;
      return;
    }

    // Paginate
    const totalPages = Math.ceil(students.length / LB_PAGE_SIZE);
    const page = Math.min(lbCurrentPage, totalPages);
    const pageStudents = students.slice((page - 1) * LB_PAGE_SIZE, page * LB_PAGE_SIZE);
    const globalOffset = (page - 1) * LB_PAGE_SIZE;

    // Render slim rows
    list.innerHTML = pageStudents.map((s, localIdx) => {
      const rank = globalOffset + localIdx + 1;
      const rankClass = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "";
      const totalCorrect = s.attempts.reduce((acc, r) => acc + (r.correctCount || 0), 0);
      const totalWrong = s.attempts.reduce((acc, r) => acc + (r.wrongCount || 0), 0);
      const totalTimeSec = s.attempts.reduce((acc, r) => acc + (r.timeTakenSeconds || 0), 0);
      const daysSince = s.firstAt ? Math.floor((Date.now() / 1000 - s.firstAt) / 86400) : 0;
      const initials = s.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";

      return `<div class="lb-slim-row lb-slim-clickable" data-uid="${s.uid}" data-rank="${rank}" title="Tap to view full history">
        <div class="lb-slim-rank ${rankClass}">${rank}</div>
        <div class="lb-slim-avatar">${initials}</div>
        <div class="lb-slim-info">
          <div class="lb-slim-name">${escapeHtml(s.name)}</div>
          <div class="lb-slim-email">${escapeHtml(s.email)}</div>
        </div>
        <div class="lb-slim-chips">
          <span class="lb-chip lb-chip-attempts" title="Attempts"><i class="fa-solid fa-pen-to-square"></i> ${s.attempts.length}</span>
          <span class="lb-chip lb-chip-correct" title="Correct"><i class="fa-solid fa-check"></i> ${totalCorrect}</span>
          <span class="lb-chip lb-chip-time" title="Total time"><i class="fa-solid fa-clock"></i> ${formatDuration(totalTimeSec)}</span>
          <span class="lb-chip lb-chip-days" title="Days with us"><i class="fa-solid fa-calendar-days"></i> ${daysSince}d</span>
        </div>
        <div class="lb-slim-score ${rankClass}">${s.bestPercent}%</div>
      </div>`;
    }).join("");

    // Bind click → student detail modal
    list.querySelectorAll(".lb-slim-clickable").forEach((row) => {
      row.addEventListener("click", () => {
        const uid = row.dataset.uid;
        const rank = Number(row.dataset.rank);
        const student = lbAllRows.find((s) => s.uid === uid);
        if (student) showStudentDetailModal(student, rank);
      });
    });

    // Pagination controls
    if (pagination && totalPages > 1) {
      let pHtml = "";
      if (page > 1) pHtml += `<button class="btn btn-ghost btn-sm" data-pg="${page - 1}">← Prev</button>`;
      for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) {
        pHtml += `<button class="btn btn-sm ${p === page ? "btn-primary" : "btn-ghost"}" data-pg="${p}">${p}</button>`;
      }
      if (page < totalPages) pHtml += `<button class="btn btn-ghost btn-sm" data-pg="${page + 1}">Next →</button>`;
      pagination.innerHTML = pHtml;
      pagination.querySelectorAll("[data-pg]").forEach((btn) => {
        btn.addEventListener("click", () => { lbCurrentPage = Number(btn.dataset.pg); renderAdminLb(); });
      });
    }
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="empty-state" style="padding:2rem"><p>Could not load leaderboard</p></div>`;
  }
}

// ============================================================
// STUDENT DETAIL MODAL
// ============================================================
function showStudentDetailModal(student, rank) {
  const attempts = [...student.attempts].sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
  const totalCorrect = attempts.reduce((acc, r) => acc + (r.correctCount || 0), 0);
  const totalWrong = attempts.reduce((acc, r) => acc + (r.wrongCount || 0), 0);
  const totalSkipped = attempts.reduce((acc, r) => acc + (r.unansweredCount || 0), 0);
  const totalTimeSec = attempts.reduce((acc, r) => acc + (r.timeTakenSeconds || 0), 0);
  const avgScore = attempts.length ? Math.round(attempts.reduce((acc, r) => acc + (r.percent || 0), 0) / attempts.length) : 0;
  const distinctExams = new Set(attempts.map((r) => r.examId)).size;
  const daysSince = student.firstAt ? Math.floor((Date.now() / 1000 - student.firstAt) / 86400) : 0;
  const initials = student.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";

  const backdrop = openModal(`
    <div class="modal-head" style="gap:0.75rem">
      <div style="display:flex;align-items:center;gap:0.85rem;flex:1;min-width:0">
        <div class="lb-detail-avatar">${initials}</div>
        <div style="min-width:0">
          <div style="font-size:1.1rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(student.name)}</div>
          <div style="font-size:0.78rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(student.email)}</div>
        </div>
        <span class="lb-detail-rank-badge rank-${rank <= 3 ? ["gold","silver","bronze"][rank-1] : "normal"}">#${rank}</span>
      </div>
      <button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="modal-body" style="padding-top:0">
      <!-- KPI strip -->
      <div class="lb-detail-kpi-grid">
        <div class="lb-detail-kpi"><div class="n">${attempts.length}</div><div class="l">Exams Given</div></div>
        <div class="lb-detail-kpi"><div class="n">${distinctExams}</div><div class="l">Unique Exams</div></div>
        <div class="lb-detail-kpi"><div class="n">${student.bestPercent}%</div><div class="l">Best Score</div></div>
        <div class="lb-detail-kpi"><div class="n">${avgScore}%</div><div class="l">Avg Score</div></div>
        <div class="lb-detail-kpi"><div class="n" style="color:#22c55e">${totalCorrect}</div><div class="l">✓ Correct</div></div>
        <div class="lb-detail-kpi"><div class="n" style="color:#ef4444">${totalWrong}</div><div class="l">✗ Wrong</div></div>
        <div class="lb-detail-kpi"><div class="n">${totalSkipped}</div><div class="l">Skipped</div></div>
        <div class="lb-detail-kpi"><div class="n">${formatDuration(totalTimeSec)}</div><div class="l">Total Time</div></div>
        <div class="lb-detail-kpi"><div class="n">${daysSince}d</div><div class="l">Journey</div></div>
      </div>

      <!-- Score trend -->
      ${attempts.length >= 2 ? `
      <div style="margin-bottom:1.25rem">
        <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:.05em">Score Trend</div>
        <div style="display:flex;align-items:flex-end;gap:3px;height:50px">
          ${[...attempts].reverse().map(r => `
            <div style="flex:1;min-width:8px;background:var(--primary-hover);border-radius:3px 3px 0 0;height:${Math.max(4, (r.percent/100)*46)}px;opacity:0.85" title="${r.examTitle||''}: ${r.percent}%"></div>
          `).join("")}
        </div>
      </div>` : ""}

      <!-- Attempt history table -->
      <div style="font-size:0.82rem;font-weight:600;color:var(--text-muted);margin-bottom:0.5rem;text-transform:uppercase;letter-spacing:.05em">Attempt History</div>
      <div class="table-wrap" style="margin-bottom:1rem">
        <table class="data-table" style="font-size:0.83rem">
          <thead><tr><th>#</th><th>Exam</th><th>Score</th><th>✓</th><th>✗</th><th>Time</th><th>Date</th><th>Status</th></tr></thead>
          <tbody>
            ${attempts.map((r, i) => `<tr>
              <td style="color:var(--text-dim)">${r.attemptNumber || i + 1}</td>
              <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.examTitle || "—")}</td>
              <td><strong>${formatScore(r.score)}/${r.total}</strong> <span style="color:var(--text-dim)">(${r.percent}%)</span></td>
              <td style="color:#22c55e;font-weight:700">${r.correctCount ?? "—"}</td>
              <td style="color:#ef4444;font-weight:700">${r.wrongCount ?? "—"}</td>
              <td style="font-family:var(--mono);font-size:0.78rem">${formatDuration(r.timeTakenSeconds || 0)}</td>
              <td style="font-size:0.78rem;color:var(--text-dim)">${formatDateTime(r.submittedAt)}</td>
              <td>${r.passed === true ? '<span class="badge badge-open" style="font-size:0.7rem">Pass</span>' : r.passed === false ? '<span class="badge badge-locked" style="font-size:0.7rem">Fail</span>' : "—"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>

      <button class="btn btn-primary btn-sm" id="modal-pdf-btn" style="width:100%"><i class="fa-solid fa-file-pdf"></i> Download PDF Report</button>
    </div>
  `, true);

  backdrop.querySelector("#modal-pdf-btn")?.addEventListener("click", () => {
    exportStudentPdf(student, rank, attempts, { totalCorrect, totalWrong, totalSkipped, totalTimeSec, avgScore, distinctExams, daysSince });
  });
}

// ============================================================
// PDF EXPORT — Student
// ============================================================
async function loadLogoDataUrl() {
  try {
    const res = await fetch("assets/logo.png");
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

async function exportStudentPdf(student, rank, attempts, stats) {
  if (!window.jspdf) { toast("PDF library did not load", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const logoDataUrl = await loadLogoDataUrl();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentW = W - margin * 2;

  function addWatermark() {
    if (!logoDataUrl) return;
    doc.saveGraphicsState();
    doc.setGState(doc.GState({ opacity: 0.06 }));
    const wSize = 80;
    doc.addImage(logoDataUrl, "PNG", (W - wSize) / 2, (H - wSize) / 2, wSize, wSize);
    doc.restoreGraphicsState();
  }

  function addHeader(pageNum, totalPages) {
    // Logo small top-left
    if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", margin, 8, 10, 10);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text("Tech Verse Exam", margin + 13, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text("Student Performance Report", margin + 13, 19);
    // Page number
    doc.text(`Page ${pageNum} of ${totalPages}`, W - margin, 15, { align: "right" });
    // Header line
    doc.setDrawColor(59, 130, 246);
    doc.setLineWidth(0.5);
    doc.line(margin, 22, W - margin, 22);
  }

  function addFooter() {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated ${new Date().toLocaleString()} · Tech Verse Exam Platform`, margin, H - 8);
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, H - 11, W - margin, H - 11);
  }

  // Page 1
  addWatermark();
  addHeader(1, 2);

  let y = 30;

  // Student name block
  doc.setFillColor(59, 130, 246);
  doc.roundedRect(margin, y, contentW, 22, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  const initials = student.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  doc.text(`#${rank}  ${student.name}`, margin + 4, y + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(210, 225, 255);
  doc.text(student.email, margin + 4, y + 17);
  y += 28;

  // KPI grid (3 cols)
  const kpis = [
    ["Exams Given", attempts.length],
    ["Unique Exams", stats.distinctExams],
    ["Best Score", student.bestPercent + "%"],
    ["Avg Score", stats.avgScore + "%"],
    ["Total Correct", stats.totalCorrect],
    ["Total Wrong", stats.totalWrong],
    ["Skipped", stats.totalSkipped],
    ["Total Time", formatDuration(stats.totalTimeSec)],
    ["Journey", stats.daysSince + " days"],
  ];
  const colW = contentW / 3;
  const cellH = 16;
  kpis.forEach((kpi, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = margin + col * colW;
    const cy = y + row * cellH;
    doc.setFillColor(col % 2 === 0 ? 248 : 245, 250, 255);
    doc.rect(x, cy, colW, cellH, "F");
    doc.setDrawColor(220, 230, 245);
    doc.setLineWidth(0.2);
    doc.rect(x, cy, colW, cellH, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(30, 30, 100);
    doc.text(String(kpi[1]), x + colW / 2, cy + 9, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 130);
    doc.text(kpi[0], x + colW / 2, cy + 13.5, { align: "center" });
  });
  y += Math.ceil(kpis.length / 3) * cellH + 8;

  // Score trend bar mini-chart
  if (attempts.length >= 2) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 80);
    doc.text("Score Trend (oldest → latest)", margin, y + 4);
    y += 7;
    const chartH = 18;
    const barW = Math.min(8, contentW / attempts.length - 1);
    const sorted = [...attempts].reverse();
    sorted.forEach((r, i) => {
      const bh = Math.max(1, (r.percent / 100) * chartH);
      const bx = margin + i * (barW + 1);
      const by = y + chartH - bh;
      const pct = r.percent || 0;
      const [rr, gg, bb] = pct >= 70 ? [34, 197, 94] : pct >= 40 ? [234, 179, 8] : [239, 68, 68];
      doc.setFillColor(rr, gg, bb);
      doc.roundedRect(bx, by, barW, bh, 0.8, 0.8, "F");
    });
    y += chartH + 8;
  }

  addFooter();

  // Page 2 — Attempt history table
  doc.addPage();
  addWatermark();
  addHeader(2, 2);
  addFooter();

  y = 30;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text("Attempt History", margin, y);
  y += 6;

  if (doc.autoTable) {
    doc.autoTable({
      startY: y,
      margin: { left: margin, right: margin },
      head: [["#", "Exam", "Score", "Correct", "Wrong", "Time", "Date", "Status"]],
      body: attempts.map((r, i) => [
        r.attemptNumber || i + 1,
        (r.examTitle || "—").slice(0, 30),
        `${formatScore(r.score)}/${r.total} (${r.percent}%)`,
        r.correctCount ?? "—",
        r.wrongCount ?? "—",
        formatDuration(r.timeTakenSeconds || 0),
        r.submittedAt?.toDate ? r.submittedAt.toDate().toLocaleDateString() : "—",
        r.passed === true ? "Pass" : r.passed === false ? "Fail" : "—",
      ]),
      styles: { fontSize: 8, cellPadding: 2.5, halign: "center" },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        1: { halign: "left", cellWidth: 45 },
        2: { halign: "center" },
      },
      alternateRowStyles: { fillColor: [245, 248, 255] },
    });
  }

  const safeName = student.name.replace(/[^\w\u0980-\u09FF -]/g, "").trim() || "student";
  doc.save(`${safeName}-report.pdf`);
  toast("Downloading PDF", "success");
}

// ============================================================
// PDF EXPORT — Full Leaderboard
// ============================================================
async function exportFullLeaderboardPdf() {
  if (!lbAllRows.length) { toast("No data available", "info"); return; }
  if (!window.jspdf) { toast("PDF library did not load", "error"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const logoDataUrl = await loadLogoDataUrl();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 12;

  function addWatermarkL() {
    if (!logoDataUrl) return;
    doc.saveGraphicsState();
    doc.setGState(doc.GState({ opacity: 0.05 }));
    const wSize = 90;
    doc.addImage(logoDataUrl, "PNG", (W - wSize) / 2, (H - wSize) / 2, wSize, wSize);
    doc.restoreGraphicsState();
  }

  const examId = document.getElementById("admin-lb-exam")?.value || "";
  const examTitle = examId ? (exams.find((e) => e.id === examId)?.title || "All Exams") : "All Exams";
  const totalStudents = lbAllRows.length;
  const avgBest = totalStudents ? Math.round(lbAllRows.reduce((acc, s) => acc + s.bestPercent, 0) / totalStudents) : 0;

  // Header
  addWatermarkL();
  if (logoDataUrl) doc.addImage(logoDataUrl, "PNG", margin, 6, 12, 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30, 30, 30);
  doc.text("Tech Verse Exam · Leaderboard", margin + 15, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 120);
  doc.text(`Exam: ${examTitle}  ·  Students: ${totalStudents}  ·  Avg Best Score: ${avgBest}%  ·  Generated: ${new Date().toLocaleString()}`, margin + 15, 18.5);
  doc.setDrawColor(59, 130, 246);
  doc.setLineWidth(0.5);
  doc.line(margin, 22, W - margin, 22);

  if (doc.autoTable) {
    doc.autoTable({
      startY: 26,
      margin: { left: margin, right: margin },
      head: [["Rank", "Student", "Email", "Best %", "Attempts", "Correct", "Wrong", "Skipped", "Total Time", "Journey"]],
      body: lbAllRows.map((s, i) => {
        const totalCorrect = s.attempts.reduce((acc, r) => acc + (r.correctCount || 0), 0);
        const totalWrong = s.attempts.reduce((acc, r) => acc + (r.wrongCount || 0), 0);
        const totalSkipped = s.attempts.reduce((acc, r) => acc + (r.unansweredCount || 0), 0);
        const totalTimeSec = s.attempts.reduce((acc, r) => acc + (r.timeTakenSeconds || 0), 0);
        const daysSince = s.firstAt ? Math.floor((Date.now() / 1000 - s.firstAt) / 86400) : 0;
        return [i + 1, s.name, s.email, s.bestPercent + "%", s.attempts.length, totalCorrect, totalWrong, totalSkipped, formatDuration(totalTimeSec), daysSince + "d"];
      }),
      styles: { fontSize: 8, cellPadding: 2.5, halign: "center" },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold", fontSize: 8.5 },
      columnStyles: {
        1: { halign: "left", cellWidth: 40 },
        2: { halign: "left", cellWidth: 55 },
      },
      alternateRowStyles: { fillColor: [245, 248, 255] },
      didDrawPage: (data) => {
        if (data.pageNumber > 1) addWatermarkL();
        // Footer
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(`Page ${data.pageNumber} · Tech Verse Exam Platform`, W / 2, H - 6, { align: "center" });
      },
    });
  }

  doc.save(`leaderboard-${examTitle.replace(/[^\w -]/g, "").trim()}.pdf`);
  toast("Downloading Leaderboard PDF", "success");
}
