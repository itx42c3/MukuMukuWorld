/**
 * 譜面エディタの中心的な状態管理。
 * Undo/Redoはスナップショット方式（譜面規模的にJSON差分より単純な方が堅牢なため）。
 */
import { Chart, createEmptyChart } from './chart';

export type ToolMode =
  | 'select'
  | 'placeTap' | 'placeCritical'
  | 'placeFlick' | 'placeCriticalFlick'
  | 'placeTrace' | 'placeCriticalTrace'
  | 'placeFriction' | 'placeCriticalFriction'
  | 'placeDamage'
  | 'drawSlide' | 'drawCriticalSlide';

export interface ViewState {
  scrollTick: number;      // 現在表示中の先頭ティック
  pixelsPerBeat: number;   // ズーム(縦)
  laneWidthPx: number;     // ズーム(横、レーン1本あたりのpx)
  snapDivisor: number;     // スナップ分解能（1/4, 1/8, 1/16...）
  currentTick: number;     // 再生ヘッド位置
}

export interface SelectionState {
  noteIds: Set<string>;
  slideIds: Set<string>;
}

export interface EditorState {
  chart: Chart;
  view: ViewState;
  selection: SelectionState;
  tool: ToolMode;
  isPlaying: boolean;
  isDirty: boolean;
  activeSlideDraft: { critical: boolean; ticks: { tick: number; lane: number; width: number }[] } | null;
}

type Listener = () => void;

export class EditorStore {
  private state: EditorState;
  private undoStack: Chart[] = [];
  private redoStack: Chart[] = [];
  private listeners: Set<Listener> = new Set();
  private readonly maxHistory = 100;

  constructor() {
    this.state = {
      chart: createEmptyChart(),
      view: {
        scrollTick: 0,
        pixelsPerBeat: 80,
        laneWidthPx: 48,
        snapDivisor: 4,
        currentTick: 0,
      },
      selection: { noteIds: new Set(), slideIds: new Set() },
      tool: 'select',
      isPlaying: false,
      isDirty: false,
      activeSlideDraft: null,
    };
  }

  getState(): EditorState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** 譜面を書き換える操作の前に呼び、Undoスタックに積む */
  private pushHistory() {
    this.undoStack.push(structuredClone(this.state.chart));
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
  }

  mutateChart(fn: (chart: Chart) => void) {
    this.pushHistory();
    fn(this.state.chart);
    this.state.isDirty = true;
    this.emit();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(structuredClone(this.state.chart));
    this.state.chart = prev;
    this.state.isDirty = true;
    this.emit();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(structuredClone(this.state.chart));
    this.state.chart = next;
    this.state.isDirty = true;
    this.emit();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  loadChart(chart: Chart) {
    this.undoStack = [];
    this.redoStack = [];
    this.state.chart = chart;
    this.state.isDirty = false;
    this.state.selection = { noteIds: new Set(), slideIds: new Set() };
    this.emit();
  }

  setTool(tool: ToolMode) {
    this.state.tool = tool;
    this.state.activeSlideDraft = null;
    this.emit();
  }

  setView(partial: Partial<ViewState>) {
    this.state.view = { ...this.state.view, ...partial };
    this.emit();
  }

  setPlaying(playing: boolean) {
    this.state.isPlaying = playing;
    this.emit();
  }

  setSelection(noteIds: string[], slideIds: string[] = []) {
    this.state.selection = { noteIds: new Set(noteIds), slideIds: new Set(slideIds) };
    this.emit();
  }

  clearSelection() {
    this.state.selection = { noteIds: new Set(), slideIds: new Set() };
    this.emit();
  }

  deleteSelection() {
    if (this.state.selection.noteIds.size === 0 && this.state.selection.slideIds.size === 0) return;
    this.mutateChart(chart => {
      chart.singleNotes = chart.singleNotes.filter(n => !this.state.selection.noteIds.has(n.id));
      chart.slides = chart.slides.filter(s => !this.state.selection.slideIds.has(s.id));
    });
    this.clearSelection();
  }

  snapTick(rawTick: number): number {
    const step = (4 * 480) / this.state.view.snapDivisor / 4; // TICKS_PER_BEAT想定=480
    return Math.round(rawTick / step) * step;
  }
}

export const editorStore = new EditorStore();
