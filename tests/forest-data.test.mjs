import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { forestPeriod, shiftForestPeriod, selectForestSessions, forestSeries } from '../src/forest-data.ts';

const local = (year, month, day, hour = 0, minute = 0) => new Date(year, month - 1, day, hour, minute);
const session = (id, completedAt, minutes = 25, tree = 'pine') => ({ id, completedAt: Number(completedAt), minutes, tree, title: `专注 ${id}` });
const sum = points => points.reduce((total, point) => total + point.minutes, 0);

test('periods use local midnight, Monday weeks and exclusive next-period boundaries', () => {
  const anchor = local(2026, 9, 13, 18, 43); // Sunday.
  for (const [scope, start, end] of [
    ['day', local(2026, 9, 13), local(2026, 9, 14)],
    ['week', local(2026, 9, 7), local(2026, 9, 14)],
    ['month', local(2026, 9, 1), local(2026, 10, 1)],
    ['year', local(2026, 1, 1), local(2027, 1, 1)],
  ]) {
    const period = forestPeriod(scope, anchor);
    assert.equal(period.start, +start, scope);
    assert.equal(period.end, +end, scope);
    assert.match(period.label, /2026年/);
  }
  assert.deepEqual(forestPeriod('all', anchor), { start: null, end: null, label: '全部记录' });
  assert.equal(forestPeriod('week', local(2026, 9, 7, 12)).start, +local(2026, 9, 7));
});

test('cross-year weeks and leap months include the correct calendar dates', () => {
  const week = forestPeriod('week', local(2027, 1, 1));
  assert.equal(week.start, +local(2026, 12, 28));
  assert.equal(week.end, +local(2027, 1, 4));
  assert.equal(week.label, '2026年12月28日 — 2027年1月3日');
  for (const [year, days] of [[2024, 29], [2025, 28], [2000, 29], [2100, 28]]) {
    const month = forestPeriod('month', local(year, 2, 14));
    assert.equal(month.start, +local(year, 2, 1));
    assert.equal(month.end, +local(year, 3, 1));
    assert.equal(forestSeries('month', local(year, 2, 14), []).length, days);
  }
});

test('selection includes the start and final millisecond but never the next period', () => {
  const anchor = local(2024, 2, 29, 12);
  for (const scope of ['day', 'week', 'month', 'year']) {
    const { start, end } = forestPeriod(scope, anchor);
    const rows = [session('outside-after', end), session('last', end - 1), session('first', start), session('outside-before', start - 1)];
    assert.deepEqual(selectForestSessions(rows, scope, anchor).map(row => row.id), ['first', 'last'], scope);
    assert.equal(sum(forestSeries(scope, anchor, rows)), 50, scope);
  }
});

test('oldest-first selection uses deterministic ID ties without mutating legacy records', () => {
  const anchor = local(2026, 9, 12);
  const completedAt = +anchor;
  const rows = [session('z', completedAt, 50, 'sakura'), session('a', completedAt, 25, 'oak'), session('old', local(2020, 1, 1), 5)];
  rows.forEach(Object.freeze);
  Object.freeze(rows);
  const before = JSON.stringify(rows);
  const selected = selectForestSessions(rows, 'all', anchor);
  assert.deepEqual(selected.map(row => row.id), ['old', 'a', 'z']);
  assert.equal(selected[2], rows[0]);
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(Object.keys(selected[0]).sort(), ['completedAt', 'id', 'minutes', 'title', 'tree']);
  forestSeries('all', anchor, rows);
  assert.equal(JSON.stringify(rows), before);
});

test('period navigation avoids month-end and leap-day overflow and never changes the input date', () => {
  const cases = [
    ['month', local(2024, 1, 31, 23, 59), 1, local(2024, 2, 1)],
    ['month', local(2025, 3, 31, 12), -1, local(2025, 2, 1)],
    ['month', local(2026, 12, 31), 1, local(2027, 1, 1)],
    ['month', local(2026, 1, 31), -1, local(2025, 12, 1)],
    ['year', local(2024, 2, 29), 1, local(2025, 1, 1)],
    ['year', local(2024, 12, 31), -1, local(2023, 1, 1)],
    ['week', local(2027, 1, 3, 22), 1, local(2027, 1, 4)],
    ['week', local(2027, 1, 1, 22), -1, local(2026, 12, 21)],
    ['day', local(2024, 2, 28, 18), 1, local(2024, 2, 29)],
    ['day', local(2024, 3, 1, 18), -1, local(2024, 2, 29)],
  ];
  for (const [scope, anchor, direction, expected] of cases) {
    const before = +anchor;
    assert.equal(+shiftForestPeriod(scope, anchor, direction), +expected, scope);
    assert.equal(+anchor, before, scope);
    const back = shiftForestPeriod(scope, shiftForestPeriod(scope, anchor, direction), -direction);
    assert.equal(+back, forestPeriod(scope, anchor).start, `${scope}: round trip`);
  }
  const anchor = local(2026, 9, 12, 12);
  const all = shiftForestPeriod('all', anchor, 1);
  assert.equal(+all, +anchor);
  assert.notEqual(all, anchor);
});

test('empty history produces zero-only bars with the expected local labels', () => {
  const anchor = local(2026, 9, 12);
  assert.equal(forestSeries('day', anchor, []).length, 24);
  assert.equal(forestSeries('day', anchor, [])[23].label, '23:00');
  const week = forestSeries('week', anchor, []);
  assert.deepEqual(week.map(point => point.label), ['9/7 周一', '9/8 周二', '9/9 周三', '9/10 周四', '9/11 周五', '9/12 周六', '9/13 周日']);
  assert.equal(forestSeries('month', anchor, []).length, 30);
  assert.equal(forestSeries('month', anchor, [])[29].label, '30日');
  assert.equal(forestSeries('year', anchor, []).length, 12);
  assert.equal(forestSeries('year', anchor, [])[11].label, '12月');
  for (const scope of ['all', 'day', 'week', 'month', 'year']) {
    assert.deepEqual(selectForestSessions([], scope, anchor), []);
    assert.ok(forestSeries(scope, anchor, []).every(point => point.minutes === 0));
  }
});

