import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import storeModule from '../electron/note-store.cjs';
const { NoteStore } = storeModule;

function fixture(t, options) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nest-note-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'notes.json');
  return { file, store: new NoteStore(file, options) };
}
const memo = (id = 'note-a') => ({ id, content: '原始灵感', color: 'yellow', pinned: false, updatedAt: 100 });
const todo = () => ({ ...memo(), kind: 'checklist', items: [{ id: 'item-a', text: '任务 A', completed: false }, { id: 'item-b', text: '任务 B', completed: false }] });
const mutate = (store, requestId, ...ops) => store.mutate({ requestId, ops });

test('migration happens once, canonical memo data survives restart and ignores stale localStorage', t => {
  const { file, store } = fixture(t);
  const initialized = store.initialize([memo()]);
  assert.equal(initialized.notes[0].kind, 'memo');
  assert.equal(initialized.revision, 1);
  mutate(store, 'change', { type: 'patch', id: 'note-a', patch: { content: '桌面改写' } });
  const reloaded = new NoteStore(file);
  assert.equal(reloaded.initialize([memo()]).notes[0].content, '桌面改写');
  assert.equal(reloaded.list().revision, 2);
});

test('interleaved changes from two windows preserve independently edited fields', t => {
  const { store } = fixture(t);
  store.initialize([memo()]);
  mutate(store, 'main-content', { type: 'patch', id: 'note-a', patch: { content: '主窗口写文字' } });
  mutate(store, 'widget-color', { type: 'patch', id: 'note-a', patch: { color: 'blue' } });
  const result = store.list();
  assert.equal(result.notes[0].content, '主窗口写文字');
  assert.equal(result.notes[0].color, 'blue');
  assert.equal(result.revision, 3);
});

test('independent checklist item edits merge and complete independently', t => {
  const { store } = fixture(t);
  store.initialize([todo()]);
  mutate(store, 'a-done', { type: 'item-patch', id: 'note-a', itemId: 'item-a', patch: { completed: true } });
  mutate(store, 'b-text', { type: 'item-patch', id: 'note-a', itemId: 'item-b', patch: { text: '窗口 B 更新任务' } });
  mutate(store, 'b-done', { type: 'item-patch', id: 'note-a', itemId: 'item-b', patch: { completed: true } });
  assert.deepEqual(store.list().notes[0].items, [
    { id: 'item-a', text: '任务 A', completed: true }, { id: 'item-b', text: '窗口 B 更新任务', completed: true },
  ]);
});

