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
@layer reset, tokens, base, components, utilities;
```

| レイヤー | 役割 | 例 |
|---|---|---|
| `reset` | 要素の素の挙動を整える最小リセット | `box-sizing`, `margin: 0` |
| `tokens` | デザイントークン（`:root` のカスタムプロパティ） | `--color-*`, `--space-*` |
| `base` | クラスを持たない素の要素の地の装飾 | `body`, `a` |
| `components` | コンポーネント単位のスタイル（`*.module.css`） | `.card`, `.board` |
| `utilities` | 横断的な単機能クラス（最強・濫用禁止） | `.hint` |

各CSSファイルは**自分の属するレイヤーで中身をラップする**（例: `@layer components { … }`）。

---

## 2. デザイントークン

- 色・余白・角丸・タイポ・レイアウト幅は `src/styles/tokens.css` の
  カスタムプロパティに**一元化**する。
- コンポーネントでの**値の直書きを禁止**する。必ず `var(--*)` を参照する。
- 余白は4pxグリッド（`--space-1`=4px 〜 `--space-6`=24px）。
- テーマ切替（ダークモード等）が必要になったら `light-dark()` とトークンの
  差し替えで対応する（コンポーネント側は無改修で済む）。

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
    index.css       # @layer宣言 + 基盤のimportエントリ（main.tsxで最初に読む）
    reset.css       # @layer reset
    tokens.css      # @layer tokens
    base.css        # @layer base
    utilities.css   # @layer utilities
  components/
    <Component>/
      <Component>.tsx
      <Component>.module.css   # @layer components
```
