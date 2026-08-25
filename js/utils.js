// ==========================================================================
// Tech Verse Exam — Shared utilities
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export const COURSE_SITE_URL = "https://tvcourse.vercel.app"; // change to your course site URL
export const SUPPORT_EMAIL = "tv.support.info@gmail.com";

/** Time-of-day greeting (Bengali) + current time string, used by the header. */
export function getGreeting(name) {
  const h = new Date().getHours();
  let msg;
  if (h >= 4 && h < 12) msg = "শুভ সকাল";
  else if (h >= 12 && h < 16) msg = "শুভ দুপুর";
  else if (h >= 16 && h < 18) msg = "শুভ বিকেল";
  else if (h >= 18 && h < 21) msg = "শুভ সন্ধ্যা";
  else msg = "শুভ রাত্রি";
  return name ? `${msg}, ${name}` : msg;
}

export function getClockTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

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

/** Pull this user's course purchase/access history from the shared Course-site
 * `accessCodes` collection and join it with `courses` for display names —
 * this is what powers the "My Courses" block on the Exam site Profile page. */
export async function getUserCourseHistory(uid, coursesList = []) {
  try {
    const { collection, query, where, getDocs } = await import(
      "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js"
    );
    const snap = await getDocs(query(collection(db, "accessCodes"), where("uid", "==", uid), where("used", "==", true)));
    let courses = coursesList;
    if (!courses.length) {
      const cSnap = await getDocs(collection(db, "courses"));
      courses = cSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    return snap.docs
      .map((d) => d.data())
      .map((row) => ({ ...row, course: courses.find((c) => c.id === row.courseId) || null }))
      .sort((a, b) => (b.usedAt?.toMillis?.() || 0) - (a.usedAt?.toMillis?.() || 0));
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------- */
/* Small generic helpers                                                  */
/* ---------------------------------------------------------------------- */

export function debounce(fn, wait = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function downloadFile(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows, headers) {
  const lines = [headers.map(csvEscape).join(",")];
  rows.forEach((row) => lines.push(row.map(csvEscape).join(",")));
  return lines.join("\n");
}

/* datetime-local <-> Date helpers (schedule fields) */
export function toDateTimeLocalValue(d) {
  if (!d) return "";
  const dt = d.toDate ? d.toDate() : new Date(d);
  if (isNaN(dt)) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
export function fromDateTimeLocalValue(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

/* ---------------------------------------------------------------------- */
/* Bulk question import parser                                            */
/* Accepts:                                                                */
/*  1) JSON array: [{ "text","options":[...],"correctIndex" or "answer",  */
/*     "explanation","marks" }, ...]                                       */
/*  2) CSV / TSV with header row (question, optionA..optionF, answer,      */
/*     explanation, marks)                                                 */
/*  3) Plain-text block format:                                            */
/*     Q: question text                                                    */
/*     A) option one                                                       */
/*     B) option two                                                       */
/*     C) option three                                                     */
/*     D) option four                                                      */
/*     Answer: B                                                           */
/*     Explanation: optional text                                          */
/*     Marks: 1                                                            */
/*     (blocks separated by a blank line or a line of dashes)              */
/* Returns { questions: [...], errors: [...] }                             */
/* ---------------------------------------------------------------------- */

function letterToIndex(letter) {
  if (letter == null) return null;
  const t = String(letter).trim().toUpperCase().replace(/[().]/g, "");
  if (/^[A-F]$/.test(t)) return t.charCodeAt(0) - 65;
  if (/^\d+$/.test(t)) return Number(t) - 1; // "1" -> option A
  return null;
}

export function parseBulkQuestions(raw) {
  const text = (raw || "").trim();
  if (!text) return { questions: [], errors: ["ইনপুট খালি"] };

  // 1) Try JSON
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const data = JSON.parse(text);
      const arr = Array.isArray(data) ? data : data.questions;
      if (Array.isArray(arr)) return parseJsonQuestions(arr);
    } catch {
      /* fall through to other formats */
    }
  }

  // 2) Try CSV/TSV (header row contains "question")
  const firstLine = text.split(/\r?\n/)[0] || "";
  if (/question/i.test(firstLine) && (firstLine.includes(",") || firstLine.includes("\t"))) {
    const parsed = parseCsvQuestions(text);
    if (parsed.questions.length || parsed.errors.length) return parsed;
  }

  // 3) Plain-text block format
  return parseTextQuestions(text);
}

function normalizeQ(q, i) {
  const errors = [];
  const optionsRaw = Array.isArray(q.options) ? q.options : [];
  const options = optionsRaw.map((o) => String(o ?? "").trim()).filter((o) => o !== "");
  if (options.length < 2) errors.push(`প্রশ্ন ${i + 1}: কমপক্ষে ২টি অপশন দরকার`);
  let correctIndex = q.correctIndex;
  if (correctIndex == null && q.answer != null) correctIndex = letterToIndex(q.answer);
  if (typeof correctIndex !== "number" || isNaN(correctIndex)) correctIndex = 0;
  if (correctIndex < 0 || correctIndex >= options.length) {
    errors.push(`প্রশ্ন ${i + 1}: সঠিক উত্তর options-এর বাইরে — 0 ধরা হলো`);
    correctIndex = 0;
  }
  const text = String(q.text || q.question || "").trim();
  if (!text) errors.push(`প্রশ্ন ${i + 1}: প্রশ্নের লেখা খালি`);
  const marks = Number(q.marks);
  return {
    question: {
      text,
      options,
      correctIndex,
      explanation: String(q.explanation || "").trim(),
      marks: Number.isFinite(marks) && marks > 0 ? marks : 1,
    },
    errors,
  };
}

function parseJsonQuestions(arr) {
  const questions = [];
  const errors = [];
  arr.forEach((q, i) => {
    const { question, errors: qErrors } = normalizeQ(q, i);
    errors.push(...qErrors);
    if (question.text) questions.push(question);
  });
  return { questions, errors };
}

function splitCsvLine(line, delim) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsvQuestions(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitCsvLine(lines[0], delim).map((h) => h.toLowerCase());
  const idx = (name) => headers.indexOf(name);
  const qIdx = idx("question") >= 0 ? idx("question") : idx("text");
  const ansIdx = idx("answer") >= 0 ? idx("answer") : idx("correct");
  const explIdx = idx("explanation");
  const marksIdx = idx("marks");
  const optIdxs = [];
  for (const key of ["optiona", "optionb", "optionc", "optiond", "optione", "optionf"]) {
    const j = idx(key);
    if (j >= 0) optIdxs.push(j);
  }
  const questions = [];
  const errors = [];
  lines.slice(1).forEach((line, i) => {
    const cols = splitCsvLine(line, delim);
    const q = {
      text: qIdx >= 0 ? cols[qIdx] : "",
      options: optIdxs.map((j) => cols[j] || ""),
      answer: ansIdx >= 0 ? cols[ansIdx] : "A",
      explanation: explIdx >= 0 ? cols[explIdx] : "",
      marks: marksIdx >= 0 ? cols[marksIdx] : 1,
    };
    const { question, errors: qErrors } = normalizeQ(q, i);
    errors.push(...qErrors);
    if (question.text) questions.push(question);
  });
  return { questions, errors };
}

function parseTextQuestions(text) {
  const blocks = text
    .split(/\n\s*\n|\n-{3,}\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const questions = [];
  const errors = [];

  blocks.forEach((block, bi) => {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    let questionText = "";
    const options = [];
    let correctIndex = null;
    let explanation = "";
    let marks = 1;

    lines.forEach((line) => {
      const optMatch = line.match(/^\*?\(?([A-Fa-f])[).:]\s*(.*)$/);
      const ansMatch = line.match(/^(answer|ans|correct)\s*[:\-]\s*(.+)$/i);
      const explMatch = line.match(/^(explanation|explain|note)\s*[:\-]\s*(.+)$/i);
      const marksMatch = line.match(/^(marks|points?)\s*[:\-]\s*(.+)$/i);
      const qMatch = line.match(/^(q\d*|question)\s*[:\-]\s*(.+)$/i);

      if (ansMatch) {
        correctIndex = letterToIndex(ansMatch[2]);
        if (correctIndex == null) {
          // maybe they typed the full option text instead of a letter
          const found = options.findIndex((o) => o.toLowerCase() === ansMatch[2].trim().toLowerCase());
          if (found >= 0) correctIndex = found;
        }
      } else if (explMatch) {
        explanation = explMatch[2].trim();
      } else if (marksMatch) {
        const m = Number(marksMatch[2]);
        if (Number.isFinite(m) && m > 0) marks = m;
      } else if (optMatch) {
        const isStarred = line.trim().startsWith("*");
        options.push(optMatch[2].replace(/\(correct\)\s*$/i, "").trim());
        if (isStarred || /\(correct\)\s*$/i.test(line)) correctIndex = options.length - 1;
      } else if (qMatch) {
        questionText = qMatch[2].trim();
      } else if (!questionText) {
        questionText = line.replace(/^\d+[).]\s*/, "").trim();
      }
    });

    if (!questionText && !options.length) return; // skip stray blank block

    const { question, errors: qErrors } = normalizeQ(
      { text: questionText, options, correctIndex: correctIndex ?? 0, explanation, marks },
      bi
    );
    errors.push(...qErrors);
    if (question.text) questions.push(question);
  });

  return { questions, errors };
}

/* Shared modal helper (used by app.js + admin.js) */
export function openModal(html, large = false) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal ${large ? "modal-lg" : ""}">${html}</div>`;
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop || e.target.closest("[data-modal-close]")) backdrop.remove();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

export const BULK_IMPORT_SAMPLE = `Q: বাংলাদেশের রাজধানীর নাম কী?
A) চট্টগ্রাম
B) ঢাকা
C) খুলনা
D) রাজশাহী
Answer: B
Explanation: ঢাকা বাংলাদেশের রাজধানী ও বৃহত্তম শহর।
Marks: 1

Q: 5 + 7 = ?
A) 10
B) 11
C) 12
D) 13
Answer: C
`;
