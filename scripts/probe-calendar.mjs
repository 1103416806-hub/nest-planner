import { _electron, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const env={...process.env,NEST_TEST_HEADLESS:'1',NEST_TEST_USER_DATA:path.join(root,'.test-profile',`calendar-probe-${Date.now()}`)};
delete env.ELECTRON_RUN_AS_NODE;delete env.NEST_DEV_URL;
const app=await _electron.launch({args:['.'],cwd:root,env});
try{
 const page=await app.firstWindow();
 await expect(page.getByRole('navigation',{name:'主导航'})).toBeVisible();
 const geometry=await page.evaluate(()=>{
  const rects=selector=>[...document.querySelectorAll(selector)].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
  const scroll=document.querySelector('.timeline-scroll');
  return {dpr:devicePixelRatio,scrollbar:scroll.getBoundingClientRect().width-document.querySelector('.timeline').getBoundingClientRect().width,heads:rects('.day-heading'),allDay:rects('.all-day-row>div'),columns:rects('.day-column')};
 });
 await page.locator('.time-slot').nth(18).click();
 console.log(JSON.stringify({geometry,singleClickOpened:(await page.getByRole('dialog').count())>0},null,2));
 await mkdir(path.join(root,'artifacts'),{recursive:true});
 await page.screenshot({path:path.join(root,'artifacts',process.argv.includes('--after')?'calendar-after-fix.png':'calendar-before-fix.png')});
}finally{const done=app.waitForEvent('close');await app.evaluate(({app})=>{setImmediate(()=>app.quit());});await done;}
