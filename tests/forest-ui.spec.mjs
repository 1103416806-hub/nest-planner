import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { emptyData, validData } from '../src/model.ts';

// Playwright's page fixture creates a fresh, headless browser context for every test.
test.use({ timezoneId: 'Asia/Shanghai', locale: 'zh-CN' });
const storageKey = 'nest-planner-v1';
const fixedNow = Date.parse('2026-09-12T12:00:00+08:00');
const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const matureTrees = page => page.locator('.forest-scene-tree[data-session-id]');
const preview = page => page.locator('.forest-scene-preview');
const treeIds = page => matureTrees(page).evaluateAll(nodes => nodes.map(node => node.dataset.sessionId).sort());

function record(id, date, minutes = 25, tree = 'pine', title = `专注记录 ${id}`) {
  return { id, title, minutes, tree, completedAt: typeof date === 'number' ? date : Date.parse(date) };
}
function planted(count) {
  return Array.from({ length: count }, (_, index) => record(
    `forest-${String(index + 1).padStart(3, '0')}`, fixedNow - (count - index) * 3600000,
    [25, 40, 50][index % 3], ['pine', 'oak', 'sakura'][index % 3],
    ['晨间阅读', '整理设计方案', '写一页文字'][index % 3] + ` ${index + 1}`,
  ));
}
async function openForest(page) {
  const menu = page.getByRole('button', { name: '打开导航', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: /专注森林/ }).click();
  await expect(page.locator('.forest-garden')).toBeVisible();
}
async function boot(page, sessions = [], time = fixedNow) {
  const data = { ...emptyData(), sessions };
  expect(validData(data)).toBe(true);
  await page.clock.install({ time: new Date(time) });
  await page.addInitScript(({ key, seed }) => {
    // Do not overwrite successful timer updates on reload.
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(seed));
  }, { key: storageKey, seed: data });
  await page.goto('/');
  await openForest(page);
}
async function expectRecords(page, sessions) {
  await expect(page.getByTestId('forest-tree-count')).toHaveText(`${sessions.length} 棵`);
  await expect(matureTrees(page)).toHaveCount(sessions.length);
  expect(await treeIds(page)).toEqual(sessions.map(session => session.id).sort());
  expect(new Set(await treeIds(page)).size).toBe(sessions.length);
}
async function expectDetail(page, session) {
  const detail = page.locator('.forest-tree-detail');
  await expect(detail).toContainText(session.title);
  await expect(detail).toContainText(`${session.minutes} 分钟`);
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(session.completedAt));
  await expect(detail).toContainText(time);
}
async function assertLayout(page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const garden = page.locator('.forest-garden');
  await garden.scrollIntoViewIfNeeded();
  const bounds = await garden.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.width).toBeGreaterThan(250);
  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  expect(await garden.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect(page.locator('.forest-scene-canvas')).toBeVisible();
  await expect(page.getByRole('group', { name: '森林时间范围', exact: true })).toBeVisible();
}
async function screenshot(page, name, wholePage = false) {
  await fs.mkdir('artifacts', { recursive: true });
  await assertLayout(page);
  await (wholePage ? page : page.locator('.forest-garden')).screenshot({
    path: `artifacts/${name}.png`, animations: 'disabled', ...(wholePage ? { fullPage: true } : {}),
  });
}
async function startMinute(page, title) {
  await page.getByLabel('专注任务', { exact: true }).fill(title);
  if (!await page.getByRole('spinbutton').isVisible()) await page.getByRole('button', { name: '自定', exact: true }).click();
  await page.getByRole('spinbutton').fill('1');
  await page.getByRole('group', { name: '选择要种的小树', exact: true }).getByRole('button', { name: /樱花树/ }).click();
  await page.getByRole('button', { name: '开始专注', exact: true }).click();
  await expect(preview(page)).toHaveCount(1);
  return (await stored(page)).timer.id;
}

