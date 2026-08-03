/**
 * 外部キーボード用ショートカット。
 * Cmd/Ctrl+Z: Undo, Shift+Cmd/Ctrl+Z: Redo, Delete/Backspace: 選択削除,
 * 1-9: ノーツ種切替, Esc: 選択解除, +/-: ズーム
 */
import { EditorStore, ToolMode } from '../core/store';

const NUMBER_KEY_TOOL: Record<string, ToolMode> = {
  '1': 'select',
  '2': 'placeTap',
  '3': 'placeCritical',
  '4': 'placeFlick',
  '5': 'placeCriticalFlick',
  '6': 'placeTrace',
  '7': 'placeFriction',
  '8': 'placeDamage',
  '9': 'drawSlide',
};

export function attachKeyboardShortcuts(store: EditorStore) {
  window.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

    const meta = ev.metaKey || ev.ctrlKey;

    if (meta && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) store.redo(); else store.undo();
      return;
    }
    if (meta && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      store.redo();
      return;
    }
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      store.deleteSelection();
      return;
    }
    if (ev.key === 'Escape') {
      store.clearSelection();
      store.setTool('select');
      return;
    }
    if (ev.key === '+' || ev.key === '=') {
      const v = store.getState().view;
      store.setView({ pixelsPerBeat: Math.min(400, v.pixelsPerBeat * 1.2) });
      return;
    }
    if (ev.key === '-' || ev.key === '_') {
      const v = store.getState().view;
      store.setView({ pixelsPerBeat: Math.max(20, v.pixelsPerBeat / 1.2) });
      return;
    }
    if (NUMBER_KEY_TOOL[ev.key]) {
      store.setTool(NUMBER_KEY_TOOL[ev.key]);
      return;
    }
  });
}
