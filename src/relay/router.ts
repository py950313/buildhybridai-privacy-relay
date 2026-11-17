// Decides whether a task can stay on the device. Anything that cannot is masked and sent to the
// cloud; nothing is ever sent unmasked.
import type { NanoLang } from '../detect/nano';

export type Task = 'rewrite' | 'shorten' | 'translate' | 'summarize' | 'analyze' | 'custom';
export type OutLang = 'en' | 'zh' | 'ja' | 'es';
export type Route = 'local' | 'cloud';

export const LOCAL_TASKS: readonly Task[] = ['rewrite', 'shorten', 'translate', 'summarize'];
/** Languages the on-device model handles for input and output (measured in #2). */
export const NANO_LANGS: readonly string[] = ['en', 'ja', 'es'];

export type RouteInput = {
  task: Task; // for 'custom', pass the task the classifier returned (or 'analyze')
  tokens: number;
  lang: NanoLang;
  nanoReady: boolean;
  maxTokens: number;
  translateTarget?: OutLang;
};
export type RouteDecision = { route: Route; reason: string };

export function decideRoute(i: RouteInput): RouteDecision {
  if (!i.nanoReady) return { route: 'cloud', reason: 'On-device model not available in this browser' };
  if (!LOCAL_TASKS.includes(i.task)) return { route: 'cloud', reason: 'This task needs a larger model' };
  if (!NANO_LANGS.includes(i.lang)) return { route: 'cloud', reason: 'The on-device model does not support this language' };
  if (i.task === 'translate' && !NANO_LANGS.includes(i.translateTarget ?? 'en')) {
    return { route: 'cloud', reason: 'The on-device model cannot write the target language' };
  }
  if (i.tokens > i.maxTokens) return { route: 'cloud', reason: 'Too long for the on-device model' };
  return { route: 'local', reason: 'Short, supported task: runs on this device, nothing is sent' };
}

/** The language the answer should be written in (for the on-device output declaration). */
export function outputLang(task: Task, lang: NanoLang, target?: OutLang): OutLang {
  if (task === 'translate') return target ?? 'en';
  return lang;
}
