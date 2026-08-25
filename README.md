# TV Exam — Exam Platform

> **Tech Verse Learning** এর Exam Site। কোর্স সাইটের সাথে সংযুক্ত — একটাই Firebase Auth, দুইটা আলাদা Firestore।

---

## 📁 Project Structure

```
tv-exam/
├── index.html           ← Main SPA shell (exam list, take, result, profile, leaderboard)
├── admin.html           ← Admin panel (exam management, results, leaderboard, users)
├── sw.js                ← Service Worker (PWA offline support)
├── manifest.json        ← PWA manifest
├── firestore.rules      ← tv-exam Firestore security rules
│
├── css/
│   ├── base.css         ← Design tokens, components, layout
│   ├── auth.css         ← Login / signup styles
│   ├── exam.css         ← Exam cards, take exam, result view
│   └── admin.css        ← Admin panel sidebar + sections
│
├── js/
│   ├── firebase-config.js  ← ⚠️ SETUP REQUIRED — দুই Firebase config
│   ├── theme.js            ← Dark/light flash-free init
│   ├── router.js           ← Hash-based SPA router
│   ├── utils.js            ← Auth helpers, toast, nav, formatters
│   ├── auth.js             ← Login / signup / forgot password
│   ├── exam.js             ← Exam list, take exam, timer, scoring, PDF result
│   ├── profile.js          ← Profile page + exam history
│   ├── admin.js            ← Full admin panel logic
│   └── app.js              ← SPA entry — routes to views
│
└── assets/
    ├── logo.png            ← TV Exam logo (তোমার logo এখানে রাখো)
    ├── google.svg          ← Google OAuth button icon
    └── icons/              ← PWA icons (favicon, apple-touch, etc.)
```

---

## ⚙️ Setup (Step by Step)

### Step 1 — নতুন Firebase Project তৈরি করো

1. [Firebase Console](https://console.firebase.google.com) → **Add project** → নাম: `tv-exam`
2. **Authentication** → Enable করো (Email/Password + Google)
3. **Firestore Database** → Create database → Production mode

### Step 2 — Authorized Domain যোগ করো (গুরুত্বপূর্ণ!)

> মেইন `tv-course` Firebase project এ করতে হবে।

1. `tv-course` Firebase Console → **Authentication** → **Settings** → **Authorized domains**
2. তোমার exam site domain যোগ করো (e.g. `tv-exam.vercel.app`)

এটা না করলে exam site এ login কাজ করবে না!

### Step 3 — firebase-config.js আপডেট করো

`js/firebase-config.js` খোলো এবং `EXAM_CONFIG` তে তোমার `tv-exam` project এর config বসাও:

```js
const EXAM_CONFIG = {
  apiKey:            "তোমার-tv-exam-apiKey",
  authDomain:        "tv-exam.firebaseapp.com",
  projectId:         "tv-exam",
  storageBucket:     "tv-exam.firebasestorage.app",
  messagingSenderId: "তোমার-messagingSenderId",
  appId:             "তোমার-appId",
};
```

Config পাবে: Firebase Console → tv-exam → Project settings → Your apps → SDK setup → Config

### Step 4 — Firestore Rules deploy করো

`firestore.rules` ফাইলের rules টা `tv-exam` Firestore Rules এ paste করো।

তারপর admin ইউজারের জন্য `admins` collection এ তোমার UID যোগ করো:
```
admins/
  YOUR_UID/
    (empty doc or { name: "Admin" })
```

### Step 5 — index.html ও admin.html আপডেট করো

`index.html` এ এই দুটো জায়গায় তোমার real domain বসাও:
```html
<meta property="og:url" content="https://REPLACE_EXAM_DOMAIN/">
<a href="https://REPLACE_COURSE_DOMAIN" ...>Course</a>
```

### Step 6 — Assets যোগ করো

- `assets/logo.png` → তোমার logo (recommended: 128×128px PNG)
- `assets/icons/` → PWA icons (favicon.ico, icon-192x192.png, icon-512x512.png minimum)

### Step 7 — Deploy

```bash
# Vercel (recommended)
npx vercel

# Netlify
netlify deploy --prod

# GitHub Pages
# (dist folder upload করো)
```

---

## 🗺️ Architecture

```
┌─────────────────────────────────────┐
│   Firebase Project #1: tv-course    │
│                                     │
│   ✅ Auth (একটাই — দুই সাইটে)       │
│   ✅ Firestore → users, courses,    │
│      purchases (শুধু READ করবে      │
│      exam site থেকে)                │
│   ✅ Storage → avatars              │
└──────────────────┬──────────────────┘
                   │  auth + mainDb (read-only)
┌──────────────────▼──────────────────┐
│   Firebase Project #2: tv-exam      │
│                                     │
│   ✅ Firestore → exams, questions,  │
│      results, attempts, config,     │
│      admins                         │
└─────────────────────────────────────┘
```

**Key Points:**
- `auth` সবসময় `tv-course` project থেকে — একবার login করলে দুই সাইটেই কাজ করে
- `mainDb` শুধু ইউজার প্রোফাইল ও enrollment check এর জন্য (read-only)
- `examDb` সব exam data এর জন্য (read + write)
- Storage: `tv-course` এরটাই ব্যবহার হয় (profile photo upload)

---

## 📋 Firestore Collections (tv-exam)

| Collection | কি আছে |
|---|---|
| `exams/{id}` | title, description, courseId, duration, passMark, maxAttempts, negativeMarking, shuffle, layout, publishAt, closesAt |
| `exams/{id}/questions/{id}` | text, options[], correctIndex, explanation, order |
| `results/{uid}_{examId}` | score, percent, correct, wrong, answers, attemptNumber |
| `attempts/{id}` | same as results + full attempt log |
| `config/site` | siteName, passMark, courseSiteUrl |
| `admins/{uid}` | admin ইউজারদের UID |

---

## 🔗 Routes

| URL | Page |
|---|---|
| `#/` | Exam list |
| `#/exam?id=EXAM_ID` | Take exam |
| `#/leaderboard` | Leaderboard |
| `#/leaderboard?examId=ID` | Filtered leaderboard |
| `#/profile` | Profile + history |
| `#/history` | Exam history |
| `#/login` | Login |
| `#/signup` | Sign up |
| `#/forgot` | Forgot password |
| `admin.html` | Admin panel |

---

## 🎨 Design

- **Color scheme:** Deep Navy (`#080C14`) + Electric Blue (`#2563EB`) + Cyan accent
- **Font:** Space Grotesk (display) + Hind Siliguri (body) + JetBrains Mono (timer/code)
- **কোর্স সাইটের থেকে সম্পূর্ণ আলাদা** visual identity

---

## 🚀 Features

**Student Side:**
- ✅ Exam list with availability (open/upcoming/closed countdown)
- ✅ Course-linked exams (enrollment check)
- ✅ Timer with low-time alert
- ✅ One-by-one OR all-at-once question layout
- ✅ Negative marking support
- ✅ Max attempts limit
- ✅ Instant result with score ring, breakdown
- ✅ Answer review after exam
- ✅ PDF result download
- ✅ Leaderboard
- ✅ Profile + exam history + stats
- ✅ Dark/light mode
- ✅ PWA (installable)

**Admin Side:**
- ✅ Overview stats + recent attempts
- ✅ Add/edit/delete exams with full settings
- ✅ Question builder (add/edit/delete options, mark correct answer)
- ✅ All results table with search
- ✅ Leaderboard with exam filter
- ✅ User list (from main DB)
- ✅ Site settings

---

*Built with ❤️ for Tech Verse Learning*
