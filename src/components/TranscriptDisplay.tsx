import { useTranscriptionStore } from "../stores/transcriptionStore";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

export function TranscriptDisplay() {
  const { currentText, isTranscribing, clearCurrentText } =
    useTranscriptionStore();

  const handleCopy = async () => {
    if (currentText) {
      try {
        await writeText(currentText);
      } catch {
        // fallback
        navigator.clipboard.writeText(currentText);
      }
    }
  };

  return (
    <div className="flex flex-col gap-2 px-3 flex-1 min-h-0">
      <div
        className="glass-panel p-3 flex-1 min-h-[80px] max-h-[160px] overflow-y-auto
                      text-sm leading-relaxed"
      >
        {isTranscribing ? (
          <div className="flex items-center gap-2 text-text-secondary">
            <div className="flex gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
            <span>Dönüştürülüyor...</span>
          </div>
        ) : currentText ? (
          <p className="text-text-primary select-text cursor-text">
            {currentText}
          </p>
        ) : (
          <p className="text-text-muted italic">
            Kayıt yaparak konuşmanızı yazıya dönüştürün...
          </p>
        )}
      </div>

      {currentText && !isTranscribing && (
        <div className="flex gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 h-8 rounded-lg bg-glass border border-glass-border
                       text-xs text-text-secondary hover:text-text-primary
                       hover:bg-glass-hover transition-colors flex items-center
                       justify-center gap-1.5"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Kopyala
          </button>
          <button
            onClick={clearCurrentText}
            className="flex-1 h-8 rounded-lg bg-glass border border-glass-border
                       text-xs text-text-secondary hover:text-text-primary
                       hover:bg-glass-hover transition-colors flex items-center
                       justify-center gap-1.5"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
            Temizle
          </button>
        </div>
      )}
    </div>
  );
}
