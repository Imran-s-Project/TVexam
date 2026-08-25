// ==========================================================================
// Tech Verse Exam — Admin panel (exams, questions, results only)
// Course management stays on the Course site admin.
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
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
  COURSE_SITE_URL,
  debounce,
  downloadFile,
  toCsv,
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  parseBulkQuestions,
  BULK_IMPORT_SAMPLE,
  openModal,
} from "./utils.js";
import { initTheme } from "./theme.js";

let courses = [];
let exams = [];
let allResults = [];

initTheme();
document.getElementById("course-admin-link").href = COURSE_SITE_URL.replace(/\/?$/, "/") + "admin.html";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "index.html#/login";
    return;
  }
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
  document.getElementById("admin-gate").classList.add("hidden");
  document.getElementById("admin-shell").classList.remove("hidden");
  bindSidebar();
  bindToolbars();
  await refreshCourses();
  await Promise.all([loadOverview(), loadExamsTable(), loadResultsTable(), loadAdminLeaderboard()]);
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
}

async function refreshCourses() {
  const snap = await getDocs(collection(db, "courses"));
  courses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

/* ---------- Overview ---------- */
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
      { n: exams.length, l: "Exams" },
      { n: exams.filter((e) => e.status !== "draft").length, l: "Published" },
      { n: results.length, l: "Total Attempts" },
      { n: new Set(results.map((r) => r.uid)).size, l: "Students who took exams" },
      {
        n: results.length
          ? Math.round(results.reduce((s, r) => s + (r.percent || 0), 0) / results.length) + "%"
          : "—",
        l: "Avg Score",
      },
      { n: passRate != null ? passRate + "%" : "—", l: "Pass rate" },
    ]
      .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join("");

    if (dist) {
      const buckets = [0, 0, 0, 0, 0]; // 0-20,20-40,40-60,60-80,80-100
      results.forEach((r) => {
        const p = Math.min(99, Math.max(0, r.percent || 0));
        buckets[Math.floor(p / 20)]++;
      });
      const max = Math.max(1, ...buckets);
      const labels = ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"];
      dist.innerHTML = buckets
        .map(
          (b, i) => `
        <div class="bar-row">
          <span class="bar-label">${labels[i]}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(b / max) * 100}%"></div></div>
          <span class="bar-value">${b}</span>
        </div>`
        )
        .join("");
    }

    const top = results
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
      .slice(0, 8);
    if (!top.length) {
      recent.innerHTML = `<div class="empty-state"><p>No submissions yet</p></div>`;
    } else {
      recent.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Student</th><th>Exam</th><th>Score</th><th>Date</th></tr></thead><tbody>
        ${top
          .map(
            (r) => `<tr>
            <td>${escapeHtml(r.studentName || r.studentEmail || "—")}</td>
            <td>${escapeHtml(r.examTitle || "—")}</td>
            <td>${formatScore(r.score)}/${r.total} (${r.percent}%)</td>
            <td>${formatDateTime(r.submittedAt)}</td>
          </tr>`
          )
          .join("")}
      </tbody></table></div>`;
    }
  } catch (e) {
    console.error(e);
    grid.innerHTML = `<div class="empty-state"><p>Could not load — check results read rule includes isAdmin()</p></div>`;
  }
}

/* ---------- Exams table ---------- */
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
    if (q && !`${ex.title} ${ex.courseName || ""} ${ex.category || ""}`.toLowerCase().includes(q)) return false;
    if (statusFilter === "draft" && ex.status !== "draft") return false;
    if (statusFilter === "published" && ex.status === "draft") return false;
    return true;
  });
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No exams found</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map(
      (ex) => `<tr>
      <td><strong>${escapeHtml(ex.title)}</strong>${ex.category ? `<div class="muted" style="font-size:0.75rem">${escapeHtml(ex.category)}</div>` : ""}</td>
      <td>${escapeHtml(ex.courseName || "—")}</td>
      <td>${ex.questionCount || 0}</td>
      <td>${ex.duration ? ex.duration + " min" : "—"}</td>
      <td>${examStatusBadge(ex)}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${ex.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-dup="${ex.id}" title="Duplicate"><i class="fa-regular fa-copy"></i></button>
        <button class="icon-btn" data-export="${ex.id}" title="Export questions (JSON)"><i class="fa-solid fa-file-export"></i></button>
        <button class="icon-btn" data-del="${ex.id}" title="Delete" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`
    )
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
    return {
      text: q.text,
      options: q.options || [],
      correctIndex: q.correctIndex ?? 0,
      explanation: q.explanation || "",
      marks: q.marks || 1,
    };
  });
  downloadFile(
    `${(ex.title || "exam").replace(/[^\w\u0980-\u09FF -]/g, "").trim() || "exam"}-questions.json`,
    JSON.stringify(questions, null, 2)
  );
  toast(`${questions.length}টি প্রশ্ন এক্সপোর্ট হলো`, "success");
}

async function duplicateExam(examId) {
  const ex = exams.find((e) => e.id === examId);
  if (!ex) return;
  if (!confirm(`"${ex.title}" এর একটি কপি তৈরি করবেন?`)) return;
  try {
    const { id, ...rest } = ex;
    const newRef = await addDoc(collection(db, "exams"), {
      ...rest,
      title: (ex.title || "Exam") + " (Copy)",
      status: "draft",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const qSnap = await getDocs(query(collection(db, "exams", examId, "questions"), orderBy("order")));
    await Promise.all(
      qSnap.docs.map((d) => addDoc(collection(db, "exams", newRef.id, "questions"), d.data()))
    );
    toast("এক্সাম কপি হয়েছে (Draft হিসেবে)", "success");
    await loadExamsTable();
    await loadOverview();
  } catch (e) {
    console.error(e);
    toast("কপি করা যায়নি", "error");
  }
}

function openModalLocal(html, large) {
  return openModal(html, large);
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

  const backdrop = openModalLocal(
    `
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
            ${courses
              .map(
                (c) =>
                  `<option value="${c.id}" ${ex?.courseId === c.id ? "selected" : ""}>${escapeHtml(c.title)}</option>`
              )
              .join("")}
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
        <div class="field">
          <label><input type="checkbox" id="em-shuffle" ${ex?.shuffle !== false ? "checked" : ""} /> Shuffle questions & options</label>
        </div>
        <div class="field">
          <label><input type="checkbox" id="em-showall" ${ex?.showAll ? "checked" : ""} /> Show all questions on one page</label>
        </div>
      </div>
      <div class="exam-tab-panel" id="panel-questions">
        <div id="q-drafts"></div>
        <button type="button" class="btn btn-outline btn-sm" id="add-q-btn"><i class="fa-solid fa-plus"></i> Add question</button>
      </div>
      <div class="exam-tab-panel" id="panel-bulk">
        <div class="bulk-import-hint">
          <i class="fa-solid fa-bolt"></i> একসাথে অনেক প্রশ্ন যোগ করুন — <code>Q/A/B/C/D/Answer/Explanation</code> প্লেইন টেক্সট, CSV, অথবা JSON ফরম্যাটে পেস্ট করুন। যোগ হলে নিচে বিদ্যমান প্রশ্নের তালিকায় যুক্ত হবে — আলাদা করে সেভ করতে ভুলবেন না।
        </div>
        <textarea id="bulk-import-text" rows="12" placeholder="এখানে প্রশ্ন পেস্ট করুন…"></textarea>
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
  `,
    true
  );

  const draftsEl = backdrop.querySelector("#q-drafts");
  function renderDrafts() {
    draftsEl.innerHTML = questionDrafts
      .map(
        (q, i) => `
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
          ${q.options
            .map(
              (opt, oi) => `
          <div class="field" style="display:flex;gap:0.5rem;align-items:center">
            <input type="radio" name="correct-${i}" value="${oi}" ${q.correctIndex === oi ? "checked" : ""} title="Correct" />
            <input type="text" data-f="opt" data-oi="${oi}" value="${escapeHtml(opt || "")}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" />
            ${q.options.length > 2 ? `<button type="button" class="icon-btn" data-rm-opt="${oi}" title="Remove option" style="width:32px;height:32px"><i class="fa-solid fa-xmark"></i></button>` : ""}
          </div>`
            )
            .join("")}
        </div>
        ${q.options.length < 6 ? `<button type="button" class="btn btn-ghost btn-sm" data-add-opt="${i}"><i class="fa-solid fa-plus"></i> Add option</button>` : ""}
        <div class="field" style="margin-top:0.5rem">
          <label><i class="fa-solid fa-lightbulb"></i> Explanation <span class="muted" style="font-weight:400;font-size:0.8rem">(optional — shown to students after they submit)</span></label>
          <textarea data-f="explanation" rows="2" placeholder="e.g. Paris has been the capital of France since...">${escapeHtml(q.explanation || "")}</textarea>
        </div>
      </div>`
      )
      .join("");
    backdrop.querySelector("#q-count").textContent = questionDrafts.length;

    draftsEl.querySelectorAll("[data-rm-q]").forEach((b) =>
      b.addEventListener("click", () => {
        syncDraftsFromDom();
        questionDrafts.splice(Number(b.dataset.rmQ), 1);
        renderDrafts();
      })
    );
    draftsEl.querySelectorAll("[data-dup-q]").forEach((b) =>
      b.addEventListener("click", () => {
        syncDraftsFromDom();
        const i = Number(b.dataset.dupQ);
        questionDrafts.splice(i + 1, 0, { ...questionDrafts[i], options: [...questionDrafts[i].options] });
        renderDrafts();
      })
    );
    draftsEl.querySelectorAll("[data-move-up]").forEach((b) =>
      b.addEventListener("click", () => {
        syncDraftsFromDom();
        const i = Number(b.dataset.moveUp);
        if (i === 0) return;
        [questionDrafts[i - 1], questionDrafts[i]] = [questionDrafts[i], questionDrafts[i - 1]];
        renderDrafts();
      })
    );
    draftsEl.querySelectorAll("[data-move-down]").forEach((b) =>
      b.addEventListener("click", () => {
        syncDraftsFromDom();
        const i = Number(b.dataset.moveDown);
        if (i === questionDrafts.length - 1) return;
        [questionDrafts[i + 1], questionDrafts[i]] = [questionDrafts[i], questionDrafts[i + 1]];
        renderDrafts();
      })
    );
    draftsEl.querySelectorAll("[data-add-opt]").forEach((b) =>
      b.addEventListener("click", () => {
        syncDraftsFromDom();
        const i = Number(b.dataset.addOpt);
        if (questionDrafts[i].options.length < 6) questionDrafts[i].options.push("");
        renderDrafts();
      })
    );
    draftsEl.querySelectorAll("[data-rm-opt]").forEach((b) =>
      b.addEventListener("click", (e) => {
        syncDraftsFromDom();
        const qi = Number(b.closest(".q-draft").dataset.qi);
        const oi = Number(b.dataset.rmOpt);
        questionDrafts[qi].options.splice(oi, 1);
        if (questionDrafts[qi].correctIndex >= questionDrafts[qi].options.length) questionDrafts[qi].correctIndex = 0;
        renderDrafts();
      })
    );
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

  backdrop.querySelector("#add-q-btn").addEventListener("click", () => {
    syncDraftsFromDom();
    questionDrafts.push({ text: "", options: ["", "", "", ""], correctIndex: 0, explanation: "", marks: 1 });
    renderDrafts();
  });

  backdrop.querySelectorAll(".exam-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "questions") syncDraftsFromDom();
      backdrop.querySelectorAll(".exam-tab-btn").forEach((b) => b.classList.remove("active"));
      backdrop.querySelectorAll(".exam-tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      backdrop.querySelector(`#panel-${btn.dataset.tab}`).classList.add("active");
    });
  });

  /* ---- Bulk import wiring ---- */
  const bulkTextarea = backdrop.querySelector("#bulk-import-text");
  const bulkReport = backdrop.querySelector("#bulk-import-report");
  backdrop.querySelector("#bulk-sample-btn").addEventListener("click", () => {
    bulkTextarea.value = BULK_IMPORT_SAMPLE;
  });
  backdrop.querySelector("#bulk-import-btn").addEventListener("click", () => {
    const { questions: parsed, errors } = parseBulkQuestions(bulkTextarea.value);
    if (parsed.length) {
      syncDraftsFromDom();
      parsed.forEach((q) => questionDrafts.push({ ...q, options: q.options.length ? q.options : ["", "", "", ""] }));
      renderDrafts();
      backdrop.querySelectorAll(".exam-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "questions"));
      backdrop.querySelectorAll(".exam-tab-panel").forEach((p) => p.classList.toggle("active", p.id === "panel-questions"));
    }
    bulkReport.innerHTML = `${parsed.length}টি প্রশ্ন যোগ হয়েছে।${
      errors.length ? ` <span style="color:var(--danger)">${errors.length}টি সমস্যা: ${errors.slice(0, 5).map(escapeHtml).join("; ")}</span>` : ""
    }`;
    if (parsed.length) toast(`${parsed.length}টি প্রশ্ন যোগ হয়েছে`, "success");
  });
  const fileInput = backdrop.querySelector("#bulk-import-json-file");
  backdrop.querySelector("#bulk-import-json-file-btn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    bulkTextarea.value = text;
    fileInput.value = "";
    toast("ফাইল লোড হয়েছে — এখন Parse & Add চাপুন", "info");
  });

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

    if (!payload.title) {
      toast("Exam title দিন", "error");
      btn.disabled = false;
      btn.textContent = ex ? "Save Changes" : "Create Exam";
      return;
    }
    if (!validQs.length) {
      toast("অন্তত ১টি প্রশ্ন যোগ করুন (কমপক্ষে ২টি অপশনসহ)", "error");
      btn.disabled = false;
      btn.textContent = ex ? "Save Changes" : "Create Exam";
      return;
    }

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
        examRef = await addDoc(collection(db, "exams"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      await Promise.all(
        validQs.map((q, i) =>
          addDoc(collection(db, "exams", examRef.id, "questions"), {
            text: q.text.trim(),
            options: q.options.map((o) => o.trim()).filter((o) => o !== ""),
            correctIndex: Math.min(q.correctIndex, q.options.filter((o) => o.trim()).length - 1),
            explanation: (q.explanation || "").trim(),
            marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
            order: i,
          })
        )
      );
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
  } catch {
    toast("Could not delete", "error");
  }
}

