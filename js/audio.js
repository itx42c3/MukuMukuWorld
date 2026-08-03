// ============================================================================
// audio.js — 音源の読み込み・波形生成・再生同期
// ============================================================================

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.peaks = null; // Float32Array min/max pairs per pixel-column at fixed resolution
    this.peaksResolution = 512; // samples per peak column
    this.source = null;
    this.playing = false;
    this.playStartCtxTime = 0;
    this.playStartOffset = 0; // seconds into track
    this.gain = null;
    this.volume = 0.8;
    this.onEnded = null;
  }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async load(file) {
    this.ensureCtx();
    const arrayBuf = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arrayBuf);
    this._buildPeaks();
    return this.buffer.duration;
  }

  _buildPeaks() {
    const data = this.buffer.getChannelData(0);
    const res = this.peaksResolution;
    const cols = Math.ceil(data.length / res);
    const peaks = new Float32Array(cols * 2);
    for (let c = 0; c < cols; c++) {
      let min = 1, max = -1;
      const start = c * res;
      const end = Math.min(start + res, data.length);
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      peaks[c * 2] = min;
      peaks[c * 2 + 1] = max;
    }
    this.peaks = peaks;
  }

  get duration() { return this.buffer ? this.buffer.duration : 0; }

  currentTime() {
    if (!this.playing) return this.playStartOffset;
    return this.playStartOffset + (this.ctx.currentTime - this.playStartCtxTime);
  }

  play(fromSeconds) {
    if (!this.buffer) return;
    this.stop();
    this.ensureCtx();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const offset = Math.max(0, fromSeconds ?? 0);
    src.start(0, offset);
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        if (this.onEnded) this.onEnded();
      }
    };
    this.source = src;
    this.playStartCtxTime = this.ctx.currentTime;
    this.playStartOffset = offset;
    this.playing = true;
  }

  stop() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch (e) {}
      this.source = null;
    }
    if (this.playing) this.playStartOffset = this.currentTime();
    this.playing = false;
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }
}
