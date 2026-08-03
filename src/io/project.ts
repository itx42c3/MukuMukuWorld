/**
 * プロジェクト状態（.mmwproj.json）の入出力
 *
 * USC は「譜面データ」のみを対象にした共有・互換フォーマットだが、
 * こちらは「編集セッションの状態」を丸ごと書き出し、別端末・別ブラウザに
 * 引き継ぐためのフォーマット。譜面データ(Chart)に加えて、
 * ズーム倍率やスナップ分解能などの表示状態も保持する。
 *
 * IndexedDBの自動保存はあくまで「同一ブラウザ・同一端末」内の復旧用であり、
 * 端末をまたいだ引き継ぎ（例: iPadで作業した続きをPCで開く）にはファイルとして
 * 書き出す必要があるため、このフォーマットを用意している。
 */
import { Chart } from '../core/chart';
import { ViewState } from '../core/store';

export const PROJECT_FORMAT_VERSION = 1;

/** 書き出し対象とするビュー状態（再生ヘッド位置などその場限りの値は除く） */
export interface ProjectViewState {
  pixelsPerBeat: number;
  laneWidthPx: number;
  snapDivisor: number;
}

export interface ProjectFile {
  formatVersion: number;
  savedAt: string; // ISO8601
  appName: 'MukuMukuWorld';
  chart: Chart;
  view: ProjectViewState;
}

/** 現在の編集状態からプロジェクトファイル(JSON文字列)を生成する */
export function exportProject(chart: Chart, view: ViewState): string {
  const project: ProjectFile = {
    formatVersion: PROJECT_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    appName: 'MukuMukuWorld',
    chart,
    view: {
      pixelsPerBeat: view.pixelsPerBeat,
      laneWidthPx: view.laneWidthPx,
      snapDivisor: view.snapDivisor,
    },
  };
  return JSON.stringify(project, null, 2);
}

/** プロジェクトファイル(JSON文字列)を読み込み、譜面とビュー状態を取り出す */
export function importProject(json: string): { chart: Chart; view: Partial<ProjectViewState> } {
  const data = JSON.parse(json);

  if (!data || typeof data !== 'object' || !data.chart) {
    throw new Error('MukuMukuWorldのプロジェクトファイルとして認識できませんでした。');
  }

  const chart = data.chart as Chart;
  // 最低限の妥当性チェック（壊れたファイルの誤読込を防ぐ）
  if (!Array.isArray(chart.singleNotes) || !Array.isArray(chart.slides) || !Array.isArray(chart.bpmEvents)) {
    throw new Error('譜面データの形式が不正です。');
  }

  const view: Partial<ProjectViewState> = {};
  if (data.view && typeof data.view === 'object') {
    if (typeof data.view.pixelsPerBeat === 'number') view.pixelsPerBeat = data.view.pixelsPerBeat;
    if (typeof data.view.laneWidthPx === 'number') view.laneWidthPx = data.view.laneWidthPx;
    if (typeof data.view.snapDivisor === 'number') view.snapDivisor = data.view.snapDivisor;
  }

  return { chart, view };
}

/** ファイル名判定用の拡張子 */
export const PROJECT_FILE_EXTENSION = '.mmwproj.json';

export function isProjectFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.mmwproj.json') || fileName.toLowerCase().endsWith('.json');
}
