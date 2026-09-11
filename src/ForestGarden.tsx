import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Leaf, Trees, X } from 'lucide-react';
import type { FocusController } from './Focus';
import type { FocusSession } from './model';
import ForestScene from './ForestScene';
import { forestPeriod, forestSeries, selectForestSessions, shiftForestPeriod, type ForestScope } from './forest-data';
import './forest-garden.css';

const plotSize = 36;
const scopes: { key: ForestScope; label: string }[] = [
  { key: 'all', label: '全部' }, { key: 'day', label: '日' }, { key: 'week', label: '周' },
  { key: 'month', label: '月' }, { key: 'year', label: '年' },
];
const species = { pine: '小松树', oak: '橡树', sakura: '樱花树' };

export default function ForestGarden({ focus }: { focus: FocusController }) {
  const [scope, setScope] = useState<ForestScope>('all');
  const [anchor, setAnchor] = useState(() => new Date());
  const [plot, setPlot] = useState(() => Math.max(0, Math.ceil(focus.sessions.length / plotSize) - 1));
  const [selectedId, setSelectedId] = useState<string>();
  const known = useRef(new Set(focus.sessions.map(session => session.id)));
  const previousTimer = useRef<string | undefined>(undefined);
  const now = Date.now();
  const today = new Date(now);
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const sessions = useMemo(() => selectForestSessions(focus.sessions, scope, anchor), [focus.sessions, scope, anchor]);
  const period = useMemo(() => forestPeriod(scope, anchor), [scope, anchor]);
  const series = useMemo(() => forestSeries(scope, scope === 'all' ? new Date(currentMonthStart) : anchor, focus.sessions), [focus.sessions, scope, anchor, currentMonthStart]);
  const minutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const days = new Set(sessions.map(session => new Date(session.completedAt).toLocaleDateString('en-CA'))).size;
  const showsCurrentPeriod = period.start === null || now >= period.start && now < period.end!;
  const active = focus.timer && showsCurrentPeriod ? {
    tree: focus.timer.tree,
    progress: Math.max(0, Math.min(1, 1 - focus.remaining / (focus.timer.minutes * 60_000))),
  } : undefined;
  const plots = Math.max(1, Math.ceil((sessions.length + (active ? 1 : 0)) / plotSize));
  const currentPlot = Math.min(plot, plots - 1);
  const visible = sessions.slice(currentPlot * plotSize, (currentPlot + 1) * plotSize);
  const activeOnPlot = !!active && currentPlot === Math.floor(sessions.length / plotSize);
  const selected = visible.find(session => session.id === selectedId);
  const maxMinutes = Math.max(1, ...series.map(bucket => bucket.minutes));
  const nextPeriod = forestPeriod(scope, shiftForestPeriod(scope, anchor, 1));
  const canGoNext = scope !== 'all' && nextPeriod.start !== null && nextPeriod.start <= now;

  useEffect(() => {
    const fresh = sessions.filter(session => !known.current.has(session.id));
    known.current = new Set(focus.sessions.map(session => session.id));
    if (!fresh.length) return;
    const latest = fresh[fresh.length - 1];
    setPlot(Math.floor(sessions.findIndex(session => session.id === latest.id) / plotSize));
    setSelectedId(latest.id);
  }, [focus.sessions, sessions]);

  useEffect(() => {
    const id = focus.timer?.id;
    if (id && id !== previousTimer.current && active) {
      setPlot(Math.floor(sessions.length / plotSize));
      setSelectedId(undefined);
    }
    previousTimer.current = id;
  }, [focus.timer?.id, !!active, sessions.length]);

  const changePeriod = (nextScope: ForestScope, nextAnchor = anchor) => {
    setScope(nextScope); setAnchor(nextScope === 'all' ? new Date() : nextAnchor); setPlot(0); setSelectedId(undefined);
  };
  const selectTree = (session: FocusSession) => setSelectedId(session.id);

  return <section className="forest-garden visual-forest" aria-labelledby="forest-garden-title">
    <header className="forest-visual-heading"><div><h2 id="forest-garden-title">我的森林 <span data-testid="forest-tree-count">{sessions.length} 棵</span></h2><p>每一次专注，都在这里留下一棵树。</p></div><Trees size={24} strokeWidth={1.4} /></header>
    <div className="forest-period-controls">
      <div className="forest-period-tabs" role="group" aria-label="森林时间范围">{scopes.map(item => <button key={item.key} type="button" aria-pressed={scope === item.key} onClick={() => changePeriod(item.key)}>{item.label}</button>)}</div>
      {scope !== 'all' && <button className="forest-back-now" onClick={() => changePeriod(scope, new Date())}>回到今天</button>}
    </div>
    <div className="forest-period-navigation">
      <button className="icon-btn" aria-label="森林上一时段" disabled={scope === 'all'} onClick={() => changePeriod(scope, shiftForestPeriod(scope, anchor, -1))}><ChevronLeft size={17} /></button>
      <span data-testid="forest-period-label">{scope === 'all' ? '所有专注，慢慢成林' : period.label}</span>
      <button className="icon-btn" aria-label="森林下一时段" disabled={!canGoNext} onClick={() => changePeriod(scope, shiftForestPeriod(scope, anchor, 1))}><ChevronRight size={17} /></button>
    </div>
    <div className="forest-landscape">
      <ForestScene sessions={visible} activeTree={activeOnPlot ? active : undefined} selectedId={selectedId} onSelect={selectTree} />
      {activeOnPlot ? <p className="forest-growing-status" role="status"><span className={focus.timer?.endsAt === null ? 'is-paused' : ''} />{focus.timer?.endsAt === null ? '小树已暂停生长' : '一棵小树正在生长'}<em>{Math.floor(active!.progress * 100)}%</em></p> : <p className="forest-landscape-caption">{sessions.length ? '点一下小树，看看它记录的那段时光。' : scope === 'all' ? '完成第一次专注，种下你的第一棵树。' : '这段时间还没有种下小树。'}</p>}
    </div>
    {plots > 1 && <nav className="forest-plot-navigation" aria-label="切换林地"><button className="icon-btn" aria-label="上一片林地" disabled={currentPlot === 0} onClick={() => { setPlot(currentPlot - 1); setSelectedId(undefined); }}><ChevronLeft size={15} /></button><span>第 {currentPlot + 1} / {plots} 片林地 <small>每片最多 36 棵</small></span><button className="icon-btn" aria-label="下一片林地" disabled={currentPlot >= plots - 1} onClick={() => { setPlot(currentPlot + 1); setSelectedId(undefined); }}><ChevronRight size={15} /></button></nav>}
    {selected && <div className="forest-tree-detail" role="status"><Leaf size={18} /><div><strong>{selected.title || '一段专注时光'}</strong><span>{species[selected.tree]} · {selected.minutes} 分钟 · {new Date(selected.completedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><button className="icon-btn" aria-label="收起小树详情" onClick={() => setSelectedId(undefined)}><X size={15} /></button></div>}
    <div className="forest-period-stats" aria-label="当前范围的专注统计"><div><strong>{sessions.length}<small>棵</small></strong><span>种下小树</span></div><div><strong>{minutes}<small>分钟</small></strong><span>投入的时间</span></div><div><strong>{days}<small>天</small></strong><span>专注的日子</span></div></div>
    {!!sessions.length && <section className="forest-time-chart" aria-label="专注时长分布"><header><span>{scope === 'all' ? '最近 12 个月' : '这段时间的专注'}</span><small>单位：分钟</small></header><div className="forest-chart-bars" role="list" aria-label="各时段专注分钟">{series.map((bucket, index) => <div key={`${bucket.label}-${index}`} role="listitem" aria-label={`${bucket.label}：${bucket.minutes} 分钟`} title={`${bucket.label} · ${bucket.minutes} 分钟`}><div className="forest-chart-track"><i style={{ height: `${bucket.minutes / maxMinutes * 100}%` }} /></div><span aria-hidden="true">{series.length <= 12 || index % Math.ceil(series.length / 8) === 0 || index === series.length - 1 ? bucket.label.replace(/^\d{4}[年/-]/, '') : ''}</span></div>)}</div></section>}
  </section>;
}
