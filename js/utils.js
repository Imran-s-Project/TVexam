// ==========================================================================
// Tech Verse Exam — Shared utilities
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const COURSE_SITE_URL = "https://tvcourse.web.app"; // change to your course site URL
export const SUPPORT_EMAIL = "tv.support.info@gmail.com";

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
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 280);
  }, 3200);
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function formatDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d)) return "—";
  return d.toLocaleString();
}

export function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
}

export function formatScore(n) {
  if (typeof n !== "number") return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function waitForAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function requireAuth(redirectTo = "index.html#/login") {
  const user = await waitForAuth();
  if (!user) {
    location.href = redirectTo;
    return null;
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireAuth("index.html#/login");
  if (!user) return null;
  const profile = await getUserProfile(user.uid);
  if (!profile?.isAdmin) {
    toast("Admin access required", "error");
    location.href = "index.html#/";
    return null;
  }
  return { user, profile };
}

export async function signOutUser() {
  await signOut(auth);
  location.href = "index.html#/login";
}

export async function touchLastActive(uid) {
  try {
    await updateDoc(doc(db, "users", uid), { lastActive: serverTimestamp() });
  } catch {
    /* ignore */
  }
}

export function getCoursePricing(course) {
  if (!course) return { isPaid: false, price: 0, label: "Free" };
  const price = Number(course.price) || 0;
  const isPaid = price > 0 || course.isPaid === true;
  return { isPaid, price, label: isPaid ? `৳${price}` : "Free" };
}

export async function userHasCourseAccess(uid, courseId, enrolledCourses = []) {
  if (!courseId) return true;
  if (enrolledCourses.includes(courseId)) return true;
  try {
    const { collection, query, where, getDocs } = await import(
      "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js"
    );
    const snap = await getDocs(
      query(collection(db, "accessCodes"), where("uid", "==", uid), where("courseId", "==", courseId), where("used", "==", true))
    );
    return !snap.empty;
  } catch {
    return enrolledCourses.includes(courseId);
  }
}
