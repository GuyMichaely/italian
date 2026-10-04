import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "./App";
import { saveSyncToken } from "./storage/cloudSync";
import "./styles.css";

// Signing in to sync comes back here with the token in the address; keep it and tidy the address.
const signedIn = /^#sync-token=(.+)$/.exec(window.location.hash);
if (signedIn) {
  saveSyncToken(decodeURIComponent(signedIn[1]!));
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/settings`);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);
