import { useId } from 'react';
import type { FocusSession, Tree } from './model';
import './forest-scene.css';

export interface ForestSceneProps {
  /** The current page, ordered oldest first. The parent owns pagination. */
  sessions: FocusSession[];
  activeTree?: { tree: Tree; progress: number };
  onSelect: (session: FocusSession) => void;
  selectedId?: string;
}

const treeNames: Record<Tree, string> = { pine: '松树', oak: '橡树', sakura: '樱花树' };
const plantingSlots = Array.from({ length: 36 }, (_, index) => {
  const row = Math.floor(index / 6), column = index % 6;
  return { row, column, distance: Math.abs(row - 2.5) + Math.abs(column - 2.5) };
}).sort((a, b) => a.distance - b.distance || a.row + a.column - b.row - b.column || a.row - b.row)
  .map(({ row, column }) => ({ x: 310 + (column - row) * 42, y: 120 + (row + column) * 17 }));

function treeScale(id: string) {
  let hash = 0;
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return 0.78 + (hash % 13) / 100;
}

function sessionLabel(session: FocusSession) {
  const date = new Date(session.completedAt);
  const dateLabel = Number.isNaN(date.getTime()) ? '日期未知' : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  return `${session.title.trim() || '未命名专注'}，${treeNames[session.tree]}，${session.minutes} 分钟，${dateLabel}`;
}

function TreeDefinitions({ prefix }: { prefix: string }) {
  return <defs>
    <linearGradient id={`${prefix}-ground`} x1=".16" y1="0" x2=".85" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stopColor="#e3e9d7" /><stop offset=".5" stopColor="#d5dfc7" /><stop offset="1" stopColor="#c2d0b3" />
    </linearGradient>
    <linearGradient id={`${prefix}-soil-left`} x1="0" y1="0" x2="1" y2="1">
      <stop stopColor="#b5bfaa" /><stop offset="1" stopColor="#95a48e" />
    </linearGradient>
    <linearGradient id={`${prefix}-soil-right`} x1="0" y1="0" x2="0" y2="1">
      <stop stopColor="#a4b19a" /><stop offset="1" stopColor="#869981" />
    </linearGradient>
    <radialGradient id={`${prefix}-island-shadow`}>
      <stop stopColor="#66778e" stopOpacity=".18" /><stop offset="1" stopColor="#66778e" stopOpacity="0" />
    </radialGradient>
    <radialGradient id={`${prefix}-tree-shadow`}>
      <stop stopColor="#536c4e" stopOpacity=".2" /><stop offset="1" stopColor="#536c4e" stopOpacity="0" />
    </radialGradient>
    <g id={`${prefix}-pine`}>
      <path d="M-3-21H3L4 1H-4Z" fill="#896d53" />
      <path d="M0-21H3L4 1H0Z" fill="#b3946b" />
      <path d="M0-76L16-49H10L23-30H15L29-12Q0 1-29-12L-15-30H-23L-10-49H-16Z" fill="#5c835f" />
      <path d="M0-76V-5Q-16-7-29-12L-15-30H-23L-10-49H-16Z" fill="#42694f" />
      <path d="M0-76L16-49L0-44Z" fill="#8ba676" />
      <path d="M0-48L23-30L0-24Z" fill="#749666" />
      <path d="M0-29L29-12Q15-7 0-5Z" fill="#759a69" />
      <path d="M-12-49L0-44L12-49M-19-30L0-24L19-30" fill="none" stroke="#a3bd88" strokeWidth="1" opacity=".48" />
    </g>
    <g id={`${prefix}-oak`}>
      <path d="M-4 1L-2-41H3L5 1Z" fill="#927457" />
      <path d="M1-21L-12-36M2-27L17-43" fill="none" stroke="#927457" strokeWidth="4" strokeLinecap="round" />
      <circle cx="-16" cy="-33" r="16" fill="#73936a" />
      <circle cx="16" cy="-36" r="18" fill="#93b17d" />
      <circle cx="0" cy="-50" r="18" fill="#adc38d" />
      <circle cx="-5" cy="-35" r="20" fill="#88a874" />
      <path d="M-23-35Q-19-17-2-15Q11-15 15-23Q-9-15-23-35Z" fill="#6f9364" />
      <path d="M-8-61Q4-70 13-58" fill="none" stroke="#c6d7a8" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      <path d="M2-16V-33M2-25L-8-33M2-25L12-35" fill="none" stroke="#64845b" strokeWidth="1.5" strokeLinecap="round" />
    </g>
    <g id={`${prefix}-sakura`}>
      <path d="M-3 1L-2-37H3L4 1Z" fill="#977663" />
      <path d="M0-18L-13-35M1-22L17-39" fill="none" stroke="#977663" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="-17" cy="-32" r="16" fill="#c992a6" />
      <circle cx="17" cy="-34" r="17" fill="#e4b8c5" />
      <circle cx="0" cy="-49" r="19" fill="#edc8d1" />
      <circle cx="-2" cy="-33" r="19" fill="#dbabbd" />
      <path d="M-24-33Q-19-16-3-15Q8-15 14-22Q-7-17-24-33Z" fill="#c98fa6" />
      <g fill="#fff0f3" opacity=".85"><circle cx="-8" cy="-52" r="2" /><circle cx="8" cy="-43" r="2.1" /><circle cx="-19" cy="-34" r="1.7" /><circle cx="14" cy="-29" r="1.6" /><circle cx="-1" cy="-29" r="1.7" /></g>
      <path d="M21-8Q26-9 24-4Q20-3 21-8" fill="#dfb1c1" />
    </g>
    <g id={`${prefix}-sprout`}>
      <path d="M0 1V-17" fill="none" stroke="#708b5f" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M0-9C-11-9-16-15-13-22C-4-22 1-16 0-9Z" fill="#769967" />
      <path d="M0-14C-1-25 5-31 14-28C15-20 8-13 0-14Z" fill="#a7bd83" />
      <path d="M-9-18L0-10M9-25L0-15" stroke="#638352" strokeWidth=".8" fill="none" />
    </g>
  </defs>;
}

