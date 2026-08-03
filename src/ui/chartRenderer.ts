/**
 * 譜面のCanvas描画エンジン。
 * 縦流し（下から上、またはMMWS同様に下が過去・上が未来）でレーンを描画する。
 * 座標系:
 *   - Y軸: tick を pixelsPerBeat でピクセル変換し、下(過去=大tick)→上(未来=小tick)ではなく
 *          MikuMikuWorld踏襲で「下から上に進行」= 下ほどtickが小さい(過去)、上ほど大きい(未来)
 *   - X軸: lane(0〜LANE_COUNT) を laneWidthPx でピクセル変換
 */
import { Chart, Note, NoteKind, Slide, TICKS_PER_BEAT, LANE_COUNT } from '../core/chart';
import { ViewState, SelectionState } from '../core/store';
import {
  NOTE_STYLES, LANE_BG_COLOR, LANE_LINE_COLOR, MEASURE_LINE_COLOR, BEAT_LINE_COLOR,
  SLIDE_PATH_COLOR_NORMAL, SLIDE_PATH_COLOR_CRITICAL, PLAYHEAD_COLOR, BPM_LINE_COLOR,
  SELECTION_COLOR,
} from './noteStyles';

export interface RenderMetrics {
  canvasWidth: number;
  canvasHeight: number;
  laneAreaLeft: number;   // レーン描画の左端px
  laneAreaWidth: number;  // レーン描画の全幅px
}

/**
 * 論理サイズ（CSS px、devicePixelRatio適用前）を受け取ってメトリクスを計算する。
 * canvas.width/height は物理px（dpr倍）になっているため、ここでは使わない。
 */
export function computeMetrics(logicalWidth: number, logicalHeight: number, view: ViewState): RenderMetrics {
  const laneAreaWidth = LANE_COUNT * view.laneWidthPx;
  const laneAreaLeft = (logicalWidth - laneAreaWidth) / 2;
  return { canvasWidth: logicalWidth, canvasHeight: logicalHeight, laneAreaLeft, laneAreaWidth };
}

/** tick → キャンバスY座標（下ほど過去、上ほど未来） */
export function tickToY(tick: number, view: ViewState, canvasHeight: number): number {
  const relBeat = (tick - view.scrollTick) / TICKS_PER_BEAT;
  return canvasHeight - relBeat * view.pixelsPerBeat - 40; // 下端40pxのマージン
}

export function yToTick(y: number, view: ViewState, canvasHeight: number): number {
  const relBeat = (canvasHeight - y - 40) / view.pixelsPerBeat;
  return view.scrollTick + relBeat * TICKS_PER_BEAT;
}

export function laneToX(lane: number, metrics: RenderMetrics, laneWidthPx: number): number {
  return metrics.laneAreaLeft + lane * laneWidthPx;
}

export function xToLane(x: number, metrics: RenderMetrics, laneWidthPx: number): number {
  return (x - metrics.laneAreaLeft) / laneWidthPx;
}

export function render(
  ctx: CanvasRenderingContext2D,
  logicalWidth: number,
  logicalHeight: number,
  chart: Chart,
  view: ViewState,
  selection: SelectionState,
  slideDraft?: { tick: number; lane: number; width: number }[],
) {
  const metrics = computeMetrics(logicalWidth, logicalHeight, view);
  const { canvasWidth, canvasHeight, laneAreaLeft, laneAreaWidth } = metrics;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // 背景
  ctx.fillStyle = '#101017';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  ctx.fillStyle = LANE_BG_COLOR;
  ctx.fillRect(laneAreaLeft, 0, laneAreaWidth, canvasHeight);

  // 表示範囲のtick計算
  const topTick = yToTick(0, view, canvasHeight);
  const bottomTick = yToTick(canvasHeight, view, canvasHeight);

  drawGridLines(ctx, chart, view, metrics, canvasHeight, bottomTick, topTick);
  drawLaneLines(ctx, metrics, canvasHeight);
  drawBpmMarkers(ctx, chart, view, metrics, canvasHeight, bottomTick, topTick);
  drawSlides(ctx, chart, view, metrics, canvasHeight, selection);
  drawSingleNotes(ctx, chart, view, metrics, canvasHeight, selection);
  if (slideDraft && slideDraft.length > 0) {
    drawSlideDraft(ctx, slideDraft, view, metrics, canvasHeight);
  }
  drawPlayhead(ctx, view, metrics, canvasHeight);
}

