import test from 'node:test';
import assert from 'node:assert/strict';
import { diffNotes, applyNoteOperations } from '../src/note-client.ts';
import { createRequire } from 'node:module';
import path from 'node:path';
const { NoteStore }=createRequire(import.meta.url)('../electron/note-store.cjs');

const note=()=>({id:'n1',content:'今日待办',kind:'checklist',color:'blue',pinned:false,updatedAt:1,items:[{id:'a',text:'买牛奶',completed:false},{id:'b',text:'读书',completed:false}]});

test('two windows editing independent note fields keep both changes',()=>{
  const original=[note()];
  const a=diffNotes(original,[{...original[0],content:'周末待办'}]);
  const b=diffNotes(original,[{...original[0],pinned:true}]);
  const merged=applyNoteOperations(applyNoteOperations(original,a),b);
  assert.equal(merged[0].content,'周末待办');assert.equal(merged[0].pinned,true);
});

test('todo text and checkbox changes merge without replacing the whole item list',()=>{
  const original=[note()];
  const a=diffNotes(original,[{...original[0],items:original[0].items.map(i=>i.id==='a'?{...i,completed:true}:i)}]);
  const b=diffNotes(original,[{...original[0],items:original[0].items.map(i=>i.id==='a'?{...i,text:'买燕麦奶'}:i)}]);
  const merged=applyNoteOperations(applyNoteOperations(original,a),b);
  assert.deepEqual(merged[0].items[0],{id:'a',text:'买燕麦奶',completed:true});
  assert.deepEqual(merged[0].items[1],original[0].items[1]);
});

test('new items merge and stale patches do not recreate deleted notes',()=>{
  const original=[note()];
  const after=[{...original[0],items:[original[0].items[1],{id:'c',text:'散步',completed:false}]}];
  assert.deepEqual(applyNoteOperations(original,diffNotes(original,after)),after);
  assert.deepEqual(applyNoteOperations([],diffNotes(original,[{...original[0],content:'stale'}])),[]);
});

test('restoring the same note with a different kind commits as one native patch',()=>{
  const store=new NoteStore(path.resolve('.test-profile','restore-kind-unwritten.json'),{write:()=>{},now:()=>1});
  const original=store.initialize([note()]).notes;
  const memo={...original[0],kind:'memo',content:'改为备忘录',items:[]};
  const result=store.mutate({requestId:'restore-memo',ops:diffNotes(original,[memo])});
  assert.equal(result.notes[0].kind,'memo');
  assert.deepEqual(result.notes[0].items,[]);
});

test('pending local edits survive a remote snapshot and old acknowledgements do not rewind state',async()=>{
  const original=[note()];let onChanged;let resolveRequest;let requestId;
  const oldWindow=globalThis.window;
  globalThis.window={nestDesktop:{notes:{initialize:()=>({notes:original,revision:0}),onChanged:fn=>{onChanged=fn;return()=>{};},mutate:request=>new Promise(resolve=>{requestId=request.requestId;resolveRequest=resolve;})}},dispatchEvent:()=>{}};
  try{
    const client=await import(`../src/note-client.ts?case=${Date.now()}`);
    client.initializeNoteClient(original);
    client.changeNotes(notes=>notes.map(n=>({...n,content:'我的修改'})));
    onChanged({notes:[{...original[0],pinned:true}],revision:1});
    assert.equal(client.getNotesSnapshot()[0].content,'我的修改');
    assert.equal(client.getNotesSnapshot()[0].pinned,true);
    // The newer server snapshot already includes both edits.
    onChanged({notes:[{...original[0],content:'我的修改',pinned:true}],revision:3});
    resolveRequest({notes:[{...original[0],content:'我的修改'}],revision:2,requestId});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.getNotesSnapshot()[0].pinned,true);
    assert.equal(client.getNotesSnapshot()[0].content,'我的修改');
    onChanged({notes:[{...original[0],content:'稍后的更新',pinned:true}],revision:4});
    assert.equal(client.getNotesSnapshot()[0].content,'稍后的更新');
  } finally {globalThis.window=oldWindow;}
});

