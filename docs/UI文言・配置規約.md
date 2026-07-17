# UI文言・配置規約

> 本書は UI に表示する全文言（ボタン・見出し・ナビ・エラー・空状態・確認・
> aria-label・placeholder）の用語統一と、作成・削除などのアクション導線の配置を
> 定める。表記ゆれ（「タスク」「課題」「イシュー」の混在、「追加」「新規」
> 「作成」の混在など）と配置の非対称（作成・削除の導線がエンティティごとに
> 違う場所にある等）による認知負荷の解消が目的。対象読者は `src/` の UI に
> 触れる開発者。

---

## 1. 目的と適用範囲

対象は次のすべて。

- ボタン・見出し・ナビゲーション
- エラー文言・空状態文言・確認ダイアログ文言
- `aria-label` / `placeholder`（スクリーンリーダー・入力補助のためのテキストも
  画面表示文言と同じ扱いとする）
- 上記に関連するアクション導線（作成・削除・編集・状態遷移・「戻る」）の
  置き場所

本書が扱わない領域は次の既存ドキュメントを正とする。

- CSS の実装規約（レイヤー・トークン・CSS Modules）は
  [フロントエンドCSS規約.md](./フロントエンドCSS規約.md)。
- ID の表示形式（Issue は `Issue #5`、Task は `KEY-5`）は
  [詳細画面設計.md](./詳細画面設計.md) §0 ADR-D4。本書のエンティティ名統一
  （§2）とこの表示形式は矛盾しない。`formatIssueRef` は既に
  `` `Issue #${number}` `` を返しており（`src/lib/formatIssueRef.ts:7`）、
  ADR-D4 の表示形式は英語表記のエンティティ名と整合している。

判断の上位原則（認知負荷理論・行動心理学に基づく汎用 UI/UX 原則）は
開発環境側の `ui-ux` Skill が定める。本書はその task-manager 固有の具体化であり、
両者が食い違う場合は本書（プロジェクト固有規約）を優先する。

---

## 2. エンティティ名

| 概念 | 統一表記 | 禁止表記 |
|---|---|---|
| Issue（課題） | `Issue`（英語固定） | 課題／イシュー |
| Task（解決手段） | `Task`（英語固定） | タスク |

UI 全体は日本語のままとし、動詞・メタラベル（「作成」「削除」「優先度」等）は
日本語で書く。エンティティ名だけを英語に固定し、「Task を削除」のように
分かち書きする。対象はボタン・見出し・ナビだけでなく、aria-label・
placeholder・エラー文言・空状態文言も含む（例:「タスクのタイトル」→
「Task のタイトル」）。

### 現状の分裂（修正対象の実例）

| 種別 | 箇所 | 現状 |
|---|---|---|
| ナビ | `AppLayout.tsx:108-113` | 「タスク」（`to="/"`）と「Issue」（`to="/issues"`）が和英混在 |
| テーブル見出し | `IssueTable.tsx:87-110` | 「Issue／ステータス／タイトル／優先度／タスク／予想／実績／操作」の「タスク」列だけ和訳 |
| セクション見出し | `IssueDetail.tsx:183` | 「タスク（{issue.tasks.length}）」 |
| 進捗表示 | `IssueDetail.tsx:133` | 「タスク {doneCount}/{activeTasks.length} 完了」 |
| aria-label | `IssueTable.tsx:144` | `` `タスク進捗 ${done}/${total}` `` |
| aria-label / placeholder | `AddTaskForm.tsx:51,54` | いずれも「タスクのタイトル」 |
| aria-label / placeholder | `NewIssueForm.tsx:68,71` | いずれも「最初のタスクのタイトル」 |
| placeholder | `NewIssueForm.tsx:63` | 「Issue のタイトル（解決すべき課題）」——Issue と「課題」が同居 |
| ボタン | `NewIssueForm.tsx:49` | 「＋ 新規 Issue」 |
| ボタン | `AddTaskForm.tsx:42` | 「＋ タスク」 |
| formLabel | `IssueDetail.tsx:145` / `TaskDetail.tsx:295` | 同じ `DetailEditForm` の呼び出しで「Issue を編集」 vs 「タスクを編集」と表記が割れている |
| 空状態 | `TaskDetail.tsx:149` | 「タスクが見つかりませんでした。」（`IssueDetail.tsx:73` は「Issue が見つかりませんでした。」） |
| 読み込み中 | `TaskDetail.tsx:162` | 「タスクを読み込み中」（`IssueDetail.tsx:86` は「Issue を読み込み中」） |
| 削除導線 | `TaskDetail.tsx:441` | 「タスクを削除」 |

---

## 3. 動詞ラベル統一表

