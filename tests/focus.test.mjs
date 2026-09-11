import test from 'node:test';
import assert from 'node:assert/strict';
import { abandonFocus, beginFocus, remainingAt, pauseFocus, resumeFocus, settleFocus, coinBalance, redeemReward } from '../src/focus-engine.mjs';

const initial = () => ({ version: 1, tasks: [], notes: [], sessions: [], timer: null,
  rewards: [{ id: 'coffee', title: '咖啡', cost: 20 }], redemptions: [] });
const start = (data = initial(), now = 1_000) => beginFocus(data, { id: 'focus-1', title: '写作', minutes: 25, tree: 'pine' }, now);

test('remaining time uses persisted deadline and survives sleep/reload', () => {
  const data = JSON.parse(JSON.stringify(start()));
  assert.equal(remainingAt(data.timer, 61_000), 24 * 60_000);
  assert.equal(remainingAt(data.timer, 2_000_000), 0);
  assert.equal(settleFocus(data, 2_000_000).sessions[0].completedAt, 1_501_000);
});

test('pause freezes duration, resume establishes a new deadline', () => {
  const paused = pauseFocus(start(), 61_000);
  assert.equal(paused.timer.endsAt, null);
  assert.equal(remainingAt(paused.timer, 8_000_000), 24 * 60_000);
  assert.equal(settleFocus(paused, 8_000_000), paused);
  const resumed = resumeFocus(paused, 8_000_000);
  assert.equal(resumed.timer.endsAt, 9_440_000);
  assert.equal(remainingAt(resumed.timer, 8_060_000), 23 * 60_000);
});

test('completion grants exactly one tree and one minute-based reward', () => {
  const running = start();
  const completed = settleFocus(running, 1_501_000);
  assert.equal(completed.timer, null);
  assert.equal(completed.sessions.length, 1);
  assert.equal(coinBalance(completed), 25);
  assert.equal(settleFocus(completed, 1_501_000), completed);
  const staleTimer = settleFocus({ ...completed, timer: running.timer }, 2_000_000);
  assert.equal(staleTimer.sessions.length, 1);
  assert.equal(coinBalance(staleTimer), 25);
});

test('pause at deadline completes session instead of freezing a zero-second timer', () => {
  const result = pauseFocus(start(), 1_501_000);
  assert.equal(result.timer, null);
  assert.equal(result.sessions.length, 1);
});

test('ending just before the deadline grants nothing and keeps previously earned trees and coins', () => {
  const first = abandonFocus(start(), 1_500_999);
  assert.equal(first.timer, null);
  assert.equal(first.sessions.length, 0);
  assert.equal(coinBalance(first), 0);
  const earned = settleFocus(start(), 1_501_000);
  const next = beginFocus(earned, { id: 'focus-2', title: '阅读', minutes: 5, tree: 'oak' }, 2_000_000);
  const result = abandonFocus(next, 2_299_999);
  assert.equal(result.timer, null);
  assert.equal(result.sessions, earned.sessions);
  assert.equal(coinBalance(result), 25);
});

test('ending at or after the deadline settles exactly once using the original completion time', () => {
  for (const now of [1_501_000, 1_501_001, 9_000_000]) {
    const running = start();
    const ended = abandonFocus(running, now);
    assert.equal(ended.timer, null);
    assert.deepEqual(ended.sessions, [{ id: 'focus-1', title: '写作', minutes: 25, completedAt: 1_501_000, tree: 'pine' }]);
    assert.equal(coinBalance(ended), 25);
    assert.equal(abandonFocus(ended, now + 1), ended);
    assert.equal(settleFocus(ended, now + 1), ended);
    const staleTimer = abandonFocus({ ...ended, timer: running.timer }, now + 1);
    assert.equal(staleTimer.sessions.length, 1);
    assert.equal(coinBalance(staleTimer), 25);
    assert.equal(running.timer.endsAt, 1_501_000);
    assert.equal(running.sessions.length, 0);
  }
});

test('ending a paused focus gives no reward and a resumed focus uses its new deadline', () => {
  const paused = pauseFocus(start(), 61_000);
  const ended = abandonFocus(paused, 8_000_000);
  assert.equal(ended.timer, null);
  assert.equal(ended.sessions.length, 0);
  assert.equal(coinBalance(ended), 0);
  const resumed = resumeFocus(paused, 8_000_000);
  const before = abandonFocus(resumed, 9_439_999);
  assert.equal(before.sessions.length, 0);
  const completed = abandonFocus(resumed, 9_440_000);
  assert.equal(completed.sessions.length, 1);
  assert.equal(completed.sessions[0].completedAt, 9_440_000);
  assert.equal(coinBalance(completed), 25);
});

test('ending with no active timer is a no-op', () => {
  const data = initial();
  assert.equal(abandonFocus(data, 9_000_000), data);
});

test('a second start never overwrites the active focus', () => {
  const data = start();
  assert.equal(start(data), data);
  for (const minutes of [0, -5, 181, NaN, 1.5]) {
    const empty = initial();
    assert.equal(beginFocus(empty, { id: 'x', title: '', minutes, tree: 'pine' }, 0), empty);
  }
});

test('rapid redemption rechecks balance and duplicate redemption IDs are idempotent', () => {
  const earned = settleFocus(start(), 1_501_000);
  const first = redeemReward(earned, 'coffee', 'redeem-1', 1_600_000);
  assert.equal(coinBalance(first), 5);
  assert.equal(first.redemptions.length, 1);
  assert.equal(redeemReward(first, 'coffee', 'redeem-2', 1_600_000), first);
  assert.equal(redeemReward(first, 'coffee', 'redeem-1', 1_600_000), first);
  assert.equal(redeemReward(first, 'missing', 'redeem-3', 1_600_000), first);
});
