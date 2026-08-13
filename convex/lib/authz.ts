/**
 * プロジェクト内ロールの認可判定（ADR-11 §3.1）。
 *
 * DB 非依存の純関数のみを置く（ユニットテスト対象。DB を触るゲート
 * （membership の解決）は convex/lib/auth.ts 側が担う）。
 * lib/taskStatus.ts と同じ方針で、schema.ts の projectRole validator とは
 * 独立にこのモジュール自身の型を定義する（役割分離を型の独立性で保つ）。
 */

export type ProjectRole = "owner" | "member";

// §3.1 の permission 表と1対1。名称は設計書の表記をそのまま使う。
export type ProjectPermission =
  | "project.delete" // プロジェクト削除
  | "project.members.manage" // メンバー追加・除名・ロール変更
  | "project.settings.edit" // プロジェクト設定・リポジトリ連携の追加/削除
  | "task.*"; // Issue/Task の CRUD・状態遷移・D&D・GitLink

// role → Set<permission> のコード内静的マップ(§3.1)。
// ロール・権限の追加はこのマップの拡張のみで行う(OCP)。
const ROLE_PERMISSIONS: Record<ProjectRole, ReadonlySet<ProjectPermission>> = {
  owner: new Set([
    "project.delete",
    "project.members.manage",
    "project.settings.edit",
    "task.*",
  ]),
  member: new Set(["task.*"]),
};

/**
 * プロジェクト内ロールが permission を持つかの判定純関数。
 * 判定材料は「ロールのみ」。member ドキュメントや作成者情報は引数に取らない
 * （作成者ベース等の例外判定を型レベルで不可能にする・§3.1。
 * Member.role（admin/member=システム軸）もこのモジュールには一切登場しない
 * ＝ god mode の構造的排除）。
 */
export function hasProjectPermission(
  role: ProjectRole,
  permission: ProjectPermission,
): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
