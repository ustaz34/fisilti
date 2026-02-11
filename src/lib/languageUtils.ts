/**
 * 2 harfli dil kodunu Web Speech API icin dogru BCP-47 locale'ine donusturur.
 * "en" -> "en-US" (en-EN gecersiz!), "tr" -> "tr-TR", "zh" -> "zh-CN" vb.
 */

const LOCALE_MAP: Record<string, string> = {
  tr: "tr-TR",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  it: "it-IT",
  pt: "pt-BR",
  ru: "ru-RU",
  ja: "ja-JP",
  zh: "zh-CN",
};

export function toBcp47Locale(language: string): string {
  if (language.length > 2 && language.includes("-")) {
    // Zaten tam locale (orn: "en-US")
    return language;
  }
  return LOCALE_MAP[language.toLowerCase()] ?? `${language}-${language.toUpperCase()}`;
}
