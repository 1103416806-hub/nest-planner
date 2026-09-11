import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowUpRight, CheckCheck, Pin, StickyNote, X } from 'lucide-react';
import { changeNotes, getNoteClientError, getNotesSnapshot, initializeNoteClient, subscribeNotes } from './note-client';
import { NoteContentEditor, noteTitle } from './Notes';
import type { Note } from './model';

let initialized = false;
function ensureNoteClient() {
  if (!initialized) { initializeNoteClient(); initialized = true; }
}

export default function DesktopNote() {
  ensureNoteClient();
  const notes = useSyncExternalStore(subscribeNotes, getNotesSnapshot, getNotesSnapshot);
  const [noteId] = useState(() => new URLSearchParams(window.location.search).get('note'));
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [noteError, setNoteError] = useState(getNoteClientError);
  const note = notes.find(item => item.id === noteId);
  const native = window.nestDesktop;
  useEffect(() => {
    document.documentElement.classList.add('desktop-note-document');
    void native?.getNoteAlwaysOnTop().then(setAlwaysOnTop).catch(() => setFeedback('无法读取窗口置顶状态'));
    const onStorageError = () => setNoteError(getNoteClientError());
    window.addEventListener('nest-note-error', onStorageError);
    setNoteError(getNoteClientError());
    return () => {
      document.documentElement.classList.remove('desktop-note-document');
      window.removeEventListener('nest-note-error', onStorageError);
    };
  }, []);
  const change = (updater: (note: Note) => Note) => changeNotes(current => current.map(item => item.id === noteId ? { ...updater(item), updatedAt: Date.now() } : item));
  const close = () => { void native?.closeNote().catch(() => setFeedback('暂时无法关闭窗口')); };
  const showMain = () => { void native?.showMain().catch(() => setFeedback('暂时无法打开主窗口')); };
  const toggleOnTop = async () => {
    if (!native) return;
    try { setAlwaysOnTop(await native.setNoteAlwaysOnTop(!alwaysOnTop)); setFeedback(''); }
    catch { setFeedback('无法更新窗口置顶状态'); }
  };
  return <main className={`desktop-note ${note?.color || 'blue'}`}>
    <header className="desktop-note-header"><div className="desktop-note-drag"><StickyNote size={16} /><span>待办与随手记</span></div><div className="desktop-note-controls">
      <button className={`icon-btn ${alwaysOnTop ? 'is-pinned' : ''}`} aria-label={alwaysOnTop ? '取消置顶便签' : '置顶便签'} aria-pressed={alwaysOnTop} title={alwaysOnTop ? '取消窗口置顶' : '窗口置顶'} onClick={() => void toggleOnTop()} disabled={!native}><Pin size={15} /></button>
      <button className="icon-btn" aria-label="打开主窗口" title="打开主窗口" onClick={showMain} disabled={!native}><ArrowUpRight size={17} /></button>
      <button className="icon-btn" aria-label="关闭桌面便签" title="关闭便签，内容保留" onClick={close} disabled={!native}><X size={17} /></button>
    </div></header>
    {note ? <div className="desktop-note-content" aria-label={noteTitle(note)}><NoteContentEditor key={note.id} note={note} onChange={change} compact /></div> : <div className="desktop-note-missing"><StickyNote size={30} strokeWidth={1.3} /><h1>这条便签已移除</h1><p>可以从主窗口打开其他便签。</p>{native && <button className="btn btn-soft" onClick={close}>关闭窗口</button>}</div>}
    <footer className="desktop-note-footer"><CheckCheck size={13} /><span role="status" title={noteError || feedback || undefined}>{noteError || feedback || (native ? '本地自动同步' : '桌面窗口功能需在桌面版中使用')}</span><span className="desktop-note-resize" aria-hidden="true" /></footer>
  </main>;
}
