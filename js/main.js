// ============================================================================
// main.js — UI配線・ファイルI/O・PWA登録
// ============================================================================

const chart = new Chart();
const audio = new AudioEngine();

// ---- 打音（Web Audio による簡易シンセ。外部サンプル不要でオフライン動作） ----
let hitAudioCtx = null;
function playHitSound() {
  try {
    if (!hitAudioCtx) hitAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = hitAudioCtx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1800, t0);
    gain.gain.setValueAtTime(0.16, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.1);
  } catch (e) { /* ignore */ }
}

// ---- トースト通知 ----------------------------------------------------------
function showToast(msg, isError) {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

const ui = {
  setPlayState(playing) {
    document.getElementById('btnPlay').textContent = playing ? '❚❚ 一時停止 (Space)' : '▶ 再生 (Space)';
  },
  updateTimeReadout(sec, tick) {
    const m = Math.floor(sec / 60), s = sec % 60;
    const { measure } = chart.tickToMeasure(tick);
    const beat = Math.floor((tick - chart.measureToTick(measure)) / TICKS_PER_BEAT) + 1;
    document.getElementById('timeReadout').textContent =
      `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')} ・ 小節 ${measure + 1} 拍 ${beat}`;
  },
  setSlideHint(on, kind) {
    const el = document.getElementById('slideHint');
    el.hidden = !on;
    if (on) {
      el.textContent = kind === 'guide'
        ? 'ガイド編集中 — クリックで中継点を追加 / Enterで確定 / Escで取消'
        : 'スライド編集中 — クリックで中継点を追加 / Enterで通常終端 / 右クリックでFlick終端 / Escで取消';
    }
  },
  toast: showToast,
  playHitSound,
  syncToolbar() {
    document.getElementById('fWidth').value = editor.currentWidth;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === editor.currentTool));
    document.getElementById('fCritical').checked = editor.currentCritical;
    document.querySelectorAll('#segDir button').forEach(b => b.classList.toggle('active', b.dataset.dir === editor.currentFlickDir));
    document.getElementById('guideAttrGroup').classList.toggle('show', editor.currentTool === TOOLS.GUIDE);
  },
  refreshSelection() { renderPropPanel(); },
  refreshTracks() { renderTrackList(); },
};

const canvas = document.getElementById('chartCanvas');
const editor = new Editor(canvas, chart, audio, ui);

// ---- ツールバー -------------------------------------------------------------

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    editor.currentTool = btn.dataset.tool;
    editor.cancelSlide();
    ui.syncToolbar();
  });
});

document.getElementById('fWidth').addEventListener('input', e => {
  editor.currentWidth = Math.max(1, Math.min(LANES, parseInt(e.target.value) || 1));
});
document.getElementById('fCritical').addEventListener('change', e => {
  editor.currentCritical = e.target.checked;
});
document.querySelectorAll('#segDir button').forEach(btn => {
  btn.addEventListener('click', () => {
    editor.currentFlickDir = btn.dataset.dir;
    ui.syncToolbar();
  });
});
document.getElementById('fDivision').addEventListener('change', e => {
  editor.division = parseInt(e.target.value);
});
document.getElementById('fZoom').addEventListener('input', e => {
  editor.pxPerBeat = parseInt(e.target.value);
});
document.querySelectorAll('#guideColors .sw').forEach(btn => {
  btn.addEventListener('click', () => {
    editor.currentGuideColor = btn.dataset.color;
    document.querySelectorAll('#guideColors .sw').forEach(b => b.classList.toggle('active', b === btn));
  });
});
document.getElementById('fGuideFade').addEventListener('change', e => { editor.currentGuideFade = e.target.value; });
document.getElementById('fHitSound').addEventListener('change', e => { editor.hitSoundEnabled = e.target.checked; });

document.getElementById('btnPlay').addEventListener('click', () => editor.togglePlay());
document.getElementById('btnDelete').addEventListener('click', () => editor.deleteSelection());
document.getElementById('btnDuplicate').addEventListener('click', () => editor.duplicateSelection());
document.getElementById('btnMirror').addEventListener('click', () => editor.mirrorSelection());
document.getElementById('btnUndo').addEventListener('click', () => { chart.undo(); renderPropPanel(); });
document.getElementById('btnRedo').addEventListener('click', () => { chart.redo(); renderPropPanel(); });

