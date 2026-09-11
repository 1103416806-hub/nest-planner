import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const key = 'nest-planner-v1';
const stored = page => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey)), key);
async function route(page, name) {
  if (await page.getByRole('button', { name: '打开导航', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '打开导航', exact: true }).click();
  }
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: new RegExp(name) }).click();
}

test('日历切换、时间格创建、真实 time input 校验、保存与共享专注', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('n');
  await page.keyboard.press('t');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.locator('.month-grid')).toBeVisible();
  await page.getByRole('button', { name: '周', exact: true }).click();
  await expect(page.locator('.day-column')).toHaveCount(7);
  await page.getByRole('button', { name: '日', exact: true }).click();
  await expect(page.locator('.day-column')).toHaveCount(1);
  await page.getByRole('button', { name: /09:00 添加日程$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await fs.mkdir('artifacts', { recursive: true });
  await page.getByRole('dialog').screenshot({ path: 'artifacts/new-schedule.png', animations: 'disabled' });
  await page.getByLabel('日程名称').fill('晨间阅读与笔记');
  await page.getByLabel('结束时间', { exact: true }).fill('08:00');
  await page.getByRole('dialog').getByRole('button', { name: '添加日程', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('结束时间需要晚于开始时间');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect((await stored(page)).tasks).toHaveLength(0);
  await page.getByLabel('开始时间', { exact: true }).fill('09:15');
  await page.getByLabel('结束时间', { exact: true }).fill('10:45');
  await page.getByRole('dialog').getByRole('button', { name: '添加日程', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await stored(page)).tasks[0]?.start).toBe('09:15');
  await page.reload();
  await page.locator('.time-event').filter({ hasText: '晨间阅读与笔记' }).click();
  await expect(page.getByLabel('结束时间', { exact: true })).toHaveValue('10:45');
  await page.getByLabel('这件事已经完成').check();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks[0]?.completed).toBe(true);
  await page.locator('.time-event').filter({ hasText: '晨间阅读与笔记' }).click();
  await page.getByLabel('结束时间', { exact: true }).fill('08:00');
  await page.getByRole('dialog').getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('结束时间需要晚于开始时间');
  expect((await stored(page)).timer).toBeNull();
  await page.getByLabel('结束时间', { exact: true }).fill('10:45');
  await page.getByRole('dialog').getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(page.locator('.focus-current')).toContainText('晨间阅读与笔记');
  const id = (await stored(page)).timer.id;
  await route(page, '我的日历');
  await expect(page.locator('.focus-current')).toContainText('晨间阅读与笔记');
  expect((await stored(page)).timer.id).toBe(id);
});

test('日程自选颜色保存、跨视图一致、全天及跟随分类', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建日程', exact: true }).click();
  await page.getByLabel('日程名称', { exact: true }).fill('自选颜色日程');
  await page.getByRole('button', { name: '日程颜色：玫瑰', exact: true }).click();
  await expect(page.getByRole('button', { name: '日程颜色：玫瑰', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('自定义日程颜色', { exact: true }).fill('#c45b86');
  await page.getByRole('dialog').getByRole('button', { name: '添加日程', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks[0]?.color).toBe('#c45b86');
  await page.reload();
  const appearance = [];
  for (const view of ['月', '周', '日']) {
    await page.getByRole('button', { name: view, exact: true }).click();
    const event = page.locator('.task-color-event').filter({ hasText: '自选颜色日程' });
    await expect(event).toHaveCount(1);
    appearance.push(await event.evaluate(element => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.color, style.borderLeftColor];
    }));
  }
  expect(appearance[1]).toEqual(appearance[0]);
  expect(appearance[2]).toEqual(appearance[0]);
  await page.locator('.time-event').filter({ hasText: '自选颜色日程' }).click();
  await expect(page.getByLabel('自定义日程颜色', { exact: true })).toHaveValue('#c45b86');
  await page.getByLabel('全天日程', { exact: true }).check();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  const allDay = page.locator('.all-day-event').filter({ hasText: '自选颜色日程' });
  await expect(allDay).toHaveCSS('background-color', appearance[0][0]);
  await allDay.click();
  await page.getByRole('button', { name: '跟随分类', exact: true }).click();
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks[0]?.color).toBeUndefined();
});

test('待办项新增勾选编辑与快速草稿恢复', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('快速便签', { exact: true }).fill('尚未保存的想法');
  await page.reload();
  await expect(page.getByLabel('快速便签', { exact: true })).toHaveValue('尚未保存的想法');
  await route(page, '随手便签');
  await page.getByRole('button', { name: '新建便签', exact: true }).click();
  await page.getByLabel('备忘录内容', { exact: true }).fill('今日待办\n想到什么都可以记在这里。');
  await page.getByLabel('新增待办', { exact: true }).fill('阅读二十分钟');
  await page.getByLabel('新增待办', { exact: true }).press('Enter');
  await page.getByLabel('新增待办', { exact: true }).fill('整理书桌');
  await page.getByRole('button', { name: '添加待办项', exact: true }).click();
  await page.getByRole('dialog').getByRole('checkbox', { name: '阅读二十分钟', exact: true }).check();
  await page.getByLabel('编辑待办：整理书桌', { exact: true }).fill('整理书桌与书架');
  await page.getByRole('button', { name: '关闭便签', exact: true }).click();
  await expect(page.locator('.note-card')).toContainText('1 / 2');
  await page.reload();
  await route(page, '随手便签');
  await expect(page.getByRole('checkbox', { name: '阅读二十分钟', exact: true })).toBeChecked();
  await expect(page.locator('.note-card')).toContainText('整理书桌与书架');
  const data=await stored(page);
  expect(data.notes[0].content).toBe('今日待办\n想到什么都可以记在这里。');
  expect(data.notes[0].items).toHaveLength(2);
});

