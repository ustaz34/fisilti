import { useRecordingStore } from "../stores/recordingStore";
import { useTranscriptionStore } from "../stores/transcriptionStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  startRecording,
  stopRecording,
  transcribeAudio,
  pasteToActiveApp,
} from "../lib/tauri-commands";

export function RecordButton() {
  const { isRecording, setRecording, duration, setDuration, setAudioData } =
    useRecordingStore();
  const { setCurrentText, setTranscribing, addToHistory } =
    useTranscriptionStore();
  const { settings } = useSettingsStore();

  const handleToggle = async () => {
    if (isRecording) {
      try {
        const audioData = await stopRecording();
        setRecording(false);
        setAudioData(audioData);

        setTranscribing(true);
        setCurrentText("Dönüştürülüyor...");

        try {
          const result = await transcribeAudio(
            audioData,
            settings.selectedModel,
          );

          if (result.text) {
            setCurrentText(result.text);
            addToHistory({
              id: Date.now().toString(),
              text: result.text,
              timestamp: Date.now(),
              durationMs: result.duration_ms,
              engine: settings.transcriptionEngine as "web" | "whisper",
              language: settings.language,
              modelId: settings.transcriptionEngine === "web" ? "web-speech" : settings.selectedModel,
            });

            // Otomatik yapistirma aktifse aktif uygulamaya yaz
            if (settings.autoPaste) {
              try {
                await pasteToActiveApp(result.text);
              } catch {
                // yapistirma basarisiz olursa sessizce devam et
              }
            }
          } else {
            setCurrentText("");
          }
        } catch (err) {
          setCurrentText(`Hata: ${err}`);
        } finally {
          setTranscribing(false);
        }
      } catch (err) {
        setCurrentText(`Kayıt durdurma hatası: ${err}`);
        setRecording(false);
      }
    } else {
      try {
        setDuration(0);
        setCurrentText("");
        await startRecording(settings.selectedDevice ?? undefined);
        setRecording(true);

        const startTime = Date.now();
        const timer = setInterval(() => {
          if (!useRecordingStore.getState().isRecording) {
            clearInterval(timer);
            return;
          }
          setDuration(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
      } catch (err) {
        setCurrentText(`Kayıt başlatma hatası: ${err}`);
      }
    }
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleToggle}
        className={`
          w-16 h-16 rounded-full flex items-center justify-center
          transition-all duration-300 cursor-pointer
          ${
            isRecording
              ? "bg-recording animate-pulse-recording scale-110"
              : "bg-accent hover:bg-accent-hover hover:scale-105"
          }
        `}
      >
        {isRecording ? (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="var(--color-bg-primary)"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-bg-primary)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        )}
      </button>
      <span className="text-xs text-text-secondary font-mono">
        {isRecording ? formatDuration(duration) : "Kaydet"}
      </span>
    </div>
  );
}
