// ============================================================================
// model.js — チャートデータモデル（拍/BPM/拍子/ノーツ/スライド/Undo履歴）
// ============================================================================

const TICKS_PER_BEAT = 480;

// ノーツ種別
const NoteType = {
  TAP: 'tap',
  FLICK: 'flick',
  TRACE: 'trace',
  TRACE_FLICK: 'traceFlick',
  DAMAGE: 'damage',
};

const FlickDir = { UP: 'up', LEFT: 'left', RIGHT: 'right' };
const EaseType = { LINEAR: 'linear', EASE_IN: 'in', EASE_OUT: 'out' };
const ConnType = { START: 'start', TICK: 'tick', ATTACH: 'attach', END: 'end' };
const GuideColor = { NEUTRAL: 'neutral', RED: 'red', GREEN: 'green', BLUE: 'blue', YELLOW: 'yellow', PURPLE: 'purple' };
const GuideFade = { NONE: 'none', IN: 'in', OUT: 'out' };

let __uid = 1;
function uid() { return (__uid++).toString(36) + '_' + Date.now().toString(36); }

class Chart {
  constructor() {
    this.reset();
  }

  reset() {
    this.title = '無題の譜面';
    this.artist = '';
    this.charter = '';
    this.audioOffsetMs = 0; // 音源オフセット(ms)。usc の offset(秒)に変換して書き出す
    this.bpmChanges = [{ tick: 0, bpm: 120 }];
    this.timeSignatures = [{ measure: 0, numerator: 4, denominator: 4 }];
    this.notes = [];   // 単発ノーツ(Tap/Flick/Trace/Damage)
    this.slides = [];  // スライド群 {id, critical, connections:[...]}
    this.guides = [];  // ガイド群（判定なし） {id, color, fade, connections:[...]}
    this.selection = new Set(); // 選択中の note.id / 'slide:<id>:<tick>' / 'guide:<id>:<tick>'
    this._history = [];
    this._future = [];
  }

  // ---- 拍/小節ユーティリティ ------------------------------------------------

  sortedBpm() { return [...this.bpmChanges].sort((a, b) => a.tick - b.tick); }
  sortedTimeSig() { return [...this.timeSignatures].sort((a, b) => a.measure - b.measure); }

  // 小節番号 -> 開始tick （拍子変更を積算）
  measureToTick(measure) {
    const sigs = this.sortedTimeSig();
    let tick = 0, curMeasure = 0, idx = 0;
    while (idx < sigs.length && sigs[idx].measure <= curMeasure && sigs[idx].measure <= measure) {
      idx++;
    }
    idx = 0;
    let curSig = sigs[0] || { numerator: 4, denominator: 4 };
    for (let m = 0; m < measure; m++) {
      // 現在の小節に適用される拍子を探す
      for (const s of sigs) if (s.measure <= m) curSig = s;
      const beatsPerMeasure = curSig.numerator * (4 / curSig.denominator);
      tick += beatsPerMeasure * TICKS_PER_BEAT;
    }
    return Math.round(tick);
  }

  sigAtMeasure(measure) {
    const sigs = this.sortedTimeSig();
    let cur = sigs[0] || { numerator: 4, denominator: 4 };
    for (const s of sigs) if (s.measure <= measure) cur = s;
    return cur;
  }

  // tick -> 小節番号・小節内tick
  tickToMeasure(tick) {
    const sigs = this.sortedTimeSig();
    let measure = 0, curTick = 0;
    let curSig = sigs[0] || { numerator: 4, denominator: 4 };
    for (let i = 0; i < sigs.length; i++) {
      const s = sigs[i];
      const next = sigs[i + 1];
      const measureTickLen = s.numerator * (4 / s.denominator) * TICKS_PER_BEAT;
      const startTickOfThisSig = this.measureToTick(s.measure);
      const endMeasure = next ? next.measure : Infinity;
      if (tick >= startTickOfThisSig) {
        const measuresIn = Math.floor((tick - startTickOfThisSig) / measureTickLen);
        const candMeasure = s.measure + measuresIn;
        if (candMeasure < endMeasure) {
          measure = candMeasure;
          curTick = tick - (startTickOfThisSig + measuresIn * measureTickLen);
          curSig = s;
        }
      }
    }
    return { measure, tickInMeasure: curTick, sig: curSig };
  }

  // BPM区間を使い tick -> 秒（音源オフセット抜き、譜面開始=0秒基準）
  tickToSeconds(tick) {
    const bpms = this.sortedBpm();
    let seconds = 0, lastTick = 0, lastBpm = bpms[0]?.bpm || 120;
    for (const b of bpms) {
      if (b.tick >= tick) break;
      seconds += (b.tick - lastTick) / TICKS_PER_BEAT * (60 / lastBpm);
      lastTick = b.tick; lastBpm = b.bpm;
    }
    seconds += (tick - lastTick) / TICKS_PER_BEAT * (60 / lastBpm);
    return seconds;
  }

