import type { OutLang, Task } from './router';

const LANG_NAME: Record<OutLang, string> = { en: 'English', zh: 'Traditional Chinese', ja: 'Japanese', es: 'Spanish' };

const TASK_TEXT: Record<Exclude<Task, 'custom'>, (t?: OutLang) => string> = {
  rewrite: () => 'Rewrite the text below so it is clear and professional. Keep its language and meaning.',
  shorten: () => 'Shorten the text below to about half its length. Keep its language and the key facts.',
  translate: (t) => `Translate the text below into ${LANG_NAME[t ?? 'en']}.`,
  summarize: () => 'Summarize the text below in a few bullet points, in the same language as the text.',
  analyze: () => 'Read the text below and answer helpfully: explain the key points, risks and suggested next steps. Answer in the same language as the text.',
};

export const PLACEHOLDER_RULE =
  'The text contains placeholders such as [PERSON_1] or [EMAIL_2] that stand for hidden private details. ' +
  'Copy every placeholder you use exactly as written, including the square brackets and capital letters. ' +
  'Do not translate, rename, renumber or fill in placeholders, and do not ask what they contain.';

/** System instruction for the cloud chat (masked text only). */
export const CLOUD_SYSTEM = `You are a helpful assistant. ${PLACEHOLDER_RULE}`;

export function taskInstruction(task: Exclude<Task, 'custom'>, target?: OutLang): string {
  return TASK_TEXT[task](target);
}

/**
 * The text that is sent. For preset tasks the instruction is ours (no user data); for a custom
 * task the user's instruction is part of the detected-and-masked input.
 */
export function buildPrompt(task: Task, body: string, target?: OutLang, analyzeInstruction?: string): string {
  if (task === 'custom') return body;
  const instruction = task === 'analyze' && analyzeInstruction ? analyzeInstruction : taskInstruction(task, target);
  return `${instruction}\n\n---\n${body}`;
}

/** Custom tasks: the user's instruction and the content are detected and masked together. */
export const joinCustom = (instruction: string, content: string) =>
  content.trim() ? `${instruction.trim()}\n\n---\n${content}` : instruction.trim();
