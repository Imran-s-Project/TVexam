// ==========================================================================
// utils.js — TV Exam shared helpers
// ==========================================================================
import { auth, mainDb, examDb } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ── সাইট লিংক ──────────────────────────────────────────────────────────
// মেইন কোর্স সাইটের URL — production এ আসল URL বসাও
export const COURSE_SITE_URL = "https://tv-course.vercel.app";

// ── Toast ────────────────────────────────────────────────────────────────
export function toast(message, type = "info") {
  let root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateX(20px)";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ── Escape HTML ──────────────────────────────────────────────────────────
export function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Format helpers ────────────────────────────────────────────────────────
export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function formatScore(val) {
  const n = Number(val);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : (ts instanceof Date ? ts : new Date(ts));
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ── Exam availability ─────────────────────────────────────────────────────
export function getExamAvailability(exam) {
  const now = Date.now();
  let publishAt = null, closesAt = null;

  if (exam.publishAt) {
    publishAt = exam.publishAt.toDate
      ? exam.publishAt.toDate()
      : new Date(exam.publishAt);
  }
  if (exam.closesAt) {
    closesAt = exam.closesAt.toDate
      ? exam.closesAt.toDate()
      : new Date(exam.closesAt);
  }

  if (publishAt && now < publishAt.getTime()) return { state: "upcoming", publishAt, closesAt };
  if (closesAt && now > closesAt.getTime()) return { state: "closed", publishAt, closesAt };
  return { state: "open", publishAt, closesAt };
}

// ── Auth helpers ──────────────────────────────────────────────────────────
let _cachedProfile = null;

export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function requireAuth() {
  const user = await waitForAuth();
  if (!user) {
    window.location.hash = "#/login";
    return null;
  }
  return user;
}

export async function requireAdmin() {
  const user = await waitForAuth();
  if (!user) { window.location.href = "index.html#/login"; return null; }
  // admin স্ট্যাটাস examDb (tv-exam) এর admins/{uid} collection এ থাকে —
  // firestore.rules ও README এর সাথে মিলিয়ে, mainDb এর role field না
  let isAdmin = false;
  try {
    const adminSnap = await getDoc(doc(examDb, "admins", user.uid));
    isAdmin = adminSnap.exists();
  } catch {
    isAdmin = false;
  }
  if (!isAdmin) {
    toast("Admin access only", "error");
    window.location.href = "index.html#/";
    return null;
  }
  const profileSnap = await getDoc(doc(mainDb, "users", user.uid)).catch(() => null);
  const profile = profileSnap?.exists() ? profileSnap.data() : { displayName: user.displayName, email: user.email };
  return { user, profile };
}

// মেইন DB থেকে ইউজার প্রোফাইল পড়া
export async function getUserProfile(uid) {
  if (_cachedProfile && _cachedProfile.id === uid) return _cachedProfile;
  const snap = await getDoc(doc(mainDb, "users", uid));
  if (!snap.exists()) return null;
  _cachedProfile = { id: snap.id, ...snap.data() };
  return _cachedProfile;
}

export function clearProfileCache() { _cachedProfile = null; }

// ── Nav init ──────────────────────────────────────────────────────────────
let _navBooted = false;

export function initNav(activePage = "") {
  if (_navBooted) {
    _updateActiveLink(activePage);
    return;
  }
  _navBooted = true;

  // Theme toggle
  const themeBtn = document.getElementById("theme-btn");
  const savedTheme = localStorage.getItem("exam_theme") || "dark";
  document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "";
  _updateThemeIcon(themeBtn, savedTheme);

  themeBtn?.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme;
    const next = current === "light" ? "" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("exam_theme", next || "dark");
    _updateThemeIcon(themeBtn, next || "dark");
  });

  // Hamburger
  const hamburger = document.getElementById("hamburger");
  const navLinks  = document.getElementById("nav-links");
  hamburger?.addEventListener("click", () => navLinks?.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!hamburger?.contains(e.target) && !navLinks?.contains(e.target)) {
      navLinks?.classList.remove("open");
    }
  });

  // Auth state → update nav-user
  onAuthStateChanged(auth, async (user) => {
    const navUser = document.getElementById("nav-user");
    if (!navUser) return;
    if (!user) {
      navUser.innerHTML = `<a href="#/login" class="btn btn-primary btn-sm">Sign In</a>`;
      return;
    }
    const profile = await getUserProfile(user.uid).catch(() => null);
    const initial = (profile?.displayName || user.displayName || user.email || "U")[0].toUpperCase();
    const avatarSrc = profile?.photoURL || user.photoURL || "";
    const isAdmin = await getDoc(doc(examDb, "admins", user.uid)).then(s => s.exists()).catch(() => false);
    navUser.innerHTML = `
      <div class="nav-avatar" id="nav-avatar-btn" title="Profile">
        ${avatarSrc ? `<img src="${escapeHtml(avatarSrc)}" alt="">` : escapeHtml(initial)}
      </div>
      <div class="nav-dropdown hidden" id="nav-dropdown">
        <div class="nav-dropdown-name">${escapeHtml(profile?.displayName || user.displayName || user.email || "")}</div>
        <a href="#/profile" class="nav-dropdown-item"><i class="fa-solid fa-user"></i> Profile</a>
        <a href="#/history" class="nav-dropdown-item"><i class="fa-solid fa-clock-rotate-left"></i> My Results</a>
        ${isAdmin ? `<a href="admin.html" class="nav-dropdown-item"><i class="fa-solid fa-shield-halved"></i> Admin Panel</a>` : ""}
        <button class="nav-dropdown-item danger" id="signout-btn"><i class="fa-solid fa-right-from-bracket"></i> Sign Out</button>
      </div>
    `;
    document.getElementById("nav-avatar-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("nav-dropdown")?.classList.toggle("hidden");
    });
    document.addEventListener("click", () => document.getElementById("nav-dropdown")?.classList.add("hidden"), { once: false });
    document.getElementById("signout-btn")?.addEventListener("click", async () => {
      await signOut(auth);
      clearProfileCache();
      const onIndex = /(^|\/)index\.html$/.test(location.pathname) || location.pathname.endsWith("/") || location.pathname === "";
      window.location.href = onIndex ? "#/login" : "index.html#/login";
    });
  });

  _updateActiveLink(activePage);
}

