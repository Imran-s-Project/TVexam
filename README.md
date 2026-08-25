# Tech Verse Exam

আলাদা Exam ওয়েবসাইট — **একই Firebase project** (Auth + Firestore) ব্যবহার করে Course সাইটের সাথে শেয়ারড ইউজার।

## ✨ বৈশিষ্ট্য (আপডেটেড)

**Student side**
- একই অ্যাকাউন্ট (Course সাইটের ইমেইল/পাসওয়ার্ড)
- Dashboard (best score সহ), Exam list (search + filter + sort), Take exam (timer, shuffle, negative marking, variable-weight marks)
- প্রশ্ন **navigator** (answered/flagged/current রঙে) + প্রতিটি প্রশ্নে **Flag for review**
- Tab-switch গোনা হয় (academic integrity) + এক্সাম চলাকালীন পেজ ছাড়লে confirm করে
- প্রতিটি Attempt আলাদাভাবে সেভ হয় — আগের মতো শুধু শেষেরটা থাকে না, পুরো ইতিহাস + প্রতিটি attempt-এর Answer Review দেখা যায়
- Exam Schedule (opens at / closes at) এবং Max attempts সম্মান করে
- My Results, Leaderboard (search + "You" হাইলাইট), Profile
- **Admin panel** (`admin.html`) — Exam ম্যানেজমেন্ট (কোর্স ম্যানেজমেন্ট Course সাইটের admin-এ)

**Admin side**
- Exam Settings: Category/Subject ট্যাগ, Status (Draft/Published), Schedule (start/end), Max attempts, Passing % , Negative marking, Shuffle, Show-all-on-one-page
- Question editor: ২–৬টি ভ্যারিয়েবল অপশন, প্রতিটি প্রশ্নে আলাদা **Marks** (weight), reorder (up/down), duplicate, ব্যাখ্যা (Explanation)
- **Bulk Import** ট্যাব — plain text / CSV / JSON পেস্ট করে অথবা `.json` ফাইল আপলোড করে একসাথে অনেক প্রশ্ন যোগ
- প্রতিটি Exam-এর প্রশ্ন **Export (JSON)** করা যায় — backup বা অন্য এক্সামে re-import করার জন্য
- Exam **Duplicate** বাটন (Draft হিসেবে কপি হয়)
- Exams table এ Search + Status filter; Results table এ Search + **CSV Export** + রেজাল্ট Delete
- Overview: মোট Exam/Attempts/Students/Avg/Pass-rate + Score distribution বার-চার্ট

## সেটআপ

1. `js/firebase-config.js` — ইতিমধ্যে Course সাইটের একই config আছে। প্রয়োজন হলে আপডেট করুন।
2. `js/utils.js` → `COURSE_SITE_URL` আপনার Course সাইটের URL দিন।
3. Firebase Hosting / Netlify / যেকোনো static host-এ deploy করুন।
4. Course সাইট থেকে Exam সাইটে লিংক দিন।

## Firestore

একই collections ব্যবহার হয়:
- `users` (shared)
- `courses` (read — paid lock check)
- `accessCodes` (read — access check)
- `exams` / `exams/{id}/questions`
- `results`

### exams/{id} — নতুন ফিল্ডসমূহ
```
title, courseName, category, courseId, duration, negativeMarking,
maxAttempts (0=unlimited), passingPercent (0=off), status ("published"|"draft"),
startAt, endAt (Timestamp | null), shuffle, showAll,
questionCount, totalMarks, createdAt, updatedAt
```
পুরনো ডকুমেন্টে এই ফিল্ডগুলো না থাকলেও কোনো সমস্যা নেই — কোডে সব ফিল্ডের জন্য ডিফল্ট ভ্যালু ধরা আছে (মিসিং `status` মানে `published`)।

### exams/{id}/questions/{qid}
```
text, options[] (2–6টি), correctIndex, explanation, marks (default 1), order
```

### results/{autoId}  ⚠️ পরিবর্তন হয়েছে
আগে result-এর ID ছিল `uid_examId` (fixed) — ফলে re-attempt করলে আগের ফলাফল **overwrite** হয়ে যেত।
এখন প্রতিটি attempt আলাদা **auto-ID** ডকুমেন্ট হিসেবে সেভ হয়, তাই সম্পূর্ণ ইতিহাস থাকে এবং Leaderboard-এর
"best attempt" হিসাব সঠিকভাবে কাজ করে। ফিল্ড: `uid, examId, examTitle, courseId, score, total, percent,
correctCount, wrongCount, unansweredCount, negativeMarking, timeTakenSeconds, attemptNumber, passed,
tabSwitches, studentName, studentEmail, submittedAt, review[]`

**Security rules চেক করুন:** নতুন লেখাগুলো সবসময় `addDoc` (create) দিয়ে হয়, কখনো নির্দিষ্ট ID-তে `update` না।
Rule-এ নিশ্চিত করুন:
```
match /results/{resultId} {
  allow read: if request.auth != null; // leaderboard-এর জন্য দরকার, চাইলে fields সীমিত করুন
  allow create: if request.auth.uid == request.resource.data.uid;
  allow delete: if isAdmin(); // admin panel থেকে ভুল রেজাল্ট মুছতে
  allow update: if false;
}
```

## ফাইল স্ট্রাকচার

```
index.html      → Student SPA
admin.html      → Exam admin
css/            → Distinct exam UI theme
js/
  firebase-config.js
  app.js          → Router + exam taking + navigator + attempt history
  admin.js        → Exam CRUD + bulk import/export + results + leaderboard
  auth.js, utils.js (bulk-import parser + shared helpers), theme.js
```
