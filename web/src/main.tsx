import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import "@guymichaely/app-sync/sync.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