function _updateActiveLink(page) {
  document.querySelectorAll(".nav-link[data-page]").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });
}

function _updateThemeIcon(btn, theme) {
  if (!btn) return;
  btn.innerHTML = theme === "light"
    ? `<i class="fa-solid fa-moon"></i>`
    : `<i class="fa-solid fa-sun"></i>`;
}

// ── Modal helpers ─────────────────────────────────────────────────────────
export function openModal(id) {
  document.getElementById(id)?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
export function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
  document.body.style.overflow = "";
}

export async function confirmAction(message) {
  return new Promise((resolve) => {
    const el = document.createElement("div");
    el.className = "modal-backdrop";
    el.innerHTML = `
      <div class="modal-box" style="max-width:380px">
        <p style="margin-bottom:20px;line-height:1.6">${escapeHtml(message)}</p>
        <div class="modal-footer">
          <button class="btn btn-outline" id="conf-no">Cancel</button>
          <button class="btn btn-danger"  id="conf-yes">Confirm</button>
        </div>
      </div>
    `;
    document.body.appendChild(el);
    document.body.style.overflow = "hidden";
    el.querySelector("#conf-yes").onclick = () => { el.remove(); document.body.style.overflow = ""; resolve(true); };
    el.querySelector("#conf-no").onclick  = () => { el.remove(); document.body.style.overflow = ""; resolve(false); };
  });
}

// ── Shuffle ───────────────────────────────────────────────────────────────
export function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── মেইন সাইট থেকে ইউজারের এক্সাম access চেক ─────────────────────────────
// মেইন DB এর accessCodes বা purchases collection চেক করে
export async function checkCourseAccess(uid, courseId) {
  if (!courseId) return true; // কোনো course link নেই → free exam
  try {
    const { collection, query, where, limit, getDocs } =
      await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js");
    const q = query(
      collection(mainDb, "accessCodes"),
      where("uid", "==", uid),
      where("courseId", "==", courseId),
      where("used", "==", true),
      limit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
  } catch {
    return false;
  }
}