/* ---------- Results table ---------- */
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
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No results</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.studentName || r.studentEmail || "—")}</td>
      <td>${escapeHtml(r.examTitle || "—")}</td>
      <td>${formatScore(r.score)}/${r.total} (${r.percent}%)</td>
      <td>#${r.attemptNumber || 1}</td>
      <td>${formatDateTime(r.submittedAt)}</td>
      <td><button class="icon-btn" data-del-result="${r.id}" title="Delete result" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`
    )
    .join("");
  tbody.querySelectorAll("[data-del-result]").forEach((b) =>
    b.addEventListener("click", () => deleteResult(b.dataset.delResult))
  );
}

async function deleteResult(id) {
  if (!confirm("এই রেজাল্টটি মুছে ফেলতে চান? (leaderboard থেকেও সরে যাবে)")) return;
  try {
    await deleteDoc(doc(db, "results", id));
    toast("রেজাল্ট মুছে ফেলা হয়েছে", "success");
    await loadResultsTable();
    await loadOverview();
    await loadAdminLeaderboard();
  } catch (e) {
    console.error(e);
    toast("মুছে ফেলা যায়নি", "error");
  }
}

function exportResultsCsv() {
  if (!allResults.length) {
    toast("এক্সপোর্ট করার মতো কোনো রেজাল্ট নেই", "info");
    return;
  }
  const headers = ["Student", "Email", "Exam", "Score", "Total", "Percent", "Attempt", "Correct", "Wrong", "Unanswered", "TimeTakenSeconds", "SubmittedAt"];
  const rows = allResults.map((r) => [
    r.studentName || "",
    r.studentEmail || "",
    r.examTitle || "",
    r.score,
    r.total,
    r.percent,
    r.attemptNumber || 1,
    r.correctCount ?? "",
    r.wrongCount ?? "",
    r.unansweredCount ?? "",
    r.timeTakenSeconds ?? "",
    r.submittedAt?.toDate ? r.submittedAt.toDate().toISOString() : "",
  ]);
  downloadFile("exam-results.csv", toCsv(rows, headers), "text/csv");
  toast("CSV ডাউনলোড হচ্ছে", "success");
}

/* ---------- Leaderboard ---------- */
async function loadAdminLeaderboard() {
  const select = document.getElementById("admin-lb-exam");
  const list = document.getElementById("admin-lb-list");
  const snap = await getDocs(collection(db, "exams"));
  exams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  select.innerHTML =
    `<option value="">All</option>` + exams.map((e) => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join("");

  async function render() {
    list.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;
    try {
      const rSnap = await getDocs(collection(db, "results"));
      let rows = rSnap.docs.map((d) => d.data());
      if (select.value) rows = rows.filter((r) => r.examId === select.value);
      const best = new Map();
      rows.forEach((r) => {
        const key = select.value ? r.uid : `${r.uid}_${r.examId}`;
        if (!best.has(key) || (r.percent || 0) > (best.get(key).percent || 0)) best.set(key, r);
      });
      const sorted = [...best.values()].sort((a, b) => (b.percent || 0) - (a.percent || 0)).slice(0, 40);
      if (!sorted.length) {
        list.innerHTML = `<div class="empty-state"><p>No data</p></div>`;
        return;
      }
      list.innerHTML = sorted
        .map(
          (r, i) => `
        <div class="lb-row">
          <div class="lb-rank ${i < 3 ? ["gold", "silver", "bronze"][i] : ""}">${i + 1}</div>
          <div class="lb-name">${escapeHtml(r.studentName || r.studentEmail || "—")}
            ${!select.value ? `<div class="muted" style="font-size:0.78rem">${escapeHtml(r.examTitle || "")}</div>` : ""}
          </div>
          <div class="lb-score">${r.percent}%</div>
        </div>`
        )
        .join("");
    } catch {
      list.innerHTML = `<div class="empty-state"><p>Could not load</p></div>`;
    }
  }
  select.onchange = render;
  await render();
}
