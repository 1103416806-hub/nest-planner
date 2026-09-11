import type { Note, NoteOperation, NoteSnapshot } from './model';
declare global {
  interface Window {
    nestDesktop?: {
      version: string;
      notify:(title:string,body:string)=>Promise<{ok:boolean;reason?:string}>;
      getAutoLaunch:()=>Promise<{supported:boolean;enabled:boolean;reason?:string}>;
      setAutoLaunch:(v:boolean)=>Promise<{supported:boolean;enabled:boolean;reason?:string}>;
      getAlwaysOnTop:()=>Promise<boolean>;
      setAlwaysOnTop:(v:boolean)=>Promise<boolean>;
      showWindow:()=>Promise<unknown>;
      notes: {
        initialize:(initial:Note[])=>NoteSnapshot;
        list:()=>Promise<NoteSnapshot>;
        mutate:(request:{requestId:string;ops:NoteOperation[]})=>Promise<NoteSnapshot>;
        onChanged:(callback:(snapshot:NoteSnapshot)=>void)=>(()=>void);
      };
      openNote:(id:string)=>Promise<{ok:boolean;reason?:string}>;
      closeNote:()=>Promise<void>;
      getNoteAlwaysOnTop:()=>Promise<boolean>;
      setNoteAlwaysOnTop:(value:boolean)=>Promise<boolean>;
      showMain:()=>Promise<void>;
    };
  }
}
export {};
