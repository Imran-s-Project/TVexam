# Tech Verse Exam

আলাদা Exam ওয়েবসাইট — **একই Firebase project** (Auth + Firestore) ব্যবহার করে Course সাইটের সাথে শেয়ারড ইউজার।

## বৈশিষ্ট্য

- একই অ্যাকাউন্ট (Course সাইটের ইমেইল/পাসওয়ার্ড)
- Dashboard, Exam list, Take exam (timer, shuffle, negative marking)
- My Results, Leaderboard, Profile
- **Admin panel** (`admin.html`) — শুধু Exam ম্যানেজমেন্ট (কোর্স ম্যানেজমেন্ট Course সাইটের admin-এ)

## সেটআপ

1. `js/firebase-config.js` — ইতিমধ্যে Course সাইটের একই config আছে। প্রয়োজন হলে আপডেট করুন।
2. `js/utils.js` → `COURSE_SITE_URL` আপনার Course সাইটের URL দিন।
3. Firebase Hosting / Netlify / যেকোনো static host-এ deploy করুন।
4. Course সাইট থেকে Exam সাইটে লিংক দিন।

## Firestore

একই collections ব্যবহার হয়:
- `users` (shared)
- `courses` (read — paid lock check)
- `accessCodes` (read — access check)
- `exams` / `exams/{id}/questions`
- `results`

Security rules Course সাইটের README অনুযায়ীই চলবে (`isAdmin()` on results read জরুরি)।

## ফাইল স্ট্রাকচার

```
index.html      → Student SPA
admin.html      → Exam admin
css/            → Distinct exam UI theme
js/
  firebase-config.js
  app.js          → Router + exam taking
  admin.js        → Exam CRUD + results
  auth.js, utils.js, theme.js
```
