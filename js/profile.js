// ==========================================================================
// profile.js — TV Exam profile, my results, settings
// ==========================================================================
import { auth, examDb, mainDb, storage } from "./firebase-config.js";
import {
  updateProfile, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, collection, getDocs, query,
  where, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { requireAuth, getUserProfile, toast, escapeHtml, formatDate, formatScore, formatDuration, initNav } from "./utils.js";

let _user    = null;
let _profile = null;

export async function initProfilePage() {
  initNav("profile");
  _user = await requireAuth();
  if (!_user) return;
  _profile = await getUserProfile(_user.uid);

  _renderProfile();
  await _loadHistory();
  _bindSettings();
}

export async function initHistoryPage() {
  initNav("history");
  _user = await requireAuth();
  if (!_user) return;

  document.getElementById("page-title")?.textContent && (document.getElementById("page-title").textContent = "My Exam History");
  await _loadHistory(true); // standalone page
}

// ── Profile render ─────────────────────────────────────────────────────────
function _renderProfile() {
  const wrap = document.getElementById("profile-info");
  if (!wrap) return;

  const name  = _profile?.displayName || _user.displayName || "Student";
  const email = _user.email || "";
  const photo = _profile?.photoURL || _user.photoURL || "";
  const init  = name[0].toUpperCase();

  wrap.innerHTML = `
    <div class="profile-card card">
      <div class="profile-avatar-row">
        <div class="profile-avatar-lg" id="profile-avatar">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml(init)}
        </div>
        <div>
          <div class="profile-name">${escapeHtml(name)}</div>
          <div class="profile-email">${escapeHtml(email)}</div>
          <div class="mt-8">
            <label class="btn btn-outline btn-sm" style="cursor:pointer">
              <i class="fa-solid fa-camera"></i> Change Photo
              <input type="file" id="avatar-upload" accept="image/*" style="display:none">
            </label>
          </div>
        </div>
      </div>

      <div class="divider"></div>

      <div class="form-grid">
        <div class="field">
          <label>Display Name</label>
          <input type="text" id="edit-name" value="${escapeHtml(name)}">
        </div>
        <div class="field">
          <label>Email</label>
          <input type="email" value="${escapeHtml(email)}" disabled style="opacity:.5">
        </div>
      </div>
      <div class="mt-16">
        <button class="btn btn-primary" id="save-profile-btn">Save Changes</button>
      </div>
    </div>

    <div class="profile-card card mt-16">
      <h3 style="font-size:1rem;margin-bottom:16px">Change Password</h3>
      <div class="form-grid">
        <div class="field span-2">
          <label>Current Password</label>
          <input type="password" id="curr-pass" placeholder="••••••••">
        </div>
        <div class="field">
          <label>New Password</label>
          <input type="password" id="new-pass" placeholder="Min 6 chars">
        </div>
        <div class="field">
          <label>Confirm New</label>
          <input type="password" id="conf-pass" placeholder="Repeat">
        </div>
      </div>
      <div class="mt-16">
        <button class="btn btn-outline" id="change-pass-btn">Update Password</button>
      </div>
    </div>
  `;

  // Avatar upload
  document.getElementById("avatar-upload")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("২MB এর বেশি হবে না", "error"); return; }
    try {
      toast("Uploading…", "info");
      const r = ref(storage, `avatars/${_user.uid}`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await updateProfile(_user, { photoURL: url });
      await updateDoc(doc(mainDb, "users", _user.uid), { photoURL: url });
      toast("Photo updated!", "success");
      const av = document.getElementById("profile-avatar");
      if (av) av.innerHTML = `<img src="${url}" alt="">`;
    } catch { toast("Upload failed", "error"); }
  });

  // Save name
  document.getElementById("save-profile-btn")?.addEventListener("click", async () => {
    const name = document.getElementById("edit-name")?.value.trim();
    if (!name) { toast("নাম দাও", "error"); return; }
    try {
      await updateProfile(_user, { displayName: name });
      await updateDoc(doc(mainDb, "users", _user.uid), { displayName: name, updatedAt: serverTimestamp() });
      toast("Profile saved!", "success");
    } catch { toast("Save failed", "error"); }
  });
}

