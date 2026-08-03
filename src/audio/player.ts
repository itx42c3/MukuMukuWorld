/**
 * Web Audio API を使った音声再生エンジン。
 * - 音声ファイル読み込み（ローカルファイル選択 / IndexedDB永続化と連携）
 * - 再生・一時停止・シーク
 * - 現在の再生位置を秒で取得（Canvas描画のtick変換に使用）
 * - 判定音（ヒットサウンド）のミキシング用に簡易サンプラーも持つ
 */
export type PlaybackListener = (currentSeconds: number, isPlaying: boolean) => void;

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;

  private startedAtCtxTime = 0;   // AudioContext.currentTimeの基準
  private startedAtOffset = 0;    // 再生開始時点のオフセット秒
  private playing = false;
  private rafId: number | null = null;

  private listeners: Set<PlaybackListener> = new Set();

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async loadFromArrayBuffer(data: ArrayBuffer): Promise<void> {
    const ctx = this.ensureContext();
    this.stop();
    this.buffer = await ctx.decodeAudioData(data.slice(0));
  }

  async loadFromFile(file: File): Promise<void> {
    const data = await file.arrayBuffer();
    await this.loadFromArrayBuffer(data);
  }

  getDurationSeconds(): number {
    return this.buffer?.duration ?? 0;
  }

  isLoaded(): boolean {
    return this.buffer !== null;
  }

  subscribe(fn: PlaybackListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    const cur = this.getCurrentSeconds();
    for (const l of this.listeners) l(cur, this.playing);
  }

  getCurrentSeconds(): number {
    if (!this.ctx) return this.startedAtOffset;
    if (!this.playing) return this.startedAtOffset;
    return this.startedAtOffset + (this.ctx.currentTime - this.startedAtCtxTime);
  }

  play(fromSeconds?: number) {
    if (!this.buffer) return;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended') ctx.resume();

    this.stopSourceOnly();

    const offset = fromSeconds ?? this.getCurrentSeconds();
    const clampedOffset = Math.max(0, Math.min(offset, this.buffer.duration));

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gainNode!);
    src.start(0, clampedOffset);

    this.sourceNode = src;
    this.startedAtCtxTime = ctx.currentTime;
    this.startedAtOffset = clampedOffset;
    this.playing = true;

    src.onended = () => {
      if (this.sourceNode === src) {
        this.playing = false;
        this.emit();
      }
    };

    this.startLoop();
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.startedAtOffset = this.getCurrentSeconds();
    this.stopSourceOnly();
    this.playing = false;
    this.stopLoop();
    this.emit();
  }

  stop() {
    this.stopSourceOnly();
    this.playing = false;
    this.startedAtOffset = 0;
    this.stopLoop();
    this.emit();
  }

  seek(seconds: number) {
    const wasPlaying = this.playing;
    this.stopSourceOnly();
    this.startedAtOffset = Math.max(0, seconds);
    if (wasPlaying) {
      this.play(this.startedAtOffset);
    } else {
      this.emit();
    }
  }

  setVolume(v: number) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v));
  }

  private stopSourceOnly() {
    if (this.sourceNode) {
      try { this.sourceNode.onended = null; this.sourceNode.stop(); } catch { /* already stopped */ }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  private startLoop() {
    const tick = () => {
      this.emit();
      if (this.playing) this.rafId = requestAnimationFrame(tick);
    };
    this.stopLoop();
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /** 判定音などの短いワンショットサンプルを鳴らす */
  async playOneShot(buffer: AudioBuffer, volume = 0.6) {
    const ctx = this.ensureContext();
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  /**
   * ノーツ通過音（簡易クリック音）を鳴らす。
   * ノーツ種別を問わず440Hz(A4)の短い単音で、実サウンドファイルを持たない
   * OscillatorNodeベースの軽量実装。判定精度確認用のメトロノーム的な用途。
   */
  playNoteTick(volume = 0.35) {
    const ctx = this.ensureContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 440;
    // クリック的な短い減衰エンベロープ（プチノイズ防止のため立ち上がりも少し持たせる）
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }
}

export const audioPlayer = new AudioPlayer();
