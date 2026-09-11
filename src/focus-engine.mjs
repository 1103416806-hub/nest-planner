/** @typedef {import('./model').AppData} AppData */
/** @typedef {import('./model').FocusTimer} FocusTimer */

/** @param {FocusTimer|null} timer @param {number} now */
export function remainingAt(timer, now) {
  if (!timer) return 0;
  return Math.max(0, timer.endsAt === null ? timer.remainingMs : timer.endsAt - now);
}

/** @param {AppData} data */
export function coinBalance(data) {
  return data.sessions.reduce((sum, item) => sum + item.minutes, 0)
    - data.redemptions.reduce((sum, item) => sum + item.cost, 0);
}

/** Settle only a running, expired timer. The timer ID is also its session ID.
 * @param {AppData} data @param {number} now @returns {AppData} */
export function settleFocus(data, now) {
  const timer = data.timer;
  if (!timer || timer.endsAt === null || remainingAt(timer, now) > 0) return data;
  if (data.sessions.some(session => session.id === timer.id)) return { ...data, timer: null };
  return {
    ...data,
    timer: null,
    sessions: [...data.sessions, {
      id: timer.id, title: timer.title, minutes: timer.minutes,
      completedAt: timer.endsAt, tree: timer.tree,
    }],
  };
}

/** @param {AppData} data @param {number} now @returns {AppData} */
export function pauseFocus(data, now) {
  const current = settleFocus(data, now);
  if (!current.timer || current.timer.endsAt === null) return current;
  return { ...current, timer: { ...current.timer, remainingMs: remainingAt(current.timer, now), endsAt: null } };
}

/** An end confirmation after the deadline must still preserve the completed session.
 * @param {AppData} data @param {number} now @returns {AppData} */
export function abandonFocus(data, now) {
  const current = settleFocus(data, now);
  return current.timer ? { ...current, timer: null } : current;
}

/** @param {AppData} data @param {number} now @returns {AppData} */
export function resumeFocus(data, now) {
  if (!data.timer || data.timer.endsAt !== null) return data;
  return { ...data, timer: { ...data.timer, endsAt: now + data.timer.remainingMs } };
}

/** @param {AppData} data @param {{id:string,title:string,minutes:number,tree:import('./model').Tree}} options @param {number} now @returns {AppData} */
export function beginFocus(data, options, now) {
  if (data.timer || !Number.isInteger(options.minutes) || options.minutes < 1 || options.minutes > 180) return data;
  const remainingMs = options.minutes * 60_000;
  return { ...data, timer: { ...options, title: options.title.trim() || '留一点时间给自己', remainingMs, endsAt: now + remainingMs } };
}

/** Validate balance within the state update so rapid redemption cannot overspend.
 * @param {AppData} data @param {string} rewardId @param {string} redemptionId @param {number} now @returns {AppData} */
export function redeemReward(data, rewardId, redemptionId, now) {
  const reward = data.rewards.find(item => item.id === rewardId);
  if (!reward || !Number.isInteger(reward.cost) || reward.cost <= 0 || coinBalance(data) < reward.cost
    || data.redemptions.some(item => item.id === redemptionId)) return data;
  return { ...data, redemptions: [...data.redemptions, {
    id: redemptionId, rewardId, title: reward.title, cost: reward.cost, redeemedAt: now,
  }] };
}
