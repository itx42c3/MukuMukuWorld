/**
 * 左サイドの「ノーツパレット」と上部ツールバーのDOM構築。
 * MikuMikuWorldの左パレット踏襲: ノーツ種をボタン一覧で並べ、選択中をハイライト。
 */
import { EditorStore, ToolMode } from '../core/store';
import { NOTE_STYLES } from './noteStyles';
import { NoteKind } from '../core/chart';

const PALETTE_ITEMS: { tool: ToolMode; kind?: NoteKind }[] = [
  { tool: 'select' },
  { tool: 'placeTap', kind: 'tap' },
  { tool: 'placeCritical', kind: 'critical' },
  { tool: 'placeFlick', kind: 'flick' },
  { tool: 'placeCriticalFlick', kind: 'criticalFlick' },
  { tool: 'placeTrace', kind: 'trace' },
  { tool: 'placeCriticalTrace', kind: 'criticalTrace' },
  { tool: 'placeFriction', kind: 'friction' },
  { tool: 'placeCriticalFriction', kind: 'criticalFriction' },
  { tool: 'placeDamage', kind: 'damage' },
  { tool: 'drawSlide' },
  { tool: 'drawCriticalSlide' },
];

const TOOL_LABELS: Record<ToolMode, string> = {
  select: '選択 / 移動',
  placeTap: 'タップ',
  placeCritical: 'クリティカル',
  placeFlick: 'フリック',
  placeCriticalFlick: 'Cフリック',
  placeTrace: 'トレース',
  placeCriticalTrace: 'Cトレース',
  placeFriction: 'フリクション',
  placeCriticalFriction: 'Cフリクション',
  placeDamage: 'ダメージ',
  drawSlide: 'スライド作成',
  drawCriticalSlide: 'Cスライド作成',
};

export function buildPalette(container: HTMLElement, store: EditorStore) {
  container.innerHTML = '';
  container.className = 'palette';

  for (const item of PALETTE_ITEMS) {
    const btn = document.createElement('button');
    btn.className = 'palette-btn';
    btn.dataset.tool = item.tool;

    const swatch = document.createElement('span');
    swatch.className = 'palette-swatch';
    if (item.kind) {
      swatch.style.background = NOTE_STYLES[item.kind].fill;
      swatch.style.borderColor = NOTE_STYLES[item.kind].stroke;
    } else if (item.tool === 'select') {
      swatch.classList.add('palette-swatch--select');
    } else {
      swatch.classList.add('palette-swatch--slide');
    }

    const label = document.createElement('span');
    label.className = 'palette-label';
    label.textContent = TOOL_LABELS[item.tool];

    btn.appendChild(swatch);
    btn.appendChild(label);
    btn.addEventListener('click', () => store.setTool(item.tool));
    container.appendChild(btn);
  }

  const refresh = () => {
    const current = store.getState().tool;
    container.querySelectorAll<HTMLButtonElement>('.palette-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === current);
    });
  };
  store.subscribe(refresh);
  refresh();
}
