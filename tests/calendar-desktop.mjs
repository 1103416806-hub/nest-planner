import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const profile = path.join(workspace, '.test-profile', `calendar-${Date.now()}`);
const artifacts = path.join(workspace, 'artifacts');
const baseline = process.argv.includes('--baseline');
const suffix = baseline ? '-baseline' : '';
const env = { ...process.env, NEST_TEST_HEADLESS: '1', NEST_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NEST_DEV_URL;
await mkdir(profile, { recursive: true });
await mkdir(artifacts, { recursive: true });
const html = await readFile(path.join(workspace, 'dist/index.html'), 'utf8');
const report = { baseline, profile, buildHash: createHash('sha256').update(html).digest('hex'), checks: [], geometry: [], activation: [] };
let desktop, page;
const tasks = () => page.evaluate(() => JSON.parse(localStorage.getItem('nest-planner-v1')).tasks);
const dialog = () => page.getByRole('dialog', { name: '新建日程', exact: true });

async function hidden(stage) {
  const state = await desktop.evaluate(({ BrowserWindow }) => ({
    shown: globalThis.__nestCalendarShown || [],
    visible: BrowserWindow.getAllWindows().filter(window => window.isVisible()).map(window => window.id),
  }));
  assert.deepEqual(state.visible, [], `${stage}: native windows must stay hidden`);
  assert.deepEqual(state.shown, [], `${stage}: a native window emitted show`);
}
async function check(name, operation) {
  try { await operation(); await hidden(name); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, `calendar-${name}-failure${suffix}.png`), animations: 'disabled' }).catch(() => {});
  }
}
async function closeEditor() {
  if (await page.getByRole('button', { name: '关闭日程', exact: true }).count()) await page.getByRole('button', { name: '关闭日程', exact: true }).click();
}
async function saveAndVerify(title, date, start, before, allDay = false) {
  await expect(dialog()).toHaveCount(1);
  await expect(page.getByLabel('日程名称', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('日期', { exact: true })).toHaveValue(date);
  await expect(page.getByLabel('开始时间', { exact: true })).toHaveValue(start);
  await page.getByLabel('日程名称', { exact: true }).fill(title);
  if (allDay) await page.getByLabel('全天日程', { exact: true }).check();
  await dialog().getByRole('button', { name: '添加日程', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await tasks()).length).toBe(before + 1);
  const saved = (await tasks()).filter(task => task.title === title);
  assert.equal(saved.length, 1, 'One activation must create exactly one task');
  assert.equal(saved[0].date, date);
  assert.equal(saved[0].start, start);
  assert.equal(saved[0].allDay, allDay);
  const [hours, mins] = start.split(':').map(Number);
  const end = `${String(hours + 1).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  assert.equal(saved[0].end, end);
  await page.reload();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  assert.deepEqual((await tasks()).find(task => task.id === saved[0].id), saved[0], 'Saved task must survive reload without date/time/title changes');
}
async function activateSlot(view, time, mode, title) {
  await page.getByRole('button', { name: view === 'week' ? '周' : '日', exact: true }).click();
  await expect(page.locator('.day-column')).toHaveCount(view === 'week' ? 7 : 1);
  const column = page.locator('.day-column').nth(view === 'week' ? 2 : 0);
  const slot = column.locator(`.time-slot[data-time="${time}"]`);
  const add = slot.getByRole('button', { name: new RegExp(` ${time} 添加日程$`) });
  const label = await add.getAttribute('aria-label');
  const match = label.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) 添加日程$/);
  assert.ok(match, 'The independent add button must identify its date and time');
  assert.equal(await slot.evaluate(element => element.tagName), 'DIV', 'Blank time cells must not act as full-cell buttons');
  assert.equal(await slot.getAttribute('data-date'), match[1]);
  assert.equal(await add.evaluate(element => element.tagName), 'BUTTON', 'The visible plus must be a native button');
  const before = (await tasks()).length;
  try {
    await slot.scrollIntoViewIfNeeded();
    if (mode === 'plus-click') {
      await slot.hover();
      const cellBox = await slot.boundingBox(), addBox = await add.boundingBox();
      assert.ok(cellBox && addBox && addBox.width < cellBox.width, 'The plus button must occupy only part of the time cell');
      await add.click();
    } else if (mode === 'plus-enter' || mode === 'plus-space') {
      await add.focus();
      await expect(add).toBeFocused();
      await add.press(mode === 'plus-enter' ? 'Enter' : 'Space');
    } else if (mode === 'blank-double') {
      const bounds = await slot.boundingBox();
      assert.ok(bounds);
      const blank = { x: bounds.width - 4, y: bounds.height / 2 };
      await slot.click({ position: blank });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      assert.equal((await tasks()).length, before, 'A single click on blank space must not create a task');
      report.activation.push({ view, time, mode: 'blank-single-noop', date: match[1], passed: true });
      await slot.dblclick({ position: blank });
    } else throw new Error(`Unknown activation mode: ${mode}`);
    await expect(dialog()).toHaveCount(1, { timeout: 1500 });
    await saveAndVerify(title, match[1], match[2], before);
    report.activation.push({ view, time, mode, date: match[1], passed: true });
  } catch (error) {
    report.activation.push({ view, time, mode, date: match[1], passed: false, error: error.message });
    throw error;
  } finally { await closeEditor(); }
}

async function geometry(view, width, zoom, position) {
  return page.evaluate(({ view, width, zoom, position }) => {
    const root = document.querySelector('.time-calendar');
    const scroller = root.querySelector('.timeline-scroll');
    const rects = selector => [...root.querySelectorAll(selector)].map(element => {
      const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width };
    });
    const head = rects('.day-heading'), allDay = rects('.all-day-row > div'), columns = rects('.day-column');
    const style = getComputedStyle(scroller);
    const gutter = scroller.offsetWidth - scroller.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
    const errors = columns.flatMap((column, index) => ['left', 'right'].flatMap(edge => [
      { column: index, edge, source: 'head', delta: head[index][edge] - column[edge] },
      { column: index, edge, source: 'allDay', delta: allDay[index][edge] - column[edge] },
    ]));
    return { view, requestedWindowWidth: width, zoom, position, viewport: innerWidth, dpr: devicePixelRatio,
      gutter, scrollTop: scroller.scrollTop, scrollLeft: scroller.scrollLeft, clientHeight: scroller.clientHeight,
      scrollHeight: scroller.scrollHeight, head, allDay, columns, errors, maxError: Math.max(...errors.map(error => Math.abs(error.delta))) };
  }, { view, width, zoom, position });
}

try {
  desktop = await electron.launch({ cwd: workspace, env, timeout: 45_000,
    args: ['.', '--force-device-scale-factor=1.5', '--disable-features=OverlayScrollbar,OverlayScrollbars,FluentOverlayScrollbar'] });
  await desktop.evaluate(({ app, BrowserWindow }) => {
    globalThis.__nestCalendarShown = [];
    const watch = window => window.on('show', () => globalThis.__nestCalendarShown.push(window.id));
    BrowserWindow.getAllWindows().forEach(watch);
    app.on('browser-window-created', (_event, window) => watch(window));
  });
  page = await desktop.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  await hidden('startup');

  await check('activation', async () => {
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('body').press('n');
    await page.locator('body').press('t');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const errors = [];
    for (const scenario of [
      ['week', '09:30', 'plus-click', '周视图加号日程'],
      ['day', '14:00', 'plus-click', '日视图加号日程'],
      ['week', '16:00', 'plus-enter', '周视图 Enter 日程'],
      ['day', '18:00', 'plus-enter', '日视图 Enter 日程'],
      ['week', '20:00', 'plus-space', '周视图 Space 日程'],
      ['day', '21:00', 'plus-space', '日视图 Space 日程'],
      ['week', '11:00', 'blank-double', '周视图空白双击日程'],
      ['day', '10:00', 'blank-double', '日视图空白双击日程'],
    ]) {
      try { await activateSlot(...scenario); } catch (error) { errors.push(`${scenario[0]}/${scenario[2]}: ${error.message}`); }
    }
    await page.getByRole('button', { name: '月', exact: true }).click();
    const add = page.locator('.month-add').nth(10);
    const date = (await add.getAttribute('aria-label')).split(' ')[0];
    const count = (await tasks()).length;
    await add.click();
    await saveAndVerify('月视图加号日程', date, '09:00', count, true);
    report.activation.push({ view: 'month', mode: 'plus', date, passed: true });
    assert.equal(errors.length, 0, errors.join('\n'));
  });

  await closeEditor();
  await check('alignment', async () => {
    for (const zoom of [1, 1.5]) {
      await desktop.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), zoom);
      for (const width of [1180, 1440, 1680]) {
        await desktop.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].setBounds({ width: value, height: 980 }, false), width);
        for (const view of ['week', 'day']) {
          await page.getByRole('button', { name: view === 'week' ? '周' : '日', exact: true }).click();
          await expect(page.locator('.day-column')).toHaveCount(view === 'week' ? 7 : 1);
          for (const position of [0, 0.5, 1]) {
            await page.locator('.timeline-scroll').evaluate(async (element, fraction) => {
              element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction;
              element.scrollLeft = (element.scrollWidth - element.clientWidth) * fraction;
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            }, position);
            const sample = await geometry(view, width, zoom, position);
            report.geometry.push(sample);
            console.log(`GEOMETRY view=${view} width=${width} zoom=${zoom} dpr=${sample.dpr} gutter=${sample.gutter.toFixed(3)} scroll=${sample.scrollTop.toFixed(1)} maxError=${sample.maxError.toFixed(3)}px`);
            if (width === 1440 && view === 'week' && zoom === 1 && position === 0.5) {
              await page.locator('.calendar-main').screenshot({ path: path.join(artifacts, `calendar-alignment${suffix}.png`), animations: 'disabled' });
            }
          }
          await hidden('geometry');
        }
      }
    }
    assert.equal(report.geometry.length, 36);
    assert.ok(report.geometry.every(sample => Math.abs(sample.dpr / sample.zoom - 1.5) < 0.03), 'Must run at an actual 150% device scale factor');
    assert.ok(report.geometry.every(sample => sample.gutter > 0 && sample.scrollHeight > sample.clientHeight), 'A real non-overlay classic scrollbar must consume layout width');
    const failures = report.geometry.filter(sample => sample.maxError > 1);
    assert.equal(failures.length, 0, failures.map(sample => `${sample.view} width=${sample.requestedWindowWidth} zoom=${sample.zoom} scroll=${sample.position}: ${sample.maxError.toFixed(3)} CSS px`).join('\n'));
  });
} catch (error) {
  report.checks.push({ name: 'fatal', passed: false, error: error.message });
  console.error(error);
} finally {
  if (desktop) {
    try { await hidden('cleanup'); } catch (error) { report.checks.push({ name: 'hidden', passed: false, error: error.message }); }
    const closed = desktop.waitForEvent('close', { timeout: 15_000 });
    await desktop.evaluate(({ app }) => { setImmediate(() => app.quit()); });
    await closed;
  }
  await writeFile(path.join(artifacts, `calendar-desktop${suffix}.json`), JSON.stringify(report, null, 2), 'utf8');
}
const failed = report.checks.filter(result => !result.passed);
console.log(`${report.checks.length - failed.length} passed, ${failed.length} failed; report: artifacts/calendar-desktop${suffix}.json`);
process.exitCode = failed.length ? 1 : 0;
