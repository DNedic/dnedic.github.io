// Decorate Zola's highlighted HTML without changing its source or token colors.
// Line numbers refer to the combined snippet, starting at 1.
export function enhanceDiffBlocks() {
  function lineNumbers(value, count) {
    const numbers = new Set();
    for (const part of value.trim().split(/\s+/)) {
      const match = /^([1-9]\d*)(?:-([1-9]\d*))?$/.exec(part);
      if (!match) continue;
      const start = Number(match[1]);
      const end = Math.min(Number(match[2] || match[1]), count);
      for (let line = start; line <= end; line++) numbers.add(line);
    }
    return numbers;
  }

  for (const diff of document.querySelectorAll(".code-diff")) {
    const pre = diff.querySelector("pre[data-lang]");
    const code = pre && pre.querySelector("code");
    if (!code || pre.hasAttribute("data-diff")) continue;

    // Zola's linenos annotation adds a table with a separate number cell.
    // Diffs use their own gutter; retain only each row's highlighted source.
    if (pre.hasAttribute("data-linenos")) {
      const table = code.querySelector(":scope > table");
      const rows = table ? Array.from(table.rows) : [];
      if (!rows.length || rows.some(row => row.cells.length !== 2)) continue;

      const content = document.createDocumentFragment();
      for (const tableRow of rows) content.append(...tableRow.cells[1].childNodes);
      code.replaceChildren(content);
      pre.removeAttribute("data-linenos");
    }

    const source = code.textContent;
    const count = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
    const added = lineNumbers(diff.dataset.added || "", count);
    const removed = lineNumbers(diff.dataset.removed || "", count);
    const fragment = document.createDocumentFragment();
    let number = 0;
    let row;
    let clones;

    function nextRow() {
      row = document.createElement("span");
      row.className = "code-diff-line";
      number++;
      if (removed.has(number)) row.classList.add("is-removed");
      else if (added.has(number)) row.classList.add("is-added");
      fragment.appendChild(row);
      clones = new Map([[code, row]]);
    }

    // A token span can cross newlines. Reuse each ancestor clone within a
    // line so sibling tokens retain their shared wrappers without duplication.
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parts = node.textContent.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] || i < parts.length - 1) {
          if (!row) nextRow();
          if (parts[i]) {
            let token = document.createTextNode(parts[i]);
            let parent = node.parentElement;
            while (!clones.has(parent)) {
              const clone = parent.cloneNode(false);
              clone.appendChild(token);
              clones.set(parent, clone);
              token = clone;
              parent = parent.parentElement;
            }
            clones.get(parent).appendChild(token);
          }
        }
        if (i < parts.length - 1) {
          row.appendChild(document.createTextNode("\n"));
          row = null;
        }
      }
    }

    code.replaceChildren(fragment);
    pre.setAttribute("data-diff", "");
  }
}