/** Stable slots are assigned before depth sorting, so adding a session never moves existing trees. */
export default function ForestScene({ sessions, activeTree, onSelect, selectedId }: ForestSceneProps) {
  const prefix = `nest-forest-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const records = sessions.slice(0, 36);
  const progress = activeTree ? Math.max(0, Math.min(1, Number.isFinite(activeTree.progress) ? activeTree.progress : 0)) : 0;
  const progressPercent = Math.round(progress * 100);
  const sceneItems = records.map((session, index) => ({ session, index, ...plantingSlots[index] }));
  const previewSlot = plantingSlots[records.length] || { x: 310, y: 321 };
  const empty = records.length === 0 && !activeTree;
  const sceneLabel = `专注森林，当前展示 ${records.length} 棵已完成的小树${activeTree ? '，另有一棵正在生长' : ''}`;
  const ordered = [...sceneItems.map(item => ({ ...item, preview: false as const })),
    ...(activeTree ? [{ session: null, index: records.length, ...previewSlot, preview: true as const }] : [])]
    .sort((a, b) => a.y - b.y || a.x - b.x);

  return <div className={`forest-scene${empty ? ' is-empty' : ''}`}>
    <svg className="forest-scene-canvas" viewBox="0 0 620 370" role="group" aria-label={sceneLabel} aria-describedby={`${prefix}-description`}>
      <desc id={`${prefix}-description`}>{empty ? '这片空地还没有完成的专注记录。虚线幼苗标记表示下一处种植位置。' : '每棵树对应一次已完成的专注。点击小树，或使用 Tab 选择小树后按 Enter 或空格，查看这次记录。正在生长的预览不计入已完成小树。'}</desc>
      <TreeDefinitions prefix={prefix} />
      <g aria-hidden="true" className="forest-scene-land">
        <ellipse cx="310" cy="324" rx="263" ry="43" fill={`url(#${prefix}-island-shadow)`} />
        <path d="M49 213L310 338V354L49 229Z" fill={`url(#${prefix}-soil-left)`} />
        <path d="M310 338L571 213V229L310 354Z" fill={`url(#${prefix}-soil-right)`} />
        <path d="M310 88L571 213L310 338L49 213Z" fill={`url(#${prefix}-ground)`} />
        <path d="M49 213L310 88L571 213" fill="none" stroke="#f3f6e9" strokeWidth="1.5" opacity=".85" />
        <path d="M50 213L310 338L571 213" fill="none" stroke="#aebda0" strokeWidth="1.2" opacity=".7" />
        <path d="M50 222L310 347L569 223" fill="none" stroke="#dae1ce" strokeWidth=".75" opacity=".25" />
        <path d="M104 214Q169 202 201 228T301 267T424 282" fill="none" stroke="#e8ecd9" strokeWidth="9" opacity=".38" strokeLinecap="round" />
        <g fill="#afbea0" opacity=".37"><ellipse cx="277" cy="126" rx="11" ry="4" /><ellipse cx="155" cy="217" rx="13" ry="5" /><ellipse cx="401" cy="274" rx="14" ry="5" /><ellipse cx="450" cy="210" rx="9" ry="3" /></g>
        <g fill="#e4e8dc"><ellipse cx="105" cy="217" rx="5" ry="2.7" /><ellipse cx="114" cy="221" rx="2.8" ry="1.7" /><ellipse cx="467" cy="235" rx="5.5" ry="3" /></g>
        <g stroke="#99ae88" strokeWidth="1.2" strokeLinecap="round" opacity=".6"><path d="M235 295L232 290M235 295V288M235 295L239 291M498 212L495 207M498 212L501 206M246 131L243 127M246 131L249 125" /></g>
      </g>
      {empty && <g className="forest-scene-empty-plot" aria-hidden="true" transform="translate(310 217)">
        <ellipse rx="30" ry="13" fill="#eef3e333" stroke="#91a98a" strokeWidth="1.2" strokeDasharray="4 4" />
        <path d="M0 0V-15M0-8Q-14-8-13-20Q0-20 0-8M0-12Q-1-27 13-25Q14-13 0-12" fill="none" stroke="#7f9a77" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2.5 3" />
      </g>}
      {ordered.map(item => {
        if (item.preview && activeTree) {
          const previewScale = progress < .28 ? .88 : .4 + progress * .45;
          return <g key="active-preview" className="forest-scene-preview" transform={`translate(${item.x} ${item.y})`} role="img" aria-label={`正在生长的${treeNames[activeTree.tree]}，进度 ${progressPercent}%，尚未计入已完成森林`}>
            <title>{`正在生长 · ${progressPercent}% · 完成后计入森林`}</title>
            <ellipse className="forest-scene-preview-ring" rx="22" ry="9" />
            <g className="forest-scene-preview-art" transform={`scale(${previewScale})`}><use href={`#${prefix}-${progress < .28 ? 'sprout' : activeTree.tree}`} /></g>
          </g>;
        }
        if (!item.session) return null;
        const session = item.session, label = sessionLabel(session), selected = selectedId === session.id;
        return <g key={session.id} className={`forest-scene-tree${selected ? ' is-selected' : ''}`} data-session-id={session.id} data-slot={item.index} transform={`translate(${item.x} ${item.y})`} role="button" tabIndex={0} aria-label={label} aria-pressed={selected}
          onClick={() => onSelect(session)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!event.repeat) onSelect(session); } }}>
          <title>{label}</title>
          <ellipse className="forest-scene-tree-hit" cx="0" cy="-27" rx="25" ry="38" fill="transparent" />
          <ellipse cx="4" cy="3" rx="28" ry="10" fill={`url(#${prefix}-tree-shadow)`} aria-hidden="true" />
          <ellipse className="forest-scene-selection" rx="22" ry="9" aria-hidden="true" />
          <g className="forest-scene-tree-art" aria-hidden="true"><g transform={`scale(${treeScale(session.id)})`}><use href={`#${prefix}-${session.tree}`} /></g></g>
        </g>;
      })}
    </svg>
  </div>;
}