function drawSlideDraft(
  ctx: CanvasRenderingContext2D,
  points: { tick: number; lane: number; width: number }[],
  view: ViewState, metrics: RenderMetrics, canvasHeight: number,
) {
  const sorted = [...points].sort((a, b) => a.tick - b.tick);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  sorted.forEach((p, i) => {
    const x = laneToX(p.lane + p.width / 2, metrics, view.laneWidthPx);
    const y = tickToY(p.tick, view, canvasHeight);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  for (const p of sorted) {
    const x = laneToX(p.lane + p.width / 2, metrics, view.laneWidthPx);
    const y = tickToY(p.tick, view, canvasHeight);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawLaneLines(ctx: CanvasRenderingContext2D, metrics: RenderMetrics, canvasHeight: number) {
  ctx.strokeStyle = LANE_LINE_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= LANE_COUNT; i++) {
    const x = metrics.laneAreaLeft + i * (metrics.laneAreaWidth / LANE_COUNT);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight);
    ctx.stroke();
  }
}

function drawGridLines(
  ctx: CanvasRenderingContext2D, chart: Chart, view: ViewState, metrics: RenderMetrics,
  canvasHeight: number, bottomTick: number, topTick: number,
) {
  // 拍線・小節線を、拍子イベントを考慮しつつ単純化して4/4基準の等間隔で描く
  const beatTicks = TICKS_PER_BEAT;
  const startBeatIdx = Math.floor(bottomTick / beatTicks) - 1;
  const endBeatIdx = Math.ceil(topTick / beatTicks) + 1;

  for (let i = startBeatIdx; i <= endBeatIdx; i++) {
    const tick = i * beatTicks;
    const y = tickToY(tick, view, canvasHeight);
    const isMeasure = i % 4 === 0;
    ctx.strokeStyle = isMeasure ? MEASURE_LINE_COLOR : BEAT_LINE_COLOR;
    ctx.lineWidth = isMeasure ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(metrics.laneAreaLeft, y);
    ctx.lineTo(metrics.laneAreaLeft + metrics.laneAreaWidth, y);
    ctx.stroke();

    if (isMeasure) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(String(Math.floor(i / 4) + 1), metrics.laneAreaLeft - 28, y + 4);
    }
  }
}

function drawBpmMarkers(
  ctx: CanvasRenderingContext2D, chart: Chart, view: ViewState, metrics: RenderMetrics,
  canvasHeight: number, bottomTick: number, topTick: number,
) {
  ctx.font = '10px "JetBrains Mono", monospace';
  for (const b of chart.bpmEvents) {
    if (b.tick < bottomTick - TICKS_PER_BEAT * 8 || b.tick > topTick + TICKS_PER_BEAT * 8) continue;
    const y = tickToY(b.tick, view, canvasHeight);
    ctx.strokeStyle = BPM_LINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(metrics.laneAreaLeft, y);
    ctx.lineTo(metrics.laneAreaLeft + metrics.laneAreaWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = BPM_LINE_COLOR;
    ctx.fillText(`♩=${b.bpm}`, metrics.laneAreaLeft + metrics.laneAreaWidth + 6, y + 3);
  }
}

function noteRect(n: Note, view: ViewState, metrics: RenderMetrics, canvasHeight: number) {
  const y = tickToY(n.tick, view, canvasHeight);
  const x = laneToX(n.lane, metrics, view.laneWidthPx);
  const w = n.width * view.laneWidthPx;
  const h = 16;
  return { x, y: y - h / 2, w, h };
}

function drawSingleNotes(
  ctx: CanvasRenderingContext2D, chart: Chart, view: ViewState, metrics: RenderMetrics,
  canvasHeight: number, selection: SelectionState,
) {
  for (const n of chart.singleNotes) {
    const { x, y, w, h } = noteRect(n, view, metrics, canvasHeight);
    if (y < -20 || y > canvasHeight + 20) continue;
    drawNoteShape(ctx, n, x, y, w, h, selection.noteIds.has(n.id));
  }
}

function drawSlides(
  ctx: CanvasRenderingContext2D, chart: Chart, view: ViewState, metrics: RenderMetrics,
  canvasHeight: number, selection: SelectionState,
) {
  for (const s of chart.slides) {
    const pts = s.notes.map(n => {
      const y = tickToY(n.tick, view, canvasHeight);
      const cx = laneToX(n.lane + n.width / 2, metrics, view.laneWidthPx);
      const leftX = laneToX(n.lane, metrics, view.laneWidthPx);
      const rightX = laneToX(n.lane + n.width, metrics, view.laneWidthPx);
      return { leftX, rightX, cx, y, note: n };
    });

    // 経路（帯状）描画
    ctx.fillStyle = s.critical ? SLIDE_PATH_COLOR_CRITICAL : SLIDE_PATH_COLOR_NORMAL;
    ctx.beginPath();
    ctx.moveTo(pts[0].leftX, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].leftX, pts[i].y);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].rightX, pts[i].y);
    ctx.closePath();
    ctx.fill();

    // 端点・中継点ノーツ
    for (let i = 0; i < s.notes.length; i++) {
      const n = s.notes[i];
      const isEdge = i === 0 || i === s.notes.length - 1;
      const { x, y, w, h } = noteRect(n, view, metrics, canvasHeight);
      if (y < -20 || y > canvasHeight + 20) continue;
      const kind: NoteKind = isEdge ? (s.critical ? 'critical' : 'tap') : 'anchor';
      const selected = selection.noteIds.has(n.id) || selection.slideIds.has(s.id);
      drawNoteShape(ctx, { ...n, kind }, x, y, w, isEdge ? h : h * 0.5, selected, !isEdge);
    }
  }
}

