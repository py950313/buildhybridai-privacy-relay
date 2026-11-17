// Scenario presets. Remote Config `scenarios` (JSON) can override any field per scenario; the
// values here are the bundled defaults.
import type { EntityType } from '../detect/types';
import type { Task } from '../relay/router';

export type ScenarioId = 'email' | 'contract' | 'health' | 'free';

export type ScenarioConfig = {
  enabled: boolean;
  defaultTask: Task;
  /** true: never answer on the device, always mask and use the cloud. */
  forceCloud: boolean;
  model: 'default' | 'complex';
  /** Types the semantic detector is told to look for especially carefully. */
  extraTypes: EntityType[];
  /** Replaces the generic "analyze" instruction. Contains no user data. */
  analyzeInstruction?: string;
  disclaimer?: { en: string; zh: string };
};

export const SCENARIO_DEFAULTS: Record<ScenarioId, ScenarioConfig> = {
  email: {
    enabled: true, defaultTask: 'rewrite', forceCloud: false, model: 'default',
    extraTypes: ['ORG', 'FINANCIAL'],
  },
  contract: {
    enabled: true, defaultTask: 'analyze', forceCloud: true, model: 'complex',
    extraTypes: ['ACCOUNT', 'ADDRESS', 'FINANCIAL'],
    analyzeInstruction:
      'The text below is a contract or agreement. List: (1) what each party must do, (2) amounts, dates and deadlines, ' +
      '(3) termination, penalty and liability clauses, (4) clauses that are unusual or risky for the reader, and ' +
      '(5) questions to ask before signing. Answer in the same language as the text. This is not legal advice.',
  },
  health: {
    enabled: true, defaultTask: 'analyze', forceCloud: true, model: 'complex',
    extraTypes: ['MEDICAL', 'DATE_OF_BIRTH', 'ID_NUMBER'],
    analyzeInstruction:
      'The text below is a health check or lab report. Explain in plain language what each item measures, which values ' +
      'are outside the reference range and what that commonly relates to, and suggest questions to ask a doctor. ' +
      'Do not diagnose and do not recommend medication. Answer in the same language as the text.',
    disclaimer: {
      en: 'For understanding your report only. This is not medical advice; talk to a doctor about your results.',
      zh: '僅供理解報告，非醫療建議；檢查結果請與醫師討論。',
    },
  },
  free: {
    enabled: true, defaultTask: 'custom', forceCloud: false, model: 'default', extraTypes: [],
  },
};

/** Merges a Remote Config JSON string over the defaults; malformed input is ignored. */
export function resolveScenarios(json: string): Record<ScenarioId, ScenarioConfig> {
  let remote: unknown;
  try {
    remote = JSON.parse(json || '{}');
  } catch {
    return SCENARIO_DEFAULTS;
  }
  if (!remote || typeof remote !== 'object') return SCENARIO_DEFAULTS;
  const out = { ...SCENARIO_DEFAULTS };
  for (const id of Object.keys(SCENARIO_DEFAULTS) as ScenarioId[]) {
    const o = (remote as Record<string, unknown>)[id];
    if (o && typeof o === 'object') out[id] = { ...SCENARIO_DEFAULTS[id], ...(o as Partial<ScenarioConfig>) };
  }
  return out;
}
