# フロントエンドCSS規約

> 本書はフロントエンド（`src/`）のスタイリング方針を定める。

## 0. 方針の要石

**CSSフレームワーク（Tailwind 等）は採用しない。pure CSS で書く。**

理由:

- モダンCSS（ネスト・`@layer`・カスタムプロパティ・`color-mix()`・`:has()`・
  コンテナクエリ・論理プロパティ等）の進化が著しく、ネイティブ機能だけで
  十分に構造化・保守できる。
- フレームワークはその進化に追従しきれず、いずれ**負債**になりうる。依存を
  抱えるより、標準に賭ける。

ただし「すべてを1枚の `style.css` に集約」もスケールしないため、以下の構造で
**関心を分割**する。

---

## 1. カスケードレイヤー（`@layer`）

優先順位は **読み込み順ではなく宣言順**で決める。詳細度バトルと `!important` を
排除するのが目的。順序は `src/styles/index.css` で一度だけ宣言する:

```css
@layer reset, tokens, base, vendor, components, utilities;
```

| レイヤー | 役割 | 例 |
|---|---|---|
| `reset` | 要素の素の挙動を整える最小リセット | `box-sizing`, `margin: 0` |
| `tokens` | デザイントークン（`:root` のカスタムプロパティ） | `--color-*`, `--space-*` |
| `base` | クラスを持たない素の要素の地の装飾 | `body`, `a` |
| `vendor` | サードパーティ CSS（レイヤー付き import で取り込む） | `@uiw/react-md-editor` |
| `components` | コンポーネント単位のスタイル（`*.module.css`） | `.card`, `.board` |
| `utilities` | 横断的な単機能クラス（最強・濫用禁止） | `.hint` |

各CSSファイルは**自分の属するレイヤーで中身をラップする**（例: `@layer components { … }`）。

### vendor レイヤー（サードパーティ CSS）

レイヤー外の CSS はすべてのレイヤーより強く、`components` の上書きを破壊する。
そのためサードパーティ CSS は次の手順で必ず `vendor` レイヤーに取り込む:

1. ライブラリ JS からの副作用 import（`import "xxx.css"`）は `vite.config.ts` の
   `stripVendorCss` プラグインで空モジュール化する。
2. `src/styles/index.css` から `@import "…" layer(vendor);` で一元 import する。
3. テーマ調整はトークンへの橋渡しファイル（例: `src/styles/markdown-theme.css`、
   `@layer components`）で行う。ベンダーのクラスは CSS Modules の管轄外のため、
   `:global` は使わずこの橋渡しファイルに集約する。

---

## 2. デザイントークン

- 色・余白・角丸・タイポ・レイアウト幅は `src/styles/tokens.css` の
  カスタムプロパティに**一元化**する。
- コンポーネントでの**値の直書きを禁止**する。必ず `var(--*)` を参照する。
- 余白は4pxグリッド（`--space-1`=4px 〜 `--space-6`=24px）。

### 2.1 テーマ（ダーク固定）

**テーマは近未来ダーク+ネオンの1本のみ**とし、ライトテーマは提供しない
（ターゲットがエンジニアであること、演出をダーク前提で設計していることによる決定）。

- `base.css` で `color-scheme: dark` を宣言し、ネイティブUI（select・
  スクロールバー等）もダーク描画に揃える。
- 文字に使う色は WCAG AA（4.5:1）を満たす明度に保つ。根拠となる実測値は
  `tokens.css` のコメントに残す。
- 将来ライト対応する場合は `light-dark()` とトークン差し替えで行う
  （コンポーネント側は無改修で済む）。

### 2.2 演出トークン（glow / gradient / shadow）

ネオン演出も**トークン経由でのみ**使う（stylelint が hex 直書きを禁止しており、
影・グラデーションの色も例外ではない）:

- `--glow-accent-sm` — hover・focus の微発光。`--glow-accent-md` — ドラッグ中
  など強調時の発光。`--glow-danger` — 破壊的操作の hover。
- `--shadow-card` — カード・パネルの既定影（ダーク地では暗さで奥行きを出す）。
- `--gradient-accent` — 主ボタンの塗り・見出しのグラデ文字。
  `--gradient-edge` — カード上端などの1px発光ライン。
  `--gradient-ambient` — body 背景専用のアンビエント光。
- 演出は**操作フィードバック中心**に留める。背景の常時アニメーション・
  無限ループ発光は追加しない。

### 2.3 モーショントークン

- `transition` / `animation` の時間は必ず `--duration-fast|base|slow` を参照する。
  `prefers-reduced-motion: reduce` 時に `tokens.css` が一括で 0ms に落とすため、
  コンポーネント側の個別対応は不要（無限アニメーションだけは Skeleton のように
  個別に `animation: none` で止める）。
- イージングは `--ease-out` を既定とする。

### 2.4 タイポグラフィの使い分け

- `--font-sans` — 本文・UIの既定。
- `--font-display`（Space Grotesk Variable、self-host） — 見出し・タイトル。
- `--font-mono` — ID（`PROJ-12` / `Issue #N`）・カウンタ・日時など
  「データ然とした文字」。`font-variant-numeric: tabular-nums` と併用する。
- セクション見出しの強調は `text-transform: uppercase` +
  `letter-spacing: var(--tracking-wide)` で行う。

---

## 3. スコープ機構：CSS Modules

コンポーネントのスタイル衝突は **CSS Modules（`*.module.css`）** で防ぐ。

- ファイル中身は**純粋なCSS**（独自DSLなし）。Viteがビルド時にクラス名を
  ハッシュ化してローカルスコープ化する＝ランタイムゼロ。
- **コンポーネントと同じディレクトリに co-locate** する（1ファイル肥大化の否定）。

```
src/
  components/
    TaskCard/
      TaskCard.tsx
      TaskCard.module.css   ← このコンポーネント専用
```

```css
/* TaskCard.module.css */
@layer components {
  .card {
    background: var(--color-surface);
    border-radius: var(--radius-sm);
  }
}
```

```tsx
// TaskCard.tsx
import s from "./TaskCard.module.css";
<article className={s.card}>…</article>;
```

- クラス名はコンポーネント内で意味が通る短い名前にする（`card`, `title`）。
  Modulesがスコープを保証するため BEM 的な接頭辞は不要。
- 真に横断的なものだけ `utilities` レイヤーのグローバルクラスにする。

---

## 4. モダンCSSの活用指針

積極的に使ってよい（=フレームワーク不要の根拠）:

- **ネスト**（`&`）でセレクタの繰り返しを削減
- **論理プロパティ**（`margin-inline`, `padding-block`）
- `color-mix()` / `light-dark()` でトークンから派生色を生成
- `:has()` による親選択、コンテナクエリによる局所レスポンシブ
- `clamp()` / `min()` / `max()` で可変サイズ

新しめの機能を使うときは対象ブラウザのサポート（Baseline）を確認する。

---

## 5. ディレクトリ構成

```
src/
  styles/
    index.css          # @layer宣言 + 基盤のimportエントリ（main.tsxで最初に読む）
    reset.css          # @layer reset
    tokens.css         # @layer tokens
    base.css           # @layer base
    markdown-theme.css # @layer components（vendor CSSへのトークン橋渡し）
    utilities.css      # @layer utilities
  components/
    <Component>/
      <Component>.tsx
      <Component>.module.css   # @layer components
```
