import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { _electron, expect } from '@playwright/test';

const workspace=fileURLToPath(new URL('../',import.meta.url));
const profile=path.join(workspace,'.test-profile',`geometry-${Date.now()}`);
await mkdir(profile,{recursive:true});
const env={...process.env,NEST_TEST_HEADLESS:'1',NEST_TEST_USER_DATA:profile};
delete env.ELECTRON_RUN_AS_NODE;delete env.NEST_DEV_URL;
let app;
async function quit(){if(!app)return;const closed=app.waitForEvent('close');await app.evaluate(({app})=>{setImmediate(()=>app.quit());});await closed;app=null;}
async function state(){return app.evaluate(({BrowserWindow})=>{const windows=BrowserWindow.getAllWindows();const note=windows.find(w=>new URL(w.webContents.getURL()).searchParams.get('note')==='geometry');return {visible:windows.some(w=>w.isVisible()),bounds:note?.getBounds()};});}
try{
  let baseline;
  for(let round=0;round<4;round++){
    app=await _electron.launch({args:['.'],cwd:workspace,env});
    const main=await app.firstWindow();
    await expect(main.getByRole('navigation',{name:'主导航'})).toBeVisible();
    if(round===0){
      await main.evaluate(async()=>{
        await window.nestDesktop.notes.mutate({requestId:crypto.randomUUID(),ops:[{type:'create',note:{id:'geometry',content:'窗口恢复验证',kind:'memo',color:'blue',pinned:false,items:[],updatedAt:Date.now()}}]});
        await window.nestDesktop.openNote('geometry');
      });
      await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('note')==='geometry');w.setBounds({x:80,y:80,width:370,height:480});});
      baseline=(await state()).bounds;
    }else{
      await expect.poll(async()=>JSON.stringify((await state()).bounds),{timeout:15000}).toBe(JSON.stringify(baseline));
    }
    assert.equal((await state()).visible,false);
    console.log(`Round ${round}: ${JSON.stringify((await state()).bounds)}`);
    await quit();
  }
  console.log('PASS: three restarts preserve exactly the same bounds; all windows hidden.');
}finally{await quit();}
