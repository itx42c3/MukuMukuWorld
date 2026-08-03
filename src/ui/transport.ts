/**
 * 下部の再生トランスポート（再生/停止、シークバー、波形表示、BPM/拍子/スナップ設定）
 */
import { EditorStore } from '../core/store';
import { AudioPlayer } from '../audio/player';
import { buildTimeMap, tickToSeconds, secondsToTick, TICKS_PER_BEAT, Chart } from '../core/chart';

/** 譜面中の全ノーツのtickを昇順ソートして取り出す（判定音の通過検出用） */
function collectSortedNoteTicks(chart: Chart): number[] {
  const ticks: number[] = [];
  for (const n of chart.singleNotes) {
    if (n.kind === 'anchor') continue; // 経由点は無音（見た目のみ）
    ticks.push(n.tick);
  }
  for (const s of chart.slides) {
    for (const n of s.notes) {
      if (n.kind === 'anchor') continue;
      ticks.push(n.tick);
    }
  }
  ticks.sort((a, b) => a - b);
  return ticks;
}

/** ソート済みtick配列のうち (fromTick, toTick] の範囲に入る個数を二分探索で数える */
function countTicksInRange(sortedTicks: number[], fromTick: number, toTick: number): number {
  const upper = upperBound(sortedTicks, toTick);
  const lower = upperBound(sortedTicks, fromTick);
  return upper - lower;
}

function upperBound(sortedTicks: number[], value: number): number {
  let lo = 0;
  let hi = sortedTicks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedTicks[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function buildTransport(container: HTMLElement, store: EditorStore, player: AudioPlayer) {
  container.className = 'transport';
  container.innerHTML = `
    <div class="transport-controls">
      <button class="transport-btn" id="btn-play" title="再生/一時停止 (Space)">▶</button>
      <button class="transport-btn" id="btn-stop" title="停止">■</button>
      <span class="transport-time" id="time-display">00:00.000</span>
      <label class="transport-snap">
        スナップ
        <select id="snap-select">
          <option value="4">1/4</option>
          <option value="8">1/8</option>
          <option value="16" selected>1/16</option>
          <option value="12">1/12</option>
          <option value="24">1/24</option>
          <option value="32">1/32</option>
          <option value="48">1/48</option>
        </select>
      </label>
      <label class="transport-file">
        <input type="file" id="audio-input" accept="audio/*" hidden />
        <button class="transport-btn" id="btn-load-audio">音声読込</button>
      </label>
      <span class="transport-filename" id="audio-filename">未読込</span>
      <label class="transport-notesound">
        <input type="checkbox" id="notesound-toggle" checked />
        ノーツ音
      </label>
    </div>
    <div class="waveform-wrap">
      <canvas id="waveform-canvas"></canvas>
    </div>
  `;

  const playBtn = container.querySelector<HTMLButtonElement>('#btn-play')!;
  const stopBtn = container.querySelector<HTMLButtonElement>('#btn-stop')!;
  const timeDisplay = container.querySelector<HTMLElement>('#time-display')!;
  const snapSelect = container.querySelector<HTMLSelectElement>('#snap-select')!;
  const audioInput = container.querySelector<HTMLInputElement>('#audio-input')!;
  const loadAudioBtn = container.querySelector<HTMLButtonElement>('#btn-load-audio')!;
  const filenameSpan = container.querySelector<HTMLElement>('#audio-filename')!;
  const waveformCanvas = container.querySelector<HTMLCanvasElement>('#waveform-canvas')!;
  const noteSoundToggle = container.querySelector<HTMLInputElement>('#notesound-toggle')!;

  // --- ノーツ音再生用の状態 ---
  // mutateChart()は同一オブジェクトを直接書き換えるためchart参照は不変。
  // 「編集を検知するたび」だと重いので、再生開始時にキャッシュを作り直す方式にする
  // （編集は基本停止中に行うワークフローのため、これで実用上十分）。
  let noteSoundEnabled = true;
  let sortedNoteTicks: number[] = collectSortedNoteTicks(store.getState().chart);
  let lastTick = store.getState().view.currentTick;

  noteSoundToggle.addEventListener('change', () => {
    noteSoundEnabled = noteSoundToggle.checked;
  });

  playBtn.addEventListener('click', () => {
    if (player.isLoaded()) {
      if (store.getState().isPlaying) {
        player.pause();
      } else {
        sortedNoteTicks = collectSortedNoteTicks(store.getState().chart);
        lastTick = store.getState().view.currentTick;
        player.play();
      }
    }
  });

  stopBtn.addEventListener('click', () => {
    player.stop();
    store.setView({ currentTick: 0 });
    lastTick = 0;
  });

  snapSelect.addEventListener('change', () => {
    store.setView({ snapDivisor: parseInt(snapSelect.value, 10) });
  });

  loadAudioBtn.addEventListener('click', () => audioInput.click());
  audioInput.addEventListener('change', async () => {
    const file = audioInput.files?.[0];
    if (!file) return;
    await player.loadFromFile(file);
    filenameSpan.textContent = file.name;
    store.mutateChart(chart => { chart.musicFile = file.name; });
    drawWaveform(waveformCanvas, player);
  });

  player.subscribe((currentSeconds, isPlaying) => {
    store.setPlaying(isPlaying);
    const timeMap = buildTimeMap(store.getState().chart);
    const tick = secondsToTick(timeMap, currentSeconds - store.getState().chart.musicOffsetSeconds);
    store.setView({ currentTick: tick });
    playBtn.textContent = isPlaying ? '⏸' : '▶';
    timeDisplay.textContent = formatTime(currentSeconds);

    // --- ノーツ通過音判定 ---
    // 前フレームのtickから今フレームのtickまでの間を通過したノーツがあれば鳴らす。
    // シーク・巻き戻し時（tickが減った場合）は誤検出を避けるためスキップする。
    if (isPlaying && noteSoundEnabled && tick > lastTick) {
      const passed = countTicksInRange(sortedNoteTicks, lastTick, tick);
      if (passed > 0) player.playNoteTick();
    }
    lastTick = tick;
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
      ev.preventDefault();
      if (player.isLoaded()) {
        if (store.getState().isPlaying) {
          player.pause();
        } else {
          sortedNoteTicks = collectSortedNoteTicks(store.getState().chart);
          lastTick = store.getState().view.currentTick;
          player.play();
        }
      }
    }
  });
}

function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(3).padStart(6, '0')}`;
}

function drawWaveform(canvas: HTMLCanvasElement, player: AudioPlayer) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const buffer = (player as any).buffer as AudioBuffer | null;
  if (!buffer) return;

  const data = buffer.getChannelData(0);
  const width = rect.width;
  const height = rect.height;
  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.fillStyle = '#101017';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#4fd1c5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < width; i++) {
    let min = 1.0, max = -1.0;
    for (let j = 0; j < step; j++) {
      const idx = i * step + j;
      if (idx >= data.length) break;
      const v = data[idx];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.moveTo(i, amp + min * amp);
    ctx.lineTo(i, amp + max * amp);
  }
  ctx.stroke();
}