  secondsToTick(sec) {
    const bpms = this.sortedBpm();
    let elapsed = 0, lastTick = 0, lastBpm = bpms[0]?.bpm || 120;
    for (const b of bpms) {
      const segDur = (b.tick - lastTick) / TICKS_PER_BEAT * (60 / lastBpm);
      if (b.tick === 0) { lastBpm = b.bpm; continue; }
      if (elapsed + segDur >= sec) {
        const remain = sec - elapsed;
        return lastTick + remain * TICKS_PER_BEAT * lastBpm / 60;
      }
      elapsed += segDur; lastTick = b.tick; lastBpm = b.bpm;
    }
    const remain = sec - elapsed;
    return lastTick + remain * TICKS_PER_BEAT * lastBpm / 60;
  }

  bpmAt(tick) {
    const bpms = this.sortedBpm();
    let cur = bpms[0]?.bpm || 120;
    for (const b of bpms) if (b.tick <= tick) cur = b.bpm;
    return cur;
  }

  // ---- Undo / Redo -----------------------------------------------------

  snapshot() {
    return JSON.stringify({
      title: this.title, artist: this.artist, charter: this.charter,
      audioOffsetMs: this.audioOffsetMs,
      bpmChanges: this.bpmChanges, timeSignatures: this.timeSignatures,
      notes: this.notes, slides: this.slides, guides: this.guides,
    });
  }

  pushHistory() {
    this._history.push(this.snapshot());
    if (this._history.length > 200) this._history.shift();
    this._future.length = 0;
  }

  undo() {
    if (!this._history.length) return false;
    this._future.push(this.snapshot());
    const s = JSON.parse(this._history.pop());
    Object.assign(this, s);
    this.selection = new Set();
    return true;
  }

  redo() {
    if (!this._future.length) return false;
    this._history.push(this.snapshot());
    const s = JSON.parse(this._future.pop());
    Object.assign(this, s);
    this.selection = new Set();
    return true;
  }

  // ---- ノーツ操作 --------------------------------------------------------

  addNote(note) {
    note.id = note.id || uid();
    this.notes.push(note);
    return note;
  }

  addSlide(slide) {
    slide.id = slide.id || uid();
    this.slides.push(slide);
    return slide;
  }

  addGuide(guide) {
    guide.id = guide.id || uid();
    this.guides.push(guide);
    return guide;
  }

  removeById(id) {
    this.notes = this.notes.filter(n => n.id !== id);
    this.slides = this.slides.filter(s => s.id !== id);
    this.guides = this.guides.filter(g => g.id !== id);
  }

  allTicks() {
    const ts = new Set();
    for (const n of this.notes) ts.add(n.tick);
    for (const s of this.slides) for (const c of s.connections) ts.add(c.tick);
    for (const g of this.guides) for (const c of g.connections) ts.add(c.tick);
    for (const b of this.bpmChanges) ts.add(b.tick);
    return ts;
  }

  lastTick() {
    let max = 0;
    for (const t of this.allTicks()) if (t > max) max = t;
    return max;
  }

  // 選択キーからオブジェクト実体を引く（note / スライド接続点 / ガイド接続点）
  resolveKey(key) {
    const n = this.notes.find(n => n.id === key);
    if (n) return { kind: 'note', obj: n, owner: null };
    for (const s of this.slides) {
      const c = s.connections.find(c => ('slide:' + s.id + ':' + c.tick) === key);
      if (c) return { kind: 'conn', obj: c, owner: s };
    }
    for (const g of this.guides) {
      const c = g.connections.find(c => ('guide:' + g.id + ':' + c.tick) === key);
      if (c) return { kind: 'guideConn', obj: c, owner: g };
    }
    return null;
  }

  // スライドの区間補間からレーン位置を求める（Attachツール用）
  slideLaneAt(slide, tick) {
    const conns = [...slide.connections].sort((a, b) => a.tick - b.tick);
    if (tick <= conns[0].tick) return conns[0];
    for (let i = 0; i < conns.length - 1; i++) {
      const a = conns[i], b = conns[i + 1];
      if (tick >= a.tick && tick <= b.tick) {
        const span = b.tick - a.tick || 1;
        let t = (tick - a.tick) / span;
        if (a.ease === EaseType.EASE_IN) t = t * t;
        else if (a.ease === EaseType.EASE_OUT) t = 1 - (1 - t) * (1 - t);
        const centerA = a.lane + a.width / 2, centerB = b.lane + b.width / 2;
        const center = centerA + (centerB - centerA) * t;
        const width = a.width + (b.width - a.width) * t;
        return { lane: center - width / 2, width };
      }
    }
    return conns[conns.length - 1];
  }
}
