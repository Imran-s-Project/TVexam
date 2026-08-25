// ==========================================================================
// firebase-config.js — TV Exam দ্বৈত Firebase সেটআপ
//
// Auth:    মেইন কোর্স প্রজেক্ট থেকে — একটাই Auth সবার জন্য
// mainDb:  মেইন কোর্স প্রজেক্টের Firestore — ইউজার প্রোফাইল ও পেমেন্ট পড়তে
// examDb:  এক্সাম প্রজেক্টের Firestore — সকল এক্সাম ডেটা লেখা ও পড়া
//
// ── কীভাবে সেটআপ করবে ──
// ১. tv-course (মেইন) Firebase Console → Authentication → Settings →
//    Authorized domains → তোমার exam site domain যোগ করো
// ২. নতুন Firebase project "tv-exam" তৈরি করো
// ৩. নিচে EXAM_CONFIG তে tv-exam এর config বসাও
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// ── ১. মেইন কোর্স প্রজেক্ট (Auth + ইউজার/কোর্স ডেটা) ─────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyA7Bzpu_RPI8wqIkSqjmh4aXFK_ARXC88g",
  authDomain:        "tv-course.firebaseapp.com",
  projectId:         "tv-course",
  storageBucket:     "tv-course.firebasestorage.app",
  messagingSenderId: "394638935623",
  appId:             "1:394638935623:web:af274fe9001abfa9771362",
};

// ── ২. এক্সাম প্রজেক্ট (এক্সাম ডেটা) ────────────────────────────────────
// ⚠️ নিচের config টা Firebase Console → tv-exam project → Project settings
//    → Your apps → SDK setup → Config থেকে copy করে বসাও
const firebaseConfig = {
  apiKey:            "AIzaSyCJyClYm7m4IFSJtuyjvNHhY4iHnCXJhKQ",
  authDomain:        "tvexam.firebaseapp.com",
  projectId:         "tvexam",
  storageBucket:     "tvexam.firebasestorage.app",
  messagingSenderId: "568880836905",
  appId:             "1:568880836905:web:3bac39c8d6c113c6d3c738",
  measurementId:     "G-JZY90RTTE0",
};

// ── Apps initialize ───────────────────────────────────────────────────────
const mainApp = initializeApp(MAIN_CONFIG, "main");
const examApp = initializeApp(EXAM_CONFIG, "exam");

// ── Exports ───────────────────────────────────────────────────────────────
// auth   → মেইন প্রজেক্ট — একটাই Auth দুই সাইটে কাজ করে
// mainDb → মেইন Firestore — শুধু read (ইউজার প্রোফাইল, purchases, courses)
// examDb → এক্সাম Firestore — read + write (exams, questions, results, attempts)
// storage→ মেইন Storage — প্রোফাইল ছবি আপলোড এখান থেকে
export const auth    = getAuth(mainApp);
export const mainDb  = getFirestore(mainApp);
export const examDb  = getFirestore(examApp);
export const storage = getStorage(mainApp);

// ── Offline persistence (examDb) ─────────────────────────────────────────
enableIndexedDbPersistence(examDb).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Exam Firestore offline: একাধিক ট্যাব — শুধু একটায় কাজ করবে।");
  } else if (err.code === "unimplemented") {
    console.warn("Exam Firestore offline: ব্রাউজার IndexedDB সাপোর্ট করে না।");
  }
});
