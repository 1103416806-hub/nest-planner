import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Plus, CalendarDays, Clock3, Check, Trash2, Play, X } from 'lucide-react';
import { addDays, dateKey, fromKey, minutes, monthDays, pad, startOfWeek, timeText, weekNames } from './dates';
import { categories, uid, validDateKey, type Task, type Category } from './model';
import { taskColorPresets, taskColorStyle, validTaskColor } from './task-colors';
export type View = 'month' | 'week' | 'day';
interface CalendarProps { date: Date; view: View; tasks: Task[]; onDate: (d: Date) => void; onView: (v: View) => void; onNew: (date?: string,start?: string) => void; onEdit: (task: Task) => void; onMove: (task: Task,date: string,start: string) => void }
export function MiniCalendar({date,onDate}: {date: Date;onDate:(d:Date)=>void}) {
  const [month,setMonth]=useState(date);
  useEffect(()=>setMonth(date),[date]);
  return <div className="mini-calendar"><div className="mini-heading"><strong>{month.getFullYear()} 年 {month.getMonth()+1} 月</strong><span><button className="icon-btn tiny" aria-label="小日历上个月" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1,12))}><ChevronLeft size={15}/></button><button className="icon-btn tiny" aria-label="小日历下个月" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1,12))}><ChevronRight size={15}/></button></span></div><div className="mini-grid">{weekNames.map(d=><span className="mini-weekday" key={d}>{d.slice(1)}</span>)}{monthDays(month).map(d=><button key={dateKey(d)} aria-label={dateKey(d)} className={`${d.getMonth()!==month.getMonth()?'outside':''} ${dateKey(d)===dateKey(date)?'selected':''} ${dateKey(d)===dateKey(new Date())?'is-today':''}`} onClick={()=>onDate(d)}>{d.getDate()}</button>)}</div></div>;
}
function eventLayout(tasks: Task[]) {
  const sorted=[...tasks].sort((a,b)=>minutes(a.start)-minutes(b.start)||minutes(b.end)-minutes(a.end));
  const results: {task:Task;column:number;columns:number}[]=[];
  let group: typeof results=[]; let ends:number[]=[]; let groupEnd=-1;
  const flush=()=>{group.forEach(x=>results.push({...x,columns:ends.length}));group=[];ends=[];};
  for(const task of sorted){const start=minutes(task.start);if(start>=groupEnd && group.length)flush();let col=ends.findIndex(e=>e<=start);if(col<0)col=ends.length;ends[col]=minutes(task.end);group.push({task,column:col,columns:1});groupEnd=Math.max(group.length===1?0:groupEnd,minutes(task.end));}flush();return results;
}
export default function Calendar({date,view,tasks,onDate,onView,onNew,onEdit,onMove}: CalendarProps) {
  const scroller=useRef<HTMLDivElement>(null); const timeGrid=useRef<HTMLDivElement>(null);
  const [gridWidth,setGridWidth]=useState<number>(); const [now,setNow]=useState(new Date());
  useLayoutEffect(()=>{
    const grid=timeGrid.current;if(!grid)return;
    // The scrollable grid excludes the native scrollbar. Reuse its fractional
    // CSS width so header and all-day tracks match at every display scale.
    const syncWidth=()=>setGridWidth(grid.getBoundingClientRect().width);
    syncWidth();
    const observer=new ResizeObserver(syncWidth);observer.observe(grid);
    return()=>observer.disconnect();
  },[view]);
  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(t);},[]);
  useEffect(()=>{if(scroller.current)scroller.current.scrollTop=7.5*68;},[view]);
  const days=view==='month'?monthDays(date):view==='week'?Array.from({length:7},(_,i)=>addDays(startOfWeek(date),i)):[date];
  if(view==='month')return <div className="month-view"><div className="month-weekdays">{weekNames.map(n=><span key={n}>{n}</span>)}</div><div className="month-grid">{days.map(day=>{const key=dateKey(day),items=tasks.filter(t=>t.date===key).sort((a,b)=>a.start.localeCompare(b.start));return <div className={`month-cell ${day.getMonth()!==date.getMonth()?'outside':''} ${key===dateKey(now)?'today-cell':''}`} key={key} onDoubleClick={e=>{if(!(e.target as Element).closest('button'))onNew(key);}}><div className="month-cell-top"><button className={`date-number ${key===dateKey(now)?'today':''}`} onClick={()=>{onDate(day);onView('day');}}>{day.getDate()}</button><button className="month-add icon-btn tiny" aria-label={`${key} 新建日程`} onClick={()=>onNew(key)}><Plus size={14}/></button></div>{items.slice(0,4).map(t=><button className={`month-event task-color-event event-${t.category} ${t.completed?'completed':''}`} key={t.id} style={taskColorStyle(t.color??categories[t.category].color)} onClick={()=>onEdit(t)}><i/>{!t.allDay&&<span>{t.start}</span>}<strong>{t.title}</strong></button>)}{items.length>4&&<button className="more-events" onClick={()=>{onDate(day);onView('day');}}>还有 {items.length-4} 项 <ArrowUpRight size={11}/></button>}</div>})}</div><div className="calendar-footer"><span><span className="status-dot"/> 双击日期空白处，添加日程</span><span>月度日程</span></div></div>;
  return <div className={`time-calendar ${view}`}><div className="week-head" style={{width:gridWidth,gridTemplateColumns:`56px repeat(${days.length},minmax(0,1fr))`}}><div className="timezone">GMT+8</div>{days.map(day=><button key={dateKey(day)} className={`day-heading ${dateKey(day)===dateKey(now)?'today-heading':''}`} onClick={()=>{onDate(day);onView('day');}}><span>{weekNames[(day.getDay()+6)%7]}</span><strong>{pad(day.getDate())}</strong>{view==='day'&&<em>{day.getMonth()+1} 月</em>}</button>)}</div><div className="all-day-row" style={{width:gridWidth,gridTemplateColumns:`56px repeat(${days.length},minmax(0,1fr))`}}><span>全天</span>{days.map(day=><div key={dateKey(day)}>{tasks.filter(t=>t.date===dateKey(day)&&t.allDay).map(t=><button key={t.id} className={`all-day-event task-color-event event-${t.category}`} style={taskColorStyle(t.color??categories[t.category].color)} onClick={()=>onEdit(t)}>{t.title}</button>)}</div>)}</div><div className="timeline-scroll" ref={scroller}><div className="timeline" ref={timeGrid} style={{gridTemplateColumns:`56px repeat(${days.length},minmax(0,1fr))`}}><div className="time-labels">{Array.from({length:24},(_,h)=><span key={h} style={{top:h*68}}>{pad(h)}:00</span>)}</div>{days.map(day=>{const key=dateKey(day);return <div className={`day-column ${key===dateKey(now)?'current-day':''}`} key={key}>{Array.from({length:48},(_,i)=><div className={`time-slot ${i%2?'half':''}`} key={i} data-date={key} data-time={timeText(i*30)} onDoubleClick={e=>{if(e.target===e.currentTarget)onNew(key,timeText(i*30));}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const t=tasks.find(x=>x.id===e.dataTransfer.getData('text/plain'));if(t)onMove(t,key,timeText(i*30));}}><button type="button" className="time-slot-add" aria-label={`${key} ${timeText(i*30)} 添加日程`} title="添加日程" onClick={e=>{e.stopPropagation();onNew(key,timeText(i*30));}} onDoubleClick={e=>e.stopPropagation()}><Plus size={14}/></button></div>)}{eventLayout(tasks.filter(t=>t.date===key&&!t.allDay)).map(({task:t,column,columns})=><button key={t.id} draggable onDragStart={e=>e.dataTransfer.setData('text/plain',t.id)} className={`time-event task-color-event event-${t.category} ${t.completed?'completed':''} ${minutes(t.end)-minutes(t.start)<30?'short-event':''}`} style={{...taskColorStyle(t.color??categories[t.category].color),top:minutes(t.start)/60*68+2,height:Math.max(19,(minutes(t.end)-minutes(t.start))/60*68-4),left:`calc(${column/columns*100}% + 5px)`,width:`calc(${100/columns}% - 9px)`}} onClick={()=>onEdit(t)} title={`${t.title} ${t.start}–${t.end}`}><span className="event-title">{t.completed&&<Check size={12}/>} {t.title}</span><small>{t.start} – {t.end}</small>{view==='day'&&t.description&&<p>{t.description}</p>}</button>)}{key===dateKey(now)&&<div className="now-line" style={{top:(now.getHours()+now.getMinutes()/60)*68}}><i/></div>}</div>})}</div></div><div className="calendar-footer"><span><span className="status-dot"/> 点击＋或双击空白处添加 · 拖动调整时间</span><span>{tasks.filter(t=>days.some(d=>dateKey(d)===t.date)).length} 项日程</span></div></div>;
}
function TaskColorPicker({ task, onChange }: { task: Task; onChange: (color?: string) => void }) {
  const selectedColor = task.color ?? categories[task.category].color;
  return <fieldset className="task-color-picker">
    <legend>日程颜色</legend>
    <div className="task-color-options">
      <button type="button" className="task-color-follow" aria-pressed={!task.color} onClick={() => onChange(undefined)}>
        {!task.color && <Check size={13} aria-hidden="true"/>}跟随分类
      </button>
      {taskColorPresets.map(preset => <button type="button" key={preset.value} className="task-color-swatch"
        style={{ backgroundColor: preset.value }} aria-label={`日程颜色：${preset.name}`} title={preset.name}
        aria-pressed={task.color?.toUpperCase() === preset.value} onClick={() => onChange(preset.value)}>
        {task.color?.toUpperCase() === preset.value && <Check size={15} aria-hidden="true"/>}
      </button>)}
      <label className="task-color-custom">自选
        <input type="color" aria-label="自定义日程颜色" value={selectedColor} onChange={event => onChange(event.target.value)}/>
      </label>
    </div>
    <div className="task-color-preview" style={taskColorStyle(selectedColor)}><span>{task.title.trim() || '日程颜色预览'}</span></div>
  </fieldset>;
}
export function TaskEditor({task,date,start,onClose,onSave,onDelete,onFocus}: {task:Task|null;date:string;start:string;onClose:()=>void;onSave:(t:Task)=>void;onDelete:(id:string)=>void;onFocus:(t:Task)=>void}) {
  const [draft,setDraft]=useState<Task>(task||{id:uid(),title:'',date,start,end:timeText(Math.min(1439,minutes(start)+60)),category:'work',completed:false,allDay:false,description:''});
  const [error,setError]=useState('');const [confirmDelete,setConfirmDelete]=useState(false);
  const form = useRef<HTMLFormElement>(null);
  const set=<K extends keyof Task>(key:K,value:Task[K])=>setDraft(d=>({...d,[key]:value}));
  const validateDraft = (): Task | null => {
    if (!form.current?.reportValidity()) return null;
    if (!draft.title.trim()) { setError('请输入日程名称'); return null; }
    if (!validDateKey(draft.date)) { setError('请选择有效的日期。'); return null; }
    if (!draft.allDay && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.end))) {
      setError('请填写有效的开始和结束时间。'); return null;
    }
    if (!draft.allDay && draft.end <= draft.start) { setError('结束时间需要晚于开始时间；跨天任务请按天拆分。'); return null; }
    if (draft.color !== undefined && !validTaskColor(draft.color)) { setError('请选择有效的日程颜色。'); return null; }
    setError('');
    return { ...draft, title: draft.title.trim(), ...(draft.allDay ? { start: '09:00', end: '10:00' } : {}) };
  };
  return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><section className="modal task-modal" role="dialog" aria-modal="true" aria-labelledby="task-title"><header><div><h2 id="task-title">{task?'日程详情':'新建日程'}</h2></div><button className="icon-btn" aria-label="关闭日程" onClick={onClose}><X size={20}/></button></header><form ref={form} onSubmit={e=>{e.preventDefault();const validated=validateDraft();if(validated)onSave(validated);}}><label className="field">日程名称<input autoFocus placeholder="输入日程名称" maxLength={160} value={draft.title} onChange={e=>set('title',e.target.value)} required/></label><div className="form-row"><label className="field"><span><CalendarDays size={14}/> 日期</span><input type="date" min="0001-01-01" max="9999-12-31" value={draft.date} onChange={e=>set('date',e.target.value)} required/></label><label className="field">分类<select value={draft.category} onChange={e=>set('category',e.target.value as Category)}>{Object.entries(categories).map(([k,c])=><option key={k} value={k}>{c.name}</option>)}</select></label></div><TaskColorPicker task={draft} onChange={color=>set('color',color)}/><label className="checkbox-label"><input type="checkbox" checked={draft.allDay} onChange={e=>set('allDay',e.target.checked)}/> 全天日程</label>{!draft.allDay&&<div className="form-row"><label className="field"><span><Clock3 size={14}/> 开始时间</span><input type="time" required value={draft.start} onChange={e=>set('start',e.target.value)}/></label><label className="field">结束时间<input type="time" required value={draft.end} onChange={e=>set('end',e.target.value)}/></label></div>}<label className="field">备注<textarea rows={3} placeholder="添加备注（可选）" maxLength={3000} value={draft.description} onChange={e=>set('description',e.target.value)}/></label>{task&&<label className="checkbox-label"><input type="checkbox" checked={draft.completed} onChange={e=>set('completed',e.target.checked)}/> 这件事已经完成</label>}{error&&<p className="form-error" role="alert">{error}</p>}<footer>{task?<button type="button" className="icon-btn danger" aria-label="删除日程" onClick={()=>setConfirmDelete(true)}><Trash2 size={17}/></button>:<span/>}<div>{task&&<button type="button" className="btn btn-soft" onClick={()=>{const validated=validateDraft();if(validated)onFocus(validated);}}><Play size={14}/> 开始专注</button>}<button className="btn btn-primary" type="submit">{task?'保存修改':'添加日程'}<Check size={15}/></button></div></footer>{confirmDelete&&<div className="inline-confirm"><span>删除这项日程？</span><button type="button" className="btn btn-soft" onClick={()=>setConfirmDelete(false)}>取消</button><button type="button" className="btn danger" onClick={()=>onDelete(draft.id)}>确认删除</button></div>}</form></section></div>;
}



