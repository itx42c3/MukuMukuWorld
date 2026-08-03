// ============================================================================
// editor.js — キャンバス描画とエディタ操作 (プレイフィールド本体)
// ============================================================================

const LANES = 12;

const COLORS = {
  bg: '#12141a',
  laneA: '#1a1d25',
  laneB: '#181b22',
  laneCenter: 'rgba(255,255,255,0.06)',
  gridBeat: 'rgba(255,255,255,0.10)',
  gridSub: 'rgba(255,255,255,0.045)',
  gridMeasure: 'rgba(255,255,255,0.28)',
  judge: '#5ce1ff',
  playhead: '#ff5c7a',
  tap: '#57e08e',
  tapCritical: '#ffd23f',
  flick: '#ff7a5c',
  flickCritical: '#ffd23f',
  trace: '#7fc7ff',
  traceCritical: '#ffd23f',
  damage: '#c25cff',
  slide: '#5ce1ff',
  slideCritical: '#ffd23f',
  selection: '#ffffff',
  waveform: '#3d6b8a',
  ghost: 'rgba(255,255,255,0.35)',
};

const GUIDE_COLORS = {
  neutral: '#9aa1ad', red: '#ff5c7a', green: '#57e08e',
  blue: '#5c9fff', yellow: '#ffd23f', purple: '#c25cff',
};

const TOOLS = {
  SELECT: 'select', TAP: 'tap', FLICK: 'flick', TRACE: 'trace', TRACE_FLICK: 'traceFlick',
  SLIDE: 'slide', GUIDE: 'guide', ATTACH: 'attach', DAMAGE: 'damage', BPM: 'bpm', TIMESIG: 'timesig',
};

const DIVISIONS = [4, 8, 12, 16, 24, 32, 48];

class Editor {
  constructor(canvas, chart, audio, ui) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.chart = chart;
    this.audio = audio;
    this.ui = ui;

    this.pxPerBeat = 110;
    this.scrollTick = 0; // tick at the judge line
    this.judgeMargin = 64;
    this.laneWidthPx = 34;
    this.waveformW = 56;
    this.gutterW = 118;

    this.currentTool = TOOLS.TAP;
    this.currentWidth = 3;
    this.currentFlickDir = FlickDir.UP;
    this.currentCritical = false;
    this.currentGuideColor = GuideColor.NEUTRAL;
    this.currentGuideFade = GuideFade.NONE;
    this.division = 16;
    this.hitSoundEnabled = true;
    this._hitFired = new Set();

    this.building = null; // 構築中のスライド/ガイド
    this.buildingKind = null; // 'slide' | 'guide'
    this.dragState = null;
    this.hover = { tick: 0, lane: 0 };
    this.selectionBox = null;

    this.playing = false;
    this._raf = null;

