const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');

const NOTE_KEYS = new Set(['id', 'content', 'color', 'pinned', 'updatedAt', 'kind', 'items']);
const ITEM_KEYS = new Set(['id', 'text', 'completed']);
const COLORS = new Set(['yellow', 'green', 'pink', 'blue']);
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_NOTES = 2000;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function id(value, label = '记录编号') {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${label}格式不正确。`);
  return value;
}
function keys(value, allowed) {
  if (!record(value) || Object.keys(value).some(key => !allowed.has(key))) throw new TypeError('记录包含不支持的字段。');
}
function item(value) {
  keys(value, ITEM_KEYS);
  id(value.id, '待办编号');
  if (typeof value.text !== 'string' || value.text.length > 1000 || typeof value.completed !== 'boolean') throw new TypeError('待办内容格式不正确，文字最多 1000 字。');
  return { id: value.id, text: value.text, completed: value.completed };
}
function normalizeNote(value) {
  keys(value, NOTE_KEYS);
  id(value.id);
  if (typeof value.content !== 'string' || value.content.length > 10000 || !COLORS.has(value.color)
    || typeof value.pinned !== 'boolean' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0
    || (value.kind !== undefined && !['memo', 'checklist'].includes(value.kind))) throw new TypeError('便签内容格式不正确，正文最多 10000 字。');
  const items = value.items === undefined ? [] : value.items;
  if (!Array.isArray(items) || items.length > 500) throw new TypeError('每张便签最多包含 500 项待办。');
  const normalized = items.map(item);
  if (new Set(normalized.map(entry => entry.id)).size !== normalized.length) throw new TypeError('待办编号重复。');
  return { id: value.id, content: value.content, color: value.color, pinned: value.pinned,
    updatedAt: value.updatedAt, kind: value.kind || 'memo', items: normalized };
}
function normalizeNotes(values) {
  if (!Array.isArray(values) || values.length > MAX_NOTES) throw new TypeError(`最多保存 ${MAX_NOTES} 张便签。`);
  const notes = values.map(normalizeNote);
  if (new Set(notes.map(note => note.id)).size !== notes.length) throw new TypeError('便签编号重复。');
  return notes;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function writeAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

class NoteStore {
  constructor(filePath, { write = writeAtomic, now = Date.now } = {}) {
    if (!path.isAbsolute(filePath)) throw new TypeError('便签存储路径必须是绝对路径。');
    this.filePath = filePath;
    this.write = write;
    this.now = now;
    this.state = { version: 1, revision: 0, notes: [], requestLog: [] };
    this.initialized = false;
    this.loadError = null;
    try {
      const size = fs.statSync(filePath).size;
      if (size > MAX_BYTES) throw new Error('便签数据文件过大。');
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!record(saved) || saved.version !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision < 0) throw new Error('便签数据文件格式不正确。');
      const notes = normalizeNotes(saved.notes);
      const requestLog = saved.requestLog === undefined ? [] : saved.requestLog;
      if (!Array.isArray(requestLog) || requestLog.length > 256 || requestLog.some(entry => !record(entry)
        || typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || !entry.requestId)) throw new Error('便签操作记录格式不正确。');
      requestLog.forEach(entry => id(entry.requestId, '请求编号'));
      this.state = { version: 1, revision: saved.revision, notes, requestLog };
      this.initialized = true;
    } catch (error) {
      if (error.code !== 'ENOENT') this.loadError = new Error(`无法读取便签数据，原文件已保留：${error.message}`);
    }
  }

  assertHealthy() { if (this.loadError) throw this.loadError; }
  list(requestId) {
    this.assertHealthy();
    return { notes: clone(this.state.notes), revision: this.state.revision, ...(requestId ? { requestId } : {}) };
  }
  has(noteId) { this.assertHealthy(); return this.state.notes.some(note => note.id === noteId); }
  commit(next) {
    const contents = JSON.stringify(next);
    if (Buffer.byteLength(contents, 'utf8') > MAX_BYTES) throw new Error('便签内容总大小超过 25 MB，请减少内容后重试。');
    // Neither the in-memory state nor revision changes if durable writing fails.
    this.write(this.filePath, contents);
    this.state = next;
    this.initialized = true;
  }
  initialize(initialNotes) {
    this.assertHealthy();
    if (this.initialized) return this.list();
    const notes = normalizeNotes(initialNotes);
    this.commit({ version: 1, revision: notes.length ? 1 : 0, notes, requestLog: [] });
    return this.list();
  }
  mutate(request, { noteId: permittedNoteId } = {}) {
    this.assertHealthy();
    if (!record(request)) throw new TypeError('便签操作格式不正确。');
    id(request.requestId, '请求编号');
    if (!Array.isArray(request.ops) || !request.ops.length || request.ops.length > 5000) throw new TypeError('一次操作应包含 1–5000 项修改。');
    const serialized = JSON.stringify(request.ops);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) throw new TypeError('本次修改内容过大。');
    if (permittedNoteId !== undefined) {
      id(permittedNoteId);
      for (const operation of request.ops) {
        if (!record(operation) || (operation.type === 'create' ? operation.note?.id : operation.id) !== permittedNoteId) throw new Error('桌面便签只能修改自身内容。');
        if (operation.type === 'create') throw new Error('桌面便签不能新建或恢复其他记录。');
      }
    }
    const hash = createHash('sha256').update(serialized).digest('hex');
    const received = this.state.requestLog.find(entry => entry.requestId === request.requestId);
    if (received) {
      if (received.hash !== hash) throw new Error('同一请求编号不能用于不同的修改。');
      return this.list(request.requestId);
    }
    let notes = clone(this.state.notes);
    const now = this.now();
    for (const operation of request.ops) {
      if (!record(operation) || typeof operation.type !== 'string') throw new TypeError('便签操作格式不正确。');
      if (operation.type === 'create') {
        const note = normalizeNote(operation.note);
        if (notes.some(entry => entry.id === note.id)) throw new Error('这张便签已存在。');
        if (notes.length >= MAX_NOTES) throw new Error(`最多保存 ${MAX_NOTES} 张便签。`);
        notes.unshift({ ...note, updatedAt: now });
        continue;
      }
      id(operation.id);
      if (!['patch', 'delete', 'item-add', 'item-patch', 'item-delete'].includes(operation.type)) throw new TypeError('不支持的便签操作。');
      if (operation.type === 'patch') {
        keys(operation.patch, NOTE_KEYS);
        if (Object.hasOwn(operation.patch, 'id') && operation.patch.id !== operation.id) throw new TypeError('不能修改便签编号。');
        // Validate even stale edits, before deciding whether their target still exists.
        const existing = notes.find(entry => entry.id === operation.id);
        normalizeNote({ id: operation.id, content: '', color: 'yellow', pinned: false, updatedAt: now, ...existing, ...operation.patch });
      }
      if (operation.type === 'item-add') item(operation.item);
      if (operation.type === 'item-delete' || operation.type === 'item-patch') id(operation.itemId, '待办编号');
      if (operation.type === 'item-patch') {
        keys(operation.patch, new Set(['text', 'completed']));
        if ((Object.hasOwn(operation.patch, 'text') && (typeof operation.patch.text !== 'string' || operation.patch.text.length > 1000))
          || (Object.hasOwn(operation.patch, 'completed') && typeof operation.patch.completed !== 'boolean')) throw new TypeError('待办修改内容不正确。');
      }
      const index = notes.findIndex(entry => entry.id === operation.id);
      // A late edit after deletion is acknowledged without resurrecting the note.
      if (index < 0) continue;
      const note = notes[index];
      if (operation.type === 'delete') { notes.splice(index, 1); continue; }
      if (operation.type === 'patch') {
        notes[index] = normalizeNote({ ...note, ...operation.patch, id: note.id, updatedAt: now });
        continue;
      }
      // Legacy kind is preserved as metadata; every note supports both body and items.
      if (operation.type === 'item-add') {
        if (note.items.some(entry => entry.id === operation.item.id)) throw new Error('这项待办已存在。');
        note.items.push(item(operation.item));
      } else if (operation.type === 'item-delete') {
        note.items = note.items.filter(entry => entry.id !== operation.itemId);
      } else {
        note.items = note.items.map(entry => entry.id === operation.itemId ? { ...entry, ...operation.patch } : entry);
      }
      note.updatedAt = now;
      notes[index] = normalizeNote(note);
    }
    this.commit({ version: 1, revision: this.state.revision + 1, notes,
      requestLog: [...this.state.requestLog, { requestId: request.requestId, hash }].slice(-256) });
    return this.list(request.requestId);
  }
}

module.exports = { NoteStore, normalizeNote, normalizeNotes, writeAtomic };
