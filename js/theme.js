export function initTheme() {
  const stored = localStorage.getItem("tv_exam_theme");
  const theme = stored || "dark";
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.innerHTML = theme === "dark" ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("tv_exam_theme", next);
      btn.innerHTML = next === "dark" ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
    });
  }
}
