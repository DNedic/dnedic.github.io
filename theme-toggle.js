(function () {
  "use strict";

  const btn = document.querySelector(".theme-toggle");
  if (!btn) return;  // not rendered (dark_mode disabled)
  btn.addEventListener("click", () => {
    const html = document.documentElement;
    let current = html.getAttribute("data-theme");
    if (current === null) {
      current = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });
})();