| 場面 | 統一語 | 現状の分裂例 |
|---|---|---|
| 新規作成・起動ボタン | 「＋ Issue を作成」／「＋ Task を作成」（幅制約時は「＋ 作成」でも可） | `NewIssueForm.tsx:49`「＋ 新規 Issue」／`AddTaskForm.tsx:42`「＋ タスク」——いずれも不適合 |
| 新規作成・確定ボタン | 「作成」 | `NewIssueForm.tsx:87`「作成」（適合）／`AddTaskForm.tsx:64`「追加」（不適合） |
| 新規作成・失敗時エラー | 「作成に失敗しました」 | `NewIssueForm.tsx:36`（適合）／`AddTaskForm.tsx:32`「追加に失敗しました」（不適合） |
| 中断 | 「キャンセル」 | `NewIssueForm.tsx:90` / `DetailEditForm.tsx:104` / `ConfirmPanel.tsx:42`（適合）／`AddTaskForm.tsx:67`「取消」（不適合） |
| 削除・起動ボタン | 「Issue を削除」／「Task を削除」（配置は §5） | `TaskDetail.tsx:441`「タスクを削除」（エンティティ名が §2 に反する→「Task を削除」へ）。`IssueTable.tsx:177` の素の「削除」は #105 で導線ごと撤去するため統一対象外 |
| 削除・確認ボタン | 「削除する」 | `TaskDetail.tsx:242`（適合）。`IssueTable.tsx:186` も語は適合だが、確認パネルごと #105 で撤去される |

「追加」「新規」「取消」は廃止語彙。新規に文言を書く際にこれらを使わない。

---

## 4. ステータス・優先度ラベル対応表

ラベル定数の正は `src/lib/issueMeta.ts`（`ISSUE_STATUS_LABELS`）と
`src/lib/taskMeta.ts`（`TASK_STATUS_LABELS` / `PRIORITY_LABELS`）のみとする。
**コンポーネント内での再定義を禁止する**。`TaskCard.tsx:7-13` が
`PRIORITY_LABELS` を `taskMeta.ts` と別に再定義しているのが違反例——実際に
すでに `none` の表示が食い違っている（TaskCard は「—」、taskMeta 側は「なし」。
リテラルは `taskMeta.ts:8` の `PRIORITY_OPTIONS` にあり、`PRIORITY_LABELS` は
`:16-18` でそこから導出される）。重複排除の際は none の表示をどちらへ寄せるかを明示的に決めること
（挙動不変の機械的作業ではない）。

### 4-1. ステータス

| 内部値 | 統一ラベル | Issue 現状（`issueMeta.ts:5-10`） | Task 現状（`taskMeta.ts:40-47`） |
|---|---|---|---|
| `open` / `todo` | 未着手 | 未着手 | 未着手 |
| `in_progress` | **進行中** | 着手中 → 要変更 | 進行中（変更なし） |
| `done` | 完了 | 完了 | 完了 |
| `canceled` | **中止** | 中止（変更なし） | キャンセル → 要変更 |
| `backlog`（Task のみ） | バックログ | — | バックログ |
| `in_review`（Task のみ） | レビュー中 | — | レビュー中 |

`canceled` を「キャンセル」ではなく「中止」に統一するのは、ボタンの
「キャンセル」（§3・中断の意）と語が衝突するため。1つの語に1つの概念だけを
割り当て、「キャンセルする」がボタン操作を指すのか状態遷移を指すのか読み手が
迷わないようにする。

副作用として `ActiveIssueStrip.tsx:34`「進行中の Issue はありません。」は
現状の `issueMeta.ts` の「着手中」ラベルと矛盾しているが、統一後は
「進行中」で一致する。

### 4-2. 優先度

優先度ラベルは元々 `taskMeta.ts:7-13`（`PRIORITY_OPTIONS`）に一本化されており
Issue/Task で分裂していない。`TaskCard.tsx:7-13` の再定義のみが例外（上記）。

---

## 5. ボタン配置規約

