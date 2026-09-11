import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Coffee, Coins, Gift, Leaf, Pause, Play, Plus, Sparkles, Sprout, Timer, X } from 'lucide-react';
import type { AppData, FocusSession, FocusTimer, Reward, Redemption, Tree, Update } from './model';
import { uid } from './model';
import { abandonFocus, beginFocus, coinBalance, pauseFocus, redeemReward, remainingAt, resumeFocus, settleFocus } from './focus-engine.mjs';
import ForestGarden from './ForestGarden';
import './focus.css';

export interface FocusController {
  timer: FocusTimer | null;
  remaining: number;
  coins: number;
  minutes: number;
  sessions: FocusSession[];
  rewards: Reward[];
  redemptions: Redemption[];
  title: string;
  setTitle: (title: string) => void;
  duration: number;
  setDuration: (minutes: number) => void;
  tree: Tree;
  setTree: (tree: Tree) => void;
  start: (title?: string, minutes?: number) => void;
  pause: () => void;
  resume: () => void;
  abandon: () => void;
  redeem: (id: string) => void;
  addReward: (title: string, cost: number) => boolean;
}

export function useFocus({ data, update, notify }: { data: AppData; update: Update; notify: (message: string) => void }): FocusController {
  const [now, setNow] = useState(Date.now);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(25);
  const [tree, setTree] = useState<Tree>('pine');
  const completedNotices = useRef(new Set<string>());
  const pendingRedemptions = useRef(new Set<string>());
  const pendingCompletion = useRef(new Set<string>());

  useEffect(() => {
    if (!data.timer || data.timer.endsAt === null) return;
    const tick = () => setNow(Date.now());
    tick();
    const interval = window.setInterval(tick, 500);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [data.timer?.id, data.timer?.endsAt]);

  useEffect(() => {
    const timer = data.timer;
    const current = Date.now();
    if (!timer || timer.endsAt === null || remainingAt(timer, current) > 0) return;
    pendingCompletion.current.add(timer.id);
    update(previous => settleFocus(previous, current));
  }, [now, data.timer, update]);

  useEffect(() => {
    for (const session of data.sessions) {
      if (pendingCompletion.current.has(session.id) && !completedNotices.current.has(session.id)) {
        completedNotices.current.add(session.id);
        pendingCompletion.current.delete(session.id);
        const message = `一棵小树长成了，获得 ${session.minutes} 枚叶子币。`;
        notify(`专注完成！${message}`);
        const desktop = window.nestDesktop;
        if (desktop) {
          const notificationFailed = () => notify('专注已完成并保存；系统通知未显示，可检查 Windows 通知设置。');
          void Promise.resolve().then(() => desktop.notify('专注完成', `「${session.title}」已完成。${message}`)).then(result => {
            if (result && typeof result === 'object' && 'ok' in result && result.ok === false) notificationFailed();
          }).catch(notificationFailed);
        }
      }
    }
    for (const redemption of data.redemptions) {
      if (pendingRedemptions.current.has(redemption.id)) {
        pendingRedemptions.current.delete(redemption.id);
        notify(`已兑换「${redemption.title}」，好好享受这份奖励。`);
      }
    }
  }, [data.sessions, data.redemptions, notify]);

  const start = useCallback((nextTitle = title, nextMinutes = duration) => {
    if (data.timer) { notify('先完成或结束当前专注，再种下一棵树。'); return; }
    if (!Number.isInteger(nextMinutes) || nextMinutes < 1 || nextMinutes > 180) { notify('专注时长需要是 1–180 分钟的整数。'); return; }
    const current = Date.now();
    const options = { id: uid(), title: nextTitle, minutes: nextMinutes, tree };
    setNow(current);
    update(previous => beginFocus(previous, options, current));
  }, [data.timer, duration, title, tree, update, notify]);

  const pause = useCallback(() => {
    const current = Date.now();
    if (data.timer && data.timer.endsAt !== null && remainingAt(data.timer, current) === 0) pendingCompletion.current.add(data.timer.id);
    update(previous => pauseFocus(previous, current));
    setNow(current);
  }, [data.timer, update]);
  const resume = useCallback(() => {
    const current = Date.now();
    update(previous => resumeFocus(previous, current));
    setNow(current);
  }, [update]);
  const abandon = useCallback(() => {
    const current = Date.now();
    const timer = data.timer;
    const completed = timer && timer.endsAt !== null && remainingAt(timer, current) === 0;
    if (completed) pendingCompletion.current.add(timer.id);
    update(previous => abandonFocus(previous, current));
    setNow(current);
    if (timer && !completed) notify('本次专注已结束。休息一下，随时可以重新开始。');
  }, [data.timer, update, notify]);

  const redeem = useCallback((id: string) => {
    const reward = data.rewards.find(item => item.id === id);
    if (!reward) return;
    if (coinBalance(data) < reward.cost) { notify('叶子币还差一点，再完成一段专注吧。'); return; }
    const redemptionId = uid();
    pendingRedemptions.current.add(redemptionId);
    const current = Date.now();
    update(previous => redeemReward(previous, id, redemptionId, current));
  }, [data, update, notify]);

  const addReward = useCallback((rewardTitle: string, cost: number) => {
    if (!rewardTitle.trim() || !Number.isInteger(cost) || cost < 1 || cost > 10000) { notify('填写奖励名称，并设置 1–10000 枚叶子币。'); return false; }
    const reward: Reward = { id: uid(), title: rewardTitle.trim().slice(0, 80), cost };
    update(previous => ({ ...previous, rewards: [...previous.rewards, reward] }));
    notify('新的小奖励已加入。');
    return true;
  }, [update, notify]);

  return {
    timer: data.timer, remaining: data.timer ? remainingAt(data.timer, now) : Math.max(0, Number.isFinite(duration) ? duration : 0) * 60_000,
    coins: coinBalance(data), minutes: data.sessions.reduce((sum, session) => sum + session.minutes, 0),
    sessions: data.sessions, rewards: data.rewards, redemptions: data.redemptions,
    title, setTitle, duration, setDuration, tree, setTree, start, pause, resume, abandon, redeem, addReward,
  };
}

const treeNames: Record<Tree, string> = { pine: '小松树', oak: '橡树', sakura: '樱花树' };
const treeDescriptions: Record<Tree, string> = { pine: '稳稳生长', oak: '慢慢积累', sakura: '静待花开' };

export function TreeArt({ tree = 'pine', progress = 1, className = '', miniature = false }: { tree?: Tree; progress?: number; className?: string; miniature?: boolean }) {
  const sprout = progress < 0.28;
  return <svg className={`focus-tree-art ${className}`} viewBox="0 0 160 148" role="img" aria-label={sprout ? '正在生长的小树苗' : treeNames[tree]}>
    {!miniature && <><circle cx="80" cy="73" r="56" fill="#e7eddf" opacity=".65" /><circle cx="118" cy="30" r="5" fill="#d8e4cf" /><circle cx="32" cy="57" r="3" fill="#c7d8be" /></>}
    <ellipse cx="80" cy="134" rx="41" ry="7" fill="#d4dfca" opacity=".65" />
    {sprout ? <g>
      <path d="M80 129V91" stroke="#809363" strokeWidth="5" strokeLinecap="round" />
      <path d="M80 109C58 109 46 93 50 78C73 78 84 90 80 109Z" fill="#7e9c68" />
      <path d="M80 99C77 79 90 65 109 68C110 86 98 99 80 99Z" fill="#a3b981" />
      <path d="M59 89L79 109M100 77L81 98" stroke="#587c54" strokeWidth="1.3" opacity=".6" />
    </g> : tree === 'pine' ? <g>
      <path d="M76 107H85V133H76Z" fill="#9c7851" />
      <path d="M80 25L116 80H103L126 112Q80 123 34 112L57 80H44Z" fill="#6c8e69" />
      <path d="M80 25L81 117Q53 117 34 112L57 80H44Z" fill="#496f59" />
      <path d="M62 83L80 88L99 83M54 103L80 108L108 103" fill="none" stroke="#a8bd8b" strokeWidth="2" opacity=".45" />
    </g> : tree === 'oak' ? <g>
      <path d="M79 73L79 133M80 109L61 90M81 103L101 84" stroke="#997851" strokeWidth="8" strokeLinecap="round" />
      <circle cx="54" cy="74" r="27" fill="#82a474" /><circle cx="104" cy="70" r="31" fill="#9bb783" /><circle cx="79" cy="48" r="32" fill="#acc38d" /><circle cx="76" cy="78" r="33" fill="#91b078" />
      <path d="M79 99V76M78 88L62 77M79 88L96 73" stroke="#6b915f" strokeWidth="3" strokeLinecap="round" />
    </g> : <g>
      <path d="M80 69L80 133M79 108L59 87M81 99L99 80" stroke="#a78669" strokeWidth="7" strokeLinecap="round" />
      <circle cx="49" cy="71" r="25" fill="#e8b7b0" /><circle cx="108" cy="69" r="26" fill="#efd0c4" /><circle cx="80" cy="46" r="30" fill="#eed0c5" /><circle cx="80" cy="76" r="31" fill="#e5b8af" />
      <g fill="#fae9de"><circle cx="67" cy="47" r="3" /><circle cx="97" cy="57" r="3" /><circle cx="55" cy="76" r="3" /><circle cx="84" cy="80" r="3" /><circle cx="103" cy="89" r="3" /></g>
      <path d="M119 112q6 1 3 7q-7-1-3-7" fill="#e8b7b0" />
    </g>}
    <path d="M42 132L40 126M47 132L49 128M110 132L113 125M116 133L119 130" stroke="#a9bb8c" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

function clockLabel(milliseconds: number) {
  const seconds = Math.ceil(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function FocusPanel({ focus, compact = false }: { focus: FocusController; compact?: boolean }) {
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const timer = focus.timer;
  const active = timer !== null;
  const paused = active && timer.endsAt === null;
  const progress = active ? Math.max(0, Math.min(1, 1 - focus.remaining / (timer.minutes * 60_000))) : 0;
  const circumference = 2 * Math.PI * 97;
  useEffect(() => { setConfirmAbandon(false); }, [timer?.id]);

  return <section className={`focus-panel${compact ? ' focus-panel-compact' : ''}`} aria-label="专注计时器">
    <div className="focus-panel-heading"><span className="focus-eyebrow"><Sprout size={16} /> {compact ? '专注计时' : '专注计时'}</span><span className={`focus-status${active && !paused ? ' is-running' : ''}`}>{active ? paused ? '已暂停' : '专注中' : '准备开始'}</span></div>
    <div className="focus-clock" aria-label={`剩余 ${clockLabel(focus.remaining)}`}>
      <svg className="focus-clock-ring" viewBox="0 0 214 214" aria-hidden="true"><circle cx="107" cy="107" r="97" fill="none" stroke="var(--focus-ring, #e1e7da)" strokeWidth="3" /><circle cx="107" cy="107" r="97" fill="none" stroke="#719070" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} transform="rotate(-90 107 107)" /></svg>
      <div className="focus-clock-content"><TreeArt tree={timer?.tree ?? focus.tree} progress={active ? progress : 0} miniature /><span className="focus-clock-digits" role="timer" aria-live="off">{clockLabel(focus.remaining)}</span><span className="focus-clock-caption">{paused ? '小树等你回来' : active ? '小树正在悄悄生长' : '完成后获得一棵树'}</span></div>
    </div>

    {active ? <div className="focus-current"><span className="focus-current-label">正在专注</span><strong title={timer.title}>{timer.title}</strong><span>{timer.minutes} 分钟 · 完成可获得 {timer.minutes} 枚叶子币</span></div> : <div className="focus-setup">
      <label className="focus-title-label" htmlFor={compact ? 'focus-title-small' : 'focus-title-large'}>专注任务</label>
      <input id={compact ? 'focus-title-small' : 'focus-title-large'} className="field focus-title-input" value={focus.title} maxLength={100} onChange={event => focus.setTitle(event.target.value)} placeholder="输入任务名称（可选）" onKeyDown={event => { if (event.key === 'Enter') focus.start(); }} />
      <div className="focus-duration-options" role="group" aria-label="选择专注时长">
        {[5, 25, 50].map(minutes => <button key={minutes} className={`focus-duration${focus.duration === minutes && !customDuration ? ' is-selected' : ''}`} onClick={() => { focus.setDuration(minutes); setCustomDuration(false); }} aria-pressed={focus.duration === minutes && !customDuration}>{minutes} <span>分钟</span></button>)}
        <button className={`focus-duration${customDuration || ![5, 25, 50].includes(focus.duration) ? ' is-selected' : ''}`} onClick={() => setCustomDuration(value => !value)} aria-expanded={customDuration}>自定</button>
      </div>
      {customDuration && <label className="focus-custom-duration">专注时长 <input className="field" type="number" min="1" max="180" step="1" value={Number.isNaN(focus.duration) ? '' : focus.duration} onChange={event => focus.setDuration(event.target.valueAsNumber)} /> 分钟 <span>1–180</span></label>}
      {!compact && <div className="focus-species" role="group" aria-label="选择要种的小树">{(['pine', 'oak', 'sakura'] as Tree[]).map(tree => <button key={tree} className={`focus-species-option${focus.tree === tree ? ' is-selected' : ''}`} onClick={() => focus.setTree(tree)} aria-pressed={focus.tree === tree}><TreeArt tree={tree} miniature /><span>{treeNames[tree]}<small>{treeDescriptions[tree]}</small></span>{focus.tree === tree && <Check size={14} />}</button>)}</div>}
    </div>}

    {confirmAbandon && active ? <div className="focus-abandon-confirm" role="alert"><p>结束这次专注？</p><span>本次不会获得小树和叶子币。</span><div><button className="btn btn-soft" onClick={() => setConfirmAbandon(false)}>继续专注</button><button className="btn focus-stop-btn" onClick={() => { focus.abandon(); setConfirmAbandon(false); }}>确认结束</button></div></div> : <div className="focus-actions">{active ? <><button className="btn btn-primary focus-start-btn" onClick={paused ? focus.resume : focus.pause}>{paused ? <Play size={16} fill="currentColor" /> : <Pause size={16} fill="currentColor" />}{paused ? '继续专注' : '暂停一下'}</button><button className="focus-end-btn" onClick={() => setConfirmAbandon(true)}>结束本次</button></> : <button className="btn btn-primary focus-start-btn" onClick={() => focus.start()}><Play size={15} fill="currentColor" /> 开始专注</button>}</div>}
    <p className="focus-gentle-note"><Leaf size={12} /> {compact ? '让每一分钟，都有生长的痕迹。' : '完成 1 分钟专注，收获 1 枚叶子币。'}</p>
  </section>;
}

export function ForestPage({ focus }: { focus: FocusController }) {
  const [rewardFormOpen, setRewardFormOpen] = useState(false);
  const [rewardTitle, setRewardTitle] = useState('');
  const [rewardCost, setRewardCost] = useState(30);
  const [showRedemptions, setShowRedemptions] = useState(false);

  return <div className="forest-page">
    <header className="forest-page-header"><div><div className="forest-page-kicker"><Leaf size={15} /> ONE MOMENT AT A TIME</div><h1>专注森林<span>。</span></h1><p>把每一次专注，种成一片森林。</p></div><div className="forest-balance"><span><Coins size={18} /> 我的叶子币</span><strong>{focus.coins}<small>枚</small></strong></div></header>
    <div className="forest-layout">
      <div className="forest-timer-column"><FocusPanel focus={focus} /><div className="forest-small-note"><Sparkles size={19} /><p>不必一下子做很多。<br /><strong>从好好度过这几分钟开始。</strong></p></div></div>
      <div className="forest-content-column">
        <ForestGarden focus={focus} />
        <section className="reward-shop" aria-labelledby="reward-title"><div className="forest-section-heading"><div><span className="forest-section-kicker">A LITTLE TREAT</span><h2 id="reward-title">我的奖励</h2></div><button className="reward-add" onClick={() => setRewardFormOpen(value => !value)} aria-expanded={rewardFormOpen}>{rewardFormOpen ? <X size={15} /> : <Plus size={15} />} {rewardFormOpen ? '收起' : '添加奖励'}</button></div><p className="reward-description">使用专注积累的叶币兑换奖励。</p>
          {rewardFormOpen && <form className="reward-form" onSubmit={event => { event.preventDefault(); if (focus.addReward(rewardTitle, rewardCost)) { setRewardTitle(''); setRewardFormOpen(false); } }}><label>奖励自己<input autoFocus className="field" placeholder="例如：去看一场电影" maxLength={80} required value={rewardTitle} onChange={event => setRewardTitle(event.target.value)} /></label><label>需要叶子币<input className="field" type="number" min={1} max={10000} required step={1} value={Number.isNaN(rewardCost) ? '' : rewardCost} onChange={event => setRewardCost(event.target.valueAsNumber)} /></label><button className="btn btn-primary" type="submit">保存奖励</button></form>}
          <div className="reward-list">{focus.rewards.map((reward, index) => <div className="reward-item" key={reward.id}><div className={`reward-item-icon reward-icon-${index % 3}`}>{index === 0 ? <Coffee size={21} strokeWidth={1.5} /> : index === 1 ? <Play size={19} strokeWidth={1.5} /> : <Gift size={21} strokeWidth={1.5} />}</div><div className="reward-item-text"><strong>{reward.title}</strong><span><Leaf size={12} /> {reward.cost} 枚叶子币</span></div><button className="reward-redeem" disabled={focus.coins < reward.cost} onClick={() => focus.redeem(reward.id)} aria-label={`兑换${reward.title}，需要 ${reward.cost} 枚叶子币`}>{focus.coins < reward.cost ? `还差 ${reward.cost - focus.coins}` : '兑换'}</button></div>)}</div>
          <button className="reward-history-toggle" onClick={() => setShowRedemptions(value => !value)} aria-expanded={showRedemptions}>奖励兑换记录 <span>{focus.redemptions.length}</span><ArrowUpRight size={13} /></button>
          {showRedemptions && <div className="reward-history">{focus.redemptions.length ? [...focus.redemptions].reverse().map(redemption => <div key={redemption.id}><span><Check size={13} />{redemption.title}</span><small>{new Date(redemption.redeemedAt).toLocaleDateString('zh-CN')} · −{redemption.cost} 币</small></div>) : <p>还没有兑换记录。你的下一份小奖励正在路上。</p>}</div>}
        </section>
      </div>
    </div>
    <div className="forest-bottom-note"><Timer size={13} /> 专注进度会自动保存，切换页面或稍后回来都能继续。</div>
  </div>;
}

