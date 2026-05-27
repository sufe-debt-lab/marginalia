import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner.js";
import { App } from "./App.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <>
    <App />
    <Toaster position="bottom-right" />
  </>
);
