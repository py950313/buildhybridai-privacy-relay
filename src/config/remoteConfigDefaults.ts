// Bundled defaults; the live values come from Firebase Remote Config. Keep keys in sync with
// remoteconfig.template.json. Values marked "provisional" are set from prototype findings (#2).
export const REMOTE_CONFIG_DEFAULTS = {
  cloud_model_default: 'gemini-3.5-flash-lite',
  cloud_model_complex: 'gemini-3.5-flash',
  local_route_max_tokens: 3000, // measured: Nano contextWindow 9216 (docs/prototype-findings.md)
  detect_chunk_tokens: 1500, // provisional
  detect_overlap_tokens: 200,
  nano_zh_detection_enabled: true, // Nano with zh declared as en: works today, not guaranteed by the API
  scenarios: '{}', // filled in #7
} as const;
