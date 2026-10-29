import { enhanceCodeBlocks } from "./code-enhance.js";
import { initResponsiveCode } from "./responsive-code.js";

// Module scripts run after parsing. Capture the source before formatting,
// then measure the new controls in the next animation frame.
enhanceCodeBlocks();
requestAnimationFrame(initResponsiveCode);
