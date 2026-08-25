// ==========================================================================
// admin.js — TV Exam Admin Panel
// Sections: Overview · Exams · Questions · Results · Leaderboard · Users · Settings
// ==========================================================================
import { auth, examDb, mainDb } from "./firebase-config.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, getDoc, setDoc, query, orderBy, where,
  serverTimestamp, Timestamp, limit, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  requireAdmin, toast, escapeHtml, formatDate, formatDateTime,
  formatScore, formatDuration, getExamAvailability, openModal,
  closeModal, confirmAction, initNav,
} from "./utils.js";

initNav("admin");

let me       = null;
let allExams = [];
let allUsers = {};

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
  me = await requireAdmin();
  if (!me) return;
  document.getElementById("admin-gate")?.classList.add("hidden");
  document.getElementById("admin-shell")?.classList.remove("hidden");
  document.getElementById("admin-user-name").textContent =
    me.profile?.displayName || me.user.displayName || "Admin";

  _bindSidebar();
  await _refreshExams();
  await _refreshUsers();
  _loadOverview();
}

// ── Sidebar switching ──────────────────────────────────────────────────────
function _bindSidebar() {
  const sidebar  = document.getElementById("admin-sidebar");
  const backdrop = document.getElementById("admin-sidebar-backdrop");
  const mobileBar= document.getElementById("admin-mobile-section-name");

  const close = () => {
    sidebar?.classList.remove("open");
    backdrop?.classList.remove("open");
  };
  document.getElementById("admin-drawer-open")?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("open");
  });
  backdrop?.addEventListener("click", close);

  document.querySelectorAll(".admin-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav-item").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach(s => s.classList.remove("active"));
      btn.classList.add("active");
      const secId = `section-${btn.dataset.section}`;
      document.getElementById(secId)?.classList.add("active");
      if (mobileBar) mobileBar.textContent = btn.dataset.label || btn.textContent.trim();
      close();

      // Lazy-load sections
      const sec = btn.dataset.section;
      if (sec === "exams")       _loadExamsTable();
      if (sec === "results")     _loadResultsTable();
      if (sec === "leaderboard") _loadLeaderboard();
      if (sec === "users")       _loadUsersTable();
      if (sec === "settings")    _loadSettings();
    });
  });
}

