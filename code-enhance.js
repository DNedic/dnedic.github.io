// Wraps each <pre data-lang> with a language label and a copy-to-clipboard
// button. Dispatches "codeenhance:ready" on document after all pill widths
// are measured so responsive-code.js waits for that instead of racing on
// DOMContentLoaded. Must still load before responsive-code.js so the
// captured source text is the original, pre-formatted version.

(function () {
  "use strict";

  const LABELS = {
    c: "C",
    cpp: "C++",
    h: "C",
    hpp: "C++",
    cmake: "CMake",
    bash: "Bash",
    sh: "Shell",
    shell: "Shell",
    zsh: "Shell",
    js: "JavaScript",
    ts: "TypeScript",
    jsx: "JSX",
    tsx: "TSX",
    py: "Python",
    rs: "Rust",
    go: "Go",
    ld: "Linker script",
    toml: "TOML",
    yaml: "YAML",
    yml: "YAML",
    json: "JSON",
    md: "Markdown",
    html: "HTML",
    css: "CSS",
    scss: "SCSS",
    nix: "Nix",
    dockerfile: "Dockerfile",
    asm: "Assembly",
    nasm: "Assembly",
    gas: "Assembly",
    sql: "SQL",
    diff: "Diff",
  };

  function pretty(lang) {
    return LABELS[lang.toLowerCase()] || lang;
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:absolute;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function enhance(pre) {
    const code = pre.querySelector("code");
    if (!code) return;

    const lang = pre.getAttribute("data-lang") || "";
    const original = code.textContent;
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";

    const controls = document.createElement("div");
    controls.className = "code-controls";

    if (lang) {
      const langEl = document.createElement("span");
      langEl.className = "code-lang";
      langEl.textContent = pretty(lang);
      controls.appendChild(langEl);
    }

    const btn = document.createElement("button");
    btn.className = "code-copy";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.textContent = "Copy";

    let resetTimer = 0;
    function flash(ok) {
      btn.textContent = ok ? "Copied" : "Failed";
      btn.classList.toggle("copied", ok);
      btn.classList.toggle("failed", !ok);
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
        btn.classList.remove("failed");
      }, 1500);
    }

    btn.addEventListener("click", () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(original).then(
          () => { flash(true); },
          () => { flash(fallbackCopy(original)); }
        );
      } else {
        flash(fallbackCopy(original));
      }
    });

    controls.appendChild(btn);

    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(controls);
    wrapper.appendChild(pre);
  }

  function init() {
    const pres = document.querySelectorAll("pre[data-lang]");
    for (let i = 0; i < pres.length; i++) enhance(pres[i]);
    // Signal that every pre is wrapped; responsive-code.js measures the pill
    // widths itself at format time.
    requestAnimationFrame(() => {
      document.dispatchEvent(new CustomEvent("codeenhance:ready"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
