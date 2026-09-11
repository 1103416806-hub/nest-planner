import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, CheckCheck, CheckSquare2, FileText, Monitor, Pin, Plus, Search, StickyNote, Trash2, X } from 'lucide-react';
import { uid, type Note, type Update } from './model';

const colors: Note['color'][] = ['yellow', 'green', 'pink', 'blue'];
const colorNames = ['霜白', '银灰', '雾紫', '浅蓝'];
export type ChangeNote = (updater: (note: Note) => Note) => void;
export const isChecklist = (note: Note) => (note.items?.length || 0) > 0 || note.kind === 'checklist';
export const noteTitle = (note: Note) => note.content.split('\n')[0].trim() || note.items?.find(item => item.text.trim())?.text || '新便签';

export function QuickNote({ update, onOpen, notes }: { update: Update; onOpen: () => void; notes: Note[] }) {
  const [text, setText] = useState(() => { try { return localStorage.getItem('nest-quick-draft') || ''; } catch { return ''; } });
  useEffect(() => { try { localStorage.setItem('nest-quick-draft', text); } catch { /* The workspace displays storage errors. */ } }, [text]);
  const save = () => {
    if (!text.trim()) return;
    update(data => ({ ...data, notes: [{ id: uid(), kind: 'memo', content: text.trim(), color: 'blue', pinned: false, updatedAt: Date.now() }, ...data.notes] }));
    setText('');
  };
  return <section className="quick-note"><div className="section-label"><span><StickyNote size={16} /> 快速记录</span><button className="icon-btn tiny" aria-label="打开全部便签" onClick={onOpen}><ArrowUpRight size={17} /></button></div><div className="quick-paper"><textarea aria-label="快速便签" value={text} onChange={event => setText(event.target.value)} placeholder="记下一件事或一个想法…" maxLength={10000} onKeyDown={event => { if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); save(); } }} /><div className="paper-bottom"><span>Ctrl + Enter 保存</span><button className="icon-btn tiny" aria-label="保存快速便签" disabled={!text.trim()} onClick={save}><Plus size={18} /></button></div></div>{notes.length > 0 && <button className="latest-note" onClick={onOpen}>{isChecklist(notes[0]) ? <CheckSquare2 size={13} /> : <FileText size={13} />}<span>{noteTitle(notes[0])}</span><ArrowUpRight size={13} /></button>}</section>;
}

/** Main and desktop windows edit the latest shared note through function updates. */
export function NoteContentEditor({ note, onChange, compact = false }: { note: Note; onChange: ChangeNote; compact?: boolean }) {
  const [itemText, setItemText] = useState('');
  const newItem = useRef<HTMLInputElement>(null);
  const items = note.items || [];
  const completed = items.filter(item => item.completed).length;
  const atItemLimit = items.length >= 500;
  const addItem = () => {
    const text = itemText.trim();
    if (!text || atItemLimit) return;
    const item = { id: uid(), text, completed: false };
    onChange(current => {
      const currentItems = current.items || [];
      return currentItems.length >= 500 ? current : { ...current, items: [...currentItems, item] };
    });
    setItemText('');
    newItem.current?.focus();
  };
  const patchItem = (id: string, patch: { text?: string; completed?: boolean }) => onChange(current => ({ ...current, items: (current.items || []).map(item => item.id === id ? { ...item, ...patch } : item) }));
  return <div className={`note-content-editor note-dual-editor ${compact ? 'is-compact' : ''} ${items.length ? '' : 'has-no-items'}`}>
    <section className="note-todo-section" aria-label="待办">
      <div className="note-section-heading"><h3><CheckSquare2 size={15} /> 待办</h3><span>{completed} / {items.length} 已完成</span></div>
      <div className="checklist-add"><input ref={newItem} autoFocus={!compact} aria-label="新增待办" placeholder={atItemLimit ? '已达到 500 项上限' : '写一项待办，按 Enter 添加'} maxLength={1000} disabled={atItemLimit} value={itemText} onChange={event => setItemText(event.target.value)} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === 'Enter') { event.preventDefault(); addItem(); } }} /><button type="button" className="checklist-add-button" aria-label="添加待办项" disabled={!itemText.trim() || atItemLimit} onClick={addItem}><Plus size={14} /><span>添加</span></button></div>
      <ul className="checklist-items">{items.map((item, index) => <li key={item.id} data-item-id={item.id} className={item.completed ? 'is-done' : ''}><input type="checkbox" aria-label={item.text || `第 ${index + 1} 项待办`} checked={item.completed} onChange={event => patchItem(item.id, { completed: event.target.checked })} /><input className="checklist-item-text" aria-label={`编辑待办：${item.text || `第 ${index + 1} 项`}`} placeholder="待办内容" maxLength={1000} value={item.text} onChange={event => patchItem(item.id, { text: event.target.value })} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === 'Enter') { event.preventDefault(); newItem.current?.focus(); } }} /><button type="button" className="icon-btn tiny checklist-delete" aria-label={`删除待办 ${index + 1}`} onClick={() => onChange(current => ({ ...current, items: (current.items || []).filter(existing => existing.id !== item.id) }))}><X size={15} /></button></li>)}</ul>
      {!items.length && <p className="checklist-empty">逐条添加，完成后打勾。</p>}
      {atItemLimit && <p className="checklist-limit" role="status">已达 500 项，删除旧待办后可继续添加。</p>}
    </section>
    <section className="note-memo-section" aria-label="随手记">
      <div className="note-section-heading"><h3><FileText size={15} /> 随手记</h3></div>
      <textarea className="memo-content" aria-label="备忘录内容" placeholder="自由写下想法、灵感或备注…" maxLength={10000} value={note.content} onChange={event => { const content = event.target.value; onChange(current => ({ ...current, content })); }} />
    </section>
  </div>;
}