test('空森林不显示虚构成熟树，桌面空状态可见', async ({ page }) => {
  await boot(page);
  await expectRecords(page, []);
  await expect(preview(page)).toHaveCount(0);
  await expect(page.locator('.forest-landscape-caption')).toHaveText('完成第一次专注，种下你的第一棵树。');
  await expect(page.locator('.forest-scene-canvas')).toHaveAttribute('aria-label', /展示 0 棵已完成/);
  expect((await stored(page)).sessions).toEqual([]);
  await screenshot(page, 'forest-empty-desktop');
});

test('18 条真实记录各有一树，鼠标及 Enter/Space 可查看时长和日期', async ({ page }) => {
  const sessions = planted(18);
  await boot(page, sessions);
  await expectRecords(page, sessions);
  const frontTree = matureTrees(page).last();
  // Choose the frontmost painted tree so the mouse exercises a real visible hit target.
  const frontId = await frontTree.getAttribute('data-session-id');
  await frontTree.click();
  await expectDetail(page, sessions.find(session => session.id === frontId));
  await expect(frontTree).toHaveAttribute('aria-pressed', 'true');
  for (const [index, key] of [[0, 'Enter'], [1, 'Space']]) {
    const tree = matureTrees(page).nth(index);
    const id = await tree.getAttribute('data-session-id');
    await tree.focus();
    await tree.press(key);
    await expect(tree).toHaveAttribute('aria-pressed', 'true');
    await expectDetail(page, sessions.find(session => session.id === id));
  }
  await page.getByRole('button', { name: '收起小树详情', exact: true }).click();
  await screenshot(page, 'forest-18-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot(page, 'forest-18-mobile', true);
  await screenshot(page, 'forest-18-mobile-garden');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await openForest(page);
  await expectRecords(page, sessions);
});

test('日周月年与全部按真实完成时间筛选，前后时段及回到今天正确', async ({ page }) => {
  const sessions = [
    record('today-am', '2026-09-12T08:15:00+08:00', 25),
    record('today-noon', '2026-09-12T11:30:00+08:00', 50, 'oak'),
    record('yesterday', '2026-09-11T18:40:00+08:00', 30, 'sakura'),
    record('monday', '2026-09-07T00:00:00+08:00', 10),
    record('last-sunday', '2026-09-06T23:59:59+08:00', 20, 'oak'),
    record('month-start', '2026-09-01T00:00:00+08:00', 15, 'sakura'),
    record('last-month', '2026-08-31T23:59:59+08:00', 40),
    record('year-start', '2026-01-01T00:00:00+08:00', 35, 'oak'),
    record('last-year', '2025-12-31T23:59:59+08:00', 45, 'sakura'),
  ];
  await boot(page, sessions);
  const tabs = page.getByRole('group', { name: '森林时间范围', exact: true });
  const subset = ids => sessions.filter(session => ids.includes(session.id));
  const scenarios = [
    ['日', ['today-am', 'today-noon'], ['yesterday'], /2026年9月12日/, /2026年9月11日/],
    ['周', ['today-am', 'today-noon', 'yesterday', 'monday'], ['last-sunday', 'month-start', 'last-month'], /2026年9月7日/, /2026年8月31日/],
    ['月', ['today-am', 'today-noon', 'yesterday', 'monday', 'last-sunday', 'month-start'], ['last-month'], /2026年9月/, /2026年8月/],
    ['年', sessions.filter(session => session.id !== 'last-year').map(session => session.id), ['last-year'], /2026年/, /2025年/],
  ];
  for (const [label, current, previous, currentLabel, previousLabel] of scenarios) {
    await tabs.getByRole('button', { name: label, exact: true }).click();
    await expect(tabs.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectRecords(page, subset(current));
    await expect(page.getByTestId('forest-period-label')).toContainText(currentLabel);
    await expect(page.getByRole('button', { name: '森林下一时段' })).toBeDisabled();
    await page.getByRole('button', { name: '森林上一时段' }).click();
    await expectRecords(page, subset(previous));
    await expect(page.getByTestId('forest-period-label')).toContainText(previousLabel);
    await page.getByRole('button', { name: '森林下一时段' }).click();
    await expectRecords(page, subset(current));
    await page.getByRole('button', { name: '森林上一时段' }).click();
    await page.getByRole('button', { name: '回到今天', exact: true }).click();
    await expectRecords(page, subset(current));
    const sum = subset(current).reduce((total, session) => total + session.minutes, 0);
    await expect(page.locator('.forest-period-stats > div').nth(1)).toContainText(`${sum}分钟`);
  }
  await tabs.getByRole('button', { name: '全部', exact: true }).click();
  await expectRecords(page, sessions);
  await expect(page.getByRole('button', { name: '森林上一时段' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '森林下一时段' })).toBeDisabled();
});

test('一分钟预览随时间生长，完成仅种一树，刷新和提前结束不多种树', async ({ page }) => {
  await boot(page);
  const id = await startMinute(page, '一分钟写作');
  await expectRecords(page, []);
  await expect(preview(page)).toHaveAttribute('aria-label', /尚未计入已完成森林/);
  await expect(preview(page).locator('use')).toHaveAttribute('href', /-sprout$/);
  await page.clock.fastForward(30000);
  const progress = Number((await preview(page).getAttribute('aria-label')).match(/进度 (\d+)%/)[1]);
  expect(progress).toBeGreaterThanOrEqual(45);
  expect(progress).toBeLessThan(65);
  await expect(preview(page).locator('use')).toHaveAttribute('href', /-sakura$/);
  expect((await stored(page)).sessions).toHaveLength(0);
  await page.clock.fastForward(31000);
  await expect.poll(async () => (await stored(page)).sessions.length).toBe(1);
  const completed = (await stored(page)).sessions[0];
  expect(completed).toMatchObject({ id, title: '一分钟写作', tree: 'sakura', minutes: 1 });
  await expectRecords(page, [completed]);
  await expect(preview(page)).toHaveCount(0);
  await page.reload();
  await openForest(page);
  await page.clock.fastForward(120000);
  expect((await stored(page)).sessions).toEqual([completed]);
  await expectRecords(page, [completed]);
  await startMinute(page, '提前结束的专注');
  await page.clock.fastForward(10000);
  await page.getByRole('button', { name: '结束本次', exact: true }).click();
  await page.getByRole('button', { name: '确认结束', exact: true }).click();
  await page.clock.fastForward(120000);
  expect((await stored(page)).timer).toBeNull();
  expect((await stored(page)).sessions).toEqual([completed]);
  await expectRecords(page, [completed]);
  await expect(preview(page)).toHaveCount(0);
});

test('超过 36 条记录从最后林地打开，翻页可以访问全部真实树且不重复', async ({ page }) => {
  const sessions = planted(79);
  await boot(page, sessions);
  await expect(page.getByTestId('forest-tree-count')).toHaveText('79 棵');
  const plots = page.getByRole('navigation', { name: '切换林地', exact: true });
  await expect(plots).toContainText('第 3 / 3 片林地');
  await expect(matureTrees(page)).toHaveCount(7);
  await expect(page.getByRole('button', { name: '下一片林地' })).toBeDisabled();
  const seen = [];
  for (let index = 2; index >= 0; index--) {
    await expect(plots).toContainText(`第 ${index + 1} / 3 片林地`);
    const ids = await treeIds(page);
    expect(ids).toEqual(sessions.slice(index * 36, (index + 1) * 36).map(session => session.id).sort());
    seen.push(...ids);
    if (index) await page.getByRole('button', { name: '上一片林地' }).click();
  }
  expect(seen.sort()).toEqual(sessions.map(session => session.id).sort());
  expect(new Set(seen).size).toBe(79);
  await expect(page.getByRole('button', { name: '上一片林地' })).toBeDisabled();
  await page.getByRole('button', { name: '下一片林地' }).click();
  await page.getByRole('button', { name: '下一片林地' }).click();
  await expect(plots).toContainText('第 3 / 3 片林地');
});

test('森林持续打开跨月时，新完成的小树与最近12个月统计一起更新', async ({ page }) => {
  await boot(page, [record('september', '2026-09-30T20:00:00+08:00', 25)], Date.parse('2026-09-30T23:59:40+08:00'));
  await expect(page.getByRole('listitem', { name: '2026年9月：25 分钟', exact: true })).toBeVisible();
  await startMinute(page, '跨月完成');
  await page.clock.fastForward(61000);
  await expect(page.getByTestId('forest-tree-count')).toHaveText('2 棵');
  await expect(page.getByRole('listitem', { name: '2026年10月：1 分钟', exact: true })).toBeVisible();
  await expect(page.getByRole('listitem', { name: '2026年9月：25 分钟', exact: true })).toBeVisible();
});

test('森林中的预览暂停后保持进度，重载和继续计时最终只种一棵树', async ({ page }) => {
  await boot(page);
  await startMinute(page, '暂停后继续');
  await page.clock.fastForward(20000);
  await page.getByRole('button', { name: '暂停一下', exact: true }).click();
  const pausedProgress = await preview(page).getAttribute('aria-label');
  await page.clock.fastForward(120000);
  await expect(preview(page)).toHaveAttribute('aria-label', pausedProgress);
  await expect(page.locator('.forest-growing-status')).toContainText('小树已暂停生长');
  await expectRecords(page, []);
  await page.reload();
  await openForest(page);
  await expect(preview(page)).toHaveAttribute('aria-label', pausedProgress);
  await page.getByRole('button', { name: '继续专注', exact: true }).click();
  await page.clock.fastForward(42000);
  await expect(page.getByTestId('forest-tree-count')).toHaveText('1 棵');
  await expect(preview(page)).toHaveCount(0);
  await page.clock.fastForward(120000);
  expect((await stored(page)).sessions).toHaveLength(1);
});

test('满 36 棵的计时预览使用下一片林地，完成后只增加对应记录', async ({ page }) => {
  const sessions = planted(36);
  await boot(page, sessions);
  await expectRecords(page, sessions);
  await screenshot(page, 'forest-36-desktop');
  const id = await startMinute(page, '下一片林地的第一棵树');
  await expect(page.getByRole('navigation', { name: '切换林地' })).toContainText('第 2 / 2 片林地');
  await expect(matureTrees(page)).toHaveCount(0);
  await expect(page.getByTestId('forest-tree-count')).toHaveText('36 棵');
  await page.getByRole('button', { name: '上一片林地' }).click();
  await expectRecords(page, sessions);
  await expect(preview(page)).toHaveCount(0);
  await page.getByRole('button', { name: '下一片林地' }).click();
  await expect(preview(page)).toHaveCount(1);
  await page.clock.fastForward(61000);
  await expect(page.getByTestId('forest-tree-count')).toHaveText('37 棵');
  await expect(matureTrees(page)).toHaveCount(1);
  expect(await treeIds(page)).toEqual([id]);
  await expect(preview(page)).toHaveCount(0);
  expect((await stored(page)).sessions).toHaveLength(37);
});

test('390px 小屏森林、筛选与计时按钮可达且无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, planted(36));
  await expect(matureTrees(page)).toHaveCount(36);
  await screenshot(page, 'forest-36-mobile', true);
  await screenshot(page, 'forest-36-mobile-garden');
  const tabs = page.getByRole('group', { name: '森林时间范围', exact: true });
  await tabs.getByRole('button', { name: '周', exact: true }).click();
  await assertLayout(page);
  await page.getByRole('button', { name: '森林上一时段' }).click();
  await expect(page.getByTestId('forest-tree-count')).toHaveText('0 棵');
  await page.getByRole('button', { name: '回到今天', exact: true }).click();
  const start = page.getByRole('button', { name: '开始专注', exact: true });
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
