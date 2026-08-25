// ==========================================================================
// Auth helpers — shared Firebase Auth (same users as Course site)
// ==========================================================================
import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { toast, escapeHtml } from "./utils.js";

export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  const ref = doc(db, "users", cred.user.uid);
  const existing = await getDoc(ref);
  if (!existing.exists()) {
    await setDoc(ref, {
      email,
      displayName: displayName || "",
      isAdmin: false,
      enrolledCourses: [],
      createdAt: serverTimestamp(),
      lastActive: serverTimestamp(),
      source: "exam-site",
    });
  }
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function bindAuthForms() {
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = loginForm.querySelector('[type="submit"]');
      const email = loginForm.querySelector("#login-email").value.trim();
      const password = loginForm.querySelector("#login-password").value;
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        await signIn(email, password);
        toast("Welcome back!", "success");
        location.hash = "#/";
      } catch (err) {
        toast(authErrorMessage(err), "error");
        btn.disabled = false;
        btn.textContent = "Sign In";
      }
    });
  }

  const signupForm = document.getElementById("signup-form");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = signupForm.querySelector('[type="submit"]');
      const name = signupForm.querySelector("#signup-name").value.trim();
      const email = signupForm.querySelector("#signup-email").value.trim();
      const password = signupForm.querySelector("#signup-password").value;
      if (password.length < 6) {
        toast("Password must be at least 6 characters", "error");
        return;
      }
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span>`;
      try {
        await signUp(email, password, name);
        toast("Account created!", "success");
        location.hash = "#/";
      } catch (err) {
        toast(authErrorMessage(err), "error");
        btn.disabled = false;
        btn.textContent = "Create Account";
      }
    });
  }

  const forgotForm = document.getElementById("forgot-form");
  if (forgotForm) {
    forgotForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = forgotForm.querySelector('[type="submit"]');
      const email = forgotForm.querySelector("#forgot-email").value.trim();
      btn.disabled = true;
      try {
        await resetPassword(email);
        toast("Password reset email sent", "success");
        location.hash = "#/login";
      } catch (err) {
        toast(authErrorMessage(err), "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Send Reset Link";
      }
    });
  }
}

function authErrorMessage(err) {
  const code = err?.code || "";
  if (code.includes("email-already-in-use")) return "Email already registered";
  if (code.includes("invalid-email")) return "Invalid email";
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return "Wrong email or password";
  if (code.includes("user-not-found")) return "No account found";
  if (code.includes("weak-password")) return "Password too weak";
  if (code.includes("too-many-requests")) return "Too many attempts — try later";
  return err?.message || "Authentication failed";
}

export { onAuthStateChanged };
