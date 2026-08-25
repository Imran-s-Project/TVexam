// Theme — runs before body renders to prevent flash
(function () {
  try {
    const t = localStorage.getItem("exam_theme");
    if (t === "light") document.documentElement.dataset.theme = "light";
  } catch {}
})();
