import { enhanceDiffBlocks } from "./code-diff.js";
import { enhanceCodeBlocks } from "./code-enhance.js";
import { initResponsiveCode } from "./responsive-code.js";

// Module scripts run after parsing. Diff decoration preserves the source;
// capture it before responsive formatting and measure controls next frame.
enhanceDiffBlocks();
enhanceCodeBlocks();
requestAnimationFrame(initResponsiveCode);
