// ==========================================================================
// app.js — TV Exam SPA entry point
// Hash routes → views
// ==========================================================================
import { Router, navigate } from "./router.js";
import { auth, examDb, mainDb } from "./firebase-config.js";
import {
  collection, getDocs, getDoc, doc,
  query, orderBy, where, limit,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLoginPage, initSignupPage, initForgotPage } from "./auth.js";
import { initExamPage } from "./exam.js";
import { initProfilePage, initHistoryPage } from "./profile.js";
import { initNav, requireAuth, waitForAuth, toast, escapeHtml,
         formatScore, formatDate, formatDuration } from "./utils.js";

// ── All view containers ────────────────────────────────────────────────────
const views = {
  exams:       document.getElementById("view-exams"),
  auth:        document.getElementById("view-auth"),
  profile:     document.getElementById("view-profile"),
  history:     document.getElementById("view-history"),
  leaderboard: document.getElementById("view-leaderboard"),
  "404":       document.getElementById("view-404"),
};
const authPanels = {
  login:  document.getElementById("auth-login"),
  signup: document.getElementById("auth-signup"),
  forgot: document.getElementById("auth-forgot"),
};

function showView(name) {
  Object.values(views).forEach(v => v?.classList.add("hidden"));
  views[name]?.classList.remove("hidden");
}
function showAuthPanel(name) {
  Object.values(authPanels).forEach(p => p?.classList.add("hidden"));
  authPanels[name]?.classList.remove("hidden");
}

// ── Router ─────────────────────────────────────────────────────────────────
const router = new Router({

  // ── Exams list (home) ──────────────────────────────────────────────────
  "": async (params) => {
    showView("exams");
    return initExamPage(params);
  },

  // ── Take exam ──────────────────────────────────────────────────────────
  "exam": async (params) => {
    showView("exams");
    return initExamPage(params);
  },

  // ── Result ────────────────────────────────────────────────────────────
  "result": async (params) => {
    showView("exams");
    return initExamPage(params);
  },

  // ── Leaderboard ────────────────────────────────────────────────────────
  "leaderboard": async (params) => {
    showView("leaderboard");
    initNav("leaderboard");
    await _initLeaderboard(params);
  },

  // ── Profile ────────────────────────────────────────────────────────────
  "profile": async () => {
    showView("profile");
    return initProfilePage();
  },

  // ── History ────────────────────────────────────────────────────────────
  "history": async () => {
    showView("history");
    return initHistoryPage();
  },

  // ── Auth ───────────────────────────────────────────────────────────────
  "login": async () => {
    showView("auth");
    showAuthPanel("login");
    initNav("");
    return initLoginPage();
  },

  "signup": async () => {
    showView("auth");
    showAuthPanel("signup");
    initNav("");
    return initSignupPage();
  },

  "forgot": async () => {
    showView("auth");
    showAuthPanel("forgot");
    initNav("");
    return initForgotPage();
  },

  // ── 404 ────────────────────────────────────────────────────────────────
  "404": () => {
    showView("404");
    initNav("");
  },
});

// ── Leaderboard page logic ─────────────────────────────────────────────────
async function _initLeaderboard(params) {
  const container  = document.getElementById("leaderboard-list");
  const examSelect = document.getElementById("lb-exam-select");

  // Populate exam options
  if (examSelect && !examSelect.dataset.loaded) {
    examSelect.dataset.loaded = "1";
    try {
      const snap = await getDocs(collection(examDb, "exams"));
      const exams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      examSelect.innerHTML = `<option value="">All Exams</option>` +
        exams.map(ex => `<option value="${ex.id}">${escapeHtml(ex.title)}</option>`).join("");
    } catch {}

    // Pre-select from params
    const preId = params?.get("examId");
    if (preId) examSelect.value = preId;

    examSelect.addEventListener("change", () => _renderLeaderboard(examSelect.value, container));
  }

  await _renderLeaderboard(examSelect?.value || "", container);
}

async function _renderLeaderboard(examId, container) {
  if (!container) return;
  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;

  // Load users from mainDb for display names / avatars
  let usersMap = {};
  try {
    const uSnap = await getDocs(collection(mainDb, "users"));
    uSnap.docs.forEach(d => { usersMap[d.id] = d.data(); });
  } catch {}

  try {
    let q;
    if (examId) {
      q = query(collection(examDb, "results"),
            where("examId", "==", examId),
            orderBy("percent", "desc"),
            limit(50));
    } else {
      q = query(collection(examDb, "results"),
            orderBy("percent", "desc"),
            limit(50));
    }
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = `
        <div class="empty-state" style="padding:48px 20px">
          <div class="icon"><i class="fa-solid fa-trophy"></i></div>
          <p>কেউ এখনো exam দেয়নি — প্রথম হওয়ার সুযোগ তোমার!</p>
          <a href="#/" class="btn btn-primary" style="margin-top:16px">Exams দেখো</a>
        </div>`;
      return;
    }

    container.innerHTML = snap.docs.map((d, i) => {
      const r    = d.data();
      const u    = usersMap[r.uid] || {};
      const name = u.displayName || u.email?.split("@")[0] || "Student";
      const photo= u.photoURL || "";
      const init = name[0]?.toUpperCase() || "S";
      const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      const rankLabel = i < 3 ? ["🥇","🥈","🥉"][i] : `#${i+1}`;
      const passed = r.percent >= (r.passMark || 60);

      return `
        <div class="leaderboard-row">
          <div class="lb-rank ${rankClass}">${rankLabel}</div>
          <div class="lb-avatar">
            ${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml(init)}
          </div>
          <div style="flex:1;min-width:0">
            <div class="lb-name">${escapeHtml(name)}</div>
            <div style="font-size:.78rem;color:var(--text-muted)">
              ${escapeHtml(r.examTitle || "")}
              ${r.timeTakenSeconds ? ` · ${formatDuration(r.timeTakenSeconds)}` : ""}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="lb-score" style="color:${passed ? "var(--accent-green-soft)" : "var(--accent-red-soft)"}">
              ${r.percent}%
            </div>
            <div style="font-size:.78rem;color:var(--text-muted)">${formatScore(r.score)}/${r.total}</div>
          </div>
        </div>`;
    }).join("");
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Leaderboard লোড হয়নি — refresh করো।</p></div>`;
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
router.start();
