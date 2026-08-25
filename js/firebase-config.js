// ==========================================================================
// Tech Verse Exam — Firebase (SAME project as Course site → shared Auth + users)
// ==========================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyA7Bzpu_RPI8wqIkSqjmh4aXFK_ARXC88g",
  authDomain: "tv-course.firebaseapp.com",
  projectId: "tv-course",
  storageBucket: "tv-course.firebasestorage.app",
  messagingSenderId: "394638935623",
  appId: "1:394638935623:web:af274fe9001abfa9771362",
  measurementId: "G-VF48BD7CFS",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Firestore offline: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Firestore offline: IndexedDB not supported.");
  }
});
