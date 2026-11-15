// Firebase AI Logic hybrid inference: Gemini Nano on the device (ONLY_ON_DEVICE) for tasks the
// router keeps local, Gemini in the cloud (ONLY_IN_CLOUD) for masked text only.
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type ChatSession } from 'firebase/ai';
import { app } from '../config/firebase';
import { CLOUD_SYSTEM } from '../relay/prompts';
import type { OutLang, Task } from '../relay/router';

const ai = getAI(app, { backend: new GoogleAIBackend() });
const CLOUD_TIMEOUT_MS = 60_000;

const deviceModel = (inLang: string, outLang: string) =>
  getGenerativeModel(ai, {
    mode: InferenceMode.ONLY_ON_DEVICE,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: 'text', languages: [inLang] }],
        expectedOutputs: [{ type: 'text', languages: [outLang] }],
      },
    },
  });

/** Must be called from a user gesture when the model still needs downloading. */
export async function prepareDeviceModel(onProgress: (p: number) => void): Promise<void> {
  await deviceModel('en', 'en').initializeDeviceModel(onProgress);
}

export async function runLocal(prompt: string, inLang: string, outLang: OutLang): Promise<string> {
  const res = await deviceModel(inLang, outLang).generateContent(prompt);
  return res.response.text();
}

export function startCloudChat(model: string): ChatSession {
  return getGenerativeModel(
    ai,
    { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model, systemInstruction: CLOUD_SYSTEM } },
    { timeout: CLOUD_TIMEOUT_MS },
  ).startChat();
}

export async function sendCloud(chat: ChatSession, maskedPrompt: string): Promise<string> {
  const res = await chat.sendMessage(maskedPrompt);
  return res.response.text();
}

type LM = {
  create(o: object): Promise<{ prompt(t: string, o?: object): Promise<string>; destroy(): void }>;
};

/** Classifies a free-form instruction on the device. Without Nano every custom task is 'analyze'. */
export async function classifyTask(instruction: string): Promise<Exclude<Task, 'custom'>> {
  const api = (globalThis as { LanguageModel?: LM }).LanguageModel;
  if (!api) return 'analyze';
  const tasks = ['rewrite', 'shorten', 'translate', 'summarize', 'analyze'] as const;
  try {
    const s = await api.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [{ role: 'system', content:
        'Classify the user request into one task: rewrite (improve wording), shorten, translate, summarize, ' +
        'or analyze (anything else: questions, advice, extraction, reasoning). Reply with JSON.' }],
    });
    try {
      const raw = await s.prompt(instruction.slice(0, 2000), {
        responseConstraint: { type: 'object', properties: { task: { type: 'string', enum: tasks } }, required: ['task'] },
      });
      const t = JSON.parse(raw).task;
      return tasks.includes(t) ? t : 'analyze';
    } finally {
      s.destroy();
    }
  } catch {
    return 'analyze';
  }
}
