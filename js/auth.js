// ==========================================================================
// auth.js — TV Exam login / signup
// Auth সবসময় মেইন কোর্স প্রজেক্ট থেকে
// ==========================================================================
import { auth, mainDb } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, setDoc, getDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, navigate, waitForAuth } from "./utils.js";

// ── Login page ────────────────────────────────────────────────────────────
export async function initLoginPage() {
  // Already logged in → redirect
  const user = await waitForAuth();
  if (user) { navigate("#/"); return; }

  const form    = document.getElementById("login-form");
  const emailEl = document.getElementById("login-email");
  const passEl  = document.getElementById("login-pass");
  const btnEl   = document.getElementById("login-btn");
  const googleBtn = document.getElementById("google-btn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    btnEl.disabled = true;
    btnEl.textContent = "Signing in…";
    try {
      await signInWithEmailAndPassword(auth, emailEl.value.trim(), passEl.value);
      navigate("#/");
    } catch (err) {
      toast(_authError(err.code), "error");
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = "Sign In";
    }
  });

  googleBtn?.addEventListener("click", () => _oauthLogin(new GoogleAuthProvider()));
}

// ── Signup page ───────────────────────────────────────────────────────────
export async function initSignupPage() {
  const user = await waitForAuth();
  if (user) { navigate("#/"); return; }

  const form    = document.getElementById("signup-form");
  const nameEl  = document.getElementById("signup-name");
  const emailEl = document.getElementById("signup-email");
  const passEl  = document.getElementById("signup-pass");
  const btnEl   = document.getElementById("signup-btn");
  const googleBtn = document.getElementById("google-btn-signup");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name  = nameEl.value.trim();
    const email = emailEl.value.trim();
    const pass  = passEl.value;
    if (!name)          { toast("নাম দাও", "error"); return; }
    if (pass.length < 6) { toast("Password কমপক্ষে ৬ অক্ষর", "error"); return; }

    btnEl.disabled = true;
    btnEl.textContent = "Creating account…";
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      // মেইন DB তে ইউজার প্রোফাইল তৈরি করো (যদি না থাকে)
      const userRef = doc(mainDb, "users", cred.user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          displayName: name,
          email,
          photoURL: "",
          role: "student",
          createdAt: serverTimestamp(),
          examSiteSignup: true,
        });
      }
      navigate("#/");
    } catch (err) {
      toast(_authError(err.code), "error");
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = "Create Account";
    }
  });

  googleBtn?.addEventListener("click", () => _oauthLogin(new GoogleAuthProvider()));
}

// ── Forgot password ───────────────────────────────────────────────────────
export async function initForgotPage() {
  const form    = document.getElementById("forgot-form");
  const emailEl = document.getElementById("forgot-email");
  const btnEl   = document.getElementById("forgot-btn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    btnEl.disabled = true;
    try {
      await sendPasswordResetEmail(auth, emailEl.value.trim());
      toast("Reset email পাঠানো হয়েছে! ইনবক্স চেক করো।", "success");
      emailEl.value = "";
    } catch (err) {
      toast(_authError(err.code), "error");
    } finally {
      btnEl.disabled = false;
    }
  });
}

// ── OAuth helper ──────────────────────────────────────────────────────────
async function _oauthLogin(provider) {
  try {
    const cred = await signInWithPopup(auth, provider);
    // মেইন DB তে ইউজার প্রোফাইল না থাকলে তৈরি করো
    const userRef = doc(mainDb, "users", cred.user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        displayName: cred.user.displayName || "",
        email: cred.user.email || "",
        photoURL: cred.user.photoURL || "",
        role: "student",
        createdAt: serverTimestamp(),
        examSiteSignup: true,
      });
    }
    navigate("#/");
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") {
      toast(_authError(err.code), "error");
    }
  }
}

// ── Error messages ────────────────────────────────────────────────────────
function _authError(code) {
  const map = {
    "auth/user-not-found":       "এই email দিয়ে কোনো account নেই",
    "auth/wrong-password":       "Password ভুল",
    "auth/invalid-credential":   "Email বা Password ভুল",
    "auth/email-already-in-use": "এই email আগেই registered",
    "auth/weak-password":        "Password কমপক্ষে ৬ অক্ষর হতে হবে",
    "auth/invalid-email":        "Email format ঠিক নেই",
    "auth/too-many-requests":    "অনেকবার চেষ্টা করা হয়েছে। একটু পরে চেষ্টা করো।",
    "auth/network-request-failed": "Network error। Internet connection চেক করো।",
  };
  return map[code] || `Error: ${code}`;
}
