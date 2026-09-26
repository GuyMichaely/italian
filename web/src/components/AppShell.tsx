import type { ReactNode } from "react";
import type { Route } from "../app/useHashRoute";
import { Icon, type IconName } from "./Icons";
import { SaveIndicator, type SaveState } from "./SaveIndicator";

const navItems: { route: Route; label: string; icon: IconName }[] = [
  { route: "study", label: "Study", icon: "study" },
  { route: "words", label: "Words", icon: "words" },
  { route: "grammar", label: "Grammar", icon: "grammar" },
  { route: "settings", label: "Settings", icon: "settings" },
];

export function AppShell({ route, syncing, syncLabel, saveState, onAdd, children }: { route: Route; syncing: boolean; syncLabel: string; saveState: SaveState; onAdd: () => void; children: ReactNode }) {
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" href="#/study" aria-label="Parola home"><span className="wordmark-mark" aria-hidden="true">P</span><span>Parola</span></a>
        <nav className="top-nav" aria-label="Main">
          {navItems.map((item) => <a key={item.route} href={`#/${item.route}`} className={route === item.route ? "active" : ""} aria-current={route === item.route ? "page" : undefined}><Icon name={item.icon} size={17} />{item.label}</a>)}
        </nav>
        <div className="topbar-actions">
          <SaveIndicator state={saveState} />
          <a className="storage-pill" href="#/settings" title={syncing ? `Sync server: ${syncLabel}` : "Words are stored in this browser"}><span className={`status-dot ${syncing ? "remote" : "local"}`} aria-hidden="true" />{syncing ? "Sync" : "Local"}</a>
          <button type="button" className="primary-button add-button" onClick={onAdd}><Icon name="plus" size={16} /><span>Add words</span></button>
        </div>
      </div>
    </header>
    <main className={`content-frame route-${route}`}>{children}</main>
    <nav className="bottom-nav" aria-label="Main">
      {navItems.map((item) => <a key={item.route} href={`#/${item.route}`} className={route === item.route ? "active" : ""} aria-current={route === item.route ? "page" : undefined}><Icon name={item.icon} size={20} /><span>{item.label}</span></a>)}
    </nav>
  </div>;
}
