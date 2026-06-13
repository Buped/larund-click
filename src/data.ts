export { MODELS } from './constants/models';

export const ACTION_TEMPLATES = [
  { type: "screenshot", icon: "eye",      color: "#A09D98", text: "Captured screen",                               detail: "1512 × 982 · scene parsed" },
  { type: "wait",       icon: "hourglass",color: "#F5A524", text: "Waiting for page to settle",                    detail: "DOM stable after 420ms" },
  { type: "click",      icon: "pointer",  color: "#4A9EFF", text: 'Clicked "Email address" field at (612, 318)',   detail: "Confidence: 97%" },
  { type: "type",       icon: "keyboard", color: "#3ECF8E", text: 'Typed "alex@larund.io"',                        detail: "28 keystrokes · field focused" },
  { type: "click",      icon: "pointer",  color: "#4A9EFF", text: 'Clicked "Company" field at (612, 392)',         detail: "Confidence: 95%" },
  { type: "type",       icon: "keyboard", color: "#3ECF8E", text: 'Typed "Larund Inc."',                           detail: "11 keystrokes" },
  { type: "scroll",     icon: "scrollV",  color: "#A78BFA", text: "Scrolled down 240px",                           detail: "Revealed plan options" },
  { type: "screenshot", icon: "eye",      color: "#A09D98", text: "Captured screen",                               detail: "Re-evaluating layout" },
];
