import './ui/style.css';
import { editorStore } from './core/store';
import { audioPlayer } from './audio/player';
import { render as renderChart } from './ui/chartRenderer';
import { InteractionController } from './ui/interaction';
import { buildPalette } from './ui/toolbar';
import { buildPropertyPanel } from './ui/propertyPanel';
import { buildTransport } from './ui/transport';
import { buildFileMenu } from './ui/fileMenu';
import { attachKeyboardShortcuts } from './ui/keyboardShortcuts';
import { registerServiceWorker } from './pwa/registerSw';
import { saveProject, loadProject } from './core/persistence';

const AUTOSAVE_ID = 'current-project';
const AUTOSAVE_INTERVAL_MS = 15000;

async function main() {
  registerServiceWorker();

  // --- DOM要素取得 ---
  const canvas = document.getElementById('chart-canvas') as HTMLCanvasElement;
  const paletteEl = document.getElementById('palette')!;
  const propertyPanelEl = document.getElementById('property-panel')!;
  const transportEl = document.getElementById('transport')!;
  const fileMenuEl = document.getElementById('file-menu')!;
  const undoBtn = document.getElementById('btn-undo') as HTMLButtonElement;
  const redoBtn = document.getElementById('btn-redo') as HTMLButtonElement;

  // --- Canvas解像度をDPRに合わせて設定 ---
  // 方針: canvas.width/height は「論理ピクセル(CSS px)」の値をそのまま使う。
  // 実際の物理解像度はCSS側のtransform:scaleではなくbackingStoreの拡大で担保するため、
  // ctx.setTransform で dpr 倍にスケールしたうえで、width/heightプロパティ自体は
  // dpr倍した物理サイズにする。ただし chartRenderer / interaction 側は
  // 「論理サイズ」で座標計算したいので、論理サイズを別途 canvas.dataset に保持し、
  // レンダラーには論理幅・論理高さを渡す。
  let logicalWidth = 0;
  let logicalHeight = 0;
  let interaction: InteractionController | null = null;

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    logicalWidth = rect.width;
    logicalHeight = rect.height;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    requestRedraw();
  }

  // --- 再描画 ---
  let redrawScheduled = false;
  function requestRedraw() {
    if (redrawScheduled) return;
    redrawScheduled = true;
    requestAnimationFrame(() => {
      redrawScheduled = false;
      const ctx = canvas.getContext('2d')!;
      const state = editorStore.getState();
      const draft = interaction?.getSlideDraftPoints();
      renderChart(ctx, logicalWidth, logicalHeight, state.chart, state.view, state.selection, draft);

      if (state.isPlaying) requestRedraw();
    });
  }

  // --- UIモジュール初期化 ---
  buildPalette(paletteEl, editorStore);
  buildPropertyPanel(propertyPanelEl, editorStore);
  buildTransport(transportEl, editorStore, audioPlayer);
  buildFileMenu(fileMenuEl, editorStore);
  attachKeyboardShortcuts(editorStore);

  interaction = new InteractionController(canvas, editorStore, requestRedraw);

  undoBtn.addEventListener('click', () => editorStore.undo());
  redoBtn.addEventListener('click', () => editorStore.redo());

  let lastTool = editorStore.getState().tool;
  editorStore.subscribe(() => {
    undoBtn.disabled = !editorStore.canUndo();
    redoBtn.disabled = !editorStore.canRedo();
    const currentTool = editorStore.getState().tool;
    if (currentTool !== lastTool) {
      lastTool = currentTool;
      interaction?.clearSlideDraft();
    }
    requestRedraw();
  });

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));

  // --- 自動保存の復元 ---
  try {
    const saved = await loadProject(AUTOSAVE_ID);
    if (saved && saved.chart) {
      editorStore.loadChart(saved.chart);
    }
  } catch (e) {
    console.warn('自動保存データの復元に失敗しました', e);
  }

  setInterval(() => {
    const state = editorStore.getState();
    if (state.isDirty) {
      saveProject(AUTOSAVE_ID, state.chart).catch((e) => console.warn('自動保存に失敗しました', e));
    }
  }, AUTOSAVE_INTERVAL_MS);

  // 離脱前の保存
  window.addEventListener('beforeunload', () => {
    const state = editorStore.getState();
    if (state.isDirty) {
      saveProject(AUTOSAVE_ID, state.chart);
    }
  });

  resizeCanvas();
  requestRedraw();
}

main();
