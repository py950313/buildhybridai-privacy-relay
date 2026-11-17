import { fetchAndActivate, getValue } from 'firebase/remote-config';
import { remoteConfig } from '../config/firebase';
import { REMOTE_CONFIG_DEFAULTS } from '../config/remoteConfigDefaults';
import { resolveScenarios, SCENARIO_DEFAULTS, type ScenarioConfig, type ScenarioId } from '../config/scenarios';

export type AppConfig = {
  cloudModelDefault: string;
  cloudModelComplex: string;
  localRouteMaxTokens: number;
  detectChunkTokens: number;
  detectOverlapTokens: number;
  nanoZhDetection: boolean;
  scenarios: Record<ScenarioId, ScenarioConfig>;
};

export const DEFAULT_CONFIG: AppConfig = {
  cloudModelDefault: REMOTE_CONFIG_DEFAULTS.cloud_model_default,
  cloudModelComplex: REMOTE_CONFIG_DEFAULTS.cloud_model_complex,
  localRouteMaxTokens: REMOTE_CONFIG_DEFAULTS.local_route_max_tokens,
  detectChunkTokens: REMOTE_CONFIG_DEFAULTS.detect_chunk_tokens,
  detectOverlapTokens: REMOTE_CONFIG_DEFAULTS.detect_overlap_tokens,
  nanoZhDetection: REMOTE_CONFIG_DEFAULTS.nano_zh_detection_enabled,
  scenarios: SCENARIO_DEFAULTS,
};

/** Fetches Remote Config; on any failure (offline, no template yet) the bundled defaults apply. */
export async function loadConfig(): Promise<AppConfig> {
  try {
    await fetchAndActivate(remoteConfig);
  } catch {
    return DEFAULT_CONFIG;
  }
  return {
    cloudModelDefault: getValue(remoteConfig, 'cloud_model_default').asString(),
    cloudModelComplex: getValue(remoteConfig, 'cloud_model_complex').asString(),
    localRouteMaxTokens: getValue(remoteConfig, 'local_route_max_tokens').asNumber(),
    detectChunkTokens: getValue(remoteConfig, 'detect_chunk_tokens').asNumber(),
    detectOverlapTokens: getValue(remoteConfig, 'detect_overlap_tokens').asNumber(),
    nanoZhDetection: getValue(remoteConfig, 'nano_zh_detection_enabled').asBoolean(),
    scenarios: resolveScenarios(getValue(remoteConfig, 'scenarios').asString()),
  };
}