function drawNoteShape(
  ctx: CanvasRenderingContext2D, n: Note, x: number, y: number, w: number, h: number,
  selected: boolean, small = false,
) {
  const style = NOTE_STYLES[n.kind];
  const radius = small ? 3 : 5;

  ctx.save();
  if (n.hidden) ctx.globalAlpha = 0.35;

  ctx.fillStyle = style.fill;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();

  ctx.strokeStyle = selected ? SELECTION_COLOR : style.stroke;
  ctx.lineWidth = selected ? 3 : 1.5;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();

  if (!small) {
    ctx.fillStyle = style.textColor;
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(style.shortLabel, x + w / 2, y + h / 2 + 3);
    ctx.textAlign = 'left';

    if (n.kind === 'flick' || n.kind === 'criticalFlick') {
      drawFlickArrow(ctx, x + w / 2, y - 4, n.flick ?? 'up', style.fill);
    }
  }
  ctx.restore();
}

function drawFlickArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: string, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  const angle = dir === 'left' ? Math.PI : dir === 'right' ? 0 : -Math.PI / 2;
  if (dir === 'up') {
    // 上向きはそのまま
  } else if (dir !== 'left' && dir !== 'right') {
    ctx.rotate(-Math.PI / 2);
  } else {
    ctx.rotate(dir === 'left' ? Math.PI : 0);
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5, 0);
  ctx.lineTo(-5, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPlayhead(ctx: CanvasRenderingContext2D, view: ViewState, metrics: RenderMetrics, canvasHeight: number) {
  const y = tickToY(view.currentTick, view, canvasHeight);
  if (y < -10 || y > canvasHeight + 10) return;
  ctx.strokeStyle = PLAYHEAD_COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(metrics.laneAreaLeft - 8, y);
  ctx.lineTo(metrics.laneAreaLeft + metrics.laneAreaWidth + 8, y);
  ctx.stroke();

  ctx.fillStyle = PLAYHEAD_COLOR;
  ctx.beginPath();
  ctx.moveTo(metrics.laneAreaLeft - 8, y);
  ctx.lineTo(metrics.laneAreaLeft - 2, y - 5);
  ctx.lineTo(metrics.laneAreaLeft - 2, y + 5);
  ctx.closePath();
  ctx.fill();
}
