// Minimal i18n: English strings are the keys; Traditional Chinese is looked up when selected.
import { createContext, useContext } from 'react';

export type UiLang = 'en' | 'zh';
export const LangContext = createContext<UiLang>('en');

const ZH: Record<string, string> = {
  // status bar
  'Full: on-device AI + private detection': '完整模式：本機 AI＋本機偵測',
  'Private detection (no on-device AI here: everything is masked, then sent)': '本機偵測模式（此瀏覽器沒有本機 AI：一律遮罩後才送出）',
  'Manual mode: pattern rules + your own marks': '手動模式：規則比對＋自行標記',
  'On-device AI:': '本機 AI：',
  'ready': '就緒',
  'not in this browser': '此瀏覽器不支援',
  'not supported on this device': '此裝置不支援',
  'downloading {p}%': '下載中 {p}%',
  'Prepare on-device model': '準備本機模型',
  'Detection model:': '偵測模型：',
  'off': '關閉',
  'ready ({v})': '就緒（{v}）',
  'loading…': '載入中…',
  'could not load: manual mode': '載入失敗：改用手動模式',
  'Download ({mb} MB, once)': '下載（{mb} MB，只需一次）',
  'Online': '已連線',
  'Offline: cloud disabled': '離線：雲端功能停用',
  'Clear': '清除',
  'Forget the text and the placeholder table': '清除文字與代號對照表',
  // composer
  'Scenario': '情境',
  'Work email or document': '工作信或文件',
  'Contract': '合約',
  'Health report': '健檢報告',
  'Other': '其他',
  'Task': '任務',
  'Rewrite': '改寫',
  'Shorten': '縮短',
  'Translate': '翻譯',
  'Summarize': '摘要',
  'Analyze / explain': '分析／說明',
  'Custom instruction': '自訂指令',
  'Into': '翻成',
  'English': '英文',
  'Traditional Chinese': '繁體中文',
  'Japanese': '日文',
  'Spanish': '西班牙文',
  'What should the AI do? (this is checked for private details too)': '要 AI 做什麼？（這段也會檢查有沒有個資）',
  'Paste the email, document or report here.': '把信件、文件或報告貼在這裡。',
  'On this device': '在本機處理',
  'Masked, then cloud': '遮罩後上雲',
  'Chosen by you': '由你指定',
  'Auto': '自動',
  'Cloud (masked)': '雲端（先遮罩）',
  'Run on this device': '在本機執行',
  'Find private details': '找出敏感內容',
  'You are offline. On-device tasks still work; cloud tasks need a connection.': '目前離線。本機任務照常可用；雲端任務需要連線。',
  'This scenario always masks the text and uses the cloud model.': '這個情境一律先遮罩，再交給雲端模型。',
  // route reasons
  'On-device model not available in this browser': '此瀏覽器沒有本機模型',
  'This task needs a larger model': '這個任務需要較大的模型',
  'The on-device model does not support this language': '本機模型不支援這個語言',
  'The on-device model cannot write the target language': '本機模型無法輸出目標語言',
  'Too long for the on-device model': '內容太長，本機模型處理不了',
  'Short, supported task: runs on this device, nothing is sent': '短文且本機支援：在本機處理，不送出任何內容',
  'Custom instruction: classified on this device when you run it': '自訂指令：執行時先在本機判斷任務類型',
  // confirm
  'Check what will be hidden': '確認要遮掉的內容',
  'Highlighted items are replaced by placeholders before anything is sent. Click an item to keep it in clear.': '標色的內容會在送出前換成代號。點一下可以讓它保持原文。',
  'Manual mode: only fixed formats (IDs, phones, emails, cards, addresses) are found automatically; mark names yourself.': '手動模式：只會自動找出固定格式（證號、電話、Email、卡號、地址）；人名請自行標記。',
  'Mark something the detector missed': '標記沒被找到的內容',
  'Mark selection (all occurrences)': '標記選取的文字（全文相同處一起標）',
  'Placeholder': '代號',
  'Type': '類型',
  'Original': '原文',
  'Times': '次數',
  'Keep in clear': '保持原文',
  'Mask': '遮掉',
  'Same as…': '與…相同',
  'split': '拆開',
  'Suggested but not found in your text': '模型建議、但原文裡找不到',
  'The on-device model suggested these, but they do not appear word for word. If one is really there, select it above and mark it.': '本機模型建議了這些內容，但原文裡沒有逐字出現。如果確實存在，請在上方選取並標記。',
  'Back': '返回',
  'Send masked text ({n} hidden)': '送出遮罩後的文字（已遮 {n} 處）',
  'Offline: connect to send to the cloud.': '離線：連線後才能送到雲端。',
  // turn
  'You': '你',
  'AI': 'AI',
  'Cloud ({m})': '雲端（{m}）',
  'Ran on this device. Nothing was sent.': '在本機完成，沒有送出任何內容。',
  'Use the cloud instead (masks first)': '改用雲端（會先遮罩）',
  '{n} placeholder(s) came back changed and were not restored (shown in red).': '有 {n} 個代號被改寫，未還原（以紅色標示）。',
  'Not used in the answer:': '回覆中沒用到：',
  'Copy answer': '複製回覆',
  'Receipt: what left this device': '收據：離開這台裝置的內容',
  'Sent (exactly this)': '實際送出的內容',
  'Kept on this device': '留在本機的項目',
  'The placeholder table exists only in this tab. Closing it or pressing Clear erases it.': '代號對照表只存在這個分頁；關閉分頁或按「清除」就消失。',
  'Statistics saved (counts only, no text).': '已儲存統計（只有數量，沒有文字）。',
  'Statistics were not saved.': '統計未儲存。',
  // app
  'Use AI on private text. Short tasks run on this device; everything else is masked here first and restored here after.': '放心把私密文字交給 AI：短任務在本機完成；其他內容先在本機遮罩，回覆再在本機還原。',
  'Looking for private details on this device…': '正在本機尋找敏感內容…',
  'Working on this device…': '本機處理中…',
  'Sending masked text…': '正在送出遮罩後的文字…',
  'Ask a follow-up (checked and masked the same way)': '繼續追問（一樣會檢查並遮罩）',
  'New task': '新任務',
  'You are offline. Cloud tasks need a connection.': '目前離線，雲端任務需要連線。',
  'You are offline. Nothing was sent.': '目前離線，沒有送出任何內容。',
  'The cloud model did not answer within 60 seconds. Try again.': '雲端模型 60 秒內沒有回應，請再試一次。',
  // entity types
  'Person': '人名', 'Organization': '組織', 'Location': '地點', 'Address': '地址', 'Email': 'Email', 'Phone': '電話',
  'ID number': '證號', 'Card': '卡號', 'Account': '帳號', 'Date of birth': '生日', 'Medical': '醫療', 'Financial': '財務',
};

export type T = (s: string, vars?: Record<string, string | number>) => string;

export function translate(lang: UiLang, s: string, vars?: Record<string, string | number>): string {
  let out = lang === 'zh' ? ZH[s] ?? s : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v));
  return out;
}

export function useT(): T {
  const lang = useContext(LangContext);
  return (s, vars) => translate(lang, s, vars);
}