document.getElementById('fVolume').addEventListener('input', e => audio.setVolume(parseFloat(e.target.value)));
document.getElementById('fOffset').addEventListener('input', e => { chart.audioOffsetMs = parseFloat(e.target.value) || 0; });

['fTitle', 'fArtist', 'fCharter'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    chart[id.replace('f', '').toLowerCase()] = e.target.value;
  });
});

// ---- ヘルプモーダル ---------------------------------------------------------

document.getElementById('btnHelp').addEventListener('click', () => { document.getElementById('helpModal').hidden = false; });
document.getElementById('closeHelp').addEventListener('click', () => { document.getElementById('helpModal').hidden = true; });
document.getElementById('helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') e.target.hidden = true; });

// ---- メニュー -----------------------------------------------------------

document.querySelectorAll('.menu').forEach(menu => {
  const btn = menu.querySelector('.menu-btn');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = menu.classList.contains('open');
    document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
    if (!wasOpen) menu.classList.add('open');
  });
});
window.addEventListener('click', () => document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')));

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function loadFieldsFromChart() {
  document.getElementById('fTitle').value = chart.title;
  document.getElementById('fArtist').value = chart.artist;
  document.getElementById('fCharter').value = chart.charter;
  document.getElementById('fOffset').value = chart.audioOffsetMs;
  renderTrackList();
  renderPropPanel();
}

document.getElementById('mNew').addEventListener('click', () => {
  if (!confirm('現在の譜面を破棄して新規作成しますか？')) return;
  chart.reset();
  loadFieldsFromChart();
  showToast('新規譜面を作成しました');
});

document.getElementById('mSaveProject').addEventListener('click', () => {
  downloadJSON(NativeProject.export(chart), `${chart.title || 'chart'}.json`);
  showToast('プロジェクトを保存しました');
});
document.getElementById('mOpenProject').addEventListener('click', () => document.getElementById('fileProject').click());
document.getElementById('fileProject').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const loaded = NativeProject.import(json);
    Object.assign(chart, loaded);
    chart.selection = new Set();
    loadFieldsFromChart();
    showToast(`「${chart.title}」を読み込みました`);
  } catch (err) { showToast('読み込みに失敗しました: ' + err.message, true); }
  e.target.value = '';
});

document.getElementById('mExportUsc').addEventListener('click', () => {
  downloadJSON(USC.export(chart), `${chart.title || 'chart'}.usc`);
  showToast('USCを書き出しました');
});
document.getElementById('mImportUsc').addEventListener('click', () => document.getElementById('fileUsc').click());
document.getElementById('fileUsc').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const json = JSON.parse(await file.text());
    const loaded = USC.import(json);
    loaded.title = chart.title; loaded.artist = chart.artist; loaded.charter = chart.charter;
    Object.assign(chart, loaded);
    chart.selection = new Set();
    loadFieldsFromChart();
    showToast('USCを読み込みました');
  } catch (err) { showToast('読み込みに失敗しました: ' + err.message, true); }
  e.target.value = '';
});

document.getElementById('mImportAudio').addEventListener('click', () => document.getElementById('fileAudio').click());
document.getElementById('fileAudio').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  document.getElementById('audioName').textContent = '音源: 読み込み中…';
  try {
    const dur = await audio.load(file);
    document.getElementById('audioName').textContent = `音源: ${file.name} (${dur.toFixed(1)}s)`;
    showToast('音源を読み込みました');
  } catch (err) {
    document.getElementById('audioName').textContent = '音源: 読み込み失敗';
    showToast('音源の読み込みに失敗しました', true);
  }
  e.target.value = '';
});

// ---- プロパティパネル -------------------------------------------------------