// ── Data refresh helpers ───────────────────────────────────────────────────
async function _refreshExams() {
  const snap = await getDocs(collection(examDb, "exams"));
  allExams = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

async function _refreshUsers() {
  const snap = await getDocs(collection(mainDb, "users"));
  snap.docs.forEach(d => { allUsers[d.id] = d.data(); });
}

// ── Overview ───────────────────────────────────────────────────────────────
async function _loadOverview() {
  const grid = document.getElementById("overview-stat-grid");
  try {
    const [resultsSnap, attemptsSnap] = await Promise.all([
      getCountFromServer(collection(examDb, "results")),
      getCountFromServer(collection(examDb, "attempts")),
    ]);
    const stats = [
      { v: allExams.length,          l: "Total Exams",    icon: "fa-file-pen",    color: "var(--accent-blue-soft)" },
      { v: Object.keys(allUsers).length, l: "Users",      icon: "fa-users",       color: "var(--accent-cyan-soft)" },
      { v: resultsSnap.data().count, l: "Unique Results", icon: "fa-chart-bar",   color: "var(--accent-green-soft)" },
      { v: attemptsSnap.data().count,l: "Total Attempts", icon: "fa-rotate",      color: "var(--accent-amber-soft)" },
    ];
    grid.innerHTML = stats.map(s => `
      <div class="stat-card card">
        <div class="stat-label"><i class="fa-solid ${s.icon}" style="color:${s.color}"></i> ${s.l}</div>
        <div class="stat-value">${s.v}</div>
      </div>`).join("");
  } catch {
    grid.innerHTML = `<div class="empty-state"><p>Could not load stats</p></div>`;
  }

  // Recent results
  try {
    const snap = await getDocs(query(collection(examDb, "attempts"), orderBy("submittedAt", "desc"), limit(10)));
    const tbody = document.querySelector("#recent-results-table tbody");
    if (!tbody) return;
    if (snap.empty) { tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--text-muted);padding:20px">No attempts yet</td></tr>`; return; }
    tbody.innerHTML = snap.docs.map(d => {
      const r = d.data();
      const u = allUsers[r.uid] || {};
      return `<tr>
        <td>${escapeHtml(u.displayName || u.email || r.uid.slice(0,8))}</td>
        <td>${escapeHtml(r.examTitle || "—")}</td>
        <td><b>${r.percent}%</b> (${formatScore(r.score)}/${r.total})</td>
        <td>${r.percent >= (r.passMark || 60)
          ? `<span class="badge badge-green">Passed</span>`
          : `<span class="badge badge-red">Failed</span>`}</td>
        <td>${formatDate(r.submittedAt)}</td>
      </tr>`;
    }).join("");
  } catch {}
}

// ── Exams table ────────────────────────────────────────────────────────────
function _loadExamsTable() {
  const tbody = document.querySelector("#exams-table tbody");
  if (!tbody) return;
  if (!allExams.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--text-muted);padding:20px">No exams yet — add one!</td></tr>`;
    return;
  }
  tbody.innerHTML = allExams.map(ex => {
    const { state } = getExamAvailability(ex);
    const stateBadge = {
      open: `<span class="badge badge-green">Open</span>`,
      upcoming: `<span class="badge badge-amber">Upcoming</span>`,
      closed: `<span class="badge badge-red">Closed</span>`,
    }[state] || "";
    return `<tr>
      <td><b>${escapeHtml(ex.title)}</b></td>
      <td>${escapeHtml(ex.courseName || "General")}</td>
      <td>${ex.questionCount || 0}</td>
      <td>${ex.duration || 10} min</td>
      <td>${stateBadge}</td>
      <td>
        <div class="row-actions">
          <button class="action-btn edit" title="Edit" onclick="window._editExam('${ex.id}')"><i class="fa-solid fa-pen"></i></button>
          <button class="action-btn edit" title="Questions" onclick="window._manageQuestions('${ex.id}')"><i class="fa-solid fa-list-check"></i></button>
          <button class="action-btn delete" title="Delete" onclick="window._deleteExam('${ex.id}')"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── Add / Edit Exam ────────────────────────────────────────────────────────
function _openExamModal(exam = null) {
  const isEdit = !!exam;
  const modal  = document.getElementById("exam-modal");
  const title  = document.getElementById("exam-modal-title");
  title.textContent = isEdit ? "Edit Exam" : "Add New Exam";

  // Populate fields
  document.getElementById("ef-title").value       = exam?.title || "";
  document.getElementById("ef-desc").value        = exam?.description || "";
  document.getElementById("ef-course-id").value   = exam?.courseId || "";
  document.getElementById("ef-course-name").value = exam?.courseName || "";
  document.getElementById("ef-duration").value    = exam?.duration || 10;
  document.getElementById("ef-pass-mark").value   = exam?.passMark || 60;
  document.getElementById("ef-max-att").value     = exam?.maxAttempts || 0;
  document.getElementById("ef-neg-mark").value    = exam?.negativeMarking || 0;
  document.getElementById("ef-layout").value      = exam?.layout || "one";
  document.getElementById("ef-shuffle").checked   = exam?.shuffle !== false;

  // Dates
  const toLocal = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  document.getElementById("ef-publish-at").value  = toLocal(exam?.publishAt);
  document.getElementById("ef-closes-at").value   = toLocal(exam?.closesAt);

  openModal("exam-modal");

  const form = document.getElementById("exam-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById("exam-save-btn");
    btn.disabled = true; btn.textContent = "Saving…";

    const toTs = (val) => val ? Timestamp.fromDate(new Date(val)) : null;
    const data = {
      title:          document.getElementById("ef-title").value.trim(),
      description:    document.getElementById("ef-desc").value.trim(),
      courseId:       document.getElementById("ef-course-id").value.trim(),
      courseName:     document.getElementById("ef-course-name").value.trim(),
      duration:       Number(document.getElementById("ef-duration").value) || 10,
      passMark:       Number(document.getElementById("ef-pass-mark").value) || 60,
      maxAttempts:    Number(document.getElementById("ef-max-att").value) || 0,
      negativeMarking:Number(document.getElementById("ef-neg-mark").value) || 0,
      layout:         document.getElementById("ef-layout").value,
      shuffle:        document.getElementById("ef-shuffle").checked,
      publishAt:      toTs(document.getElementById("ef-publish-at").value),
      closesAt:       toTs(document.getElementById("ef-closes-at").value),
      updatedAt:      serverTimestamp(),
    };
    if (!data.title) { toast("Title দাও", "error"); btn.disabled = false; btn.textContent = "Save"; return; }

    try {
      if (isEdit) {
        await updateDoc(doc(examDb, "exams", exam.id), data);
        toast("Exam updated!", "success");
      } else {
        data.createdAt = serverTimestamp();
        data.questionCount = 0;
        await addDoc(collection(examDb, "exams"), data);
        toast("Exam added!", "success");
      }
      closeModal("exam-modal");
      await _refreshExams();
      _loadExamsTable();
    } catch (err) {
      toast("Save failed: " + err.message, "error");
    } finally {
      btn.disabled = false; btn.textContent = "Save";
    }
  };
}

window._editExam = async (id) => {
  const snap = await getDoc(doc(examDb, "exams", id));
  if (snap.exists()) _openExamModal({ id, ...snap.data() });
};

window._deleteExam = async (id) => {
  const ok = await confirmAction("এই exam এবং সকল প্রশ্ন delete হবে। নিশ্চিত?");
  if (!ok) return;
  try {
    // Delete questions subcollection
    const qSnap = await getDocs(collection(examDb, "exams", id, "questions"));
    await Promise.all(qSnap.docs.map(d => deleteDoc(d.ref)));
    await deleteDoc(doc(examDb, "exams", id));
    toast("Exam deleted", "success");
    await _refreshExams();
    _loadExamsTable();
  } catch { toast("Delete failed", "error"); }
};

// ── Questions manager ──────────────────────────────────────────────────────
window._manageQuestions = async (examId) => {
  const examSnap = await getDoc(doc(examDb, "exams", examId));
  if (!examSnap.exists()) return;
  const exam = { id: examId, ...examSnap.data() };

  const modal = document.getElementById("questions-modal");
  document.getElementById("qm-exam-title").textContent = exam.title;
  openModal("questions-modal");
  await _renderQuestions(examId, exam);
};

async function _renderQuestions(examId, exam) {
  const container = document.getElementById("question-builder");
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;

  const snap = await getDocs(query(collection(examDb, "exams", examId, "questions"), orderBy("order", "asc")));
  const questions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  container.innerHTML = questions.map((q, i) => _questionHtml(q, i, questions.length)).join("") +
    `<button class="btn btn-outline" id="add-q-btn" style="margin-top:8px">
       <i class="fa-solid fa-plus"></i> Add Question
     </button>`;

  // Bind remove buttons
  container.querySelectorAll(".remove-q-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ok = await confirmAction("এই প্রশ্নটি delete করবো?");
      if (!ok) return;
      try {
        await deleteDoc(doc(examDb, "exams", examId, "questions", btn.dataset.qid));
        await updateDoc(doc(examDb, "exams", examId), { questionCount: Math.max(0, questions.length - 1) });
        toast("Deleted", "success");
        await _renderQuestions(examId, exam);
      } catch { toast("Delete failed", "error"); }
    });
  });

  // Add question
  document.getElementById("add-q-btn")?.addEventListener("click", () => {
    _openQuestionForm(examId, null, questions.length, async () => await _renderQuestions(examId, exam));
  });

  // Edit question
  container.querySelectorAll(".edit-q-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const q = questions.find(q => q.id === btn.dataset.qid);
      if (q) _openQuestionForm(examId, q, q.order, async () => await _renderQuestions(examId, exam));
    });
  });
}

function _questionHtml(q, i, total) {
  return `
    <div class="question-item">
      <div class="question-item-header">
        <span class="question-num">Q${i + 1} / ${total}</span>
        <div class="row-actions">
          <button class="action-btn edit edit-q-btn" data-qid="${q.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="action-btn delete remove-q-btn" data-qid="${q.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
      <div style="font-weight:600;font-size:.95rem;margin-bottom:10px">${escapeHtml(q.text)}</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${q.options?.map((opt, oi) => `
          <div style="display:flex;align-items:center;gap:8px;font-size:.85rem;color:${oi === q.correctIndex ? "var(--accent-green-soft)" : "var(--text-muted)"}">
            <span style="width:20px;height:20px;border-radius:50%;background:${oi === q.correctIndex ? "var(--accent-green)" : "var(--bg-elevated-2)"};display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#fff;flex-shrink:0">${String.fromCharCode(65+oi)}</span>
            ${escapeHtml(opt)}
            ${oi === q.correctIndex ? `<i class="fa-solid fa-check" style="margin-left:4px"></i>` : ""}
          </div>`).join("") || ""}
      </div>
      ${q.explanation ? `<div style="margin-top:10px;font-size:.82rem;color:var(--text-muted);border-left:2px solid var(--border-accent);padding-left:10px">${escapeHtml(q.explanation)}</div>` : ""}
    </div>`;
}

function _openQuestionForm(examId, q, orderIdx, onSave) {
  const modal = document.getElementById("question-form-modal");
  document.getElementById("qf-title").textContent = q ? "Edit Question" : "New Question";
  document.getElementById("qf-text").value = q?.text || "";
  document.getElementById("qf-explanation").value = q?.explanation || "";

  const optsContainer = document.getElementById("qf-options");
  const opts = q?.options || ["", "", "", ""];
  const correctIdx = q?.correctIndex ?? 0;

  function renderOpts(options, correct) {
    optsContainer.innerHTML = options.map((opt, i) => `
      <div class="option-input-row">
        <span class="option-letter-label">${String.fromCharCode(65+i)}</span>
        <input class="field option-input" type="text" placeholder="Option ${String.fromCharCode(65+i)}"
               value="${escapeHtml(opt)}" data-opt-i="${i}">
        <input type="radio" class="option-correct-radio" name="correct-opt" value="${i}"
               ${i === correct ? "checked" : ""} title="Mark as correct">
      </div>`).join("") +
      `<button type="button" class="btn btn-ghost btn-sm" id="add-option-btn" style="margin-top:4px">
         <i class="fa-solid fa-plus"></i> Add Option
       </button>`;

    document.getElementById("add-option-btn")?.addEventListener("click", () => {
      const cur = [...optsContainer.querySelectorAll("[data-opt-i]")].map(el => el.value);
      const curCorrect = Number(optsContainer.querySelector("[name=correct-opt]:checked")?.value ?? 0);
      if (cur.length >= 6) { toast("সর্বোচ্চ ৬টি option", "error"); return; }
      renderOpts([...cur, ""], curCorrect);
    });
  }
  renderOpts(opts, correctIdx);

  openModal("question-form-modal");

  const form = document.getElementById("question-form");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById("qf-save-btn");
    saveBtn.disabled = true; saveBtn.textContent = "Saving…";

    const text    = document.getElementById("qf-text").value.trim();
    const explain = document.getElementById("qf-explanation").value.trim();
    const options = [...optsContainer.querySelectorAll("[data-opt-i]")].map(el => el.value.trim());
    const correct = Number(optsContainer.querySelector("[name=correct-opt]:checked")?.value ?? 0);

    if (!text)                 { toast("প্রশ্ন লিখো", "error"); saveBtn.disabled = false; saveBtn.textContent = "Save"; return; }
    if (options.some(o => !o)) { toast("সব option পূরণ করো", "error"); saveBtn.disabled = false; saveBtn.textContent = "Save"; return; }

    const data = { text, options, correctIndex: correct, explanation: explain, order: q?.order ?? orderIdx, updatedAt: serverTimestamp() };

    try {
      if (q) {
        await updateDoc(doc(examDb, "exams", examId, "questions", q.id), data);
      } else {
        data.createdAt = serverTimestamp();
        await addDoc(collection(examDb, "exams", examId, "questions"), data);
        // Update question count
        const examSnap = await getDoc(doc(examDb, "exams", examId));
        const cnt = (examSnap.data()?.questionCount || 0) + 1;
        await updateDoc(doc(examDb, "exams", examId), { questionCount: cnt });
      }
      toast(q ? "Question updated!" : "Question added!", "success");
      closeModal("question-form-modal");
      await onSave();
    } catch (err) {
      toast("Save failed: " + err.message, "error");
    } finally {
      saveBtn.disabled = false; saveBtn.textContent = "Save";
    }
  };
}

// ── Results table ──────────────────────────────────────────────────────────
async function _loadResultsTable() {
  const tbody  = document.querySelector("#results-table tbody");
  const search = document.getElementById("results-search");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6"><div class="loading-screen"><span class="spinner"></span></div></td></tr>`;

  try {
    const snap = await getDocs(query(collection(examDb, "attempts"), orderBy("submittedAt", "desc"), limit(100)));
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    function render(filter = "") {
      const fl = filter.toLowerCase();
      const filtered = fl ? rows.filter(r => {
        const u = allUsers[r.uid] || {};
        return (u.displayName || u.email || "").toLowerCase().includes(fl) ||
               (r.examTitle || "").toLowerCase().includes(fl);
      }) : rows;

      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No results found</td></tr>`;
        return;
      }
      tbody.innerHTML = filtered.map(r => {
        const u = allUsers[r.uid] || {};
        return `<tr>
          <td>${escapeHtml(u.displayName || u.email || r.uid.slice(0,8))}</td>
          <td>${escapeHtml(r.examTitle || "—")}</td>
          <td><b>${r.percent}%</b></td>
          <td>${formatScore(r.score)}/${r.total}</td>
          <td>${r.percent >= (r.passMark || 60)
            ? `<span class="badge badge-green">Passed</span>`
            : `<span class="badge badge-red">Failed</span>`}</td>
          <td>${formatDate(r.submittedAt)}</td>
        </tr>`;
      }).join("");
    }
    render();
    search?.addEventListener("input", () => render(search.value));
  } catch {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>Could not load</p></div></td></tr>`;
  }
}

// ── Leaderboard ────────────────────────────────────────────────────────────
async function _loadLeaderboard() {
  const container = document.getElementById("leaderboard-list");
  const examSelect = document.getElementById("lb-exam-select");
  if (!container) return;

  // Populate exam select
  if (examSelect && !examSelect.dataset.loaded) {
    examSelect.innerHTML = `<option value="">All Exams (Best Score)</option>` +
      allExams.map(ex => `<option value="${ex.id}">${escapeHtml(ex.title)}</option>`).join("");
    examSelect.dataset.loaded = "1";
    examSelect.addEventListener("change", () => _renderLeaderboard(examSelect.value, container));
  }
  await _renderLeaderboard("", container);
}

async function _renderLeaderboard(examId, container) {
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
  try {
    let q;
    if (examId) {
      q = query(collection(examDb, "results"), where("examId", "==", examId), orderBy("percent", "desc"), limit(50));
    } else {
      q = query(collection(examDb, "results"), orderBy("percent", "desc"), limit(50));
    }
    const snap = await getDocs(q);
    if (snap.empty) { container.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-trophy"></i></div><p>No results yet</p></div>`; return; }

    const rows = snap.docs.map((d, i) => {
      const r = d.data();
      const u = allUsers[r.uid] || {};
      const name = u.displayName || u.email || r.uid.slice(0, 10);
      const photo = u.photoURL || "";
      const init = name[0]?.toUpperCase() || "?";
      const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";

      return `
        <div class="leaderboard-row">
          <div class="lb-rank ${rankClass}">${i < 3 ? ["🥇","🥈","🥉"][i] : `#${i+1}`}</div>
          <div class="lb-avatar">${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml(init)}</div>
          <div>
            <div class="lb-name">${escapeHtml(name)}</div>
            <div style="font-size:.78rem;color:var(--text-muted)">${escapeHtml(r.examTitle || "")}</div>
          </div>
          <div style="text-align:right">
            <div class="lb-score">${r.percent}%</div>
            <div style="font-size:.78rem;color:var(--text-muted)">${formatScore(r.score)}/${r.total}</div>
          </div>
        </div>`;
    }).join("");
    container.innerHTML = rows;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Could not load leaderboard</p></div>`;
  }
}

// ── Users table ────────────────────────────────────────────────────────────
function _loadUsersTable() {
  const tbody = document.querySelector("#users-table tbody");
  if (!tbody) return;
  const users = Object.entries(allUsers);
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">No users yet</td></tr>`;
    return;
  }
  tbody.innerHTML = users.map(([uid, u]) => `
    <tr>
      <td>${escapeHtml(u.displayName || "—")}</td>
      <td>${escapeHtml(u.email || "—")}</td>
      <td>${u.role === "admin"
        ? `<span class="badge badge-blue">Admin</span>`
        : `<span class="badge badge-gray">Student</span>`}</td>
      <td>${formatDate(u.createdAt)}</td>
    </tr>`).join("");
}

// ── Settings ───────────────────────────────────────────────────────────────
function _loadSettings() {
  const form = document.getElementById("settings-form");
  if (!form || form.dataset.bound) return;
  form.dataset.bound = "1";
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("settings-save-btn");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await setDoc(doc(examDb, "config", "site"), {
        siteName:    document.getElementById("s-site-name").value.trim(),
        passMark:    Number(document.getElementById("s-pass-mark").value) || 60,
        courseSiteUrl: document.getElementById("s-course-url").value.trim(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      toast("Settings saved!", "success");
    } catch { toast("Save failed", "error"); }
    finally { btn.disabled = false; btn.textContent = "Save Settings"; }
  });

  // Load current settings
  getDoc(doc(examDb, "config", "site")).then(snap => {
    if (!snap.exists()) return;
    const s = snap.data();
    document.getElementById("s-site-name").value  = s.siteName || "TV Exam";
    document.getElementById("s-pass-mark").value  = s.passMark || 60;
    document.getElementById("s-course-url").value = s.courseSiteUrl || "";
  });
}

// ── Global event bindings ──────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Add exam button
  document.getElementById("add-exam-btn")?.addEventListener("click", () => _openExamModal());

  // Modal close buttons
  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });

  init();
});