function _bindSettings() {
  document.getElementById("change-pass-btn")?.addEventListener("click", async () => {
    const curr = document.getElementById("curr-pass")?.value;
    const nw   = document.getElementById("new-pass")?.value;
    const conf = document.getElementById("conf-pass")?.value;
    if (!curr || !nw) { toast("সব ঘর পূরণ করো", "error"); return; }
    if (nw !== conf) { toast("New passwords মিলছে না", "error"); return; }
    if (nw.length < 6) { toast("Password কমপক্ষে ৬ অক্ষর", "error"); return; }
    try {
      const cred = EmailAuthProvider.credential(_user.email, curr);
      await reauthenticateWithCredential(_user, cred);
      await updatePassword(_user, nw);
      toast("Password changed!", "success");
      document.getElementById("curr-pass").value = "";
      document.getElementById("new-pass").value = "";
      document.getElementById("conf-pass").value = "";
    } catch (err) {
      toast(err.code === "auth/wrong-password" ? "Current password ভুল" : "Error: " + err.message, "error");
    }
  });
}

// ── Exam history ───────────────────────────────────────────────────────────
async function _loadHistory(standalone = false) {
  const container = document.getElementById(standalone ? "history-list" : "my-history-list");
  if (!container) return;

  container.innerHTML = `<div class="loading-screen"><span class="spinner"></span></div>`;

  try {
    const snap = await getDocs(
      query(collection(examDb, "attempts"),
        where("uid", "==", _user.uid),
        orderBy("submittedAt", "desc"))
    );

    if (snap.empty) {
      container.innerHTML = `<div class="empty-state"><div class="icon"><i class="fa-solid fa-scroll"></i></div><p>No exam history yet — take an exam to get started!</p></div>`;
      return;
    }

    // Stats
    const attempts = snap.docs.map(d => d.data());
    const avgScore  = Math.round(attempts.reduce((s, a) => s + a.percent, 0) / attempts.length);
    const bestScore = Math.max(...attempts.map(a => a.percent));
    const passed    = attempts.filter(a => a.percent >= (a.passMark || 60)).length;

    const statsHtml = `
      <div class="stat-grid mb-16">
        <div class="stat-card"><div class="stat-label">Total Attempts</div><div class="stat-value">${attempts.length}</div></div>
        <div class="stat-card"><div class="stat-label">Avg Score</div><div class="stat-value">${avgScore}%</div></div>
        <div class="stat-card"><div class="stat-label">Best Score</div><div class="stat-value">${bestScore}%</div></div>
        <div class="stat-card"><div class="stat-label">Passed</div><div class="stat-value" style="color:var(--accent-green-soft)">${passed}</div></div>
      </div>
    `;

    const rowsHtml = attempts.map(a => {
      const pm = a.passMark || 60;
      const ok = a.percent >= pm;
      return `
        <div class="exam-history-item">
          <div>
            <div class="exam-history-title">${escapeHtml(a.examTitle || "Exam")}</div>
            <div class="exam-history-meta">
              ${formatDate(a.submittedAt)} &nbsp;·&nbsp; ${formatDuration(a.timeTakenSeconds || 0)}
              &nbsp;·&nbsp; ✓${a.correct} &nbsp;·&nbsp; ✗${a.wrong}
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-family:var(--font-display);font-weight:700;font-size:1.1rem;color:${ok ? "var(--accent-green-soft)" : "var(--accent-red-soft)"}">
              ${a.percent}%
            </div>
            <div style="font-size:0.8rem;color:var(--text-muted)">${formatScore(a.score)}/${a.total}</div>
          </div>
        </div>`;
    }).join("");

    container.innerHTML = statsHtml + `<div class="card" style="padding:0 20px">${rowsHtml}</div>`;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Could not load history</p></div>`;
  }
}
