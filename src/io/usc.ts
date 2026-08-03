/**
 * USC (Sonolus Universal Chart) 形式の入出力
 *
 * USC は JSON ベースで beat（拍単位の浮動小数）で時間を表現する。
 * 参考仕様: https://github.com/sevenc-nanashi/usc-format (コミュニティ仕様)
 * NextSekai 実装のエントリタイプ拡張にも対応する。
 */
import {
  Chart, Note, NoteKind, Slide, TICKS_PER_BEAT, FlickDirection, EaseType,
} from '../core/chart';

// USCのentity type一覧（NextSekai拡張を含む）
type UscEntityType =
  | 'bpm' | 'timeScaleGroup' | 'timeScaleChange'
  | 'single' | 'slide' | 'guide'
  | 'damage' | 'friction'
  | 'startNote' | 'tickNote' | 'endNote' | 'attachedNote';

interface UscEntity {
  archetype: string;
  data: Record<string, { name: string; value?: number; ref?: string }[]>;
}

interface UscObject {
  beat: number;
  [key: string]: unknown;
}

// --- 内部表現 → USC 変換テーブル ---

const KIND_TO_USC_CRITICAL: Record<NoteKind, boolean> = {
  tap: false, critical: true,
  flick: false, criticalFlick: true,
  trace: false, criticalTrace: true,
  damage: false, friction: false, criticalFriction: true,
  anchor: false,
};

const KIND_TO_USC_TYPE: Partial<Record<NoteKind, string>> = {
  tap: 'normal', critical: 'normal',
  flick: 'flick', criticalFlick: 'flick',
  trace: 'trace', criticalTrace: 'trace',
  friction: 'friction', criticalFriction: 'friction',
  damage: 'damage',
};

function tickToBeat(tick: number): number {
  return tick / TICKS_PER_BEAT;
}
function beatToTick(beat: number): number {
  return Math.round(beat * TICKS_PER_BEAT);
}

function flickToUsc(dir: FlickDirection | undefined): string {
  switch (dir) {
    case 'up': return 'up';
    case 'left': return 'left';
    case 'right': return 'right';
    default: return 'up';
  }
}
function uscToFlick(dir: string | undefined): FlickDirection {
  switch (dir) {
    case 'left': return 'left';
    case 'right': return 'right';
    case 'up': return 'up';
    default: return 'none';
  }
}

/** 内部Chartモデル → USC JSON文字列 */
export function exportUsc(chart: Chart): string {
  const objects: any[] = [];

  objects.push({
    beat: 0,
    lane: 0,
    size: 0,
    archetype: '#BPM_CHANGE',
  });

  for (const b of chart.bpmEvents) {
    objects.push({
      beat: tickToBeat(b.tick),
      bpm: b.bpm,
      archetype: '#BPM_CHANGE',
    });
  }

  for (const ts of chart.timeSignatures) {
    objects.push({
      beat: tickToBeat(ts.measure * TICKS_PER_BEAT * (ts.numerator / ts.denominator) * 4 / 4),
      numerator: ts.numerator,
      denominator: ts.denominator,
      archetype: '#TIMESCALE_GROUP',
    });
  }

  // 単発ノーツ
  for (const n of chart.singleNotes) {
    const type = KIND_TO_USC_TYPE[n.kind] ?? 'normal';
    objects.push({
      beat: tickToBeat(n.tick),
      lane: n.lane,
      size: n.width,
      critical: KIND_TO_USC_CRITICAL[n.kind] ?? false,
      type,
      direction: n.kind === 'flick' || n.kind === 'criticalFlick' ? flickToUsc(n.flick) : undefined,
      archetype: `#SINGLE_${type.toUpperCase()}`,
    });
  }

  // スライド（Hold）
  for (const s of chart.slides) {
    const connections = s.notes.map((n, idx) => {
      const role = idx === 0 ? 'start' : idx === s.notes.length - 1 ? 'end' : 'tick';
      return {
        beat: tickToBeat(n.tick),
        lane: n.lane,
        size: n.width,
        critical: s.critical,
        ease: n.ease ?? 'linear',
        hidden: n.hidden ?? false,
        type: n.kind,
        role,
      };
    });
    objects.push({
      archetype: '#SLIDE',
      critical: s.critical,
      connections,
    });
  }

  const usc = {
    formatVersion: 1,
    offset: chart.musicOffsetSeconds,
    metadata: {
      title: chart.title,
      artist: chart.artist,
      author: chart.author,
    },
    objects,
  };

  return JSON.stringify(usc, null, 2);
}

/** USC JSON文字列 → 内部Chartモデル */
export function importUsc(json: string): Chart {
  const data = JSON.parse(json);
  const chart: Chart = {
    formatVersion: 1,
    title: data.metadata?.title ?? '',
    artist: data.metadata?.artist ?? '',
    author: data.metadata?.author ?? '',
    musicOffsetSeconds: data.offset ?? 0,
    bpmEvents: [],
    timeSignatures: [],
    singleNotes: [],
    slides: [],
    skillEvents: [],
    comments: [],
  };

  for (const obj of data.objects ?? []) {
    const arch: string = obj.archetype ?? '';

    if (arch === '#BPM_CHANGE' && typeof obj.bpm === 'number') {
      chart.bpmEvents.push({
        id: crypto.randomUUID(),
        tick: beatToTick(obj.beat ?? 0),
        bpm: obj.bpm,
      });
    } else if (arch === '#TIMESCALE_GROUP' && typeof obj.numerator === 'number') {
      chart.timeSignatures.push({
        id: crypto.randomUUID(),
        measure: Math.round((obj.beat ?? 0) / 4),
        numerator: obj.numerator,
        denominator: obj.denominator ?? 4,
      });
    } else if (arch.startsWith('#SINGLE_')) {
      const critical: boolean = !!obj.critical;
      const type: string = obj.type ?? 'normal';
      let kind: NoteKind = 'tap';
      if (type === 'flick') kind = critical ? 'criticalFlick' : 'flick';
      else if (type === 'trace') kind = critical ? 'criticalTrace' : 'trace';
      else if (type === 'friction') kind = critical ? 'criticalFriction' : 'friction';
      else if (type === 'damage') kind = 'damage';
      else kind = critical ? 'critical' : 'tap';

      chart.singleNotes.push({
        id: crypto.randomUUID(),
        tick: beatToTick(obj.beat ?? 0),
        lane: obj.lane ?? 0,
        width: obj.size ?? 1,
        kind,
        flick: type === 'flick' ? uscToFlick(obj.direction) : undefined,
      });
    } else if (arch === '#SLIDE' && Array.isArray(obj.connections)) {
      const critical: boolean = !!obj.critical;
      const notes: Note[] = obj.connections.map((c: any) => ({
        id: crypto.randomUUID(),
        tick: beatToTick(c.beat ?? 0),
        lane: c.lane ?? 0,
        width: c.size ?? 1,
        kind: (c.type as NoteKind) ?? 'anchor',
        ease: (c.ease as EaseType) ?? 'linear',
        hidden: !!c.hidden,
      }));
      chart.slides.push({
        id: crypto.randomUUID(),
        critical,
        notes,
      });
    }
  }

  if (chart.bpmEvents.length === 0) {
    chart.bpmEvents.push({ id: crypto.randomUUID(), tick: 0, bpm: 120 });
  }
  if (chart.timeSignatures.length === 0) {
    chart.timeSignatures.push({ id: crypto.randomUUID(), measure: 0, numerator: 4, denominator: 4 });
  }

  return chart;
}
