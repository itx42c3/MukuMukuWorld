# MukuMukuWorld

Sonolus / NextSekai 系エンジン向けの Project Sekai 譜面エディタです。MikuMikuWorld4CC を参考にした操作感（クリック配置・ドラッグで幅調整・スライド連結・BPM/拍子トラック・波形同期）を、サーバー不要のブラウザ単体（PWA）で実現しています。

## 使い方（ローカルで開く）

Service Worker はセキュリティ上 `file://` では動作しないため、簡易サーバー経由で開いてください。

```bash
cd sekai-editor
python3 -m http.server 8080
# もしくは: npx serve .
```

ブラウザで `http://localhost:8080` を開きます。右上の「⇩ インストール」ボタンが出たら、それをクリックするとデスクトップ/ホーム画面にアプリとして追加できます（2回目以降はオフラインでも起動可能）。

## 主な機能

**ノーツ**
- Tap / Critical Tap
- Flick（左・上・右）/ Critical Flick
- Trace / Critical Trace / Trace Flick
- Damage（判定なしの減衰ノーツ）
- Slide（始点・中継点・終点、区間ごとに ease：Linear / Ease In / Ease Out）
- Guide（判定なしの装飾パス。6色 × フェード in/out に対応）
- Attach（スライド上に付随する Trace。スライドの補間位置へ自動スナップ）

**編集操作**
- 12レーン・幅1〜12（ワイド/フルワイドノーツ対応）
- グリッド分割：1/4, 1/8, 1/12, 1/16, 1/24, 1/32, 1/48（三連対応）、Ctrl+ホイールでズーム
- 選択ツール：範囲選択・複数選択・ドラッグ移動・矢印キーでの微調整
- 複製（Ctrl+D）／左右反転（Ctrl+M）／削除（Del）
- 選択中オブジェクトのプロパティパネル（レーン・幅・Critical・フリック方向・easeを直接編集、複数選択時は一括Critical切替）
- BPM／拍子の一覧パネル（追加はクリック配置、削除はワンクリック）
- Undo / Redo（Ctrl+Z / Ctrl+Shift+Z、履歴に応じてボタンも自動的に有効/無効化）
- ショートカット一覧モーダル（画面右上の「?」）

**再生・音源**
- 音源読み込み＋波形表示＋Web Audioでの再生同期
- 音源オフセット調整（ms単位）
- 打音（ノーツ通過時の簡易クリック音、オン/オフ切替可）

**保存形式**
- ネイティブ `.json`（BPM/拍子/全ノーツ/ガイドを完全保持、編集の継続用）
- `.usc`（Sonolus pjsekai系エンジンで使われるUSC形式でのエクスポート/インポート。single/slide/guide/bpm/timeSignatureに対応）

## USC形式についての注意

USCはSonolusのpjsekai系エンジン（Chart Cyanvas / NextSekai 等）で使われる非公式な共通フォーマットで、エンジンの実装（フォーク）によって細部のフィールド名や仕様が異なることがあります。書き出した `.usc` は、実際にアップロードするサーバー/エンジンで一度読み込みテストを行うことをおすすめします。差異があれば `js/usc.js` の `USC.export` / `USC.import` を調整してください。

## 未実装・今後の拡張候補

- ハイスピード（タイムスケール）レイヤー
- .sus 形式（公式互換）の入出力
- メトロノーム、キースキン/レーンカスタム
- クリップボードを使ったコピー＆ペースト（現状は複製=Ctrl+Dで代替）

## ファイル構成

```
index.html       画面本体
style.css        スタイル
manifest.json    PWAマニフェスト
sw.js            Service Worker（オフラインキャッシュ）
js/model.js      譜面データモデル（tick/BPM/拍子/ガイド/Undo）
js/usc.js        USC/ネイティブ形式の入出力
js/audio.js      音声デコード・波形・再生
js/editor.js     Canvas描画・操作ロジック本体
js/main.js       UI配線・プロパティパネル・ファイルI/O・PWA登録
icons/           PWAアイコン
```
