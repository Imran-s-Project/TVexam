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
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  toast,
  escapeHtml,
  getUserProfile,
  formatDateTime,
  formatScore,
  COURSE_SITE_URL,
} from "./utils.js";
import { initTheme } from "./theme.js";

let courses = [];
let exams = [];

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
  await refreshCourses();
  await loadOverview();
  await loadExamsTable();
  await loadResultsTable();
  await loadAdminLeaderboard();
});

function bindSidebar() {
  document.querySelectorAll(".admin-nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`section-${btn.dataset.section}`)?.classList.add("active");
    });
  });
}

async function refreshCourses() {
  const snap = await getDocs(collection(db, "courses"));
  courses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadOverview() {
  const grid = document.getElementById("stat-grid");
  const recent = document.getElementById("recent-results");
  try {
    const [examsSnap, resultsSnap] = await Promise.all([
      getDocs(collection(db, "exams")),
      getDocs(collection(db, "results")),
    ]);
    exams = examsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const results = resultsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    grid.innerHTML = [
      { n: exams.length, l: "Exams" },
      { n: results.length, l: "Total Attempts" },
      { n: new Set(results.map((r) => r.uid)).size, l: "Students who took exams" },
      {
        n: results.length
          ? Math.round(results.reduce((s, r) => s + (r.percent || 0), 0) / results.length) + "%"
          : "—",
        l: "Avg Score",
      },
    ]
      .map((s) => `<div class="stat-card"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join("");

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

async function loadExamsTable() {
  const tbody = document.querySelector("#exams-table tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-screen"><span class="spinner"></span></div></td></tr>`;
  const snap = await getDocs(collection(db, "exams"));
  exams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (!exams.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No exams yet</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = exams
    .map(
      (ex) => `<tr>
      <td><strong>${escapeHtml(ex.title)}</strong></td>
      <td>${escapeHtml(ex.courseName || "—")}</td>
      <td>${ex.questionCount || 0}</td>
      <td>${ex.duration ? ex.duration + " min" : "—"}</td>
      <td><div class="row-actions">
        <button class="icon-btn" data-edit="${ex.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn" data-del="${ex.id}" title="Delete" style="color:var(--danger)"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`
    )
    .join("");
  tbody.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openExamModal(b.dataset.edit))
  );
  tbody.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteExam(b.dataset.del))
  );
}

document.getElementById("add-exam-btn")?.addEventListener("click", () => openExamModal(null));

function openModal(html, large = false) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal ${large ? "modal-lg" : ""}">${html}</div>`;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop || e.target.closest("[data-modal-close]")) backdrop.remove();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

