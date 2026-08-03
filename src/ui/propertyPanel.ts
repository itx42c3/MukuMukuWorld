/**
 * 右サイドのプロパティパネル。
 * - 選択中ノーツの lane/width/flick方向/ease 編集
 * - BPMイベント・拍子イベントの一覧編集
 */
import { EditorStore } from '../core/store';
import { NoteKind, FlickDirection, EaseType } from '../core/chart';
import { NOTE_STYLES } from './noteStyles';

export function buildPropertyPanel(container: HTMLElement, store: EditorStore) {
  container.className = 'property-panel';

  const render = () => {
    const state = store.getState();
    container.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = 'プロパティ';
    container.appendChild(title);

    const selectedIds = [...state.selection.noteIds];
    if (selectedIds.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'property-empty';
      empty.textContent = 'ノーツを選択すると詳細を編集できます';
      container.appendChild(empty);
    } else {
      const allNotes = [
        ...state.chart.singleNotes,
        ...state.chart.slides.flatMap(s => s.notes),
      ];
      const note = allNotes.find(n => n.id === selectedIds[0]);
      if (note) {
        container.appendChild(buildField('レーン', String(note.lane), (v) => {
          store.mutateChart(chart => {
            const target = findNote(chart, note.id);
            if (target) target.lane = parseFloat(v) || 0;
          });
        }));
        container.appendChild(buildField('幅', String(note.width), (v) => {
          store.mutateChart(chart => {
            const target = findNote(chart, note.id);
            if (target) target.width = Math.max(0.5, parseFloat(v) || 1);
          });
        }));
        container.appendChild(buildField('Tick', String(note.tick), (v) => {
          store.mutateChart(chart => {
            const target = findNote(chart, note.id);
            if (target) target.tick = Math.max(0, parseInt(v, 10) || 0);
          });
        }));

        if (note.kind === 'flick' || note.kind === 'criticalFlick') {
          container.appendChild(buildFlickSelect(note.flick ?? 'up', (v) => {
            store.mutateChart(chart => {
              const target = findNote(chart, note.id);
              if (target) target.flick = v;
            });
          }));
        }
      }
    }

    container.appendChild(buildBpmSection(store));
    container.appendChild(buildMetaSection(store));
  };

  store.subscribe(render);
  render();
}

function findNote(chart: ReturnType<EditorStore['getState']>['chart'], id: string) {
  const single = chart.singleNotes.find(n => n.id === id);
  if (single) return single;
  for (const s of chart.slides) {
    const n = s.notes.find(nn => nn.id === id);
    if (n) return n;
  }
  return null;
}

function buildField(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.step = '0.5';
  input.addEventListener('change', () => onChange(input.value));
  wrap.appendChild(l);
  wrap.appendChild(input);
  return wrap;
}

function buildFlickSelect(current: FlickDirection, onChange: (v: FlickDirection) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const l = document.createElement('label');
  l.textContent = 'フリック方向';
  const select = document.createElement('select');
  const options: { value: FlickDirection; label: string }[] = [
    { value: 'up', label: '上' },
    { value: 'left', label: '左' },
    { value: 'right', label: '右' },
  ];
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === current) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => onChange(select.value as FlickDirection));
  wrap.appendChild(l);
  wrap.appendChild(select);
  return wrap;
}

function buildBpmSection(store: EditorStore): HTMLElement {
  const state = store.getState();
  const section = document.createElement('div');
  section.className = 'panel-section';

  const h = document.createElement('h4');
  h.textContent = 'BPM';
  section.appendChild(h);

  const list = document.createElement('div');
  list.className = 'bpm-list';
  for (const b of [...state.chart.bpmEvents].sort((a, b2) => a.tick - b2.tick)) {
    const row = document.createElement('div');
    row.className = 'bpm-row';

    const tickInput = document.createElement('input');
    tickInput.type = 'number';
    tickInput.value = String(b.tick);
    tickInput.addEventListener('change', () => {
      store.mutateChart(chart => {
        const ev = chart.bpmEvents.find(e => e.id === b.id);
        if (ev) ev.tick = Math.max(0, parseInt(tickInput.value, 10) || 0);
      });
    });

    const bpmInput = document.createElement('input');
    bpmInput.type = 'number';
    bpmInput.value = String(b.bpm);
    bpmInput.step = '0.01';
    bpmInput.addEventListener('change', () => {
      store.mutateChart(chart => {
        const ev = chart.bpmEvents.find(e => e.id === b.id);
        if (ev) ev.bpm = Math.max(1, parseFloat(bpmInput.value) || 120);
      });
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.className = 'icon-btn';
    delBtn.addEventListener('click', () => {
      store.mutateChart(chart => {
        chart.bpmEvents = chart.bpmEvents.filter(e => e.id !== b.id);
      });
    });

    row.appendChild(tickInput);
    row.appendChild(bpmInput);
    row.appendChild(delBtn);
    list.appendChild(row);
  }
  section.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.className = 'add-btn';
  addBtn.textContent = '+ BPM追加';
  addBtn.addEventListener('click', () => {
    store.mutateChart(chart => {
      chart.bpmEvents.push({
        id: crypto.randomUUID(),
        tick: state.view.currentTick,
        bpm: chart.bpmEvents[chart.bpmEvents.length - 1]?.bpm ?? 120,
      });
    });
  });
  section.appendChild(addBtn);

  return section;
}

function buildMetaSection(store: EditorStore): HTMLElement {
  const state = store.getState();
  const section = document.createElement('div');
  section.className = 'panel-section';
  const h = document.createElement('h4');
  h.textContent = '楽曲情報';
  section.appendChild(h);

  const fields: { key: 'title' | 'artist' | 'author'; label: string }[] = [
    { key: 'title', label: '曲名' },
    { key: 'artist', label: 'アーティスト' },
    { key: 'author', label: '譜面作者' },
  ];
  for (const f of fields) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const l = document.createElement('label');
    l.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = state.chart[f.key];
    input.addEventListener('change', () => {
      store.mutateChart(chart => { chart[f.key] = input.value; });
    });
    wrap.appendChild(l);
    wrap.appendChild(input);
    section.appendChild(wrap);
  }
  return section;
}
