import assert from 'node:assert/strict';
import { mkdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

// Native windows stay hidden; never use the real user's profile, notifications,
// startup settings, or physical keyboard/mouse input in this regression script.
const workspace = fileURLToPath(new URL('../', import.meta.url));
const profile = path.resolve(workspace, '.test-profile', `desktop-multi-${Date.now()}`);
const artifacts = path.resolve(workspace, 'artifacts');
const packageInfo = JSON.parse(await readFile(path.join(workspace, 'node_modules/electron/package.json'), 'utf8'));
assert.equal(packageInfo.version, '44.3.0');
await access(path.join(workspace, 'node_modules/electron/path.txt'));
await access(path.join(workspace, 'dist/index.html'));
await mkdir(profile, { recursive: true });
await mkdir(artifacts, { recursive: true });
const env = { ...process.env, NEST_TEST_HEADLESS: '1', NEST_TEST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NEST_DEV_URL;

const results = [];
let desktop, main, memoPage, todoPage;
const pass = message => { results.push(message); console.log(`PASS ${message}`); };
const snapshot = () => main.evaluate(() => window.nestDesktop.notes.list());

async function assertHidden(stage) {
  const state = await desktop.evaluate(({ BrowserWindow }) => ({
    visible: BrowserWindow.getAllWindows().filter(window => window.isVisible()).map(window => ({ id: window.id, title: window.getTitle() })),
    everShown: globalThis.__nestTestShownWindows || [],
  }));
  assert.deepEqual(state.visible, [], `${stage}: a native test window became visible`);
  assert.deepEqual(state.everShown, [], `${stage}: a native test window emitted show`);
}

async function launch() {
  desktop = await electron.launch({ args: ['.'], cwd: workspace, env, timeout: 45_000 });
  await desktop.evaluate(({ app, BrowserWindow }) => {
    globalThis.__nestTestShownWindows = [];
    const watch = window => window.on('show', () => globalThis.__nestTestShownWindows.push(window.id));
    BrowserWindow.getAllWindows().forEach(watch);
    app.on('browser-window-created', (_event, window) => watch(window));
  });
  main = await desktop.firstWindow();
  await main.waitForLoadState('domcontentloaded');
  await expect(main.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(main.getByRole('dialog')).toHaveCount(0);
  const environment = await desktop.evaluate(({ app }) => ({
    profile: app.getPath('userData'), electron: process.versions.electron,
    headless: process.env.NEST_TEST_HEADLESS, packaged: app.isPackaged,
  }));
  assert.equal(path.resolve(environment.profile), profile);
  assert.equal(environment.electron, '44.3.0');
  assert.equal(environment.headless, '1');
  assert.equal(environment.packaged, false);
  await assertHidden('launch');
}

async function waitForNote(noteId) {
  let page;
  await expect.poll(() => {
    page = desktop.windows().find(candidate => {
      try { return !candidate.isClosed() && new URL(candidate.url()).searchParams.get('note') === noteId; }
      catch { return false; }
    });
    return !!page;
  }, { timeout: 15_000, message: `desktop note ${noteId} should load` }).toBe(true);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('button', { name: '关闭桌面便签' })).toBeVisible();
  await assertHidden('note created/restored');
  return page;
}

async function findNote(predicate) {
  let note;
  await expect.poll(async () => { note = (await snapshot()).notes.find(predicate); return !!note; }, { timeout: 10_000 }).toBe(true);
  return note;
}

async function nativeNoteState(noteId) {
  return desktop.evaluate(({ BrowserWindow }, id) => {
    const window = BrowserWindow.getAllWindows().find(candidate => {
      try { return new URL(candidate.webContents.getURL()).searchParams.get('note') === id; }
      catch { return false; }
    });
    return window ? { id: window.id, visible: window.isVisible(), bounds: window.getBounds(),
      alwaysOnTop: window.isAlwaysOnTop(), resizable: window.isResizable(), movable: window.isMovable() } : null;
  }, noteId);
}

async function quit() {
  if (!desktop) return;
  // Always quit even when a visibility assertion fails, avoiding an orphan test app.
  let visibilityError;
  try { await assertHidden('before quit'); } catch (error) { visibilityError = error; }
  const application = desktop;
  const closed = application.waitForEvent('close', { timeout: 15_000 });
  await application.evaluate(({ app }) => { setImmediate(() => app.quit()); });
  await closed;
  desktop = null;
  if (visibilityError) throw visibilityError;
}

try {
  await launch();
  assert.match(await main.title(), /栖时/);
  const bridge = await main.evaluate(() => ({
    available: !!window.nestDesktop?.notes, requireType: typeof window.require, processType: typeof window.process,
  }));
  assert.equal(bridge.available, true);
  assert.equal(bridge.requireType, 'undefined');
  assert.equal(bridge.processType, 'undefined');
  await main.locator('body').press('n');
  await main.locator('body').press('t');
  await expect(main.getByRole('dialog')).toHaveCount(0);
  await main.locator('.time-slot-add').first().click();
  await expect(main.getByRole('dialog', { name: '新建日程', exact: true })).toHaveCount(1);
  await main.getByRole('button', { name: '关闭日程', exact: true }).click();
  await expect(main.getByRole('dialog')).toHaveCount(0);
  await assertHidden('idle calendar and explicit single-click creation');
  pass('Hidden Electron 44 window, isolated profile, preload safety, no spontaneous dialog, and explicit single-click schedule creation');

  await main.getByRole('button', { name: /随手便签/ }).click();
  await main.getByRole('button', { name: '新建便签', exact: true }).click();
  const mainMemo = main.getByRole('textbox', { name: '备忘录内容' });
  await mainMemo.fill('主窗口备忘\n先记录一个想法。');
  const memo = await findNote(note => note.kind === 'memo' && note.content === '主窗口备忘\n先记录一个想法。');
  await main.getByRole('button', { name: '关闭便签', exact: true }).click();
  await main.getByRole('button', { name: '桌面显示：主窗口备忘', exact: true }).click();
  memoPage = await waitForNote(memo.id);
  const widgetMemo = memoPage.getByRole('textbox', { name: '备忘录内容' });
  await expect(widgetMemo).toHaveValue('主窗口备忘\n先记录一个想法。');
  await main.getByRole('heading', { name: '主窗口备忘', exact: true }).click();
  await mainMemo.fill('从主窗口同步的备忘\n正文 A');
  await expect(widgetMemo).toHaveValue('从主窗口同步的备忘\n正文 A');
  await widgetMemo.fill('从桌面同步的备忘\n正文 B');
  await expect(mainMemo).toHaveValue('从桌面同步的备忘\n正文 B');
  const memoContent = '一个周末的小想法\n留半天给阅读，再出门散步。';
  await Promise.all([
    main.getByRole('button', { name: '雾紫', exact: true }).click(),
    widgetMemo.fill(memoContent),
  ]);
  await findNote(note => note.id === memo.id && note.content === memoContent && note.color === 'pink');
  await expect(mainMemo).toHaveValue(memoContent);
  await expect(memoPage.locator('.desktop-note')).toHaveClass(/pink/);
  const memoAdd = memoPage.getByRole('textbox', { name: '新增待办', exact: true });
  await memoAdd.fill('带上阅读笔记');
  await memoAdd.press('Enter');
  await expect(main.getByRole('dialog').getByRole('checkbox', { name: '带上阅读笔记', exact: true })).toBeVisible();
  await main.getByRole('dialog').getByRole('checkbox', { name: '带上阅读笔记', exact: true }).check();
  await expect(memoPage.getByRole('checkbox', { name: '带上阅读笔记', exact: true })).toBeChecked();
  await findNote(note => note.id === memo.id && note.content === memoContent && note.items.some(item => item.text === '带上阅读笔记' && item.completed));
  await main.getByRole('button', { name: '关闭便签', exact: true }).click();
  await assertHidden('bidirectional memo edits');
  pass('A single note supports structured todos and free text; both sections synchronize between main and widget without losing existing content');

  await memoPage.getByRole('button', { name: '置顶便签', exact: true }).click();
  await expect.poll(async () => (await nativeNoteState(memo.id))?.alwaysOnTop).toBe(true);
  const memoClosed = memoPage.waitForEvent('close');
  await memoPage.getByRole('button', { name: '关闭桌面便签' }).click();
  await memoClosed;
  assert.equal((await findNote(note => note.id === memo.id)).content, memoContent);
  await main.getByRole('button', { name: '桌面显示：一个周末的小想法', exact: true }).click();
  memoPage = await waitForNote(memo.id);
  await expect(memoPage.getByRole('textbox', { name: '备忘录内容' })).toHaveValue(memoContent);
  await expect(memoPage.getByRole('button', { name: '取消置顶便签', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await assertHidden('memo close/reopen');
  pass('Closing preserves a note; reopening restores its content and native always-on-top setting');

  await main.getByRole('button', { name: '新建便签', exact: true }).click();
  const checklistDialog = main.getByRole('dialog', { name: '便签', exact: true });
  await checklistDialog.getByRole('textbox', { name: '备忘录内容', exact: true }).fill('今天的小计划');
  const mainAdd = checklistDialog.getByRole('textbox', { name: '新增待办', exact: true });
  for (const text of ['读完一章书', '整理书桌']) { await mainAdd.fill(text); await mainAdd.press('Enter'); }
  const todo = await findNote(note => note.content === '今天的小计划' && note.items.length === 2);
  await checklistDialog.getByRole('button', { name: '桌面显示', exact: true }).click();
  todoPage = await waitForNote(todo.id);
  await expect(todoPage.getByRole('checkbox', { name: '读完一章书', exact: true })).not.toBeChecked();
  await todoPage.getByRole('checkbox', { name: '读完一章书', exact: true }).check();
  await expect(checklistDialog.getByRole('checkbox', { name: '读完一章书', exact: true })).toBeChecked();
  await checklistDialog.getByRole('checkbox', { name: '整理书桌', exact: true }).check();
  await expect(todoPage.getByRole('checkbox', { name: '整理书桌', exact: true })).toBeChecked();
  const widgetAdd = todoPage.getByRole('textbox', { name: '新增待办', exact: true });
  await widgetAdd.fill('去楼下散步'); await widgetAdd.press('Enter');
  await expect(checklistDialog.getByRole('checkbox', { name: '去楼下散步', exact: true })).toBeVisible();
  await mainAdd.fill('准备明天的早餐'); await mainAdd.press('Enter');
  await expect(todoPage.getByRole('checkbox', { name: '准备明天的早餐', exact: true })).toBeVisible();
  await Promise.all([
    todoPage.getByRole('textbox', { name: '编辑待办：整理书桌', exact: true }).fill('整理书桌与书架'),
    checklistDialog.getByRole('checkbox', { name: '读完一章书', exact: true }).uncheck(),
  ]);
  await findNote(note => note.id === todo.id && note.items.length === 4
    && note.items.some(item => item.text === '整理书桌与书架' && item.completed)
    && note.items.some(item => item.text === '读完一章书' && !item.completed));
  await expect(todoPage.getByRole('checkbox', { name: '读完一章书', exact: true })).not.toBeChecked();
  await expect(checklistDialog.getByRole('textbox', { name: '编辑待办：整理书桌与书架', exact: true })).toHaveValue('整理书桌与书架');
  const todoThoughts = '今天的小计划\n做完之后，留一点时间给自己。';
  await Promise.all([
    todoPage.getByRole('textbox', { name: '备忘录内容', exact: true }).fill(todoThoughts),
    checklistDialog.getByRole('checkbox', { name: '去楼下散步', exact: true }).check(),
  ]);
  await findNote(note => note.id === todo.id && note.content === todoThoughts && note.items.some(item => item.text === '去楼下散步' && item.completed));
  await expect(checklistDialog.getByRole('textbox', { name: '备忘录内容', exact: true })).toHaveValue(todoThoughts);
  await checklistDialog.getByRole('button', { name: '关闭便签', exact: true }).click();
  await assertHidden('bidirectional checklist edits');
  pass('Checklist UI creation; checkboxes/additions synchronize both ways; simultaneous edits to separate items merge');

  const forbidden = await todoPage.evaluate(async otherNoteId => {
    try {
      await window.nestDesktop.notes.mutate({ requestId: crypto.randomUUID(), ops: [{ type: 'patch', id: otherNoteId, patch: { content: 'must not be written' } }] });
      return false;
    } catch { return true; }
  }, memo.id);
  assert.equal(forbidden, true);
  assert.equal((await findNote(note => note.id === memo.id)).content, memoContent);
  for (const page of [memoPage, todoPage]) {
    assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process]), ['undefined', 'undefined']);
  }
  const windowCount = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert.equal((await main.evaluate(id => window.nestDesktop.openNote(id), todo.id)).ok, true);
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), windowCount);
  await assertHidden('widget authorization and repeated open');
  pass('Cross-note widget writes rejected; renderer Node access disabled; repeated open reuses the same window');

  await desktop.evaluate(({ BrowserWindow }) => {
    const mainWindow = BrowserWindow.getAllWindows().find(window => !new URL(window.webContents.getURL()).searchParams.has('note'));
    mainWindow.close();
  });
  assert.equal(main.isClosed(), false);
  const independentContent = `${memoContent}\n桌面便签可独立继续记录。`;
  await memoPage.getByRole('textbox', { name: '备忘录内容' }).fill(independentContent);
  await findNote(note => note.id === memo.id && note.content === independentContent);
  await todoPage.getByRole('button', { name: '打开主窗口', exact: true }).click();
  await expect(main.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(main.getByRole('dialog')).toHaveCount(0);
  await assertHidden('main hidden while notes remain active');
  pass('Closing main to tray leaves notes active and synchronized; showMain respects hidden test mode');

  for (const [width, height] of [[280, 360], [340, 430], [500, 650]]) {
    await desktop.evaluate(({ BrowserWindow }, { noteId, width, height }) => {
      const window = BrowserWindow.getAllWindows().find(candidate => new URL(candidate.webContents.getURL()).searchParams.get('note') === noteId);
      window.setContentSize(width, height);
    }, { noteId: todo.id, width, height });
    await expect.poll(() => todoPage.evaluate(() => {
      const todoRegion = document.querySelector('.note-todo-section').getBoundingClientRect();
      const memoRegion = document.querySelector('.note-memo-section').getBoundingClientRect();
      const add = document.querySelector('.checklist-add').getBoundingClientRect();
      const text = document.querySelector('.memo-content').getBoundingClientRect();
      return todoRegion.bottom <= memoRegion.top && add.bottom <= todoRegion.bottom + 1
        && text.height >= 48 && text.bottom <= memoRegion.bottom + 1
        && document.documentElement.scrollWidth <= innerWidth + 1;
    }), { message: `Both note sections must remain usable at ${width}x${height}` }).toBe(true);
  }
  const glass = await todoPage.evaluate(() => ({
    background: getComputedStyle(document.querySelector('.desktop-note')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }));
  assert.match(glass.background, /rgba\(.*0\.3\d*\)/, 'The note tint should retain substantial transparency');
  assert.equal(glass.body, 'rgba(0, 0, 0, 0)', 'The page behind the glass tint must remain transparent');
  await assertHidden('small and large split note layout');
  pass('Upper todos and lower free text stay usable at 280x360, 340x430 and 500x650; glass tint keeps a transparent page');

  await desktop.evaluate(({ BrowserWindow, screen }, noteId) => {
    const window = BrowserWindow.getAllWindows().find(candidate => new URL(candidate.webContents.getURL()).searchParams.get('note') === noteId);
    const area = screen.getPrimaryDisplay().workArea;
    window.setBounds({ x: area.x + 80, y: area.y + 80, width: 370, height: 480 });
  }, todo.id);
  const beforeRestart = await nativeNoteState(todo.id);
  assert.equal(beforeRestart.resizable, true);
  assert.equal(beforeRestart.movable, true);
  // Windows display scaling rounds between physical and logical pixels.
  assert.ok(Math.abs(beforeRestart.bounds.width - 370) <= 2);
  assert.ok(Math.abs(beforeRestart.bounds.height - 480) <= 2);
  await quit();
  const savedWindowState = JSON.parse(await readFile(path.join(profile, 'nest-desktop.json'), 'utf8'));
  assert.equal(savedWindowState.noteWindows[memo.id].opened, true);
  assert.equal(savedWindowState.noteWindows[todo.id].opened, true);
  await launch();
  memoPage = await waitForNote(memo.id);
  todoPage = await waitForNote(todo.id);
  await expect(memoPage.getByRole('textbox', { name: '备忘录内容' })).toHaveValue(independentContent);
  await expect(todoPage.getByRole('textbox', { name: '备忘录内容', exact: true })).toHaveValue(todoThoughts);
  await expect(memoPage.getByRole('checkbox', { name: '带上阅读笔记', exact: true })).toBeChecked();
  await expect(todoPage.getByRole('checkbox', { name: '读完一章书', exact: true })).not.toBeChecked();
  await expect(todoPage.getByRole('checkbox', { name: '整理书桌与书架', exact: true })).toBeChecked();
  await expect(todoPage.getByRole('checkbox', { name: '去楼下散步', exact: true })).toBeVisible();
  await expect(todoPage.getByRole('checkbox', { name: '准备明天的早餐', exact: true })).toBeVisible();
  const restoredBounds=(await nativeNoteState(todo.id)).bounds;
  console.log('Bounds before / after restart:',JSON.stringify(beforeRestart.bounds),JSON.stringify(restoredBounds));
  for(const field of ['x','y','width','height'])assert.ok(Math.abs(restoredBounds[field]-beforeRestart.bounds[field])<=2,`Restored ${field} must match within display rounding`);
  assert.equal((await nativeNoteState(memo.id)).alwaysOnTop, true);
  await assertHidden('restart with restored desktop notes');
  pass('Quit/relaunch restores both note windows, data, checkboxes, position, size, and pin setting');

  await main.screenshot({ path: path.join(artifacts, 'desktop-app.png'), animations: 'disabled', fullPage: true });
  await todoPage.screenshot({ path: path.join(artifacts, 'desktop-note.png'), animations: 'disabled', fullPage: true });
  await assertHidden('screenshots');
  console.log(`All ${results.length} native desktop checks passed. No test window was shown.`);
  console.log(`Isolated profile: ${profile}`);
  console.log(`Screenshots: ${path.join(artifacts, 'desktop-app.png')} and ${path.join(artifacts, 'desktop-note.png')}`);
} catch (error) {
  if (main && !main.isClosed()) await main.screenshot({ path: path.join(artifacts, 'desktop-failure.png'), animations: 'disabled' }).catch(() => {});
  if (todoPage && !todoPage.isClosed()) await todoPage.screenshot({ path: path.join(artifacts, 'desktop-note-failure.png'), animations: 'disabled' }).catch(() => {});
  throw error;
} finally {
  if (desktop) await quit();
}