function renderPropPanel() {
  const panel = document.getElementById('propPanel');
  const sel = chart.selection;
  if (!sel.size) { panel.innerHTML = '<div class="prop-empty">オブジェクトを選択してください</div>'; return; }

  if (sel.size > 1) {
    panel.innerHTML = `<div class="prop-title">${sel.size} 件選択中</div>
      <div class="prop-row"><label>一括操作</label></div>
      <div class="btn-grid" style="margin-top:4px">
        <button class="icon-btn" id="pBatchCritOn">Critical ON</button>
        <button class="icon-btn" id="pBatchCritOff">Critical OFF</button>
      </div>`;
    document.getElementById('pBatchCritOn')?.addEventListener('click', () => batchSetCritical(true));
    document.getElementById('pBatchCritOff')?.addEventListener('click', () => batchSetCritical(false));
    return;
  }

  const key = [...sel][0];
  const r = chart.resolveKey(key);
  if (!r) { panel.innerHTML = '<div class="prop-empty">オブジェクトを選択してください</div>'; return; }
  const obj = r.obj;
  const { measure } = chart.tickToMeasure(obj.tick);
  const beat = ((obj.tick - chart.measureToTick(measure)) / TICKS_PER_BEAT + 1).toFixed(2);

  let label = '';
  if (r.kind === 'note') label = { tap: 'Tap', flick: 'Flick', trace: 'Trace', traceFlick: 'Trace Flick', damage: 'Damage' }[obj.type] || obj.type;
  else if (r.kind === 'conn') label = 'Slide: ' + { start: '始点', tick: '中継点', end: '終点', attach: 'Attach' }[obj.type];
  else label = 'Guide: ' + { start: '始点', tick: '中継点', end: '終点' }[obj.type];

  let html = `<div class="prop-title">${label} <span class="prop-badge" style="background:var(--panel-3);color:var(--text-dim)">m${measure + 1} / ${beat}拍</span></div>`;
  html += `<div class="prop-row"><label>レーン</label><input type="number" id="pLane" min="0" max="${LANES - obj.width}" value="${obj.lane}"></div>`;
  html += `<div class="prop-row"><label>幅</label><input type="number" id="pWidth" min="1" max="${LANES}" value="${obj.width}"></div>`;

  if (r.kind === 'note' && (obj.type !== NoteType.DAMAGE)) {
    html += `<div class="prop-row"><label>Critical</label><input type="checkbox" id="pCritical" ${obj.critical ? 'checked' : ''}></div>`;
  }
  if (r.kind === 'conn' && obj.type !== ConnType.TICK && obj.type !== ConnType.ATTACH) {
    html += `<div class="prop-row"><label>Critical</label><input type="checkbox" id="pCritical" ${obj.critical ? 'checked' : ''}></div>`;
  }
  if (obj.type === NoteType.FLICK || obj.type === NoteType.TRACE_FLICK || (r.kind === 'conn' && obj.type === ConnType.END)) {
    html += `<div class="prop-row"><label>フリック方向</label><div class="seg" id="pDir">
      <button data-d="left" class="${obj.flickDir === 'left' ? 'active' : ''}">←</button>
      <button data-d="up" class="${(!obj.flickDir || obj.flickDir === 'up') ? 'active' : ''}">↑</button>
      <button data-d="right" class="${obj.flickDir === 'right' ? 'active' : ''}">→</button>
      <button data-d="none" class="${obj.flickDir === null && r.kind === 'conn' ? 'active' : ''}">無</button>
    </div></div>`;
  }
  if ((r.kind === 'conn' || r.kind === 'guideConn') && (obj.type === ConnType.START || obj.type === ConnType.TICK)) {
    html += `<div class="prop-row"><label>Ease</label><div class="seg" id="pEase">
      <button data-e="linear" class="${obj.ease === 'linear' ? 'active' : ''}">Linear</button>
      <button data-e="in" class="${obj.ease === 'in' ? 'active' : ''}">In</button>
      <button data-e="out" class="${obj.ease === 'out' ? 'active' : ''}">Out</button>
    </div></div>`;
  }

  panel.innerHTML = html;

  document.getElementById('pLane')?.addEventListener('input', e => {
    chart.pushHistory();
    obj.lane = Math.max(0, Math.min(LANES - obj.width, parseInt(e.target.value) || 0));
  });
  document.getElementById('pWidth')?.addEventListener('input', e => {
    chart.pushHistory();
    obj.width = Math.max(1, Math.min(LANES - obj.lane, parseInt(e.target.value) || 1));
  });
  document.getElementById('pCritical')?.addEventListener('change', e => {
    chart.pushHistory();
    obj.critical = e.target.checked;
  });
  document.getElementById('pDir')?.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      chart.pushHistory();
      obj.flickDir = b.dataset.d === 'none' ? null : b.dataset.d;
      renderPropPanel();
    });
  });
  document.getElementById('pEase')?.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      chart.pushHistory();
      obj.ease = b.dataset.e;
      renderPropPanel();
    });
  });
}