test('invalid later operation rejects the whole batch without memory or disk changes', t => {
  const { file, store } = fixture(t);
  store.initialize([memo()]);
  const before = readFileSync(file, 'utf8');
  assert.throws(() => mutate(store, 'invalid',
    { type: 'patch', id: 'note-a', patch: { content: '不可部分提交' } },
    { type: 'patch', id: 'note-a', patch: { content: 'x'.repeat(10001) } }), /最多/);
  assert.equal(store.list().notes[0].content, '原始灵感');
  assert.equal(store.list().revision, 1);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('write failure cannot commit to memory or advance revision', t => {
  const { file, store } = fixture(t);
  store.initialize([memo()]);
  const failing = new NoteStore(file, { write: () => { throw new Error('disk full'); } });
  assert.throws(() => mutate(failing, 'disk-full', { type: 'delete', id: 'note-a' }), /disk full/);
  assert.equal(failing.list().notes.length, 1);
  assert.equal(failing.list().revision, 1);
  assert.equal(new NoteStore(file).list().notes.length, 1);
});

test('request acknowledgements are idempotent across restart', t => {
  const { file, store } = fixture(t);
  store.initialize([todo()]);
  const operation = { type: 'item-add', id: 'note-a', item: { id: 'item-c', text: '一次新增', completed: false } };
  const first = mutate(store, 'same-request', operation);
  const retried = mutate(new NoteStore(file), 'same-request', operation);
  assert.equal(retried.requestId, 'same-request');
  assert.equal(retried.revision, first.revision);
  assert.equal(retried.notes[0].items.length, 3);
  assert.throws(() => mutate(store, 'same-request', { type: 'delete', id: 'note-a' }), /同一请求/);
});

test('deleting a note or item never allows stale edits to resurrect it', t => {
  const { store } = fixture(t);
  store.initialize([todo()]);
  mutate(store, 'delete-item', { type: 'item-delete', id: 'note-a', itemId: 'item-a' });
  mutate(store, 'stale-item', { type: 'item-patch', id: 'note-a', itemId: 'item-a', patch: { completed: true } });
  assert.equal(store.list().notes[0].items.length, 1);
  mutate(store, 'delete-note', { type: 'delete', id: 'note-a' });
  mutate(store, 'stale-note', { type: 'patch', id: 'note-a', patch: { content: '延迟写入' } });
  assert.deepEqual(store.list().notes, []);
});

test('widget scope rejects other notes even in a mixed batch', t => {
  const { store } = fixture(t);
  store.initialize([memo(), memo('note-b')]);
  assert.throws(() => store.mutate({ requestId: 'escape', ops: [
    { type: 'patch', id: 'note-a', patch: { content: 'allowed' } },
    { type: 'delete', id: 'note-b' },
  ] }, { noteId: 'note-a' }), /只能修改自身/);
  assert.equal(store.list().notes.length, 2);
  assert.equal(store.list().notes[0].content, '原始灵感');
});

test('malformed IDs, duplicate items, and existing corrupted files are rejected', t => {
  const { file, store } = fixture(t);
  assert.throws(() => store.initialize([{ ...memo(), id: '' }]), /编号/);
  assert.throws(() => store.initialize([{ ...memo(), updatedAt: 100.5 }]), /格式/);
  assert.throws(() => store.initialize([{ ...todo(), items: [todo().items[0], todo().items[0]] }]), /重复/);
  writeFileSync(file, '{not valid json', 'utf8');
  const corrupted = new NoteStore(file);
  assert.throws(() => corrupted.initialize([memo()]), /原文件已保留/);
  assert.equal(readFileSync(file, 'utf8'), '{not valid json');
});

test('ordered batch can create a checklist, add an item, then complete it atomically', t => {
  const { store } = fixture(t);
  store.initialize([]);
  const result = mutate(store, 'ordered-batch',
    { type: 'create', note: { ...memo(), kind: 'checklist', items: [] } },
    { type: 'item-add', id: 'note-a', item: { id: 'new-item', text: '同一批加入', completed: false } },
    { type: 'item-patch', id: 'note-a', itemId: 'new-item', patch: { completed: true } });
  assert.equal(result.revision, 1);
  assert.deepEqual(result.notes[0].items, [{ id: 'new-item', text: '同一批加入', completed: true }]);
});

test('legacy untyped, memo, and checklist notes all support item add/check/delete without rewriting their body or kind', t => {
  for (const kind of [undefined, 'memo', 'checklist']) {
    const { file, store } = fixture(t);
    const original = kind === 'checklist'
      ? { ...todo(), content: '旧清单的完整标题\n补充文字也应保留。' }
      : { ...memo(), content: '原有自由正文\n第二行完整保留。', ...(kind ? { kind } : {}) };
    const initialItems = original.items || [];
    store.initialize([original]);
    const apply = (requestId, operation) => store.mutate({ requestId, ops: [operation] }, { noteId: original.id });
    apply('add', { type: 'item-add', id: original.id, item: { id: 'mixed-item', text: '写在正文上方的待办', completed: false } });
    apply('check', { type: 'item-patch', id: original.id, itemId: 'mixed-item', patch: { text: '已修改的待办', completed: true } });
    const expectedItems = [...initialItems, { id: 'mixed-item', text: '已修改的待办', completed: true }];
    const persisted = new NoteStore(file).initialize([original]).notes[0];
    assert.equal(persisted.kind, kind || 'memo');
    assert.equal(persisted.content, original.content);
    assert.deepEqual(persisted.items, expectedItems);
    apply('delete', { type: 'item-delete', id: original.id, itemId: 'mixed-item' });
    const afterDelete = new NoteStore(file).list().notes[0];
    assert.equal(afterDelete.content, original.content);
    assert.equal(afterDelete.kind, kind || 'memo');
    assert.deepEqual(afterDelete.items, initialItems);
  }
});

test('memo body and todo edits from two clients merge in either arrival order and survive restart', t => {
  for (const bodyFirst of [true, false]) {
    const { file, store } = fixture(t);
    const original = { ...memo(), kind: 'memo', items: [
      { id: 'read', text: '读一章书', completed: false },
      { id: 'walk', text: '出门散步', completed: false },
    ] };
    store.initialize([original]);
    // Both clients start from the same snapshot and submit only their own changed fields.
    const base = store.list().notes[0];
    const body = { requestId: 'main-body', ops: [{ type: 'patch', id: base.id, patch: { content: `${base.content}\n正文窗口追加的一行。` } }] };
    const todo = { requestId: 'desktop-todo', ops: [
      { type: 'item-patch', id: base.id, itemId: 'read', patch: { completed: true } },
      { type: 'item-add', id: base.id, item: { id: 'cook', text: '准备晚餐', completed: false } },
    ] };
    for (const request of bodyFirst ? [body, todo] : [todo, body]) store.mutate(request, { noteId: base.id });
    const final = store.list();
    assert.equal(final.notes[0].kind, 'memo');
    assert.equal(final.notes[0].content, '原始灵感\n正文窗口追加的一行。');
    assert.deepEqual(final.notes[0].items, [
      { id: 'read', text: '读一章书', completed: true },
      { id: 'walk', text: '出门散步', completed: false },
      { id: 'cook', text: '准备晚餐', completed: false },
    ]);
    const restarted = new NoteStore(file);
    assert.deepEqual(restarted.list(), final);
    assert.deepEqual(restarted.initialize([original]), final, 'Stale migration data must not overwrite either part');
  }
});

test('invalid mixed memo operation rejects body and todo changes together', t => {
  const { file, store } = fixture(t);
  store.initialize([{ ...memo(), kind: 'memo', items: [{ id: 'keep', text: '已有待办', completed: false }] }]);
  const before = store.list();
  const bytes = readFileSync(file, 'utf8');
  assert.throws(() => mutate(store, 'invalid-mixed',
    { type: 'patch', id: 'note-a', patch: { content: '不应被部分写入的正文' } },
    { type: 'item-patch', id: 'note-a', itemId: 'keep', patch: { completed: true } },
    { type: 'item-add', id: 'note-a', item: { id: 'invalid', text: 'x'.repeat(1001), completed: false } }), /最多 1000/);
  assert.deepEqual(store.list(), before);
  assert.equal(readFileSync(file, 'utf8'), bytes);
});
