// ============================================================================
// usc.js — USC (Universal Sekai Chart) 形式のエクスポート/インポート
// Sonolus pjsekai系エンジン（NextSekai / Chart Cyanvas 系）で使われる
// JSONベースのチャート形式。エンジンの実装差異により細部が異なる場合が
// あるため、読み込み先サーバーで一度動作確認することを推奨します。
// ============================================================================

const USC = {
  // lane: 本エディタ内部では 0(左端)〜11(右端) の12レーンで幅1〜12として
  // 扱う。usc 側は中心 -6〜6 の座標系（幅は同じ単位）を使うため変換する。
  laneToUsc(lane, width) { return (lane - 6) + width / 2; },
  uscToLane(uscLane, width) { return Math.round(uscLane - width / 2 + 6); },

  export(chart) {
    const objects = [];

    for (const b of chart.sortedBpm()) {
      objects.push({ type: 'bpm', beat: b.tick / TICKS_PER_BEAT, bpm: b.bpm });
    }
    for (const s of chart.sortedTimeSig()) {
      objects.push({
        type: 'timeSignature',
        measure: s.measure,
        numerator: s.numerator,
        denominator: s.denominator,
      });
    }
    for (const n of chart.notes) {
      const obj = {
        type: n.type === NoteType.DAMAGE ? 'damage' : 'single',
        beat: n.tick / TICKS_PER_BEAT,
        lane: this.laneToUsc(n.lane, n.width),
        size: n.width / 2,
        critical: !!n.critical,
      };
      if (n.type === NoteType.TRACE || n.type === NoteType.TRACE_FLICK) obj.trace = true;
      if (n.type === NoteType.FLICK || n.type === NoteType.TRACE_FLICK) {
        obj.direction = n.flickDir || FlickDir.UP;
      }
      objects.push(obj);
    }
    for (const s of chart.slides) {
      const connections = s.connections
        .slice()
        .sort((a, b) => a.tick - b.tick)
        .map(c => {
          const co = {
            type: c.type,
            beat: c.tick / TICKS_PER_BEAT,
            lane: this.laneToUsc(c.lane, c.width),
            size: c.width / 2,
          };
          if (c.type === ConnType.START || c.type === ConnType.TICK) co.ease = c.ease || EaseType.LINEAR;
          if (c.type === ConnType.END && c.flickDir) { co.direction = c.flickDir; }
          if (c.critical !== undefined) co.critical = !!c.critical;
          return co;
        });
      objects.push({ type: 'slide', critical: !!s.critical, connections });
    }
    for (const g of chart.guides) {
      const connections = g.connections
        .slice()
        .sort((a, b) => a.tick - b.tick)
        .map(c => ({
          type: c.type,
          beat: c.tick / TICKS_PER_BEAT,
          lane: this.laneToUsc(c.lane, c.width),
          size: c.width / 2,
          ease: c.ease || EaseType.LINEAR,
        }));
      objects.push({ type: 'guide', color: g.color || GuideColor.NEUTRAL, fade: g.fade || GuideFade.NONE, connections });
    }

    const sortKey = (o) => {
      if (o.beat !== undefined) return o.beat;
      if (o.type === 'slide' || o.type === 'guide') return o.connections[0]?.beat ?? 0;
      if (o.type === 'timeSignature') return chart.measureToTick(o.measure) / TICKS_PER_BEAT;
      return 0;
    };
    objects.sort((a, b) => sortKey(a) - sortKey(b));

    return {
      usc: true,
      version: 1,
      offset: -(chart.audioOffsetMs / 1000),
      objects,
    };
  },

  import(json) {
    const chart = new Chart();
    chart.bpmChanges = [];
    chart.timeSignatures = [];
    const objects = json.objects || [];
    chart.audioOffsetMs = json.offset !== undefined ? -json.offset * 1000 : 0;

    for (const o of objects) {
      if (o.type === 'bpm') {
        chart.bpmChanges.push({ tick: Math.round(o.beat * TICKS_PER_BEAT), bpm: o.bpm });
      } else if (o.type === 'timeSignature') {
        chart.timeSignatures.push({ measure: o.measure, numerator: o.numerator, denominator: o.denominator });
      } else if (o.type === 'single' || o.type === 'damage') {
        const width = Math.round((o.size || 1) * 2);
        chart.addNote({
          type: o.type === 'damage' ? NoteType.DAMAGE : (o.trace ? (o.direction ? NoteType.TRACE_FLICK : NoteType.TRACE) : (o.direction ? NoteType.FLICK : NoteType.TAP)),
          tick: Math.round(o.beat * TICKS_PER_BEAT),
          lane: this.uscToLane(o.lane, width),
          width,
          critical: !!o.critical,
          flickDir: o.direction || null,
        });
      } else if (o.type === 'slide') {
        const connections = (o.connections || []).map(c => {
          const width = Math.round((c.size || 1) * 2);
          return {
            type: c.type,
            tick: Math.round(c.beat * TICKS_PER_BEAT),
            lane: this.uscToLane(c.lane, width),
            width,
            ease: c.ease || EaseType.LINEAR,
            critical: c.critical,
            flickDir: c.direction || null,
          };
        });
        chart.addSlide({ critical: !!o.critical, connections });
      } else if (o.type === 'guide') {
        const connections = (o.connections || []).map(c => {
          const width = Math.round((c.size || 1) * 2);
          return {
            type: c.type, tick: Math.round(c.beat * TICKS_PER_BEAT),
            lane: this.uscToLane(c.lane, width), width, ease: c.ease || EaseType.LINEAR,
          };
        });
        chart.addGuide({ color: o.color || GuideColor.NEUTRAL, fade: o.fade || GuideFade.NONE, connections });
      }
    }
    if (!chart.bpmChanges.length) chart.bpmChanges.push({ tick: 0, bpm: 120 });
    if (!chart.timeSignatures.length) chart.timeSignatures.push({ measure: 0, numerator: 4, denominator: 4 });
    return chart;
  },
};

// ---- ネイティブ保存形式（プロジェクトファイル。usc より情報量が多い）------
const NativeProject = {
  export(chart) {
    return {
      formatVersion: 1,
      title: chart.title, artist: chart.artist, charter: chart.charter,
      audioOffsetMs: chart.audioOffsetMs,
      bpmChanges: chart.bpmChanges,
      timeSignatures: chart.timeSignatures,
      notes: chart.notes,
      slides: chart.slides,
      guides: chart.guides,
    };
  },
  import(json) {
    const chart = new Chart();
    chart.title = json.title || '無題の譜面';
    chart.artist = json.artist || '';
    chart.charter = json.charter || '';
    chart.audioOffsetMs = json.audioOffsetMs || 0;
    chart.bpmChanges = json.bpmChanges || [{ tick: 0, bpm: 120 }];
    chart.timeSignatures = json.timeSignatures || [{ measure: 0, numerator: 4, denominator: 4 }];
    chart.notes = json.notes || [];
    chart.slides = json.slides || [];
    chart.guides = json.guides || [];
    return chart;
  },
};