test('backup replacement restores checklist order in one commit without one operation per item',async()=>{
  const oldWindow=globalThis.window;
  const original=Array.from({length:11},(_,index)=>({...note(),id:`list-${index}`,items:Array.from({length:500},(_,itemIndex)=>({id:`item-${index}-${itemIndex}`,text:`旧内容 ${itemIndex}`,completed:false}))}));
  const replacement=original.map(n=>({...n,items:n.items.slice().reverse().map(item=>({...item,text:`新内容 ${item.id}`,completed:true}))})).reverse();
  let writes=0;let onChanged;const requests=[];
  const store=new NoteStore(path.resolve('.test-profile',`replace-order-${crypto.randomUUID()}.json`),{write:()=>{writes++;},now:()=>1});
  store.initialize(original);
  globalThis.window={nestDesktop:{notes:{initialize:()=>store.list(),list:async()=>store.list(),onChanged:fn=>{onChanged=fn;return()=>{};},mutate:async request=>{requests.push(request);const snapshot=store.mutate(request);onChanged(snapshot);return snapshot;}}},dispatchEvent:()=>{}};
  try{
    const client=await import(`../src/note-client.ts?replace-order=${crypto.randomUUID()}`);
    client.initializeNoteClient(original);
    const result=await client.replaceNotes(replacement);
    assert.equal(requests.length,1);
    assert.equal(requests[0].ops.length,22);
    assert.equal(writes,2,'one initialization write and one atomic replacement');
    assert.deepEqual(result.map(n=>n.id),replacement.map(n=>n.id));
    for(let index=0;index<result.length;index++)assert.deepEqual(result[index].items,replacement[index].items);
    assert.deepEqual(store.list().notes,result);
  }finally{globalThis.window=oldWindow;}
});

test('failed backup replacement rolls back notes and rejects before other imported data can commit',async()=>{
  const oldWindow=globalThis.window;
  const originalNotes=[note()];let fail=false;
  const store=new NoteStore(path.resolve('.test-profile',`replace-failure-${crypto.randomUUID()}.json`),{write:()=>{if(fail)throw new Error('disk write denied');},now:()=>1});
  const original=store.initialize(originalNotes).notes;
  const originalWorkspace={tasks:[{id:'original-task'}],sessions:[{id:'original-session'}],notes:original};
  const importedWorkspace={tasks:[{id:'imported-task'}],sessions:[],notes:[{...note(),content:'导入的新清单'}]};
  let workspace=originalWorkspace;let observedOptimistic=false;let didCommit=false;
  globalThis.window={nestDesktop:{notes:{initialize:()=>store.list(),list:async()=>store.list(),onChanged:()=>()=>{},mutate:async request=>store.mutate(request)}},dispatchEvent:()=>{}};
  try{
    const client=await import(`../src/note-client.ts?replace-failure=${crypto.randomUUID()}`);
    client.initializeNoteClient(original);
    client.subscribeNotes(()=>{const notes=client.getNotesSnapshot();observedOptimistic ||= notes[0]?.content==='导入的新清单';workspace={...workspace,notes};});
    fail=true;
    await assert.rejects(client.replaceNotes(importedWorkspace.notes).then(notes=>{didCommit=true;workspace={...importedWorkspace,notes};}),/disk write denied/);
    assert.equal(observedOptimistic,true);
    assert.equal(didCommit,false);
    assert.deepEqual(workspace,originalWorkspace);
    assert.deepEqual(store.list().notes,original);
    assert.equal(client.getNoteClientError(),'disk write denied');
  }finally{globalThis.window=oldWindow;}
});

test('an initialization error remains readable after the UI mounts and blocks false successful restores',async()=>{
  const oldWindow=globalThis.window;let mutations=0;
  const original=[note()];
  globalThis.window={nestDesktop:{notes:{initialize:()=>{throw new Error('notes.json could not be read');},onChanged:()=>()=>{},list:async()=>({notes:[],revision:0}),mutate:async()=>{mutations++;return {notes:[],revision:1};}}},dispatchEvent:()=>{}};
  try{
    const client=await import(`../src/note-client.ts?init-error=${crypto.randomUUID()}`);
    assert.deepEqual(client.initializeNoteClient(original),original);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.getNoteClientError(),'notes.json could not be read');
    await assert.rejects(client.replaceNotes([]),/notes.json could not be read/);
    assert.deepEqual(client.getNotesSnapshot(),original);
    assert.equal(mutations,0);
  }finally{globalThis.window=oldWindow;}
});
