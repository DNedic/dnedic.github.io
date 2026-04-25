// Responsive code formatting
// Measures available columns in each <pre> block and:
//   1. Compresses structural indentation when viewport is narrow
//   2. Breaks long lines at semantic points (language-aware)
//
// Works with Zola's syntect output: <pre data-lang="..."><code><span>...</span></code></pre>

(function () {
  "use strict";

  // ── Tuning constants ────────────────────────────────────────────────
  const DEBOUNCE_MS          = 150;  // resize debounce delay
  const MAX_LINES            = 500;  // skip blocks longer than this
  const MAX_SPLITS           = 10;   // max breaks per source line
  const MAX_COLS             = 200;  // skip formatting above this width
  const FALLBACK_COLS        = 80;   // when char-width probe fails
  const DEFAULT_INDENT_STEP  = 4;    // assumed step when none detected
  const CONT_INDENT          = 4;    // default continuation indent offset
  const MIN_COMPRESSED_STEP  = 2;    // never compress indent below this
  const COMPRESS_THRESHOLD   = 55;   // compress only below this col count
  const COMPRESS_AGGRESSIVE  = 35;   // halve indent below this col count
  const BACKSLASH_RESERVE    = 2;    // columns reserved for trailing " \"
  const PAREN_OFFSET         = 1;    // continuation past opening '('
  const LD_COLON_OFFSET      = 2;    // continuation past ld ": " separator

  const SKIP_LANGS        = new Set(["asm", "nasm", "gas"]);
  const SPACE_BREAK_LANGS = new Set(["bash", "dockerfile", "nix"]);
  const BACKSLASH_LANGS   = new Set(["bash", "dockerfile"]);
  const OPENERS = { '(': ')', '[': ']', '{': '}' };
  const CLOSERS = { ')': '(', ']': '[', '}': '{' };

  // ── Break rules ──────────────────────────────────────────────────────
  // { pat, mode } — "after": break after pat; "before": break before pat.
  // Rightmost match within column budget wins.
  // Languages in SPACE_BREAK_LANGS skip these entirely and break at any
  // unquoted space instead.

  const c_like = [
    { pat: "{",    mode: "after" },
    { pat: "}",    mode: "before" },
    { pat: " = ",  mode: "after" },
    { pat: " || ", mode: "before" },
    { pat: " && ", mode: "before" },
  ];

  const COMMON_RULES = [
    { pat: ", ", mode: "after",  sep: true },
    { pat: "; ", mode: "after",  sep: true },
    { pat: "(",  mode: "after" },
    { pat: ")",  mode: "before" },
  ];

  const RULES = {
    c:   c_like.concat([
      { pat: " << ", mode: "before" },
      { pat: " >> ", mode: "before" },
      { pat: "->",   mode: "before" },
    ]).concat(COMMON_RULES),
    cpp: c_like.concat([
      { pat: " << ", mode: "before" },
      { pat: " >> ", mode: "before" },
      { pat: "->",   mode: "before" },
      { pat: "::",   mode: "before" },
    ]).concat(COMMON_RULES),
    h:     c_like.concat(COMMON_RULES),
    cmake: [
      { pat: " -",  mode: "before", sep: true },
      { pat: " \"", mode: "before", sep: true },
    ].concat(COMMON_RULES),
    ld: [
      { pat: ", ",  mode: "before", sep: true },
      { pat: ": ",  mode: "after" },
      { pat: " > ", mode: "before" },
    ].concat(COMMON_RULES),
  };

  // Break rule for space-separated argument languages (bash, dockerfile, nix).
  // A single space acts as both the break point and the argument separator.
  const SPACE_RULES = [{ pat: " ", mode: "before", sep: true }];

  // ── Segment helpers ──────────────────────────────────────────────────
  // A "segment" is { text, open, close } — plain text plus its wrapping
  // HTML tag (from syntect's <span> elements). A "line" is an array of
  // segments representing one source line.

  function plain(line) {
    return line.map(seg => seg.text).join('');
  }

  function leadingSpaces(line) {
    return Math.max(0, plain(line).search(/\S/));
  }

  function toHTML(line) {
    return line.map(seg => {
      const e = seg.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return seg.open ? seg.open + e + seg.close : e;
    }).join('');
  }

  function stripLeading(line) {
    const out = [];
    let stripping = true;
    for (let i = 0; i < line.length; i++) {
      if (stripping) {
        const t = line[i].text;
        let j = 0;
        while (j < t.length && t[j] === " ") j++;
        if (j < t.length) {
          out.push({ text: t.slice(j), open: line[i].open, close: line[i].close });
          stripping = false;
        }
      } else {
        out.push(line[i]);
      }
    }
    return out;
  }

  function removeNSpaces(line, n) {
    if (n <= 0) return line;
    const out = [];
    let rem = n;
    for (let i = 0; i < line.length; i++) {
      if (rem > 0) {
        const t = line[i].text;
        let cut = 0;
        while (cut < t.length && cut < rem && t[cut] === " ") cut++;
        rem -= cut;
        const rest = t.slice(cut);
        if (rest.length || line[i].open) out.push({ text: rest, open: line[i].open, close: line[i].close });
      } else {
        out.push(line[i]);
      }
    }
    return out;
  }

  function splitAt(line, pos) {
    const before = [], after = [];
    let count = 0, done = false;
    for (let i = 0; i < line.length; i++) {
      if (done) { after.push(line[i]); continue; }
      const seg = line[i];
      if (count + seg.text.length <= pos) {
        before.push(seg);
        count += seg.text.length;
        if (count === pos) done = true;
      } else {
        const at = pos - count;
        before.push({ text: seg.text.slice(0, at), open: seg.open, close: seg.close });
        if (seg.text.length > at)
          after.push({ text: seg.text.slice(at), open: seg.open, close: seg.close });
        done = true;
      }
    }
    return [before, after];
  }

  function prependPad(line, n) {
    const pad = " ".repeat(n);
    return [{ text: pad, open: "", close: "" }].concat(stripLeading(line));
  }

  // ── Parsing ──────────────────────────────────────────────────────────

  function measureCharWidth(pre) {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;width:1ch;font:inherit";
    const container = pre.querySelector("code") || pre;
    container.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    container.removeChild(probe);
    return w || 0;
  }

  // Measures the pill width at format time rather than relying on a dataset
  // written by code-enhance.js in a separate rAF. Avoids a timing race where
  // the initial offsetWidth read happens before layout settles on mobile
  // (pillWidth=0 → line 0 gets the full budget and sits under the pill).
  function pillWidth(pre) {
    const parent = pre.parentElement;
    if (!parent) return 0;
    const controls = parent.querySelector(".code-controls");
    return controls ? controls.offsetWidth : 0;
  }

  // Line 0 cols: reserves space for the controls pill so line 0 text stays
  // clear of it. Lines 1+ use the natural padding only (reservePill = false).
  function measureColumns(pre, charW, reservePill) {
    if (!charW) return FALLBACK_COLS;
    const style = getComputedStyle(pre);
    const padL = parseFloat(style.paddingLeft) || 0;
    let padR = parseFloat(style.paddingRight) || 0;
    if (reservePill) {
      const pw = pillWidth(pre);
      if (pw) padR = pw + 18;
    }
    return Math.floor((pre.clientWidth - padL - padR) / charW);
  }

  function extractLines(codeEl) {
    const lines = [[]];
    for (let i = 0; i < codeEl.childNodes.length; i++) {
      const node = codeEl.childNodes[i];
      let open = "", close = "", text = "";
      if (node.nodeType === 3) {
        text = node.textContent;
      } else if (node.nodeType === 1 && node.tagName === "SPAN") {
        const html = node.outerHTML;
        open = html.slice(0, html.indexOf(">") + 1);
        close = "</span>";
        text = node.textContent;
      } else continue;
      const parts = text.split("\n");
      for (let p = 0; p < parts.length; p++) {
        if (p > 0) lines.push([]);
        if (parts[p].length || (p === 0 && open))
          lines[lines.length - 1].push({ text: parts[p], open: open, close: close });
      }
    }
    return lines;
  }

  // ── Analysis ─────────────────────────────────────────────────────────

  function detectIndentStep(lines) {
    let step = 0;
    for (let i = 0; i < lines.length; i++) {
      const sp = leadingSpaces(lines[i]);
      if (sp > 0 && (!step || sp < step)) step = sp;
    }
    return step || DEFAULT_INDENT_STEP;
  }

  function computeCompressedStep(step, cols) {
    if (cols >= COMPRESS_THRESHOLD || step <= MIN_COMPRESSED_STEP) return step;
    return cols < COMPRESS_AGGRESSIVE
      ? Math.max(step >> 1, MIN_COMPRESSED_STEP)
      : Math.max(step - 1, MIN_COMPRESSED_STEP);
  }

  // ── Indent compression ──────────────────────────────────────────────
  // Multiplies every line's leading-space count by `factor` (0 < factor ≤ 1),
  // rounding to the nearest integer.  Factor is computed once from the first
  // code block on the page and applied uniformly to all blocks.

  function applyIndentFactor(lines, factor) {
    // Detect this block's indent step to distinguish structural from alignment indents.
    const step = detectIndentStep(lines);

    let changed = false;
    let prevOrig = null;  // original plain text of previous line (pre-compression)
    let prevSp = 0;
    let prevRemoved = 0;
    let prevAligned = false;
    for (let i = 0; i < lines.length; i++) {
      const orig = plain(lines[i]);
      const sp = Math.max(0, orig.search(/\S/));
      if (sp > 0) {
        // A line is alignment-indented when the previous original line has
        // content at this column AND either it's a large forward jump (new
        // alignment start) or the previous line was itself aligned (continuation).
        const hasPrevContent = prevOrig !== null && sp < prevOrig.length && prevOrig[sp] !== ' ';
        const aligned = hasPrevContent
          && (sp > prevSp && sp - prevSp > step || prevAligned && sp >= prevSp);
        const remove = aligned ? prevRemoved : sp - Math.round(sp * factor);
        if (remove > 0) {
          lines[i] = removeNSpaces(lines[i], remove);
          changed = true;
        }
        prevRemoved = remove;
        prevAligned = aligned;
      } else {
        prevRemoved = 0;
        prevAligned = false;
      }
      prevOrig = orig;
      prevSp = sp;
    }
    return changed;
  }

  // ── Line breaking ────────────────────────────────────────────────────

  // Returns true if the container at openPos has a single argument
  // (no comma at depth 1 — breaking at the bracket wastes vertical space).
  function singleArgContainer(text, openPos) {
    const open = text[openPos], close = OPENERS[open];
    if (!close) return false;
    let depth = 0;
    for (let i = openPos; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) { depth--; if (depth === 0) return true; }
      else if (text[i] === ',' && depth === 1) return false;
    }
    return true; // unclosed — treat as single-arg
  }

  // Find the matching opener for a closer at closePos.
  function findMatchingOpen(text, closePos) {
    const close = text[closePos], open = CLOSERS[close];
    if (!open) return -1;
    let depth = 0;
    for (let i = closePos; i >= 0; i--) {
      if (text[i] === close) depth++;
      else if (text[i] === open) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  // ── Chunk scanner ────────────────────────────────────────────────────
  // Truly single-pass over a text chunk.  In one left-to-right scan:
  //   • tracks string context (both " and ') incrementally
  //   • tracks bracket depth/column for continuation-indent computation
  //   • accumulates `best` — the rightmost break within the column budget
  //     (the "go back one token" moment: when the window closes, `best` is
  //     the last opportunity that fit, with no further search)
  //   • tracks `lastSepPos` — rightmost argument separator seen anywhere,
  //     used to detect single-argument containers without a second pass
  //
  // Returns { bp, ps, hasArgSep } or null.
  // initPs carries bracket state accumulated from previous chunks so that
  // multi-line breaks stay aware of earlier openers.
  // "Before-closer" breaks save the pre-decrement bracket state so the
  // first fragment still sees the enclosing bracket in its depth count.
  function scanChunk(text, lang, floor, maxCols, initPs) {
    const isSpaceLang = SPACE_BREAK_LANGS.has(lang);
    const rules = isSpaceLang ? SPACE_RULES : (RULES[lang] || COMMON_RULES);
    let inStr = false, strChar = '';

    let depth = initPs.depth, openCol = initPs.col;
    let prevDepth, prevOpenCol;           // state before current char's bracket update

    let best = -1, bestPs = null;
    let lastSepPos = -1;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];

      if (inStr) {
        if (c === strChar && (i === 0 || text[i - 1] !== '\\')) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strChar = c; continue; }

      prevDepth = depth; prevOpenCol = openCol;
      if (OPENERS[c]) { depth++; openCol = i; }
      else if (CLOSERS[c]) { depth--; if (depth <= 0) { depth = 0; openCol = -1; } }

      for (let r = 0; r < rules.length; r++) {
        const pat  = rules[r].pat;
        const plen = pat.length;
        if (c !== pat[0]) continue;
        if (plen > 1) {
          let ok = true;
          for (let k = 1; k < plen; k++)
            if (text[i + k] !== pat[k]) { ok = false; break; }
          if (!ok) continue;
        }

        const bp = rules[r].mode === 'after' ? i + plen : i;
        if (bp <= floor || bp >= text.length) continue;

        if (plen === 1 && OPENERS[pat]) {
          if (singleArgContainer(text, i)) continue;
        } else if (plen === 1 && CLOSERS[pat]) {
          const op = findMatchingOpen(text, i);
          if (op >= 0 && singleArgContainer(text, op)) continue;
        }

        if (rules[r].sep)
          if (bp > lastSepPos) lastSepPos = bp;

        if (bp <= maxCols && bp > best) {
          best = bp;
          // "before" at a closer: first half excludes the closer, so depth
          // must still reflect the open bracket — use pre-decrement state.
          bestPs = (rules[r].mode === 'before' && plen === 1 && CLOSERS[pat])
            ? { depth: prevDepth, col: prevOpenCol }
            : { depth: depth, col: openCol };
        }
      }
    }

    if (best < 0) return null;
    return { bp: best, ps: bestPs, hasArgSep: lastSepPos >= best };
  }

  function defaultContIndent(lang, text, indent) {
    if (lang === "ld") {
      const colon = text.indexOf(": ");
      return colon >= 0 ? colon + LD_COLON_OFFSET : indent + CONT_INDENT;
    }
    return indent + CONT_INDENT;
  }

  function continuationIndent(ps, prevDepth, indent, fallback, maxCols) {
    let ci;
    if (ps.depth > 0 && ps.col >= 0)
      ci = ps.col + PAREN_OFFSET;           // inside parens: align past '('
    else if (prevDepth > 0 && ps.depth === 0)
      ci = indent;                          // just closed parens: back to base
    else
      ci = fallback;
    return Math.min(ci, maxCols >> 1);
  }

  function breakLine(line, cols, colsFull, lang) {
    const text = plain(line);
    const addBackslash = BACKSLASH_LANGS.has(lang);
    const budget = addBackslash ? cols - BACKSLASH_RESERVE : cols;
    const budgetFull = addBackslash ? colsFull - BACKSLASH_RESERVE : colsFull;
    if (text.length <= budget) return null;

    const indent = leadingSpaces(line);
    const fallbackCI = defaultContIndent(lang, text, indent);
    let ps = { depth: 0, col: -1 };
    let rem = line;
    const pieces = [];
    let splits = MAX_SPLITS, prevLen = text.length;
    let iter = 0;

    while (splits-- > 0) {
      // After the first split the continuation is on a new visual line —
      // the pill only affects line 0, so use the wider colsFull budget.
      const curBudget = iter++ === 0 ? budget : budgetFull;
      const rt = plain(rem);
      if (rt.length <= curBudget) break;

      const result = scanChunk(rt, lang, Math.max(0, rt.search(/\S/)), curBudget, ps);
      if (!result || result.bp >= rt.length - 1) break;

      const halves = splitAt(rem, result.bp);
      const prevDepth = ps.depth;
      ps = result.ps;
      let ci = continuationIndent(ps, prevDepth, indent, fallbackCI, colsFull);

      // Single-argument container: avoid wasteful deep indent
      if (ps.depth > 0 && ci > fallbackCI && !result.hasArgSep)
        ci = Math.min(fallbackCI, cols >> 1);

      pieces.push(toHTML(halves[0]) + (addBackslash ? " \\" : ""));
      rem = prependPad(halves[1], ci);

      const newLen = plain(rem).length;
      if (newLen >= prevLen) break;
      prevLen = newLen;
    }

    if (!pieces.length) return null;
    pieces.push(toHTML(rem));
    return pieces.join("\n");
  }

  // ── Block formatter ──────────────────────────────────────────────────

  function formatBlock(pre, cols, colsFull, factor) {
    const codeEl = pre.querySelector("code");
    if (!codeEl) return;

    const lang = (pre.getAttribute("data-lang") || "").toLowerCase();
    if (SKIP_LANGS.has(lang)) return;

    const lines = extractLines(codeEl);
    if (lines.length > MAX_LINES) return;

    let changed = factor < 1 && applyIndentFactor(lines, factor);

    const output = [];
    for (let i = 0; i < lines.length; i++) {
      // Line 0 sits under the controls pill; subsequent lines use the full
      // content width. breakLine itself also switches from cols to colsFull
      // after the first split (continuations of line 0 are no longer under
      // the pill either).
      const broken = breakLine(lines[i], i === 0 ? cols : colsFull, colsFull, lang);
      if (broken !== null) {
        output.push(broken);
        changed = true;
      } else {
        output.push(toHTML(lines[i]));
      }
    }

    if (changed) {
      if (!codeEl.hasAttribute("data-original"))
        codeEl.setAttribute("data-original", codeEl.innerHTML);
      codeEl.innerHTML = output.join("\n");
    }
  }

  // ── Init & resize ────────────────────────────────────────────────────

  function restoreAll() {
    const els = document.querySelectorAll("pre code[data-original]");
    for (let i = 0; i < els.length; i++)
      els[i].innerHTML = els[i].getAttribute("data-original");
  }

  function formatAll() {
    restoreAll();
    const pres = document.querySelectorAll("pre[data-lang]");
    if (!pres.length) { if (window.__rcDebug) window.__rcDebug(0, [], "no pres"); return; }

    // Measure character width once (single DOM operation); all code blocks
    // share the same monospace font so charW is uniform across blocks.
    const charW = measureCharWidth(pres[0]);
    const cols0 = measureColumns(pres[0], charW, true);
    if (cols0 <= 0 || cols0 >= MAX_COLS) {
      if (window.__rcDebug) window.__rcDebug(charW, [{ i: 0, cw: pres[0].clientWidth, pw: pillWidth(pres[0]), cols: cols0, colsFull: measureColumns(pres[0], charW, false) }], "early return cols0=" + cols0);
      return;
    }

    // Compute a global indent factor from the first processable block so that
    // all blocks on the page share the same indentation scale.
    let factor = 1;
    for (let j = 0; j < pres.length; j++) {
      const lang0 = (pres[j].getAttribute("data-lang") || "").toLowerCase();
      if (SKIP_LANGS.has(lang0)) continue;
      const code0 = pres[j].querySelector("code");
      if (!code0) continue;
      const lines0 = extractLines(code0);
      if (lines0.length > MAX_LINES) continue;
      const step = detectIndentStep(lines0);
      factor = computeCompressedStep(step, cols0) / step;
      break;
    }

    // Use per-block cols so each block's own controls paddingRight is accounted
    // for independently — prevents cross-block contamination where pres[0]'s
    // wider/narrower controls caused wrong col counts for all other blocks.
    const dbg = [];
    for (let i = 0; i < pres.length; i++) {
      const cols = measureColumns(pres[i], charW, true);
      const colsFull = measureColumns(pres[i], charW, false);
      const cs = getComputedStyle(pres[i]);
      dbg.push({ i: i, cw: pres[i].clientWidth, pw: pillWidth(pres[i]), cols: cols, colsFull: colsFull,
                 padL: cs.paddingLeft, padR: cs.paddingRight, inlineR: pres[i].style.paddingRight || "-" });
      try { formatBlock(pres[i], cols, colsFull, factor); }
      catch (e) { console.error("responsive-code:", i, e); }
    }

    if (window.__rcDebug) window.__rcDebug(charW, dbg, "ok");
  }

  let timer;
  function onResize() { clearTimeout(timer); timer = setTimeout(formatAll, DEBOUNCE_MS); }

  function init() {
    if (/[?&#]debug=code\b/.test(location.search + location.hash)) {
      const s = document.createElement("script");
      s.src = "/code-debug.js";
      document.head.appendChild(s);
    }
    document.addEventListener("codeenhance:ready", function () {
      formatAll();
      window.addEventListener("resize", onResize);
    }, { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