| 導線 | 置き場所 | 根拠 |
|---|---|---|
| Issue 作成 | Issue 一覧（`/issues`）最上部 | 既存どおり（`IssuesView.tsx:83-85`）。加えて Board 画面（`/`）にも Issue 作成導線を追加する。現状 `TasksView.tsx` / `Board.tsx` には Issue 作成手段が無く、空状態案内が到達できない導線名を出す原因になっている（§6-3）。**Board 画面の導線は `/issues` への誘導リンクとする**——インラインフォームは D&D の in-flight mutation 中に別経路の mutation が columns を書き換え楽観更新の巻き戻りを誘発するため原則採用しない（採用する場合は実機6シナリオ×フィルタ ON/OFF に「ドロップ直後の in-flight 中に Issue 作成」を加えた実機検証が必須） |
| Task 作成 | 親 Issue 詳細画面のタスクセクション末尾 | 既存どおり（`IssueDetail.tsx:205-206`）。Task は Issue に従属するため、作成は親 Issue の文脈内で行う |
| 削除 | 詳細画面最下部の danger セクションに統一 | 破壊的操作の隔離によるエラー防止と、Issue/Task 間の対称性の確保。Task は既に `TaskDetail.tsx:434-447` に dangerSection を持つ。Issue には現状この導線が無いため新設し、一覧行末の削除ボタン（`IssueTable.tsx:171-178`、確認パネルは `184-191`）は撤去する |
| 編集 | 詳細ヘッダ右端 | 現状維持（`IssueDetail.tsx:120-126` / `TaskDetail.tsx:277-283`） |
| 戻る（← 一覧へ） | そのエンティティの一覧へ | Issue 詳細は `/issues` へ、Task 詳細は `/` へ。現状は両方 `to="/"` 固定（`IssueDetail.tsx:70-72,83-85,111-113` / `TaskDetail.tsx:146-148,159-161,256-258`）で、Issue 詳細から戻ると Issue 一覧ではなく Board に着地してしまう。`/issues` も `/` 同様 `AppLayout` 配下の子ルート（`src/App.tsx:16-39`）のため、プロジェクト選択の sessionStorage 復元（`AppLayout.tsx:14-17`）は変更後も維持される |
| 状態遷移 | Task 詳細のみ | 既存どおり（`TaskDetail.tsx:362-371`）。Issue のステータスは配下 Task から自動算出される派生値（基本設計書.md §5.1「Issue の派生ステータス（ADR-10）」。実装は `convex/lib/issueStatus.ts` の `deriveIssueStatus`）のため、Issue 詳細には遷移ボタンを置かず「ステータスは配下 Task から自動算出されます」等の説明文を置く（現状 `IssueDetail.tsx:118` はバッジ表示のみで説明文が無い） |

---

## 6. 文言パターン

### 6-1. 確認ダイアログ（宣言形に統一）

「この {対象} を削除します。{付随して消えるもの}。取り消せません。」＋
確認ボタン「削除する」／中断ボタン「キャンセル」の宣言形に統一する。疑問形
（「〜しますか？」）は使わない。

- 適合例（宣言形として）: `IssueTable.tsx:188`「この Issue と配下のタスク・
  Git 連携をすべて削除します。取り消せません。」——ただし「配下のタスク」は
  §2 違反（正しくは「配下の Task」）。この確認パネルは #105 で導線ごと撤去され、
  #104 が Issue 詳細に新設する確認文言では「配下の Task」とする
- 適合例（状態遷移）: `TaskDetail.tsx:246`「「{ステータス}」へ遷移します。
  この操作は取り消せません。」
- 不適合例: `TaskDetail.tsx:247`「このタスクを削除しますか？関連する Git 連携も
  併せて削除されます。」——同じ `ConfirmPanel` を使う3箇所のうち削除確認だけが
  疑問形で取り残されており、エンティティ名も「タスク」のまま（§2 違反）

### 6-2. エラー文言

「{操作}に失敗しました」に統一する。`NewIssueForm.tsx:36`「作成に失敗しました」
が適合、`AddTaskForm.tsx:32`「追加に失敗しました」は不適合（§3 参照）。ただし
複数操作をまとめて扱う汎用フォールバック（`Board.tsx:67` / `TaskDetail.tsx:188`
の「操作に失敗しました」、いずれも D&D や状態遷移・削除・担当変更を一括で
受ける catch 節）は個別の操作名に分解できないため対象外とする。

### 6-3. 空状態

次に取るべき行動を、**実在する導線の名前**で案内する。`Board.tsx:413-416`の
「タスクがありません。Issue 一覧の「＋ タスク」または「＋ 新規 Issue」から
作成できます。」は反面教師。「＋ タスク」は Board 画面（`/`）上には存在せず、
実際には Issue 詳細（`IssueDetail.tsx:206`）にしかない導線を指しており、
案内どおりにはたどり着けない。案内文言を書く際は、指す導線が同一画面または
遷移先に実在することを確認する。

---

## 7. 運用

- UI 文言・アクション導線を追加／変更する際は本書に従う。着手前に
  `ui-ux` Skill（汎用原則）と本書を読み込むこと。
- UI 文言・導線に触れる変更のレビューでは、本書準拠を確認観点に含める
  （frontend-specialist の領域レビュー観点）。
- 既存の分裂例（§2〜§6 に列挙したもの）は本書とは別に、実装 Issue を切って
  段階的に解消する（コード変更は本書のスコープ外）。
- 将来課題: UI 文言は現状コンポーネントへ直書きされており定数化されていない
  （`ISSUE_STATUS_LABELS` / `TASK_STATUS_LABELS` / `PRIORITY_LABELS` 以外の
  ボタン・見出し・エラー文言など）。本書の統一表を元に文言定数
  （`uiText.ts` 等）への一元化を検討する。
