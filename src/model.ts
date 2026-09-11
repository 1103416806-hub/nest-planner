import { validTaskColor } from './task-colors.ts';

export type Category = 'work' | 'study' | 'life';
export type Tree = 'pine' | 'oak' | 'sakura';
export interface Task { id: string; title: string; date: string; start: string; end: string; category: Category; completed: boolean; allDay: boolean; description: string; color?: string }
export interface NoteItem { id: string; text: string; completed: boolean }
export interface Note { id: string; content: string; color: 'yellow' | 'green' | 'pink' | 'blue'; pinned: boolean; updatedAt: number; kind?: 'memo' | 'checklist'; items?: NoteItem[] }
export type NoteOperation = {type:'create';note:Note} | {type:'patch';id:string;patch:Partial<Note>} | {type:'delete';id:string} | {type:'item-add';id:string;item:NoteItem} | {type:'item-patch';id:string;itemId:string;patch:Partial<Pick<NoteItem,'text'|'completed'>>} | {type:'item-delete';id:string;itemId:string};
export interface NoteSnapshot { notes: Note[]; revision: number; requestId?: string }
export interface FocusSession { id: string; title: string; minutes: number; completedAt: number; tree: Tree }
export interface FocusTimer { id: string; title: string; minutes: number; remainingMs: number; endsAt: number | null; tree: Tree }
export interface Reward { id: string; title: string; cost: number }
export interface Redemption { id: string; rewardId: string; title: string; cost: number; redeemedAt: number }
export interface AppData { version: 1; tasks: Task[]; notes: Note[]; sessions: FocusSession[]; timer: FocusTimer | null; rewards: Reward[]; redemptions: Redemption[] }
export type Update = (updater: (prev: AppData) => AppData) => void;
export const categories: Record<Category, { name: string; color: string }> = { work: { name: '工作', color: '#8b7bbb' }, study: { name: '学习', color: '#5786c7' }, life: { name: '生活', color: '#8b98aa' } };
export const uid = () => crypto.randomUUID();
export const emptyData = (): AppData => ({ version: 1, tasks: [], notes: [], sessions: [], timer: null, rewards: [{id:'coffee',title:'一杯喜欢的咖啡',cost:30},{id:'episode',title:'安心看一集剧',cost:60},{id:'gift',title:'送自己一份小礼物',cost:120}], redemptions: [] });
export const STORAGE_KEY = 'nest-planner-v1';
export let persistenceIssue: { raw: string | null; message: string } | null = null;
export function clearPersistenceIssue() { persistenceIssue = null; }
export function loadData(): AppData {
  let raw: string | null = null;
  clearPersistenceIssue();
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyData();
    const value: unknown = JSON.parse(raw);
    if (!validData(value)) {
      persistenceIssue = { raw, message: '本机记录格式有误，原始记录已保留。请先导出原始记录，或从备份恢复。' };
      return emptyData();
    }
    return value;
  } catch {
    persistenceIssue = { raw, message: raw === null ? '暂时无法读取本机记录。已暂停自动保存，请检查存储权限后重试。' : '本机记录无法解析，原始记录已保留。请先导出原始记录，或从备份恢复。' };
    return emptyData();
  }
}
export function validDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) return false;
  const date = new Date(value + 'T12:00:00');
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}
export function validData(value: unknown): value is AppData {
  if (!value || typeof value !== 'object') return false;
  const d = value as AppData;
  const str = (v: unknown) => typeof v === 'string';
  const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const id = (v: unknown) => str(v) && (v as string).trim().length > 0;
  const uniqueIds = (items: { id: string }[]) => items.every(item => item && id(item.id)) && new Set(items.map(item => item.id)).size === items.length;
  const tree = (v: unknown) => ['pine','oak','sakura'].includes(v as string);
  const time = (v: unknown) => str(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v as string);
  const noteId = (v: unknown) => id(v) && (v as string).length <= 128 && !/[\u0000-\u001f\u007f]/.test(v as string);
  const noteKeys = ['id','content','color','pinned','updatedAt','kind','items'];
  const validNote = (n: Note) => noteId(n.id) && Object.keys(n).every(k=>noteKeys.includes(k)) && str(n.content) && n.content.length <= 10000 && ['yellow','green','pink','blue'].includes(n.color) && typeof n.pinned === 'boolean' && integer(n.updatedAt) && (n.kind === undefined || ['memo','checklist'].includes(n.kind)) && (n.items === undefined || Array.isArray(n.items) && n.items.length<=500 && uniqueIds(n.items) && n.items.every(i=>noteId(i.id) && Object.keys(i).every(k=>['id','text','completed'].includes(k)) && str(i.text) && i.text.length<=1000 && typeof i.completed==='boolean'));
  if (!(d.version === 1
    && Array.isArray(d.tasks) && uniqueIds(d.tasks) && d.tasks.every(t => str(t.title) && !!t.title.trim() && validDateKey(t.date) && time(t.start) && time(t.end) && (t.allDay || t.end > t.start) && ['work','study','life'].includes(t.category) && typeof t.completed === 'boolean' && typeof t.allDay === 'boolean' && str(t.description) && (t.color === undefined || validTaskColor(t.color)))
    && Array.isArray(d.notes) && d.notes.length<=2000 && uniqueIds(d.notes) && d.notes.every(validNote)
    && Array.isArray(d.sessions) && uniqueIds(d.sessions) && d.sessions.every(s => str(s.title) && integer(s.minutes) && s.minutes >= 1 && s.minutes <= 180 && integer(s.completedAt) && tree(s.tree))
    && Array.isArray(d.rewards) && uniqueIds(d.rewards) && d.rewards.every(r => str(r.title) && !!r.title.trim() && integer(r.cost) && r.cost >= 1 && r.cost <= 10000)
    && Array.isArray(d.redemptions) && uniqueIds(d.redemptions) && d.redemptions.every(r => id(r.rewardId) && str(r.title) && integer(r.cost) && r.cost >= 1 && r.cost <= 10000 && integer(r.redeemedAt))
    && (d.timer === null || !!d.timer && id(d.timer.id) && !d.sessions.some(s => s.id === d.timer?.id) && str(d.timer.title) && integer(d.timer.minutes) && d.timer.minutes >= 1 && d.timer.minutes <= 180 && integer(d.timer.remainingMs) && d.timer.remainingMs <= d.timer.minutes * 60000 && (d.timer.endsAt === null || integer(d.timer.endsAt)) && tree(d.timer.tree)))) return false;
  const earned = d.sessions.reduce((sum, session) => sum + session.minutes, 0);
  const spent = d.redemptions.reduce((sum, redemption) => sum + redemption.cost, 0);
  return Number.isSafeInteger(earned) && Number.isSafeInteger(spent) && spent <= earned;
}

