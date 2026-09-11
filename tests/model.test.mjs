import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearPersistenceIssue, emptyData, loadData, persistenceIssue, STORAGE_KEY, validData, validDateKey } from '../src/model.ts';
import { taskColorPresets, taskColorStyle } from '../src/task-colors.ts';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
  clearPersistenceIssue();
});
function storageWith(raw, fail = false) {
  const writes = [];
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key) { assert.equal(key, STORAGE_KEY); if (fail) throw new Error('Storage access denied'); return raw; },
    setItem(...args) { writes.push(args); },
  } });
  return writes;
}
function recordedData() {
  return { ...emptyData(),
    tasks: [{ id: 'task-1', title: '写作', date: '2026-09-11', start: '09:00', end: '10:00', category: 'work', completed: false, allDay: false, description: '先完成第一稿' }],
    notes: [{ id: 'note-1', content: '一个想法\n留到明天', color: 'yellow', pinned: true, updatedAt: 1700000000000 }],
    sessions: [{ id: 'session-1', title: '写作', minutes: 60, completedAt: 1700000000000, tree: 'pine' }],
    redemptions: [{ id: 'redemption-1', rewardId: 'coffee', title: '一杯喜欢的咖啡', cost: 30, redeemedAt: 1700000000100 }],
    timer: { id: 'timer-1', title: '阅读', minutes: 25, remainingMs: 1500000, endsAt: 1700001500000, tree: 'oak' },
  };
}

test('missing storage and a complete valid backup load without writing', () => {
  let writes = storageWith(null);
  assert.deepEqual(loadData(), emptyData());
  assert.equal(persistenceIssue, null);
  assert.deepEqual(writes, []);
  const expected = recordedData();
  writes = storageWith(JSON.stringify(expected));
  assert.deepEqual(loadData(), expected);
  assert.equal(persistenceIssue, null);
  assert.deepEqual(writes, []);
});

test('malformed JSON and an empty stored value preserve exact recovery data', () => {
  for (const raw of ['{"tasks": [', '']) {
    const writes = storageWith(raw);
    assert.deepEqual(loadData(), emptyData());
    assert.equal(persistenceIssue.raw, raw);
    assert.match(persistenceIssue.message, /原始记录已保留/);
    assert.deepEqual(writes, []);
    clearPersistenceIssue();
    assert.equal(persistenceIssue, null);
  }
});

test('one invalid task preserves the whole original record for recovery', () => {
  const invalid = recordedData();
  invalid.tasks[0].end = '08:00';
  const raw = JSON.stringify(invalid, null, 2);
  const writes = storageWith(raw);
  assert.deepEqual(loadData(), emptyData());
  assert.equal(persistenceIssue.raw, raw);
  assert.match(persistenceIssue.message, /格式有误/);
  assert.deepEqual(writes, []);
});

test('denied storage reports an unreadable state and a later load can recover', () => {
  const writes = storageWith(null, true);
  assert.deepEqual(loadData(), emptyData());
  assert.equal(persistenceIssue.raw, null);
  assert.match(persistenceIssue.message, /无法读取/);
  assert.deepEqual(writes, []);
  storageWith(JSON.stringify(recordedData()));
  assert.deepEqual(loadData(), recordedData());
  assert.equal(persistenceIssue, null);
});

test('calendar dates must exist rather than normalize into a different month', () => {
  for (const date of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-01', '0000-01-01', '2026-9-11', '']) {
    assert.equal(validDateKey(date), false, date);
    const data = recordedData(); data.tasks[0].date = date;
    assert.equal(validData(data), false, date);
  }
  for (const date of ['2024-02-29', '2026-09-11', '0001-01-01', '9999-12-31']) assert.equal(validDateKey(date), true, date);
});

test('duplicate IDs are rejected in every record collection and active timers', () => {
  for (const collection of ['tasks', 'notes', 'sessions', 'rewards', 'redemptions']) {
    const data = recordedData(); data[collection].push({ ...data[collection][0] });
    assert.equal(validData(data), false, collection);
  }
  const duplicateTimer = recordedData(); duplicateTimer.timer.id = duplicateTimer.sessions[0].id;
  assert.equal(validData(duplicateTimer), false);
  const blankId = recordedData(); blankId.notes[0].id = ' ';
  assert.equal(validData(blankId), false);
});

test('timestamps, duration, timer state and reward costs reject invalid numbers', () => {
  const changes = [
    d => { d.sessions[0].minutes = 1.5; },
    d => { d.sessions[0].completedAt = -1; },
    d => { d.notes[0].updatedAt = Infinity; },
    d => { d.notes[0].updatedAt = 0.5; },
    d => { d.rewards[0].cost = 1.5; },
    d => { d.rewards[0].cost = 10001; },
    d => { d.redemptions[0].cost = -30; },
    d => { d.redemptions[0].cost = 0; },
    d => { d.redemptions[0].redeemedAt = NaN; },
    d => { d.timer.minutes = 181; },
    d => { d.timer.remainingMs = 1500001; },
    d => { d.timer.endsAt = -1; },
  ];
  for (const change of changes) { const data = recordedData(); change(data); assert.equal(validData(data), false); }
});

test('redemptions cannot create a negative balance and valid all-day records survive', () => {
  const data = recordedData();
  data.redemptions[0].cost = 60;
  data.tasks[0].allDay = true;
  assert.equal(validData(data), true);
  data.redemptions[0].cost = 61;
  assert.equal(validData(data), false);
  data.redemptions[0].cost = 60;
  data.tasks[0].start = '';
  assert.equal(validData(data), false);
});

test('legacy tasks and custom task colors survive backup and storage round trips', () => {
  for (const color of [undefined, ...taskColorPresets.map(preset => preset.value), '#00AaFf', '#000000', '#ffffff']) {
    const expected = recordedData();
    if (color !== undefined) expected.tasks[0].color = color;
    expected.tasks[0].calendarSource = 'legacy-extra-field';
    const raw = JSON.stringify(expected);
    assert.equal(validData(JSON.parse(raw)), true, `Backup color: ${color}`);
    const writes = storageWith(raw);
    assert.deepEqual(loadData(), expected);
    assert.equal(persistenceIssue, null);
    assert.deepEqual(writes, []);
  }
});

test('invalid task colors reject imports and preserve the original recovery record', () => {
  for (const color of [null, '', '#123', '#11223344', 'red', 'rgb(1,2,3)', '#gggggg', ' #112233', 0, {}]) {
    const data = recordedData();
    data.tasks[0].color = color;
    assert.equal(validData(data), false, JSON.stringify(color));
    const raw = JSON.stringify(data);
    const writes = storageWith(raw);
    assert.deepEqual(loadData(), emptyData());
    assert.equal(persistenceIssue.raw, raw);
    assert.deepEqual(writes, []);
  }
});

test('task colors keep readable text and a visible strip even for pale custom colors', () => {
  const luminance = color => {
    const rgb = color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
    const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const color of [...taskColorPresets.map(preset => preset.value), '#000000', '#ffffff', '#ffff00', '#00ff00', '#ff00ff', '#00ffff', '#fefefe']) {
    const style = taskColorStyle(color);
    assert.ok(contrast(style.color, style.backgroundColor) >= 4.5, `${color}: text contrast`);
    assert.ok(contrast(style.borderColor, style.backgroundColor) >= 3, `${color}: color strip contrast`);
  }
});
