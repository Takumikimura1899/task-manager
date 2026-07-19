import type { Doc, Id } from "../convex/_generated/dataModel";
import type {
  CurrentMember,
  MemberSummary,
} from "../src/hooks/useCurrentMember";

/**
 * convex/react（useQuery / useMutation）を vi.mock でモックするための共有ヘルパ。
 *
 * convex/ の外に置く理由は test/convexSupport.ts と同じ（convex/ 配下は
 * `convex dev`/`deploy` のバンドル対象になるため）。加えてこのファイルは
 * vitest の収集対象（*.test/*.spec）にも該当しないため単独実行されない。
 *
 * ## なぜ vi.mock 自体は各テストファイルに残すのか
 * vi.mock の factory は巻き上げ（ファイル先頭への物理移動）の対象になり、
 * ファイル内で通常の `const` 等で宣言した変数を参照すると
 * "Cannot access before initialization" になる。これを避けるため各テスト
 * ファイル側で `vi.hoisted` で `useQueryMock` / `mutate` を作り、`vi.mock`
 * の factory から参照する必要がある（Vitest の制約）。
 *
 * ディスパッチ本体（getFunctionName 解決や名前ディスパッチ）はここに一元化し、
 * factory の中から `await import("../../test/reactQuerySupport")` で
 * 呼び出す（getFunctionName 自体を `await import("convex/server")` で動的
 * import しているのと同じ形に揃えている）。
 *
 * api の関数参照（anyApi）は参照同一性を持たないため、getFunctionName で
 * "module:function" 名の文字列に解決してからディスパッチする。
 */

export type QueryMock = (
  name: string,
  args: Record<string, unknown> | undefined,
) => unknown;

export type MutateMock = (args: unknown) => Promise<unknown>;

/**
 * vi.mock("convex/react", ...) の factory 本体。
 * 呼び出し側は `vi.hoisted` で作った useQueryMock / mutate をそのまま渡す。
 */
export const buildConvexReactMock = async (
  useQueryMock: QueryMock,
  mutate: MutateMock,
) => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (
      query: Parameters<typeof getFunctionName>[0],
      args?: Record<string, unknown>,
    ) => useQueryMock(getFunctionName(query), args),
    useMutation: () => mutate,
    // 認証ゲート（App.tsx の AuthLoading / Unauthenticated / Authenticated）。
    // テストは「認証済み」を既定とし、Authenticated だけが children を描画する。
    // 未認証・ロード中の分岐を検証するテストは vi.mock で個別に差し替える。
    Authenticated: ({ children }: { children?: unknown }) => children ?? null,
    Unauthenticated: () => null,
    AuthLoading: () => null,
  };
};

/**
 * vi.mock("@convex-dev/auth/react", ...) の factory 本体。
 * useAuthActions（signIn / signOut）を呼び出し側の spy に差し替える。
 * AppLayout（ログアウト）や SignIn を描画するテストで使う。
 */
export const buildConvexAuthActionsMock = (actions: {
  signIn?: (...args: unknown[]) => Promise<unknown>;
  signOut?: (...args: unknown[]) => Promise<unknown>;
}) => ({
  useAuthActions: () => ({
    signIn: actions.signIn ?? (() => Promise.resolve()),
    signOut: actions.signOut ?? (() => Promise.resolve()),
  }),
});

/**
 * useQueryMock.mockImplementation に渡すディスパッチャを組み立てる。
 * handlers はクエリ名 → 返却値（または args を受け取って返却値を決める関数。
 * args 依存の分岐が要るクエリ用）のレコード。handlers に無いクエリ名は
 * undefined（ロード中/未購読を表す）を返す。
 *
 * 注意（購読値の参照安定性）: Convex の実際の購読は同じスナップショットに
 * 対しては同一参照を返す。handlers に渡す配列・オブジェクトは呼び出しの
 * たびに new せず、外側で一度だけ作った変数を渡すこと。毎回新しい参照を
 * 返すと、参照比較に依存するコンポーネント側の同期 effect（例: Board）が
 * 無限ループ・ちらつきを起こす。
 */
export type QueryHandlers = Record<
  string,
  unknown | ((args: Record<string, unknown> | undefined) => unknown)
>;

export const createQueryDispatcher =
  (handlers: QueryHandlers): QueryMock =>
  (name, args) => {
    if (!(name in handlers)) return undefined;
    const handler = handlers[name];
    return typeof handler === "function"
      ? (handler as (args: Record<string, unknown> | undefined) => unknown)(
          args,
        )
      : handler;
  };

// --- ファクトリ -------------------------------------------------------------

/** projects.list の1件分のモックデータを作る。 */
export const createProject = (overrides: Partial<Doc<"projects">> = {}) =>
  ({
    _id: "project_1" as Id<"projects">,
    _creationTime: 1000,
    key: "TASK",
    name: "タスク管理",
    nextTaskNumber: 1,
    nextIssueNumber: 1,
    ...overrides,
  }) as Doc<"projects">;

/**
 * members.list の1件分のモックデータを作る。
 * members.list は PII（email 等）を未認証クライアントへ露出しないため
 * {_id, name} のみを返す（convex/members.ts 参照、型は MemberSummary =
 * FunctionReturnType<typeof api.members.list>[number] を単一の情報源とする）。
 * 実クエリが返さない email/role は含めない。
 */
export const createMember = (overrides: Partial<MemberSummary> = {}) =>
  ({
    _id: "member_1" as Id<"members">,
    name: "Alice",
    ...overrides,
  }) as MemberSummary;

/**
 * members.me の non-null 戻り値（ログイン中の本人）のモックデータを作る。
 * 本人自身の照会のため email / role を含む（convex/members.ts 参照）。
 */
export const createCurrentMember = (overrides: Partial<CurrentMember> = {}) =>
  ({
    _id: "member_1" as Id<"members">,
    name: "Alice",
    role: "member",
    email: "alice@example.com",
    ...overrides,
  }) as CurrentMember;
