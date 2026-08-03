/**
 * Canvas上のポインタ操作を編集コマンドに変換する。
 *
 * iPad対応の要点:
 * - PointerEvent APIで指/Pencil/マウスを統一的に扱う（pointerType で判別）
 * - Apple Pencilは pointerType === 'pen'。筆圧(pressure)も取得可能だが今回は未使用。
 * - 指(touch)は1本指=スクロール操作、ツール選択中のタップ=配置、長押し=選択、として整理。
 * - Pencilは常に「精密配置/描画」優先（スクロールは2本指ジェスチャに譲る）。
 */
import { EditorStore } from '../core/store';
import { Note, NoteKind, Slide, TICKS_PER_BEAT } from '../core/chart';
import {
  computeMetrics, tickToY, yToTick, laneToX, xToLane, RenderMetrics,
} from './chartRenderer';

const TOOL_TO_KIND: Partial<Record<string, NoteKind>> = {
  placeTap: 'tap',
  placeCritical: 'critical',
  placeFlick: 'flick',
  placeCriticalFlick: 'criticalFlick',
  placeTrace: 'trace',
  placeCriticalTrace: 'criticalTrace',
  placeFriction: 'friction',
  placeCriticalFriction: 'criticalFriction',
  placeDamage: 'damage',
};

interface DragState {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  mode: 'scroll' | 'placeDrag' | 'selectDrag' | 'moveDrag' | 'slideDraw';
  startScrollTick: number;
  movedNoteIds?: string[];
  moveOriginalPositions?: Map<string, { tick: number; lane: number }>;
}

export class InteractionController {
  private canvas: HTMLCanvasElement;
  private store: EditorStore;
  private drag: DragState | null = null;
  private slideDraftPoints: { tick: number; lane: number; width: number }[] = [];
  private onRequestRedraw: () => void;

  constructor(canvas: HTMLCanvasElement, store: EditorStore, onRequestRedraw: () => void) {
    this.canvas = canvas;
    this.store = store;
    this.onRequestRedraw = onRequestRedraw;
    this.attach();
  }

