/**
 * 譜面エディタの内部データモデル（中間表現）
 *
 * USC (Sonolus Universal Chart) と MMWS/SUS (MikuMikuWorld) の
 * どちらにも変換できるよう、両者のスーパーセットとして設計する。
 *
 * 時間軸は「ティック」を基本単位とする。
 * 1小節 = TICKS_PER_BEAT * 拍子分子 ティック（4/4なら480*4）
 * MMWSのtick(1/480分解能)にもUSCのbeat(浮動小数)にも変換可能。
 */

/** 1拍あたりのティック数（MMWS/SUSの慣例に合わせ480を採用） */
export const TICKS_PER_BEAT = 480;

/** レーン数（ProSeka準拠: 12レーン、端の余白含め実質12分割） */
export const LANE_COUNT = 12;
export const LANE_MIN = 0;
export const LANE_MAX = LANE_COUNT; // ノーツ幅はlane+widthで表現

/** ノーツの基本種別 */
export type NoteKind =
  | 'tap'          // 通常タップ
  | 'critical'     // クリティカルタップ
  | 'flick'        // フリック
  | 'criticalFlick'
  | 'trace'        // トレース（NextSekai拡張）
  | 'criticalTrace'
  | 'damage'       // ダメージノーツ（NextSekai拡張）
  | 'friction'     // フリクション（すり抜けトレース、NextSekai/CHUNITHM系拡張）
  | 'criticalFriction'
  | 'anchor';      // スライド経由点（見た目のみ、判定なし）

/** フリック方向 */
export type FlickDirection = 'up' | 'left' | 'right' | 'none';

/** スライド（Hold）の中継点イージング */
export type EaseType = 'linear' | 'easeIn' | 'easeOut';

/** 単一ノーツ（タップ系・スライド端点・中継点すべてを表す共通構造） */
export interface Note {
  id: string;
  tick: number;          // 譜面全体での絶対ティック位置
  lane: number;           // 左端レーン位置（0始まり、小数可＝MMWS互換）
  width: number;          // レーン幅（1以上）
  kind: NoteKind;
  flick?: FlickDirection; // kind が flick/criticalFlick の場合のみ意味を持つ
  ease?: EaseType;        // スライド中継点のイージング
  hidden?: boolean;       // 見た目非表示（NextSekaiのフェイクノーツ等）
}

/** スライド（Hold）: 始点・中継点・終点を connections で結ぶ */
export interface Slide {
  id: string;
  critical: boolean;
  notes: Note[]; // notes[0]が始点, notes[last]が終点, 間はanchor/trace等
}

/** 単発ノーツ（スライドに属さないタップ・フリック・ダメージ等） */
export interface SingleNote extends Note {}

/** BPMイベント */
export interface BpmEvent {
  id: string;
  tick: number;
  bpm: number;
}

/** 拍子（時間記号）イベント */
export interface TimeSignatureEvent {
  id: string;
  measure: number; // 小節番号（拍子は小節境界でのみ変化する制約）
  numerator: number;
  denominator: number;
}

/** スキル発動エフェクト等、汎用イベント（NextSekai拡張用に汎用化） */
export interface SkillEvent {
  id: string;
  tick: number;
}

/** レーン背景演出などのコメント/レイヤーイベント（MMWS互換のための汎用フィールド） */
export interface CommentEvent {
  id: string;
  tick: number;
  text: string;
}

/** 譜面全体 */
export interface Chart {
  formatVersion: number;
  title: string;
  artist: string;
  author: string;
  musicFile?: string;      // 音声ファイル名（保存時の参照用）
  musicOffsetSeconds: number; // 音声とチャートの時間オフセット
  jacketFile?: string;

  bpmEvents: BpmEvent[];
  timeSignatures: TimeSignatureEvent[];

  singleNotes: SingleNote[];
  slides: Slide[];
  skillEvents: SkillEvent[];
  comments: CommentEvent[];
}

export function createEmptyChart(): Chart {
  return {
    formatVersion: 1,
    title: '',
    artist: '',
    author: '',
    musicOffsetSeconds: 0,
    bpmEvents: [
      { id: crypto.randomUUID(), tick: 0, bpm: 120 },
    ],
    timeSignatures: [
      { id: crypto.randomUUID(), measure: 0, numerator: 4, denominator: 4 },
    ],
    singleNotes: [],
    slides: [],
    skillEvents: [],
    comments: [],
  };
}

/** ティック→秒変換のための時間マップを構築する */
export interface TimeMapEntry {
  tick: number;
  seconds: number;
  bpm: number;
}

export function buildTimeMap(chart: Chart): TimeMapEntry[] {
  const sorted = [...chart.bpmEvents].sort((a, b) => a.tick - b.tick);
  const map: TimeMapEntry[] = [];
  let seconds = 0;
  let prevTick = 0;
  let prevBpm = sorted.length > 0 ? sorted[0].bpm : 120;

  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (i > 0) {
      const deltaTicks = ev.tick - prevTick;
      seconds += (deltaTicks / TICKS_PER_BEAT) * (60 / prevBpm);
    }
    map.push({ tick: ev.tick, seconds, bpm: ev.bpm });
    prevTick = ev.tick;
    prevBpm = ev.bpm;
  }
  if (map.length === 0) {
    map.push({ tick: 0, seconds: 0, bpm: 120 });
  }
  return map;
}

export function tickToSeconds(timeMap: TimeMapEntry[], tick: number): number {
  let entry = timeMap[0];
  for (const e of timeMap) {
    if (e.tick <= tick) entry = e;
    else break;
  }
  const deltaTicks = tick - entry.tick;
  return entry.seconds + (deltaTicks / TICKS_PER_BEAT) * (60 / entry.bpm);
}

export function secondsToTick(timeMap: TimeMapEntry[], seconds: number): number {
  let entry = timeMap[0];
  for (const e of timeMap) {
    if (e.seconds <= seconds) entry = e;
    else break;
  }
  const deltaSeconds = seconds - entry.seconds;
  return entry.tick + (deltaSeconds / (60 / entry.bpm)) * TICKS_PER_BEAT;
}
