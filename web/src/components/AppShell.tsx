import type { ReactNode } from "react";
import type { Route } from "../app/useHashRoute";
import { Icon, type IconName } from "./Icons";
import { SaveIndicator, type SaveState } from "./SaveIndicator";
import type { SyncMode, SyncStatus } from "../storage/cloudSync";

const navItems: { route: Route; label: string; icon: IconName }[] = [
  { route: "study", label: "Study", icon: "study" },
  { route: "words", label: "Words", icon: "words" },
  { route: "grammar", label: "Grammar", icon: "grammar" },
  { route: "settings", label: "Settings", icon: "settings" },
];

export function AppShell({ route, sync, syncMode, saveState, onAdd, children }: { route: Route; sync: SyncStatus; syncMode: SyncMode | Error; saveState: SaveState; onAdd: () => void; children: ReactNode }) {
  return <div className="app-shell">
    <header className="topbar">
      <div className="topbar-inner">
        <a className="wordmark" href="#/study" aria-label="Italian home"><span className="wordmark-mark" aria-hidden="true">I</span><span>Italian</span></a>
        <nav className="top-nav" aria-label="Main">
          {navItems.map((item) => <a key={item.route} href={`#/${item.route}`} className={route === item.route ? "active" : ""} aria-current={route === item.route ? "page" : undefined}><Icon name={item.icon} size={17} />{item.label}</a>)}
        </nav>
        <div className="topbar-actions">
          <SaveIndicator state={saveState} sync={sync} mode={syncMode} />
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
