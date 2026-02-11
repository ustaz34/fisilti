import { getCurrentWindow } from "@tauri-apps/api/window";

export function TitleBar() {
  const appWindow = getCurrentWindow();

  return (
    <div className="flex items-center justify-between h-10 px-3 select-none">
      <div
        className="flex-1 h-full flex items-center cursor-move"
        onMouseDown={() => appWindow.startDragging()}
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-accent flex items-center justify-center">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0a0f23"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <span className="text-xs font-semibold text-text-secondary tracking-wide">
            FISILTI
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => appWindow.minimize()}
          className="w-7 h-7 flex items-center justify-center rounded-md
                     text-text-muted hover:text-text-primary hover:bg-glass-hover
                     transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line
              x1="1"
              y1="5"
              x2="9"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <button
          onClick={() => appWindow.close()}
          className="w-7 h-7 flex items-center justify-center rounded-md
                     text-text-muted hover:text-red-400 hover:bg-red-500/10
                     transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line
              x1="1"
              y1="1"
              x2="9"
              y2="9"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="9"
              y1="1"
              x2="1"
              y2="9"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
