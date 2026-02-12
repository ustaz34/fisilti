/**
 * Tum streaming konusma tanima servisleri icin ortak callback interface.
 * webSpeechService, deepgramService, azureSpeechService ayni yapida calisir.
 */
export interface StreamCallbacks {
  onInterimResult?: (text: string) => void;
  onFinalResult?: (text: string) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}
