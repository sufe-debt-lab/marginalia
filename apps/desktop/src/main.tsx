import { createRoot } from "react-dom/client";
// Local font bundles (woff2) — Geist Sans / Geist Mono / Source Serif 4.
// Replaces the Google Fonts CDN so the desktop app renders correctly offline.
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";
import "@fontsource-variable/source-serif-4";
import { Toaster } from "@/components/ui/sonner.js";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Toaster position="bottom-right" />
  </>
);

// Drop the static splash once React has painted. Its "starting" state renders an
// identical <LoadingSplash />, so the handoff is invisible; double rAF guarantees
// React's first frame is on screen before we remove the overlay.
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    document.getElementById("splash")?.remove();
  });
});