async function openExamModal(examId) {
  const ex = examId ? exams.find((e) => e.id === examId) : null;
  let questionDrafts = [];
  if (ex) {
    const qSnap = await getDocs(query(collection(db, "exams", ex.id, "questions"), orderBy("order")));
    questionDrafts = qSnap.docs.map((d) => ({
      text: d.data().text,
      options: d.data().options || ["", "", "", ""],
      correctIndex: d.data().correctIndex ?? 0,
      explanation: d.data().explanation || "",
    }));
  }

  const backdrop = openModal(
    `
    <div class="modal-head">
      <h3>${ex ? "Edit Exam" : "Create Exam"}</h3>
      <button class="modal-close-btn" data-modal-close><i class="fa-solid fa-xmark"></i></button>
    </div>
    <form id="exam-form">
      <div class="exam-tabs">
        <button type="button" class="exam-tab-btn active" data-tab="settings">Settings</button>
        <button type="button" class="exam-tab-btn" data-tab="questions">Questions <span id="q-count">${questionDrafts.length}</span></button>
      </div>
      <div class="exam-tab-panel active" id="panel-settings">
        <div class="field"><label>Title</label><input id="em-title" required value="${ex ? escapeHtml(ex.title) : ""}" /></div>
        <div class="field"><label>Course tag (display name)</label><input id="em-course-name" value="${ex ? escapeHtml(ex.courseName || "") : ""}" /></div>
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
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
          <strong>Q${i + 1}</strong>
          <button type="button" class="btn btn-ghost btn-sm" data-rm-q="${i}" style="color:var(--danger)">Remove</button>
        </div>
        <div class="field"><label>Question</label><textarea data-f="text" rows="2">${escapeHtml(q.text)}</textarea></div>
        ${[0, 1, 2, 3]
          .map(
            (oi) => `
          <div class="field" style="display:flex;gap:0.5rem;align-items:center">
            <input type="radio" name="correct-${i}" value="${oi}" ${q.correctIndex === oi ? "checked" : ""} title="Correct" />
            <input type="text" data-f="opt" data-oi="${oi}" value="${escapeHtml(q.options[oi] || "")}" placeholder="Option ${String.fromCharCode(65 + oi)}" style="flex:1" />
          </div>`
          )
          .join("")}
        <div class="field">
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
  }
  function syncDraftsFromDom() {
    draftsEl.querySelectorAll(".q-draft").forEach((el, i) => {
      if (!questionDrafts[i]) return;
      questionDrafts[i].text = el.querySelector('[data-f="text"]').value;
      questionDrafts[i].options = [0, 1, 2, 3].map((oi) => el.querySelector(`[data-oi="${oi}"]`).value);
      const checked = el.querySelector(`input[name="correct-${i}"]:checked`);
      questionDrafts[i].correctIndex = checked ? Number(checked.value) : 0;
      questionDrafts[i].explanation = el.querySelector('[data-f="explanation"]').value;
    });
  }
  renderDrafts();

  backdrop.querySelector("#add-q-btn").addEventListener("click", () => {
    syncDraftsFromDom();
    questionDrafts.push({ text: "", options: ["", "", "", ""], correctIndex: 0, explanation: "" });
    renderDrafts();
  });

  backdrop.querySelectorAll(".exam-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      backdrop.querySelectorAll(".exam-tab-btn").forEach((b) => b.classList.remove("active"));
      backdrop.querySelectorAll(".exam-tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      backdrop.querySelector(`#panel-${btn.dataset.tab}`).classList.add("active");
    });
  });

  backdrop.querySelector("#exam-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    syncDraftsFromDom();
    const btn = backdrop.querySelector("#exam-save-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    const payload = {
      title: backdrop.querySelector("#em-title").value.trim(),
      courseName: backdrop.querySelector("#em-course-name").value.trim(),
      courseId: backdrop.querySelector("#em-course-id").value || null,
      duration: Number(backdrop.querySelector("#em-duration").value) || 0,
      negativeMarking: Number(backdrop.querySelector("#em-neg").value) || 0,
      shuffle: backdrop.querySelector("#em-shuffle").checked,
      showAll: backdrop.querySelector("#em-showall").checked,
      questionCount: questionDrafts.filter((q) => q.text.trim()).length,
      updatedAt: serverTimestamp(),
    };
    const validQs = questionDrafts.filter((q) => q.text.trim() && q.options.some((o) => o.trim()));
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
          addDoc(collection(db, "exams", examRef.id || examRef.id, "questions"), {
            text: q.text.trim(),
            options: q.options.map((o) => o.trim()),
            correctIndex: q.correctIndex,
            explanation: (q.explanation || "").trim(),
            order: i,
          })
        )
      );
      // fix ref id for new
      if (!ex) {
        /* already used examRef.id from addDoc */
      }
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

async function loadResultsTable() {
  const tbody = document.querySelector("#results-table tbody");
  tbody.innerHTML = `<tr><td colspan="5"><div class="loading-screen"><span class="spinner"></span></div></td></tr>`;
  try {
    const snap = await getDocs(collection(db, "results"));
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No results</p></div></td></tr>`;
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
      </tr>`
      )
      .join("");
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>Need isAdmin() on results read rule</p></div></td></tr>`;
  }
}

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
