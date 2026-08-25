// ==========================================================================
// router.js — TV Exam hash-based SPA router
// Routes:
//   #/          → exam list (home)
//   #/exam?id=  → take exam
//   #/result?id= → result detail
//   #/profile   → profile + history
//   #/history   → my results
//   #/leaderboard?examId= → leaderboard
//   #/login     → login
//   #/signup    → signup
//   #/forgot    → forgot password
// ==========================================================================

export function parseHash(hash = window.location.hash) {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qi  = raw.indexOf("?");
  const path = (qi === -1 ? raw : raw.slice(0, qi)).replace(/^\//, "") || "";
  const search = qi === -1 ? "" : raw.slice(qi);
  return { route: path, params: new URLSearchParams(search) };
}

export function navigate(hash) {
  window.location.hash = hash.startsWith("#") ? hash : `#${hash}`;
}

export class Router {
  constructor(routes) {
    this._routes = routes;
    this._current = null;
    this._cleanup = null;
    this._bound = this._onHashChange.bind(this);
  }

  start() {
    window.addEventListener("hashchange", this._bound);
    this._render();
  }

  stop() {
    window.removeEventListener("hashchange", this._bound);
  }

  _onHashChange() { this._render(); }

  async _render() {
    const { route, params } = parseHash();
    const hash = window.location.hash;
    const changed = hash !== this._current;
    this._current = hash;

    // Run previous page's cleanup
    if (this._cleanup) { try { this._cleanup(); } catch {} this._cleanup = null; }

    const handler = this._routes[route] || this._routes["404"] || this._routes[""];
    if (handler) {
      const cleanup = await handler(params);
      if (typeof cleanup === "function") this._cleanup = cleanup;
      if (changed) window.scrollTo(0, 0);
    }
  }
}
