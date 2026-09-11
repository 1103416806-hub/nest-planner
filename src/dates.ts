export const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
export const fromKey = (s: string) => new Date(s + 'T12:00:00');
export function addDays(d: Date, n: number) { const next = new Date(d); next.setDate(next.getDate()+n); return next; }
export function startOfWeek(d: Date) { return addDays(d, -(d.getDay()+6)%7); }
export function monthDays(d: Date) { const first = new Date(d.getFullYear(), d.getMonth(), 1, 12); const start = startOfWeek(first); return Array.from({length:42},(_,i)=>addDays(start,i)); }
export const minutes = (s: string) => { const [h,m] = s.split(':').map(Number); return h*60+m; };
export const timeText = (n: number) => `${pad(Math.floor(n/60))}:${pad(n%60)}`;
export const weekNames = ['周一','周二','周三','周四','周五','周六','周日'];
export function shiftMonth(d: Date, n: number) { const day = d.getDate(); const next = new Date(d.getFullYear(),d.getMonth()+n,1,12); next.setDate(Math.min(day,new Date(next.getFullYear(),next.getMonth()+1,0).getDate())); return next; }
