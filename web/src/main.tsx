import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import { markSyncSignedIn } from "./storage/cloudSync";
import "./styles.css";

// Signing in to sync comes back here marked in the address; note it and tidy the address.
if (window.location.hash === "#sync-signed-in") {
  markSyncSignedIn();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/settings`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
