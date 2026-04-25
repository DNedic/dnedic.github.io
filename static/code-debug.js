"use strict";

window.__rcDebug = function debugDump(charW, dbg, note) {
  let panel = document.getElementById("rc-debug");
  if (!panel) {
    panel = document.createElement("pre");
    panel.id = "rc-debug";
    panel.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:99999;margin:0;" +
      "padding:8px 10px;background:rgba(0,0,0,0.88);color:#fff;" +
      "font:12px/1.35 ui-monospace,monospace;white-space:pre-wrap;" +
      "max-height:50vh;overflow:auto;border-top:2px solid #007ea7;";
    document.body.appendChild(panel);
  }
  const vv = window.visualViewport;
  const lines = [
    `[${note || ""}]`,
    `dpr=${window.devicePixelRatio}` +
    ` innerW=${window.innerWidth}` +
    ` docW=${document.documentElement.clientWidth}` +
    (vv ? ` vvW=${Math.round(vv.width)} vvScale=${vv.scale.toFixed(2)}` : "") +
    ` charW=${charW.toFixed(3)}`
  ];
  for (const d of dbg) {
    lines.push(`#${d.i} clientW=${d.cw} pill=${d.pw}` +
               ` cols=${d.cols} colsFull=${d.colsFull}` +
               ` padL=${d.padL} padR=${d.padR} inlineR=${d.inlineR}`);
  }
  panel.textContent = lines.join("\n");
};
