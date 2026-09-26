import { type ReactNode, useEffect, useId } from "react";

/** Modal surface: a centered sheet or a side drawer on wide screens, a full-height sheet on phones. */
export function Sheet({
  title,
  subtitle,
  icon,
  size = "wide",
  closeDisabled = false,
  onClose,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  size?: "wide" | "side";
  closeDisabled?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || closeDisabled) return;
      event.preventDefault();
      onClose();
    }
    window.addEventListener("keydown", handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeDisabled, onClose]);

  return (
    <div className={`sheet-backdrop sheet-${size}`} onMouseDown={() => { if (!closeDisabled) onClose(); }}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header className="sheet-header">
          {icon && <span className="sheet-icon" aria-hidden="true">{icon}</span>}
          <div className="sheet-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={closeDisabled} aria-label="Close">×</button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}
