import { uid, type Note, type NoteOperation, type NoteSnapshot } from './model.ts';

let initialized=false;
let nativeReady=false;
let serverNotes:Note[]=[];
let projected:Note[]=[];
let revision=-1;
let pending:{requestId:string;ops:NoteOperation[]}[]=[];
let lastError:string|null=null;
let replacing=false;
const inFlight=new Set<Promise<Note[]>>();
const listeners=new Set<()=>void>();
function report(error:unknown){lastError=error instanceof Error?error.message:String(error);window.dispatchEvent(new CustomEvent('nest-note-error',{detail:lastError}));}
function clearError(){if(lastError!==null){lastError=null;window.dispatchEvent(new CustomEvent('nest-note-error',{detail:null}));}}
export const getNoteClientError=()=>lastError;

export function applyNoteOperations(notes:Note[],operations:NoteOperation[]):Note[] {
  let result=notes;
  for(const operation of operations){
    if(operation.type==='create') { if(!result.some(n=>n.id===operation.note.id))result=[operation.note,...result];continue; }
    if(operation.type==='delete'){result=result.filter(n=>n.id!==operation.id);continue;}
    result=result.map(note=>{
      if(note.id!==operation.id)return note;
      if(operation.type==='patch')return {...note,...operation.patch,id:note.id};
      const items=note.items||[];
      if(operation.type==='item-add')return items.some(i=>i.id===operation.item.id)?note:{...note,items:[...items,operation.item]};
      if(operation.type==='item-delete')return {...note,items:items.filter(i=>i.id!==operation.itemId)};
      return {...note,items:items.map(i=>i.id===operation.itemId?{...i,...operation.patch,id:i.id}:i)};
    });
  }
  return result;
}
export function diffNotes(before:Note[],after:Note[]):NoteOperation[] {
  const operations:NoteOperation[]=[];
  for(const old of before)if(!after.some(n=>n.id===old.id))operations.push({type:'delete',id:old.id});
  for(const note of [...after].reverse()){
    const old=before.find(n=>n.id===note.id);
    if(!old){operations.push({type:'create',note});continue;}
    if((note.kind||'memo')!==(old.kind||'memo')){
      operations.push({type:'patch',id:note.id,patch:{...note,kind:note.kind||'memo',items:note.items||[]}});
      continue;
    }
    const patch:Partial<Note>={};
    for(const field of ['content','color','pinned','kind','updatedAt'] as const){if(note[field]!==old[field])Object.assign(patch,{[field]:note[field]});}
    if(Object.keys(patch).length)operations.push({type:'patch',id:note.id,patch});
    const oldItems=old.items||[],items=note.items||[];
    for(const item of oldItems)if(!items.some(i=>i.id===item.id))operations.push({type:'item-delete',id:note.id,itemId:item.id});
    for(const item of items){
      const prior=oldItems.find(i=>i.id===item.id);
      if(!prior){operations.push({type:'item-add',id:note.id,item});continue;}
      const change:Partial<Pick<typeof item,'text'|'completed'>>={};
      if(prior.text!==item.text)change.text=item.text;
      if(prior.completed!==item.completed)change.completed=item.completed;
      if(Object.keys(change).length)operations.push({type:'item-patch',id:note.id,itemId:item.id,patch:change});
    }
  }
  return operations;
}
function emit(){projected=pending.reduce((notes,entry)=>applyNoteOperations(notes,entry.ops),serverNotes);listeners.forEach(listener=>listener());}
function accept(snapshot:NoteSnapshot){
  if(snapshot.requestId)pending=pending.filter(entry=>entry.requestId!==snapshot.requestId);
  if(snapshot.revision>=revision){revision=snapshot.revision;serverNotes=snapshot.notes;}
  emit();
}
export function initializeNoteClient(initial:Note[]=[]):Note[] {
  if(initialized)return projected;
  initialized=true;
  serverNotes=initial;projected=initial;
  const api=window.nestDesktop?.notes;
  if(api){
    try{const snapshot=api.initialize(initial);serverNotes=snapshot.notes;projected=snapshot.notes;revision=snapshot.revision;nativeReady=true;api.onChanged(accept);clearError();}
    catch(error){report(error);}
  }
  return projected;
}
export const subscribeNotes=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
export const getNotesSnapshot=()=>projected;
function sendMutation(ops:NoteOperation[]):Promise<Note[]> {
  const api=window.nestDesktop?.notes;
  if(!api)return Promise.resolve(projected);
  const requestId=uid();pending.push({requestId,ops});emit();
  const request=(async()=>api.mutate({requestId,ops}))().then(snapshot=>{
    accept(snapshot);clearError();return projected;
  }).catch(error=>{
    pending=pending.filter(entry=>entry.requestId!==requestId);emit();report(error);throw error;
  });
  inFlight.add(request);
  void request.then(()=>inFlight.delete(request),()=>inFlight.delete(request));
  return request;
}
export function changeNotes(updater:(notes:Note[])=>Note[]):void {
  if(!initialized)initializeNoteClient();
  if(replacing){emit();report(new Error('正在恢复备份，请等待恢复完成后再编辑便签。'));return;}
  const next=updater(projected);
  const ops=diffNotes(projected,next);
  if(!ops.length)return;
  const api=window.nestDesktop?.notes;
  if(!api){serverNotes=next;emit();clearError();return;}
  if(!nativeReady){emit();report(new Error('便签存储暂时不可用，修改未保存。请重启应用后重试。'));return;}
  void sendMutation(ops).catch(()=>undefined);
}

/** A backup restore is one durable transaction, including checklist item order. */
export async function replaceNotes(notes:Note[]):Promise<Note[]> {
  if(replacing)throw new Error('正在恢复备份，请等待本次恢复完成。');
  if(!initialized)initializeNoteClient();
  const replacement=structuredClone(notes);
  const api=window.nestDesktop?.notes;
  if(!api){serverNotes=replacement;pending=[];emit();clearError();return projected;}
  if(!nativeReady)throw new Error(lastError||'便签存储暂时不可用，备份未恢复。请重启应用后重试。');
  replacing=true;
  try {
    // Earlier local edits must settle before constructing a complete replacement.
    await Promise.allSettled([...inFlight]);
    accept(await api.list());
    const ops:NoteOperation[]=[...projected.map(note=>({type:'delete' as const,id:note.id})),...replacement.slice().reverse().map(note=>({type:'create' as const,note}))];
    if(!ops.length){clearError();return projected;}
    return await sendMutation(ops);
  } catch(error){report(error);throw error;}
  finally{replacing=false;}
}
