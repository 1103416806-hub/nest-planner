import type { FocusSession } from './model.ts';

export type ForestScope = 'all' | 'day' | 'week' | 'month' | 'year';
export interface ForestPeriod { start: number | null; end: number | null; label: string }
export interface ForestSeriesPoint { label: string; minutes: number }

// Construct local calendar boundaries, including years 0–99, without fixed-day arithmetic.
function localDate(year: number, month: number, day: number): Date {
  const result = new Date(0);
  result.setHours(0, 0, 0, 0);
  result.setFullYear(year, month, day);
  return result;
}

function validAnchor(anchor: Date): void {
  if (!Number.isFinite(anchor.getTime())) throw new RangeError('森林日期无效');
}

function dayLabel(date: Date, includeYear = true): string {
  return `${includeYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日`;
}

/** All finite ranges are local-calendar intervals with an inclusive start and exclusive end. */
export function forestPeriod(scope: ForestScope, anchor: Date): ForestPeriod {
  validAnchor(anchor);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const day = anchor.getDate();
  switch (scope) {
    case 'all': return { start: null, end: null, label: '全部记录' };
    case 'day': return {
      start: localDate(year, month, day).getTime(),
      end: localDate(year, month, day + 1).getTime(),
      label: dayLabel(anchor),
    };
    case 'week': {
      const monday = day - (anchor.getDay() + 6) % 7;
      const start = localDate(year, month, monday);
      const last = localDate(year, month, monday + 6);
      return {
        start: start.getTime(),
        end: localDate(year, month, monday + 7).getTime(),
        label: `${dayLabel(start)} — ${dayLabel(last, last.getFullYear() !== start.getFullYear())}`,
      };
    }
    case 'month': return {
      start: localDate(year, month, 1).getTime(),
      end: localDate(year, month + 1, 1).getTime(),
      label: `${year}年${month + 1}月`,
    };
    case 'year': return {
      start: localDate(year, 0, 1).getTime(),
      end: localDate(year + 1, 0, 1).getTime(),
      label: `${year}年`,
    };
  }
}

/** Navigation returns the next/previous period's local start, so month-end dates cannot overflow. */
export function shiftForestPeriod(scope: ForestScope, anchor: Date, direction: -1 | 1): Date {
  const period = forestPeriod(scope, anchor);
  if (period.start === null) return new Date(anchor.getTime());
  const start = new Date(period.start);
  const year = start.getFullYear();
  const month = start.getMonth();
  const day = start.getDate();
  switch (scope) {
    case 'day': return localDate(year, month, day + direction);
    case 'week': return localDate(year, month, day + 7 * direction);
    case 'month': return localDate(year, month + direction, 1);
    case 'year': return localDate(year + direction, 0, 1);
    case 'all': return new Date(anchor.getTime());
  }
}

export function selectForestSessions(sessions: readonly FocusSession[], scope: ForestScope, anchor: Date): FocusSession[] {
  const { start, end } = forestPeriod(scope, anchor);
  return sessions
    .filter(session => (start === null || session.completedAt >= start) && (end === null || session.completedAt < end))
    .sort((a, b) => a.completedAt - b.completedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Day bars are the 24 local clock hours: a repeated DST hour is combined and a skipped hour stays zero.
 * The all-time chart covers 12 calendar months ending in the anchor's month; its labels include years.
 */
export function forestSeries(scope: ForestScope, anchor: Date, sessions: readonly FocusSession[]): ForestSeriesPoint[] {
  const period = forestPeriod(scope, anchor);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const start = scope === 'all' ? localDate(year, month - 11, 1) : new Date(period.start!);
  const end = scope === 'all' ? localDate(year, month + 1, 1).getTime() : period.end!;
  let points: ForestSeriesPoint[];
  switch (scope) {
    case 'day': points = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour).padStart(2, '0')}:00`, minutes: 0 })); break;
    case 'week': points = Array.from({ length: 7 }, (_, index) => {
      const date = localDate(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return { label: `${date.getMonth() + 1}/${date.getDate()} 周${'一二三四五六日'[index]}`, minutes: 0 };
    }); break;
    case 'month': points = Array.from({ length: localDate(year, month + 1, 0).getDate() }, (_, index) => ({ label: `${index + 1}日`, minutes: 0 })); break;
    case 'year': points = Array.from({ length: 12 }, (_, index) => ({ label: `${index + 1}月`, minutes: 0 })); break;
    case 'all': points = Array.from({ length: 12 }, (_, index) => {
      const date = localDate(start.getFullYear(), start.getMonth() + index, 1);
      return { label: `${date.getFullYear()}年${date.getMonth() + 1}月`, minutes: 0 };
    }); break;
  }
  const startTime = start.getTime();
  for (const session of sessions) {
    if (session.completedAt < startTime || session.completedAt >= end) continue;
    const date = new Date(session.completedAt);
    let index: number;
    switch (scope) {
      case 'day': index = date.getHours(); break;
      case 'week': index = (date.getDay() + 6) % 7; break;
      case 'month': index = date.getDate() - 1; break;
      case 'year': index = date.getMonth(); break;
      case 'all': index = (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth(); break;
    }
    if (points[index]) points[index].minutes += session.minutes;
  }
  return points;
}