function batchSetCritical(val) {
  chart.pushHistory();
  for (const key of chart.selection) {
    const r = chart.resolveKey(key);
    if (r && r.obj.type !== ConnType.TICK && r.obj.type !== ConnType.ATTACH) r.obj.critical = val;
  }
  showToast(val ? 'Criticalを一括ONにしました' : 'Criticalを一括OFFにしました');
}

// ---- BPM / 拍子 一覧パネル ---------------------------------------------------

function renderTrackList() {
  const host = document.getElementById('trackList');
  const items = [];
  for (const b of chart.sortedBpm()) items.push({ kind: 'bpm', tick: b.tick, label: `♩=${b.bpm}`, data: b });
  for (const s of chart.sortedTimeSig()) items.push({ kind: 'sig', tick: chart.measureToTick(s.measure), label: `${s.numerator}/${s.denominator} (m${s.measure + 1})`, data: s });
  items.sort((a, b) => a.tick - b.tick);

  if (!items.length) { host.innerHTML = '<div class="track-empty">まだありません</div>'; return; }
  host.innerHTML = items.map((it, i) => `
    <div class="track-item">
      <span>${it.kind === 'bpm' ? '♩' : '▤'} ${it.label}</span>
      <button data-i="${i}" data-kind="${it.kind}">✕</button>
    </div>`).join('');

  host.querySelectorAll('button').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      const it = items[i];
      if (it.kind === 'bpm' && chart.bpmChanges.length <= 1) { showToast('BPMは最低1つ必要です', true); return; }
      if (it.kind === 'sig' && it.data.measure === 0) { showToast('先頭の拍子は削除できません', true); return; }
      chart.pushHistory();
      if (it.kind === 'bpm') chart.bpmChanges = chart.bpmChanges.filter(b => b !== it.data);
      else chart.timeSignatures = chart.timeSignatures.filter(s => s !== it.data);
      renderTrackList();
    });
  });
}

// ---- 選択情報・統計の定期更新 ----------------------------------------------

setInterval(() => {
  const stats = document.getElementById('stats');
  const counts = { tap: 0, flick: 0, trace: 0, damage: 0 };
  for (const n of chart.notes) {
    if (n.type === NoteType.TAP) counts.tap++;
    else if (n.type === NoteType.FLICK || n.type === NoteType.TRACE_FLICK) counts.flick++;
    else if (n.type === NoteType.TRACE) counts.trace++;
    else if (n.type === NoteType.DAMAGE) counts.damage++;
  }
  const totalNotes = counts.tap + counts.flick + counts.trace + chart.slides.length + counts.damage;
  stats.textContent = `Tap ${counts.tap} ・ Flick ${counts.flick} ・ Trace ${counts.trace} ・ Slide ${chart.slides.length} ・ Guide ${chart.guides.length} ・ Damage ${counts.damage}\n合計 ${totalNotes} ノーツ`;
  document.getElementById('btnUndo').disabled = !chart._history.length;
  document.getElementById('btnRedo').disabled = !chart._future.length;
}, 300);

ui.syncToolbar();
renderTrackList();
renderPropPanel();

// ---- PWA: Service Worker & インストール導線 --------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  document.getElementById('btnInstall').hidden = false;
});
document.getElementById('btnInstall').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  document.getElementById('btnInstall').hidden = true;
});

// 誤操作防止：離脱前確認（ノーツが1件以上ある場合）
window.addEventListener('beforeunload', (e) => {
  if (chart.notes.length || chart.slides.length || chart.guides.length) {
    e.preventDefault();
    e.returnValue = '';
  }
});