test('便签快速保存、自动编辑、置顶、刷新保留与删除', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('快速便签', { exact: true }).fill('周末去看一场展览\n带上相机，留意光影。');
  await page.getByRole('button', { name: '保存快速便签' }).click();
  await route(page, '随手便签');
  await expect(page.locator('.note-card')).toHaveCount(1);
  await page.getByRole('button', { name: '编辑便签', exact: true }).click();
  await page.getByLabel('备忘录内容').fill('周末去看一场展览\n带上相机，也带一本小本子。');
  await page.getByRole('button', { name: '银灰', exact: true }).click();
  await page.getByRole('button', { name: '关闭便签' }).click();
  await page.getByRole('button', { name: '置顶便签', exact: true }).click();
  await page.reload();
  await route(page, '随手便签');
  await expect(page.locator('.note-card.green')).toContainText('小本子');
  await expect(page.getByRole('button', { name: '取消置顶便签', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除便签', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect.poll(async () => (await stored(page)).notes.length).toBe(0);
});

test('专注暂停刷新、完成只奖励一次、兑换及主动结束', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-11T09:00:00+08:00') });
  await page.goto('/');
  await route(page, '专注森林');
  await page.getByLabel('专注任务').fill('读完这几页');
  await page.getByRole('button', { name: '自定', exact: true }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await page.clock.fastForward(15000);
  await page.getByRole('button', { name: '暂停一下', exact: true }).click();
  const paused = (await stored(page)).timer.remainingMs;
  await page.reload();
  await route(page, '专注森林');
  await page.clock.fastForward(120000);
  expect((await stored(page)).timer.remainingMs).toBe(paused);
  expect((await stored(page)).sessions).toHaveLength(0);
  await page.getByRole('button', { name: '继续专注', exact: true }).click();
  await page.clock.fastForward(61000);
  await expect.poll(async () => (await stored(page)).sessions.length).toBe(1);
  await page.reload();
  await page.clock.fastForward(61000);
  expect((await stored(page)).sessions).toHaveLength(1);
  await route(page, '专注森林');
  await page.getByRole('button', { name: '添加奖励', exact: true }).click();
  await page.getByLabel('奖励自己', { exact: true }).fill('听一首喜欢的歌');
  await page.getByLabel('需要叶子币', { exact: true }).fill('1');
  await page.getByRole('button', { name: '保存奖励', exact: true }).click();
  await page.getByRole('button', { name: '兑换听一首喜欢的歌，需要 1 枚叶子币', exact: true }).click();
  await expect.poll(async () => (await stored(page)).redemptions.length).toBe(1);
  await expect(page.locator('.forest-balance strong')).toHaveText('0枚');
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await page.getByRole('button', { name: '结束本次', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  expect((await stored(page)).timer).toBeNull();
  expect((await stored(page)).sessions).toHaveLength(1);
});

test('备份导入导出、无效格式拒绝、桌面与手机页面截图', async ({ page }) => {
  await page.goto('/');
  const date = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  const data = await stored(page);
  data.tasks = [
    { id: 'screen-1', title: '阅读与晨间笔记', date, start: '09:00', end: '10:00', category: 'study', color: '#208D9C', completed: true, allDay: false, description: '留几页文字给清晨。' },
    { id: 'screen-2', title: '整理设计方案', date, start: '10:30', end: '12:00', category: 'work', color: '#8B5CF6', completed: false, allDay: false, description: '从一个小小的想法开始。' },
    { id: 'screen-3', title: '下午散步', date, start: '14:00', end: '15:00', category: 'life', color: '#EA765E', completed: false, allDay: false, description: '' },
  ];
  data.notes = [
    { id:'note-1', content:'周末去看一场展览\n带上相机，也带一本小本子。', color:'yellow', pinned:true, updatedAt:Date.now() },
    { id:'note-2', kind:'checklist', content:'今天的小事', color:'green', pinned:false, updatedAt:Date.now()-100, items:[{id:'item-1',text:'阅读二十分钟',completed:true},{id:'item-2',text:'整理工作笔记',completed:false},{id:'item-3',text:'傍晚去散步',completed:false}] },
    { id:'note-3', content:'一个小小的灵感\n把零散的想法整理成一页，周末再回来看看。', color:'pink', pinned:false, updatedAt:Date.now()-200 },
  ];
  data.sessions = [{id:'tree-1',title:'晨间阅读',minutes:25,completedAt:Date.now(),tree:'pine'},{id:'tree-2',title:'写一页文字',minutes:50,completedAt:Date.now(),tree:'sakura'}];
  await page.getByRole('button', { name: '设置与数据', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name:'invalid.json', mimeType:'application/json', buffer:Buffer.from('{"version":99}') });
  await expect(page.getByRole('alert')).toContainText('备份格式不正确');
  expect((await stored(page)).tasks).toHaveLength(0);
  await page.locator('input[type=file]').setInputFiles({ name:'backup.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(data)) });
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(3);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^栖时备份-.*\.json$/);
  const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(exported).toEqual(data);
  await page.getByRole('button', { name: '关闭设置' }).click();
  await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await fs.mkdir('artifacts', { recursive: true });
  for (const [size, viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
    await page.setViewportSize(viewport);
    for (const [name, label] of [['calendar','我的日历'],['forest','专注森林'],['notes','随手便签']]) {
      await route(page, label);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      if(name==='calendar') { await expect(page.getByRole('button',{name:'日',exact:true})).toBeVisible(); if(size==='mobile') await page.getByRole('button',{name:'日',exact:true}).click(); }
      if(name==='forest') await expect(page.getByRole('button',{name:'开始专注',exact:true})).toBeVisible();
      if(name==='notes') await expect(page.getByRole('button',{name:'新建便签',exact:true})).toBeVisible();
      await page.screenshot({path:`artifacts/${name}-${size}.png`,fullPage:true,animations:'disabled'});
    }
  }
});