    this._bindEvents();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._loop();
  }

  // ---- 座標変換 -----------------------------------------------------------

  get playfieldLeft() { return this.waveformW; }
  get playfieldWidth() { return LANES * this.laneWidthPx; }
  get pxPerTick() { return this.pxPerBeat / TICKS_PER_BEAT; }

  tickToY(tick) {
    return (this.canvas.clientHeight - this.judgeMargin) - (tick - this.scrollTick) * this.pxPerTick;
  }
  yToTick(y) {
    return this.scrollTick + ((this.canvas.clientHeight - this.judgeMargin) - y) / this.pxPerTick;
  }
  laneToX(lane) { return this.playfieldLeft + lane * this.laneWidthPx; }
  xToLane(x) { return (x - this.playfieldLeft) / this.laneWidthPx; }

  snapTick(tick) {
    const step = TICKS_PER_BEAT / (this.division / 4);
    return Math.round(tick / step) * step;
  }

  // ---- リサイズ / メインループ ---------------------------------------------

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _loop() {
    if (this.playing) {
      const sec = this.audio.buffer ? this.audio.currentTime() : (performance.now() - this._wallStart) / 1000 + this._wallStartSec;
      this.scrollTick = this.chart.secondsToTick(sec);
      if (this.audio.buffer && !this.audio.playing) this.pause();
      this.ui.updateTimeReadout(sec, this.scrollTick);
      this._maybeHitSound();
    }
    this.render();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  play() {
    this.playing = true;
    this._hitFired = new Set();
    const sec = this.chart.tickToSeconds(this.scrollTick);
    if (this.audio.buffer) this.audio.play(sec);
    else { this._wallStart = performance.now(); this._wallStartSec = sec; }
    this.ui.setPlayState(true);
  }
  pause() {
    this.playing = false;
    if (this.audio.buffer) this.audio.stop();
    this.ui.setPlayState(false);
  }
  togglePlay() { this.playing ? this.pause() : this.play(); }

  _maybeHitSound() {
    if (!this.hitSoundEnabled) return;
    const tol = 40; // tick tolerance
    const check = (tick, key) => {
      if (tick >= this.scrollTick - tol && tick <= this.scrollTick && !this._hitFired.has(key)) {
        this._hitFired.add(key);
        this.ui.playHitSound && this.ui.playHitSound();
      }
    };
    for (const n of this.chart.notes) check(n.tick, n.id);
    for (const s of this.chart.slides) {
      check(s.connections[0].tick, s.id + ':start');
      check(s.connections[s.connections.length - 1].tick, s.id + ':end');
    }
  }

  // ---- 描画 ---------------------------------------------------------------

  render() {
    const ctx = this.ctx, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, w, h);

    this._drawWaveform();
    this._drawLanes();
    this._drawGrid();
    this._drawGuides();
    this._drawSlides();
    this._drawNotes();
    if (this.building) this._drawBuilding();
    this._drawGhost();
    this._drawJudgeLine();
    if (this.selectionBox) this._drawSelectionBox();
  }

  _visibleTickRange() {
    const h = this.canvas.clientHeight;
    const topTick = this.yToTick(0);
    const bottomTick = this.yToTick(h);
    return [Math.min(topTick, bottomTick) - 200, Math.max(topTick, bottomTick) + 200];
  }

  _drawWaveform() {
    const ctx = this.ctx, h = this.canvas.clientHeight;
    ctx.fillStyle = '#0e1015';
    ctx.fillRect(0, 0, this.waveformW, h);
    if (!this.audio.peaks) return;
    const peaks = this.audio.peaks;
    const midX = this.waveformW / 2;
    ctx.fillStyle = COLORS.waveform;
    for (let y = 0; y < h; y += 1) {
      const tick = this.yToTick(y);
      const sec = this.chart.tickToSeconds(tick);
      const sampleIdx = Math.floor(sec * this.audio.buffer.sampleRate / this.audio.peaksResolution);
      if (sampleIdx < 0 || sampleIdx >= peaks.length / 2) continue;
      const min = peaks[sampleIdx * 2], max = peaks[sampleIdx * 2 + 1];
      const w1 = Math.max(1, max * (this.waveformW / 2 - 4));
      const w2 = Math.max(1, -min * (this.waveformW / 2 - 4));
      ctx.fillRect(midX - w2, y, w1 + w2, 1);
    }
  }

  _drawLanes() {
    const ctx = this.ctx, h = this.canvas.clientHeight;
    for (let i = 0; i < LANES; i++) {
      ctx.fillStyle = (Math.floor(i / 3) % 2 === 0) ? COLORS.laneA : COLORS.laneB;
      ctx.fillRect(this.laneToX(i), 0, this.laneWidthPx, h);
    }
    ctx.strokeStyle = COLORS.laneCenter;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.laneToX(LANES / 2), 0);
    ctx.lineTo(this.laneToX(LANES / 2), h);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.playfieldLeft + 0.5, 0.5, this.playfieldWidth - 1, h - 1);
  }

  _drawGrid() {
    const ctx = this.ctx;
    const [t0, t1] = this._visibleTickRange();

    let measure = 0;
    let tick = 0;
    let guard = 0;
    while (tick < t1 && guard++ < 5000) {
      const sig = this.chart.sigAtMeasure(measure);
      const beatsPerMeasure = sig.numerator * (4 / sig.denominator);
      const measureTickLen = beatsPerMeasure * TICKS_PER_BEAT;
      if (tick + measureTickLen >= t0) {
        const y = this.tickToY(tick);
        ctx.strokeStyle = COLORS.gridMeasure; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(this.playfieldLeft, y); ctx.lineTo(this.playfieldLeft + this.playfieldWidth, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '11px "JetBrains Mono", monospace';
        ctx.fillText(String(measure + 1), 6, y - 3);

        for (let b = 1; b < beatsPerMeasure; b++) {
          const by = this.tickToY(tick + b * TICKS_PER_BEAT);
          ctx.strokeStyle = COLORS.gridBeat; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(this.playfieldLeft, by); ctx.lineTo(this.playfieldLeft + this.playfieldWidth, by); ctx.stroke();
        }
        const subStep = TICKS_PER_BEAT / (this.division / 4);
        for (let st = 0; st < measureTickLen; st += subStep) {
          if (Math.abs(st % TICKS_PER_BEAT) < 1) continue;
          const sy = this.tickToY(tick + st);
          ctx.strokeStyle = COLORS.gridSub; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(this.playfieldLeft, sy); ctx.lineTo(this.playfieldLeft + this.playfieldWidth, sy); ctx.stroke();
        }
      }
      tick += measureTickLen;
      measure++;
    }

    ctx.font = '11px "JetBrains Mono", monospace';
    for (const b of this.chart.sortedBpm()) {
      if (b.tick < t0 || b.tick > t1) continue;
      const y = this.tickToY(b.tick);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(`♩=${b.bpm}`, this.playfieldLeft + this.playfieldWidth + 8, y - 3);
    }
    for (const s of this.chart.sortedTimeSig()) {
      const mt = this.chart.measureToTick(s.measure);
      if (mt < t0 || mt > t1) continue;
      const y = this.tickToY(mt);
      ctx.fillStyle = '#7fc7ff';
      ctx.fillText(`${s.numerator}/${s.denominator}`, this.playfieldLeft + this.playfieldWidth + 8, y + 12);
    }
  }

  _drawJudgeLine() {
    const ctx = this.ctx;
    const y = this.canvas.clientHeight - this.judgeMargin;
    ctx.strokeStyle = COLORS.judge; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(this.playfieldLeft, y); ctx.lineTo(this.playfieldLeft + this.playfieldWidth, y); ctx.stroke();
  }

  _noteColor(note) {
    switch (note.type) {
      case NoteType.TAP: return note.critical ? COLORS.tapCritical : COLORS.tap;
      case NoteType.FLICK: return note.critical ? COLORS.flickCritical : COLORS.flick;
      case NoteType.TRACE: return note.critical ? COLORS.traceCritical : COLORS.trace;
      case NoteType.TRACE_FLICK: return note.critical ? COLORS.traceCritical : COLORS.trace;
      case NoteType.DAMAGE: return COLORS.damage;
    }
    return '#fff';
  }

  _drawNoteShape(x, y, width, note, selected) {
    const ctx = this.ctx;
    const wpx = width * this.laneWidthPx;
    const hpx = 16;
    const isTrace = note.type === NoteType.TRACE || note.type === NoteType.TRACE_FLICK;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = this._noteColor(note);
    ctx.strokeStyle = selected ? COLORS.selection : 'rgba(0,0,0,0.55)';
    ctx.lineWidth = selected ? 3 : 1.5;
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(-wpx / 2 + r, -hpx / 2);
    ctx.arcTo(wpx / 2, -hpx / 2, wpx / 2, hpx / 2, r);
    ctx.arcTo(wpx / 2, hpx / 2, -wpx / 2, hpx / 2, r);
    ctx.arcTo(-wpx / 2, hpx / 2, -wpx / 2, -hpx / 2, r);
    ctx.arcTo(-wpx / 2, -hpx / 2, wpx / 2, -hpx / 2, r);
    ctx.closePath();
    if (isTrace) { ctx.globalAlpha = 0.28; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke(); }
    else { ctx.fill(); ctx.stroke(); }

    if (note.type === NoteType.FLICK || note.type === NoteType.TRACE_FLICK) {
      ctx.fillStyle = '#101015';
      ctx.beginPath();
      const dir = note.flickDir || FlickDir.UP;
      if (dir === FlickDir.UP) { ctx.moveTo(0, -9); ctx.lineTo(7, 3); ctx.lineTo(-7, 3); }
      else if (dir === FlickDir.LEFT) { ctx.moveTo(-9, 0); ctx.lineTo(4, -7); ctx.lineTo(4, 7); }
      else { ctx.moveTo(9, 0); ctx.lineTo(-4, -7); ctx.lineTo(-4, 7); }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  _drawNotes() {
    const [t0, t1] = this._visibleTickRange();
    for (const n of this.chart.notes) {
      if (n.tick < t0 || n.tick > t1) continue;
      const x = this.laneToX(n.lane + n.width / 2);
      const y = this.tickToY(n.tick);
      this._drawNoteShape(x, y, n.width, n, this.chart.selection.has(n.id));
    }
  }

  _easeXY(a, b, t) {
    let tt = t;
    if (a.ease === EaseType.EASE_IN) tt = t * t;
    else if (a.ease === EaseType.EASE_OUT) tt = 1 - (1 - t) * (1 - t);
    return {
      tick: a.tick + (b.tick - a.tick) * t,
      lane: a.lane + a.width / 2 + ((b.lane + b.width / 2) - (a.lane + a.width / 2)) * tt,
      w: a.width + (b.width - a.width) * t,
    };
  }

  _drawSlideBody(conns, critical, selectedSet) {
    const ctx = this.ctx;
    const color = critical ? COLORS.slideCritical : COLORS.slide;
    for (let i = 0; i < conns.length - 1; i++) {
      const a = conns[i], b = conns[i + 1];
      ctx.beginPath();
      const steps = 24;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const p = this._easeXY(a, b, t);
        const x = this.laneToX(p.lane);
        const y = this.tickToY(p.tick);
        const halfW = (p.w / 2) * this.laneWidthPx;
        if (s === 0) ctx.moveTo(x - halfW, y); else ctx.lineTo(x - halfW, y);
      }
      for (let s = steps; s >= 0; s--) {
        const t = s / steps;
        const p = this._easeXY(a, b, t);
        const x = this.laneToX(p.lane);
        const y = this.tickToY(p.tick);
        const halfW = (p.w / 2) * this.laneWidthPx;
        ctx.lineTo(x + halfW, y);
      }
      ctx.closePath();
      ctx.fillStyle = color; ctx.globalAlpha = 0.30; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    }
    for (const c of conns) {
      const x = this.laneToX(c.lane + c.width / 2);
      const y = this.tickToY(c.tick);
      const selected = selectedSet && selectedSet.has(c.__key);
      if (c.type === ConnType.START || c.type === ConnType.END) {
        this._drawNoteShape(x, y, c.width, { type: c.flickDir ? NoteType.FLICK : NoteType.TAP, critical: c.critical ?? critical, flickDir: c.flickDir }, selected);
      } else if (c.type === ConnType.TICK) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = color; ctx.strokeStyle = selected ? COLORS.selection : 'rgba(0,0,0,0.5)'; ctx.lineWidth = selected ? 3 : 1.5;
        const s = 7; ctx.fillRect(-s / 2, -s / 2, s, s); ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else if (c.type === ConnType.ATTACH) {
        ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.trace; ctx.globalAlpha = 0.85; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = selected ? COLORS.selection : 'rgba(0,0,0,0.5)'; ctx.lineWidth = selected ? 3 : 1.5; ctx.stroke();
      }
    }
  }

  _drawSlides() {
    const [t0, t1] = this._visibleTickRange();
    for (const s of this.chart.slides) {
      const conns = s.connections.map(c => ({ ...c, __key: 'slide:' + s.id + ':' + c.tick }));
      const inRange = conns.some(c => c.tick >= t0 && c.tick <= t1);
      if (!inRange) continue;
      this._drawSlideBody(conns, s.critical, this.chart.selection);
    }
  }

  _drawGuides() {
    const ctx = this.ctx;
    const [t0, t1] = this._visibleTickRange();
    for (const g of this.chart.guides) {
      const conns = g.connections.map(c => ({ ...c, __key: 'guide:' + g.id + ':' + c.tick }));
      const inRange = conns.some(c => c.tick >= t0 && c.tick <= t1);
      if (!inRange) continue;
      const color = GUIDE_COLORS[g.color] || GUIDE_COLORS.neutral;
      const sorted = [...conns].sort((a, b) => a.tick - b.tick);
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i], b = sorted[i + 1];
        const steps = 20;
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const p = this._easeXY(a, b, t);
          const x = this.laneToX(p.lane);
          const y = this.tickToY(p.tick);
          const halfW = (p.w / 2) * this.laneWidthPx;
          if (s === 0) { ctx.moveTo(x - halfW, y); }
          else { ctx.lineTo(x - halfW, y); }
        }
        for (let s = steps; s >= 0; s--) {
          const t = s / steps;
          const p = this._easeXY(a, b, t);
          const x = this.laneToX(p.lane);
          const y = this.tickToY(p.tick);
          const halfW = (p.w / 2) * this.laneWidthPx;
          ctx.lineTo(x + halfW, y);
        }
        ctx.closePath();
        ctx.fillStyle = color; ctx.globalAlpha = 0.22; ctx.fill();
        ctx.strokeStyle = color; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      for (const c of sorted) {
        const x = this.laneToX(c.lane + c.width / 2), y = this.tickToY(c.tick);
        const selected = this.chart.selection.has(c.__key);
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = selected ? COLORS.selection : 'rgba(0,0,0,0.4)'; ctx.lineWidth = selected ? 3 : 1; ctx.stroke();
      }
    }
  }

  _drawBuilding() {
    if (this.buildingKind === 'slide') {
      const conns = this.building.connections.map(c => ({ ...c, __key: 'building' }));
      this._drawSlideBody(conns, this.building.critical, new Set());
    } else if (this.buildingKind === 'guide') {
      const save = this.chart.guides;
      this.chart.guides = [...save, this.building];
      this._drawGuides();
      this.chart.guides = save;
    }
  }

  _drawGhost() {
    if (!this.hoverInBounds) return;
    const ctx = this.ctx;
    const tool = this.currentTool;
    if ([TOOLS.SELECT, TOOLS.BPM, TOOLS.TIMESIG, TOOLS.ATTACH].includes(tool)) return;
    const x = this.laneToX(this.hover.lane + this.currentWidth / 2);
    const y = this.tickToY(this.hover.tick);
    ctx.globalAlpha = 0.55;
    this._drawNoteShape(x, y, this.currentWidth, {
      type: (tool === TOOLS.SLIDE || tool === TOOLS.GUIDE) ? NoteType.TAP : tool,
      critical: this.currentCritical,
      flickDir: this.currentFlickDir,
    }, false);
    ctx.globalAlpha = 1;
  }

  _drawSelectionBox() {
    const ctx = this.ctx, b = this.selectionBox;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1);
    const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }

  // ---- 入力処理 -------------------------------------------------------------

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousemove', e => this._onMouseMove(e));
    c.addEventListener('mouseleave', () => { this.hoverInBounds = false; });
    c.addEventListener('mousedown', e => this._onMouseDown(e));
    window.addEventListener('mouseup', e => this._onMouseUp(e));
    c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    c.addEventListener('dblclick', e => this._onDoubleClick(e));
    c.addEventListener('contextmenu', e => { e.preventDefault(); this._onRightClick(e); });
    window.addEventListener('keydown', e => this._onKeyDown(e));
  }

  _mousePos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onMouseMove(e) {
    const { x, y } = this._mousePos(e);
    this.hoverInBounds = x >= this.playfieldLeft && x <= this.playfieldLeft + this.playfieldWidth;
    const rawLane = this.xToLane(x) - this.currentWidth / 2;
    const lane = Math.max(0, Math.min(LANES - this.currentWidth, Math.round(rawLane)));
    this.hover = { tick: Math.max(0, this.snapTick(this.yToTick(y))), lane };

    if (this.dragState) this._handleDrag(x, y);
    if (this.selectionBox) { this.selectionBox.x1 = x; this.selectionBox.y1 = y; }
  }

  _hitTest(x, y) {
    for (let i = this.chart.notes.length - 1; i >= 0; i--) {
      const n = this.chart.notes[i];
      const nx = this.laneToX(n.lane + n.width / 2), ny = this.tickToY(n.tick);
      if (Math.abs(x - nx) <= (n.width * this.laneWidthPx) / 2 + 2 && Math.abs(y - ny) <= 10) {
        return { kind: 'note', obj: n, key: n.id };
      }
    }
    for (let i = this.chart.slides.length - 1; i >= 0; i--) {
      const s = this.chart.slides[i];
      for (const c of s.connections) {
        const nx = this.laneToX(c.lane + c.width / 2), ny = this.tickToY(c.tick);
        if (Math.abs(x - nx) <= (c.width * this.laneWidthPx) / 2 + 2 && Math.abs(y - ny) <= 10) {
          return { kind: 'conn', slide: s, obj: c, key: 'slide:' + s.id + ':' + c.tick };
        }
      }
    }
    for (let i = this.chart.guides.length - 1; i >= 0; i--) {
      const g = this.chart.guides[i];
      for (const c of g.connections) {
        const nx = this.laneToX(c.lane + c.width / 2), ny = this.tickToY(c.tick);
        if (Math.abs(x - nx) <= (c.width * this.laneWidthPx) / 2 + 2 && Math.abs(y - ny) <= 10) {
          return { kind: 'guideConn', slide: g, obj: c, key: 'guide:' + g.id + ':' + c.tick };
        }
      }
    }
    return null;
  }

  // スライド本体のヒットテスト（Attachツール用：区間の帯の中かどうか）
  _hitSlideBody(x, y) {
    const tick = this.yToTick(y);
    for (const s of this.chart.slides) {
      const sorted = [...s.connections].sort((a, b) => a.tick - b.tick);
      if (tick < sorted[0].tick || tick > sorted[sorted.length - 1].tick) continue;
      const { lane, width } = this.chart.slideLaneAt(s, tick);
      const cx = this.laneToX(lane + width / 2);
      if (Math.abs(x - cx) <= (width * this.laneWidthPx) / 2 + 6) return s;
    }
    return null;
  }

  _onMouseDown(e) {
    if (e.button === 2) return;
    const { x, y } = this._mousePos(e);
    if (x < this.playfieldLeft || x > this.playfieldLeft + this.playfieldWidth) {
      if (x < this.waveformW) { this._seekTo(y); }
      return;
    }
    const tick = this.hover.tick, lane = this.hover.lane;

    if (this.currentTool === TOOLS.SELECT) {
      const hit = this._hitTest(x, y);
      if (hit) {
        if (!e.shiftKey && !this.chart.selection.has(hit.key)) this.chart.selection = new Set();
        this.chart.selection.add(hit.key);
        this._beginDrag(x, y);
      } else {
        if (!e.shiftKey) this.chart.selection = new Set();
        this.selectionBox = { x0: x, y0: y, x1: x, y1: y };
      }
      this.ui.refreshSelection && this.ui.refreshSelection();
      return;
    }

    if (this.currentTool === TOOLS.ATTACH) {
      const slide = this._hitSlideBody(x, y);
      if (slide) {
        const { lane: laneAt, width } = this.chart.slideLaneAt(slide, tick);
        this.chart.pushHistory();
        slide.connections.push({ type: ConnType.ATTACH, tick, lane: Math.round(laneAt), width, ease: EaseType.LINEAR });
        this.ui.toast && this.ui.toast('Attachトレースを追加しました');
      } else {
        this.ui.toast && this.ui.toast('スライドの上でクリックしてください', true);
      }
      return;
    }

    if (this.currentTool === TOOLS.BPM) {
      const bpm = prompt('BPM を入力してください', String(this.chart.bpmAt(tick)));
      if (bpm && !isNaN(parseFloat(bpm))) {
        this.chart.pushHistory();
        this.chart.bpmChanges = this.chart.bpmChanges.filter(b => b.tick !== tick);
        this.chart.bpmChanges.push({ tick, bpm: parseFloat(bpm) });
        this.ui.refreshTracks && this.ui.refreshTracks();
      }
      return;
    }
    if (this.currentTool === TOOLS.TIMESIG) {
      const { measure } = this.chart.tickToMeasure(tick);
      const cur = this.chart.sigAtMeasure(measure);
      const input = prompt('拍子を入力してください (例: 4/4)', `${cur.numerator}/${cur.denominator}`);
      if (input && /^\d+\/\d+$/.test(input.trim())) {
        const [num, den] = input.trim().split('/').map(Number);
        this.chart.pushHistory();
        this.chart.timeSignatures = this.chart.timeSignatures.filter(s => s.measure !== measure);
        this.chart.timeSignatures.push({ measure, numerator: num, denominator: den });
        this.ui.refreshTracks && this.ui.refreshTracks();
      }
      return;
    }

    if (this.currentTool === TOOLS.SLIDE) { this._pathClick(tick, lane, 'slide'); return; }
    if (this.currentTool === TOOLS.GUIDE) { this._pathClick(tick, lane, 'guide'); return; }

    // 単発ノーツ配置
    this.chart.pushHistory();
    const note = this.chart.addNote({
      type: this.currentTool, tick, lane, width: this.currentWidth,
      critical: this.currentCritical,
      flickDir: (this.currentTool === TOOLS.FLICK || this.currentTool === TOOLS.TRACE_FLICK) ? this.currentFlickDir : null,
    });
    this.dragState = { type: 'resize', note, startX: x, baseWidth: this.currentWidth, baseLane: lane };
  }

  _pathClick(tick, lane, kind) {
    if (!this.building) {
      this.buildingKind = kind;
      if (kind === 'slide') {
        this.building = {
          critical: this.currentCritical,
          connections: [{ type: ConnType.START, tick, lane, width: this.currentWidth, ease: EaseType.LINEAR, critical: this.currentCritical }],
        };
      } else {
        this.building = {
          color: this.currentGuideColor, fade: this.currentGuideFade,
          connections: [{ type: ConnType.START, tick, lane, width: this.currentWidth, ease: EaseType.LINEAR }],
        };
      }
      this.ui.setSlideHint(true, kind);
    } else {
      this.building.connections.push({ type: ConnType.TICK, tick, lane, width: this.currentWidth, ease: EaseType.LINEAR });
      this.building.connections.sort((a, b) => a.tick - b.tick);
    }
  }

  finishPath(flickDir) {
    if (!this.building || this.building.connections.length < 2) { this.building = null; this.buildingKind = null; this.ui.setSlideHint(false); return; }
    const conns = this.building.connections.sort((a, b) => a.tick - b.tick);
    conns[conns.length - 1].type = ConnType.END;
    this.chart.pushHistory();
    if (this.buildingKind === 'slide') {
      if (flickDir) conns[conns.length - 1].flickDir = flickDir;
      this.chart.addSlide(this.building);
    } else {
      this.chart.addGuide(this.building);
    }
    this.building = null; this.buildingKind = null;
    this.ui.setSlideHint(false);
  }
  cancelSlide() { this.building = null; this.buildingKind = null; this.ui.setSlideHint(false); }

  // ---- ドラッグ移動（複数選択対応・スナップショット方式） --------------------

  _beginDrag(x, y) {
    const items = [];
    for (const key of this.chart.selection) {
      const r = this.chart.resolveKey(key);
      if (r) items.push({ key, kind: r.kind, obj: r.obj, tick0: r.obj.tick, lane0: r.obj.lane });
    }
    this.chart.pushHistory();
    this.dragState = { type: 'move', items, startX: x, startY: y, moved: false };
  }

  _handleDrag(x, y) {
    const d = this.dragState;
    if (!d) return;
    if (d.type === 'resize') {
      const deltaLanes = Math.round((x - d.startX) / this.laneWidthPx);
      const w = Math.max(1, Math.min(LANES - d.baseLane, d.baseWidth + deltaLanes * 2));
      d.note.width = Math.max(1, w);
    } else if (d.type === 'move') {
      d.moved = true;
      const dt = this.snapTick(this.yToTick(y)) - this.snapTick(this.yToTick(d.startY));
      const dl = Math.round((x - d.startX) / this.laneWidthPx);
      for (const it of d.items) {
        it.obj.tick = Math.max(0, it.tick0 + dt);
        const maxLane = LANES - (it.obj.width || 1);
        it.obj.lane = Math.max(0, Math.min(maxLane, it.lane0 + dl));
      }
    }
  }

  _onMouseUp(e) {
    if (this.dragState && this.dragState.type === 'resize') {
      const n = this.dragState.note;
      n.width = Math.max(1, Math.min(LANES, n.width));
      if (n.lane + n.width > LANES) n.lane = LANES - n.width;
    }
    this.dragState = null;
    if (this.selectionBox) {
      const b = this.selectionBox;
      const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1);
      const y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
      if (Math.abs(x1 - x0) > 3 || Math.abs(y1 - y0) > 3) {
        for (const n of this.chart.notes) {
          const nx = this.laneToX(n.lane + n.width / 2), ny = this.tickToY(n.tick);
          if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) this.chart.selection.add(n.id);
        }
        for (const s of this.chart.slides) for (const c of s.connections) {
          const nx = this.laneToX(c.lane + c.width / 2), ny = this.tickToY(c.tick);
          if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) this.chart.selection.add('slide:' + s.id + ':' + c.tick);
        }
        for (const g of this.chart.guides) for (const c of g.connections) {
          const nx = this.laneToX(c.lane + c.width / 2), ny = this.tickToY(c.tick);
          if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) this.chart.selection.add('guide:' + g.id + ':' + c.tick);
        }
      }
      this.selectionBox = null;
    }
    this.ui.refreshSelection && this.ui.refreshSelection();
  }

  _onDoubleClick(e) {
    if ((this.currentTool === TOOLS.SLIDE || this.currentTool === TOOLS.GUIDE) && this.building) this.finishPath(null);
  }

  _onRightClick(e) {
    const { x, y } = this._mousePos(e);
    if ((this.currentTool === TOOLS.SLIDE) && this.building) { this.finishPath(this.currentFlickDir); return; }
    if ((this.currentTool === TOOLS.GUIDE) && this.building) { this.finishPath(null); return; }
    const hit = this._hitTest(x, y);
    if (hit && hit.kind === 'note') {
      this.chart.pushHistory();
      this.chart.removeById(hit.obj.id);
    } else if (hit && (hit.kind === 'conn' || hit.kind === 'guideConn')) {
      this.chart.pushHistory();
      const owner = hit.slide;
      owner.connections = owner.connections.filter(c => c !== hit.obj);
      const list = hit.kind === 'conn' ? 'slides' : 'guides';
      if (owner.connections.length < 2) this.chart[list] = this.chart[list].filter(s => s !== owner);
      else {
        owner.connections.sort((a, b) => a.tick - b.tick);
        owner.connections[0].type = ConnType.START;
        owner.connections[owner.connections.length - 1].type = ConnType.END;
      }
    }
    this.ui.refreshSelection && this.ui.refreshSelection();
  }

  _onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.pxPerBeat = Math.max(24, Math.min(400, this.pxPerBeat - e.deltaY * 0.2));
    } else {
      this.scrollTick = Math.max(0, this.scrollTick + e.deltaY * this.pxPerTick * 2);
    }
  }

  _seekTo(y) {
    const tick = Math.max(0, this.yToTick(y));
    this.scrollTick = tick;
    if (this.audio.buffer) this.audio.playStartOffset = this.chart.tickToSeconds(tick);
  }

  goToTick(tick) { this.scrollTick = Math.max(0, tick); }

  // ---- 選択操作（削除・複製・反転・移動） -------------------------------------

  deleteSelection() {
    if (!this.chart.selection.size) return;
    this.chart.pushHistory();
    for (const key of [...this.chart.selection]) {
      this.chart.notes = this.chart.notes.filter(n => n.id !== key);
      for (const s of this.chart.slides) s.connections = s.connections.filter(c => ('slide:' + s.id + ':' + c.tick) !== key);
      for (const g of this.chart.guides) g.connections = g.connections.filter(c => ('guide:' + g.id + ':' + c.tick) !== key);
    }
    this._pruneEmptyPaths();
    this.chart.selection = new Set();
    this.ui.refreshSelection && this.ui.refreshSelection();
  }

  _pruneEmptyPaths() {
    this.chart.slides = this.chart.slides.filter(s => s.connections.length >= 2);
    for (const s of this.chart.slides) {
      s.connections.sort((a, b) => a.tick - b.tick);
      s.connections[0].type = ConnType.START;
      s.connections[s.connections.length - 1].type = ConnType.END;
    }
    this.chart.guides = this.chart.guides.filter(g => g.connections.length >= 2);
    for (const g of this.chart.guides) {
      g.connections.sort((a, b) => a.tick - b.tick);
      g.connections[0].type = ConnType.START;
      g.connections[g.connections.length - 1].type = ConnType.END;
    }
  }

  nudgeSelection(dTick, dLane) {
    if (!this.chart.selection.size) return;
    this.chart.pushHistory();
    for (const key of this.chart.selection) {
      const r = this.chart.resolveKey(key);
      if (!r) continue;
      r.obj.tick = Math.max(0, r.obj.tick + dTick);
      const maxLane = LANES - (r.obj.width || 1);
      r.obj.lane = Math.max(0, Math.min(maxLane, r.obj.lane + dLane));
    }
  }

  mirrorSelection() {
    if (!this.chart.selection.size) return;
    this.chart.pushHistory();
    const flip = (lane, width) => LANES - lane - width;
    const flipDir = (dir) => dir === FlickDir.LEFT ? FlickDir.RIGHT : dir === FlickDir.RIGHT ? FlickDir.LEFT : dir;
    for (const key of this.chart.selection) {
      const r = this.chart.resolveKey(key);
      if (!r) continue;
      r.obj.lane = flip(r.obj.lane, r.obj.width);
      if (r.obj.flickDir) r.obj.flickDir = flipDir(r.obj.flickDir);
    }
  }

  duplicateSelection() {
    if (!this.chart.selection.size) return;
    this.chart.pushHistory();
    const offset = TICKS_PER_BEAT / (this.division / 4);
    const newKeys = new Set();
    const noteIds = [...this.chart.selection].filter(k => this.chart.notes.some(n => n.id === k));
    for (const id of noteIds) {
      const n = this.chart.notes.find(n => n.id === id);
      const copy = { ...n, id: undefined, tick: n.tick + offset };
      const added = this.chart.addNote(copy);
      newKeys.add(added.id);
    }
    const slideIdsToDupe = new Set();
    const guideIdsToDupe = new Set();
    for (const key of this.chart.selection) {
      if (key.startsWith('slide:')) slideIdsToDupe.add(key.split(':')[1]);
      if (key.startsWith('guide:')) guideIdsToDupe.add(key.split(':')[1]);
    }
    for (const sid of slideIdsToDupe) {
      const s = this.chart.slides.find(s => s.id === sid);
      if (!s) continue;
      const copy = { critical: s.critical, connections: s.connections.map(c => ({ ...c, tick: c.tick + offset })) };
      const added = this.chart.addSlide(copy);
      for (const c of added.connections) newKeys.add('slide:' + added.id + ':' + c.tick);
    }
    for (const gid of guideIdsToDupe) {
      const g = this.chart.guides.find(g => g.id === gid);
      if (!g) continue;
      const copy = { color: g.color, fade: g.fade, connections: g.connections.map(c => ({ ...c, tick: c.tick + offset })) };
      const added = this.chart.addGuide(copy);
      for (const c of added.connections) newKeys.add('guide:' + added.id + ':' + c.tick);
    }
    this.chart.selection = newKeys;
    this.ui.refreshSelection && this.ui.refreshSelection();
  }

  // ---- キーボード ------------------------------------------------------------

  _onKeyDown(e) {
    if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    const step = TICKS_PER_BEAT / (this.division / 4);

    if (e.code === 'Space') { e.preventDefault(); this.togglePlay(); return; }
    if (e.key === 'Escape') { this.cancelSlide(); return; }
    if (e.key === 'Enter' && this.building) { this.finishPath(null); return; }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.chart.redo() : this.chart.undo(); this.ui.refreshSelection && this.ui.refreshSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); this.chart.redo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); this.chart.notes.forEach(n => this.chart.selection.add(n.id)); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); this.duplicateSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') { e.preventDefault(); this.mirrorSelection(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); return; }
    if (e.key === '[') { this.currentWidth = Math.max(1, this.currentWidth - 1); this.ui.syncToolbar(); return; }
    if (e.key === ']') { this.currentWidth = Math.min(LANES, this.currentWidth + 1); this.ui.syncToolbar(); return; }

    if (e.key === 'ArrowUp') { e.preventDefault(); this.nudgeSelection(step, 0); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); this.nudgeSelection(-step, 0); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.nudgeSelection(0, -1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); this.nudgeSelection(0, 1); return; }
    if (e.key === 'Home') { this.goToTick(0); return; }
    if (e.key === 'End') { this.goToTick(this.chart.lastTick()); return; }

    const hot = { '1': TOOLS.SELECT, '2': TOOLS.TAP, '3': TOOLS.FLICK, '4': TOOLS.TRACE, '5': TOOLS.TRACE_FLICK, '6': TOOLS.SLIDE, '7': TOOLS.GUIDE, '8': TOOLS.ATTACH, '9': TOOLS.DAMAGE };
    if (hot[e.key]) { this.currentTool = hot[e.key]; this.cancelSlide(); this.ui.syncToolbar(); return; }
  }
}