test('hour, weekday, month-day and yearly bars reflect actual completion timestamps', () => {
  const anchor = local(2024, 2, 29, 14);
  const rows = [
    session('morning', local(2024, 2, 29, 9, 5), 25),
    session('same-hour', local(2024, 2, 29, 9, 59), 5),
    session('evening', local(2024, 2, 29, 22, 10), 50),
    session('monday', local(2024, 2, 26, 12), 15),
    session('sunday', local(2024, 3, 3, 12), 30),
    session('january', local(2024, 1, 1, 12), 60),
    session('next-year', local(2025, 1, 1), 180),
  ];
  const day = forestSeries('day', anchor, rows);
  assert.equal(day[9].minutes, 30);
  assert.equal(day[22].minutes, 50);
  assert.equal(sum(day), 80);
  const week = forestSeries('week', anchor, rows);
  assert.equal(week[0].minutes, 15);
  assert.equal(week[3].minutes, 80);
  assert.equal(week[6].minutes, 30);
  assert.equal(sum(week), 125);
  const month = forestSeries('month', anchor, rows);
  assert.equal(month[28].minutes, 80);
  assert.equal(sum(month), 95);
  const year = forestSeries('year', anchor, rows);
  assert.deepEqual(year.slice(0, 3).map(point => point.minutes), [60, 95, 30]);
  assert.equal(sum(year), 185);
});

test('all-time selection retains all history while its chart labels an exact trailing twelve-month window', () => {
  const anchor = local(2026, 2, 28, 20);
  const start = +local(2025, 3, 1);
  const end = +local(2026, 3, 1);
  const rows = [session('before', start - 1), session('first', start, 50), session('last', end - 1, 5), session('after', end)];
  const points = forestSeries('all', anchor, rows);
  assert.equal(points.length, 12);
  assert.equal(points[0].label, '2025年3月');
  assert.equal(points[9].label, '2025年12月');
  assert.equal(points[10].label, '2026年1月');
  assert.equal(points[11].label, '2026年2月');
  assert.equal(points[0].minutes, 50);
  assert.equal(points[11].minutes, 5);
  assert.equal(sum(points), 55);
  assert.equal(selectForestSessions(rows, 'all', anchor).length, 4);
});

test('invalid anchors fail explicitly instead of manufacturing a date or chart', () => {
  for (const scope of ['all', 'day', 'week', 'month', 'year']) {
    assert.throws(() => forestPeriod(scope, new Date(NaN)), RangeError);
    assert.throws(() => shiftForestPeriod(scope, new Date(NaN), 1), RangeError);
    assert.throws(() => selectForestSessions([], scope, new Date(NaN)), RangeError);
    assert.throws(() => forestSeries(scope, new Date(NaN), []), RangeError);
  }
});

test('local DST days and weeks conserve minutes across both clock changes', () => {
  const moduleUrl = new URL('../src/forest-data.ts', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import {forestPeriod,shiftForestPeriod,selectForestSessions,forestSeries} from ${JSON.stringify(moduleUrl)};
    const row = (id, date, minutes) => ({id,title:id,completedAt:+date,minutes,tree:'pine'});
    const spring = new Date(2026,2,8,12);
    assert.equal(spring.getTimezoneOffset(),240,'subprocess must use New York daylight time');
    const springPeriod=forestPeriod('day',spring);
    assert.equal(springPeriod.end-springPeriod.start,23*60*60*1000);
    const springRows=[row('before',new Date(2026,2,8,1,59),25),row('after',new Date(2026,2,8,3,0),50),row('next',new Date(2026,2,9),180)];
    const springBars=forestSeries('day',spring,springRows);
    assert.equal(springBars.length,24);
    assert.equal(springBars[1].minutes,25);
    assert.equal(springBars[2].minutes,0);
    assert.equal(springBars[3].minutes,50);
    assert.equal(springBars.reduce((sum,p)=>sum+p.minutes,0),75);
    assert.equal(selectForestSessions(springRows,'day',spring).length,2);
    const springWeek=forestPeriod('week',spring);
    assert.equal(springWeek.end-springWeek.start,167*60*60*1000);
    const next=shiftForestPeriod('day',spring,1);
    assert.equal(next.getDate(),9);
    assert.equal(next.getHours(),0);
    const fall=new Date(2026,10,1,12);
    const fallPeriod=forestPeriod('day',fall);
    assert.equal(fallPeriod.end-fallPeriod.start,25*60*60*1000);
    const fallRows=[row('first',new Date('2026-11-01T01:30:00-04:00'),25),row('second',new Date('2026-11-01T01:30:00-05:00'),50)];
    const fallBars=forestSeries('day',fall,fallRows);
    assert.equal(fallBars[1].minutes,75);
    assert.equal(fallBars.reduce((sum,p)=>sum+p.minutes,0),75);
    assert.deepEqual(selectForestSessions(fallRows,'day',fall).map(s=>s.id),['first','second']);
    const fallWeek=forestPeriod('week',fall);
    assert.equal(fallWeek.end-fallWeek.start,169*60*60*1000);
    assert.equal(forestSeries('week',fall,fallRows)[6].minutes,75);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ: 'America/New_York' },
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
