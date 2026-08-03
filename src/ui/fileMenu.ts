/**
 * ファイルメニュー: 新規作成、開く(USC)、保存(USC書き出し)
 * iPad Safariでのダウンロードは <a download> によるBlobリンクで対応する。
 */
import { EditorStore } from '../core/store';
import { createEmptyChart } from '../core/chart';
import { exportUsc, importUsc } from '../io/usc';
import { exportProject, importProject, PROJECT_FILE_EXTENSION } from '../io/project';

export function buildFileMenu(container: HTMLElement, store: EditorStore) {
  container.className = 'file-menu';
  container.innerHTML = `
    <button class="file-menu-btn" id="btn-new">新規</button>
    <button class="file-menu-btn" id="btn-open">開く</button>
    <button class="file-menu-btn" id="btn-save">書き出し (USC)</button>
    <button class="file-menu-btn" id="btn-save-project">状態を保存 (JSON)</button>
    <button class="file-menu-btn" id="btn-open-project">状態を読み込み</button>
    <input type="file" id="open-input" accept=".usc,.json" hidden />
    <input type="file" id="open-project-input" accept=".json" hidden />
    <span class="file-menu-status" id="dirty-indicator"></span>
  `;

  const newBtn = container.querySelector<HTMLButtonElement>('#btn-new')!;
  const openBtn = container.querySelector<HTMLButtonElement>('#btn-open')!;
  const saveBtn = container.querySelector<HTMLButtonElement>('#btn-save')!;
  const saveProjectBtn = container.querySelector<HTMLButtonElement>('#btn-save-project')!;
  const openProjectBtn = container.querySelector<HTMLButtonElement>('#btn-open-project')!;
  const openInput = container.querySelector<HTMLInputElement>('#open-input')!;
  const openProjectInput = container.querySelector<HTMLInputElement>('#open-project-input')!;
  const dirtyIndicator = container.querySelector<HTMLElement>('#dirty-indicator')!;

  newBtn.addEventListener('click', () => {
    if (store.getState().isDirty && !confirm('保存していない変更があります。新規作成しますか？')) return;
    store.loadChart(createEmptyChart());
  });

  openBtn.addEventListener('click', () => openInput.click());
  openInput.addEventListener('change', async () => {
    const file = openInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const chart = importUsc(text);
      store.loadChart(chart);
    } catch (e) {
      alert('読み込みに失敗しました: ' + (e as Error).message);
    }
    openInput.value = '';
  });

  saveBtn.addEventListener('click', () => {
    const chart = store.getState().chart;
    const content = exportUsc(chart);
    downloadFile(content, `${chart.title || 'chart'}.usc`, 'application/json');
  });

  // --- 状態の保存/読み込み(JSON) ---
  // 譜面データに加えてズーム・スナップなどの編集状態も含めて書き出す。
  // 他デバイス・他ブラウザへ作業を引き継ぐ用途を想定（自動保存はブラウザ内限定のため）。
  saveProjectBtn.addEventListener('click', () => {
    const state = store.getState();
    const content = exportProject(state.chart, state.view);
    const baseName = state.chart.title || 'project';
    downloadFile(content, `${baseName}${PROJECT_FILE_EXTENSION}`, 'application/json');
  });

  openProjectBtn.addEventListener('click', () => openProjectInput.click());
  openProjectInput.addEventListener('change', async () => {
    const file = openProjectInput.files?.[0];
    if (!file) return;
    if (store.getState().isDirty && !confirm('保存していない変更があります。読み込みますか？')) {
      openProjectInput.value = '';
      return;
    }
    const text = await file.text();
    try {
      const { chart, view } = importProject(text);
      store.loadChart(chart);
      if (Object.keys(view).length > 0) store.setView(view);
    } catch (e) {
      alert('状態の読み込みに失敗しました: ' + (e as Error).message);
    }
    openProjectInput.value = '';
  });

  store.subscribe(() => {
    dirtyIndicator.textContent = store.getState().isDirty ? '● 未保存の変更' : '';
  });
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