  private attach() {
    this.canvas.style.touchAction = 'none'; // ブラウザ標準のスクロール/ズームを無効化し、独自ハンドリング
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  /** 論理サイズ（CSS px）。canvas.width/height は DPR 倍された物理px なのでここでは使わない。 */
  private getLogicalSize(): { width: number; height: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  private getMetrics(): RenderMetrics {
    const { width, height } = this.getLogicalSize();
    return computeMetrics(width, height, this.store.getState().view);
  }

  /** ポインタのクライアント座標を、canvas左上を原点とした論理px座標に変換する */
  private localPos(ev: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ev.clientX - rect.left,
      y: ev.clientY - rect.top,
    };
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.canvas.setPointerCapture(ev.pointerId);
    const { x, y } = this.localPos(ev);
    const state = this.store.getState();
    const metrics = this.getMetrics();
    const tick = this.store.snapTick(yToTick(y, state.view, this.getLogicalSize().height));
    const lane = Math.round(xToLane(x, metrics, state.view.laneWidthPx) * 2) / 2;

    const isPencil = ev.pointerType === 'pen';
    const isTouch = ev.pointerType === 'touch';

    // 指1本での操作は「ツールが select ならスクロール優先」「配置ツール中ならタップ配置」
    if (state.tool === 'select') {
      if (isTouch) {
        this.drag = {
          pointerId: ev.pointerId, pointerType: ev.pointerType,
          startX: x, startY: y, mode: 'scroll', startScrollTick: state.view.scrollTick,
        };
        return;
      }
      // Pencilやマウスでselectモード: 既存ノーツヒットテスト→選択/移動
      const hit = this.hitTestNote(x, y);
      if (hit) {
        this.store.setSelection([hit.id]);
        this.drag = {
          pointerId: ev.pointerId, pointerType: ev.pointerType,
          startX: x, startY: y, mode: 'moveDrag', startScrollTick: state.view.scrollTick,
          movedNoteIds: [hit.id],
          moveOriginalPositions: new Map([[hit.id, { tick: hit.tick, lane: hit.lane }]]),
        };
      } else {
        this.store.clearSelection();
      }
      return;
    }

    if (state.tool === 'drawSlide' || state.tool === 'drawCriticalSlide') {
      this.slideDraftPoints = [{ tick, lane, width: 1 }];
      this.drag = {
        pointerId: ev.pointerId, pointerType: ev.pointerType,
        startX: x, startY: y, mode: 'slideDraw', startScrollTick: state.view.scrollTick,
      };
      this.onRequestRedraw();
      return;
    }

    // ノーツ配置ツール
    const kind = TOOL_TO_KIND[state.tool];
    if (kind) {
      this.placeSingleNote(tick, Math.max(0, lane), kind);
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (!this.drag || this.drag.pointerId !== ev.pointerId) return;
    const { x, y } = this.localPos(ev);
    const state = this.store.getState();
    const metrics = this.getMetrics();

    if (this.drag.mode === 'scroll') {
      const deltaY = y - this.drag.startY;
      const deltaBeat = deltaY / state.view.pixelsPerBeat;
      const newScroll = Math.max(0, this.drag.startScrollTick - deltaBeat * TICKS_PER_BEAT);
      this.store.setView({ scrollTick: newScroll });
      return;
    }

    if (this.drag.mode === 'moveDrag' && this.drag.movedNoteIds) {
      const tick = this.store.snapTick(yToTick(y, state.view, this.getLogicalSize().height));
      const lane = Math.round(xToLane(x, metrics, state.view.laneWidthPx) * 2) / 2;
      const id = this.drag.movedNoteIds[0];
      this.store.mutateChart(chart => {
        const note = chart.singleNotes.find(n => n.id === id);
        if (note) { note.tick = Math.max(0, tick); note.lane = Math.max(0, lane); }
        for (const s of chart.slides) {
          const n = s.notes.find(nn => nn.id === id);
          if (n) { n.tick = Math.max(0, tick); n.lane = Math.max(0, lane); }
        }
      });
      return;
    }

    if (this.drag.mode === 'slideDraw') {
      const tick = this.store.snapTick(yToTick(y, state.view, this.getLogicalSize().height));
      const lane = Math.round(xToLane(x, metrics, state.view.laneWidthPx) * 2) / 2;
      const last = this.slideDraftPoints[this.slideDraftPoints.length - 1];
      if (!last || last.tick !== tick || last.lane !== lane) {
        this.slideDraftPoints.push({ tick, lane, width: 1 });
        this.onRequestRedraw();
      }
      return;
    }
  };

  private onPointerUp = (ev: PointerEvent) => {
    if (!this.drag || this.drag.pointerId !== ev.pointerId) return;

    if (this.drag.mode === 'slideDraw') {
      this.finalizeSlideDraft();
    }

    this.drag = null;
  };

  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const state = this.store.getState();
    const deltaBeat = ev.deltaY / state.view.pixelsPerBeat;
    const newScroll = Math.max(0, state.view.scrollTick + deltaBeat * TICKS_PER_BEAT);
    this.store.setView({ scrollTick: newScroll });
  };

  private placeSingleNote(tick: number, lane: number, kind: NoteKind) {
    const flick = kind === 'flick' || kind === 'criticalFlick' ? 'up' : undefined;
    this.store.mutateChart(chart => {
      chart.singleNotes.push({
        id: crypto.randomUUID(),
        tick, lane, width: 1, kind, flick,
      });
    });
  }

  private finalizeSlideDraft() {
    if (this.slideDraftPoints.length < 2) {
      this.slideDraftPoints = [];
      this.onRequestRedraw();
      return;
    }
    const state = this.store.getState();
    const critical = state.tool === 'drawCriticalSlide';
    const sorted = [...this.slideDraftPoints].sort((a, b) => a.tick - b.tick);

    const notes: Note[] = sorted.map((p, idx) => ({
      id: crypto.randomUUID(),
      tick: p.tick,
      lane: Math.max(0, p.lane),
      width: p.width,
      kind: idx === 0 || idx === sorted.length - 1 ? (critical ? 'critical' : 'tap') : 'anchor',
      ease: 'linear',
    }));

    this.store.mutateChart(chart => {
      chart.slides.push({ id: crypto.randomUUID(), critical, notes });
    });

    this.slideDraftPoints = [];
    this.onRequestRedraw();
  }

  getSlideDraftPoints() {
    return this.slideDraftPoints;
  }

  clearSlideDraft() {
    this.slideDraftPoints = [];
    this.onRequestRedraw();
  }

  private hitTestNote(x: number, y: number): Note | null {
    const state = this.store.getState();
    const metrics = this.getMetrics();
    const tolerance = 12;

    for (const n of state.chart.singleNotes) {
      const ny = tickToY(n.tick, state.view, this.getLogicalSize().height);
      const nx = laneToX(n.lane, metrics, state.view.laneWidthPx);
      const nw = n.width * state.view.laneWidthPx;
      if (x >= nx - tolerance && x <= nx + nw + tolerance && Math.abs(y - ny) <= tolerance) {
        return n;
      }
    }
    for (const s of state.chart.slides) {
      for (const n of s.notes) {
        const ny = tickToY(n.tick, state.view, this.getLogicalSize().height);
        const nx = laneToX(n.lane, metrics, state.view.laneWidthPx);
        const nw = n.width * state.view.laneWidthPx;
        if (x >= nx - tolerance && x <= nx + nw + tolerance && Math.abs(y - ny) <= tolerance) {
          return n;
        }
      }
    }
    return null;
  }
}
