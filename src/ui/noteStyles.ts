/**
 * ノーツ種類ごとの見た目定義（ProSeka配色を踏襲）
 */
import { NoteKind } from '../core/chart';

export interface NoteStyle {
  label: string;       // パレット表示名
  shortLabel: string;  // Canvas内の短縮表示
  fill: string;        // 塗り色
  stroke: string;      // 縁取り色
  textColor: string;
}

export const NOTE_STYLES: Record<NoteKind, NoteStyle> = {
  tap: {
    label: 'タップ', shortLabel: 'T',
    fill: '#4fd1c5', stroke: '#2c9c92', textColor: '#0b2e2b',
  },
  critical: {
    label: 'クリティカル', shortLabel: 'C',
    fill: '#ffd23f', stroke: '#d9a800', textColor: '#3a2c00',
  },
  flick: {
    label: 'フリック', shortLabel: 'F',
    fill: '#ff6b81', stroke: '#d9425a', textColor: '#3a0d15',
  },
  criticalFlick: {
    label: 'Cフリック', shortLabel: 'CF',
    fill: '#ffb02e', stroke: '#d98700', textColor: '#3a2400',
  },
  trace: {
    label: 'トレース', shortLabel: 'Tr',
    fill: '#a78bfa', stroke: '#7c5cf0', textColor: '#241a4d',
  },
  criticalTrace: {
    label: 'Cトレース', shortLabel: 'CTr',
    fill: '#f6ad55', stroke: '#d9800e', textColor: '#3a2400',
  },
  damage: {
    label: 'ダメージ', shortLabel: 'D',
    fill: '#e53e3e', stroke: '#a02121', textColor: '#ffffff',
  },
  friction: {
    label: 'フリクション', shortLabel: 'Fr',
    fill: '#63b3ed', stroke: '#2b76c9', textColor: '#0b2140',
  },
  criticalFriction: {
    label: 'Cフリクション', shortLabel: 'CFr',
    fill: '#f6c453', stroke: '#d9a012', textColor: '#3a2900',
  },
  anchor: {
    label: '中継点', shortLabel: '・',
    fill: '#718096', stroke: '#4a5568', textColor: '#ffffff',
  },
};

export const LANE_BG_COLOR = '#1c1c26';
export const LANE_LINE_COLOR = '#33333f';
export const MEASURE_LINE_COLOR = '#4a4a5a';
export const BEAT_LINE_COLOR = '#2a2a36';
export const SLIDE_PATH_COLOR_NORMAL = 'rgba(79, 209, 197, 0.55)';
export const SLIDE_PATH_COLOR_CRITICAL = 'rgba(255, 210, 63, 0.55)';
export const PLAYHEAD_COLOR = '#ff3b6f';
export const BPM_LINE_COLOR = '#38bdf8';
export const SELECTION_COLOR = '#ffffff';