export default function Notes({ notes, update, notify, query = '' }: { notes: Note[]; update: Update; notify: (message: string) => void; query?: string }) {
  const [filter, setFilter] = useState<'all' | 'pinned'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const note = notes.find(item => item.id === editing);
  const desktopAvailable = typeof window.nestDesktop?.openNote === 'function';
  const change = (id: string, updater: (note: Note) => Note) => update(data => ({ ...data, notes: data.notes.map(item => item.id === id ? { ...updater(item), updatedAt: Date.now() } : item) }));
  const add = () => {
    const id = uid();
    update(data => ({ ...data, notes: [{ id, kind: 'memo', content: '', items: [], color: 'blue', pinned: false, updatedAt: Date.now() }, ...data.notes] }));
    setEditing(id);
  };
  const openDesktop = async (id: string) => {
    if (!desktopAvailable) return;
    try { const result = await window.nestDesktop!.openNote(id); if (result && typeof result === 'object' && 'ok' in result && result.ok === false) { notify('暂时无法打开桌面便签，请重试。'); return; } notify('已在桌面打开便签'); }
    catch { notify('暂时无法打开桌面便签，请重试。'); }
  };
  const needle = (search || query).toLowerCase();
  const shown = notes.filter(item => (filter === 'all' || item.pinned) && [item.content, ...(item.items || []).map(todo => todo.text)].join('\n').toLowerCase().includes(needle)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  return <div className="notes-page">
    <div className="page-intro"><div><h1>便签</h1><p>上方列待办，下方写想法。</p></div><div className="notes-create-actions"><button className="btn btn-primary" aria-label="新建便签" onClick={add}><Plus size={16} /> 新建便签</button></div></div>
    {desktopAvailable && <aside className="desktop-note-guide" aria-label="桌面便签使用方法"><Monitor size={21} /><div><h2>把便签放到桌面</h2><p>新建便签后，点击右上角「桌面显示」。已有便签也可点击卡片底部的「桌面显示」。</p><span>小窗口可拖动、置顶，待办和随手记会与这里自动同步。</span></div></aside>}
    <div className="notes-toolbar"><div className="text-tabs"><button aria-pressed={filter === 'all'} className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 <span>{notes.length}</span></button><button aria-pressed={filter === 'pinned'} className={filter === 'pinned' ? 'active' : ''} onClick={() => setFilter('pinned')}><Pin size={13} /> 已置顶</button></div><label className="notes-search"><Search size={16} /><input aria-label="搜索便签" placeholder="搜索便签" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="notes-sync-status"><CheckCheck size={14} /><span>{desktopAvailable ? '本地自动同步' : '已自动保存到本机'}</span>{!desktopAvailable && <span className="notes-desktop-hint"><Monitor size={13} /> 桌面版可独立显示便签</span>}</div>
    {shown.length ? <div className="notes-grid">{shown.map(item => {
      const todos = item.items || [], completed = todos.filter(todo => todo.completed).length;
      return <article className={`note-card ${item.color} combined-card`} key={item.id}>
        <div className="note-actions"><span className="note-kind"><StickyNote size={16} />待办与随手记</span><div><button className={`icon-btn tiny ${item.pinned ? 'is-pinned' : ''}`} aria-label={item.pinned ? '取消置顶便签' : '置顶便签'} title={item.pinned ? '取消列表置顶' : '在列表中置顶'} onClick={() => change(item.id, current => ({ ...current, pinned: !current.pinned }))}><Pin size={14} /></button><button className="icon-btn tiny" aria-label="删除便签" onClick={() => setDeleting(item.id)}><Trash2 size={14} /></button></div></div>
        <button className="note-body" onClick={() => setEditing(item.id)}><h3>{noteTitle(item)}</h3></button>
        {<div className="note-card-checklist"><ul>{todos.slice(0, 4).map(todo => <li className={todo.completed ? 'is-done' : ''} key={todo.id}><label><input type="checkbox" aria-label={todo.text || '未命名待办'} checked={todo.completed} onChange={event => { const checked = event.target.checked; change(item.id, current => ({ ...current, items: (current.items || []).map(existing => existing.id === todo.id ? { ...existing, completed: checked } : existing) })); }} /><span>{todo.text || '未命名待办'}</span></label></li>)}</ul>{!todos.length && <button className="note-empty-list" onClick={() => setEditing(item.id)}>添加待办项</button>}<div className="note-list-summary"><span>{completed} / {todos.length} 已完成</span>{todos.length > 4 && <button onClick={() => setEditing(item.id)}>查看全部 {todos.length} 项</button>}</div></div>}
        <button className="note-memo-preview" onClick={() => setEditing(item.id)}><span>随手记</span><p>{item.content || '写下此刻的想法…'}</p></button>
        <footer><span className="note-date">{new Date(item.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span><div>{desktopAvailable && <button className="note-desktop-action" aria-label={`桌面显示：${noteTitle(item)}`} onClick={() => void openDesktop(item.id)}><Monitor size={14} /> 桌面显示</button>}<button className="icon-btn tiny" aria-label="编辑便签" onClick={() => setEditing(item.id)}><ArrowUpRight size={16} /></button></div></footer>
      </article>;
    })}</div> : <div className="notes-empty"><StickyNote size={38} strokeWidth={1.2} /><h2>{needle ? '没有找到匹配的便签' : filter === 'pinned' ? '还没有置顶便签' : '记录你的第一条便签'}</h2><p>{needle ? '试试其他关键词。' : filter === 'pinned' ? '点击便签上的图钉，将它留在列表前面。' : '一张便签，上方列待办，下方写想法。'}</p>{!needle && filter === 'all' && <button className="btn btn-primary" onClick={add}><Plus size={16} /> 开始记录</button>}</div>}
    {note && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setEditing(null); }}><section className={`modal note-editor ${note.color}`} role="dialog" aria-modal="true" aria-labelledby="note-editor-title"><header><h2 id="note-editor-title">便签</h2><div className="note-editor-tools">{desktopAvailable && <button className="btn btn-soft" onClick={() => void openDesktop(note.id)}><Monitor size={15} /> 桌面显示</button>}<button className="icon-btn" aria-label="关闭便签" onClick={() => setEditing(null)}><X size={20} /></button></div></header><NoteContentEditor key={note.id} note={note} onChange={updater => change(note.id, updater)} /><footer><div className="note-colors" aria-label="便签色调">{colors.map((color, index) => <button aria-label={colorNames[index]} title={colorNames[index]} key={color} className={`${color} ${color === note.color ? 'active' : ''}`} onClick={() => change(note.id, current => ({ ...current, color }))}>{color === note.color && <Check size={12} />}</button>)}</div><span className="saved-hint"><CheckCheck size={13} /> {desktopAvailable ? '本地自动同步' : '自动保存'}</span></footer></section></div>}
    {deleting && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="delete-note-title"><h2 id="delete-note-title">删除这条便签？</h2><p>便签及其待办项将一并移除，桌面窗口也会同步。</p><footer><button className="btn btn-soft" onClick={() => setDeleting(null)}>取消</button><button className="btn btn-primary" onClick={() => { update(data => ({ ...data, notes: data.notes.filter(item => item.id !== deleting) })); setDeleting(null); notify('便签已删除'); }}>确认删除</button></footer></section></div>}
  </div>;
}
