// Bundled defaults; the live values come from Firebase Remote Config. Keep keys in sync with
// remoteconfig.template.json. Values marked "provisional" are set from prototype findings (#2).
export const REMOTE_CONFIG_DEFAULTS = {
  cloud_model_default: 'gemini-3.5-flash-lite',
  cloud_model_complex: 'gemini-3.5-flash',
  local_route_max_tokens: 800, // provisional
  detect_chunk_tokens: 1500, // provisional
  detect_overlap_tokens: 200,
  scenarios: '{}', // filled in #7
} as const;
