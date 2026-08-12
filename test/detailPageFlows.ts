import { act, screen } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConvexError } from "convex/values";
import type { ReactElement } from "react";
import { expect, it, type Mock } from "vitest";

/**
 * IssueDetail.test.tsx / TaskDetail.test.tsx で構造が同一な2系統のテストを
 * 共有化するファクトリ（テスト重複削減の監査 #4）。
 *
 * - 削除フロー（Issue #104）の in-flight パターン3種＋確認パネル自動クローズ
 * - 楽観ロック（Issue #73）の2パターン
 *
 * エンティティ差分（文言・ボタンラベル・ルート・ファクトリ）だけを harness で
 * 注入し、セットアップ／アサーションの構造はここに一元化する。
 * このファイルは vitest の収集対象外（test/convexSupport.ts と同じ配置）。
 * TaskDetail 固有の「状態遷移パネルとの相互排他」テストはここに含めず、
 * TaskDetail.test.tsx に個別のまま残す。
 */

type MutateMock = Mock<(args: Record<string, unknown>) => Promise<unknown>>;

/** IssueDetail/TaskDetail の楽観ロック競合時に共通の固定文言。 */
const CONFLICT_MESSAGE =
  "競合が発生しました。他の更新があったため最新を取得してください。";

/** 両画面で共有する購読・レンダリングの注入ポイント。 */
interface DetailFlowHarness<TEntity> {
  /** entity のファクトリ（createIssue / createTask）。 */
  createEntity: (overrides?: Record<string, unknown>) => TEntity;
  /** 購読モックへ値をセットする（mocks.issue = / mocks.task =）。 */
  setEntity: (v: TEntity | null | undefined) => void;
  /** 素の render（rerender 取得用）。 */
  render: () => RenderResult;
  /** 別エンティティへの client-side 遷移ボタンを含む render。 */
  renderWithNavHelper: () => RenderResult;
  /** rerender に渡す最新 UI（購読値の変化を反映する）。 */
  ui: () => ReactElement;
  mutate: MutateMock;
}

// --- 削除フロー（in-flight 3パターン） ---------------------------------------

interface DeleteInFlightFlowConfig<TEntity> extends DetailFlowHarness<TEntity> {
  deleteButtonLabel: string;
  loadingStatusLabel: string;
  notFoundText: string;
  listScreenText: string;
  /** it のタイトル（画面ごとの Issue 番号・文言差分を保つため呼び出し側で指定）。 */
  testTitles: {
    readYourWrites: string;
    inFlightNav: string;
    concurrentDelete: string;
  };
}

/**
 * 削除フロー（Issue #104）の in-flight 3パターンを登録する。
 * 呼び出し側の describe ブロック内で呼ぶこと。
 */
export function describeDeleteInFlightFlows<TEntity>(
  config: DeleteInFlightFlowConfig<TEntity>,
) {
  const confirmButtonLabel = "削除する";

  it(config.testTitles.readYourWrites, async () => {
    const user = userEvent.setup();
    config.setEntity(config.createEntity());
    let resolveRemove: (() => void) | undefined;
    config.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    const { rerender } = config.render();

    await user.click(
      screen.getByRole("button", { name: config.deleteButtonLabel }),
    );
    await user.click(screen.getByRole("button", { name: confirmButtonLabel }));

    // 削除ミューテーションがまだ解決していない間に、購読側が
    // read-your-writes で先に null を返す状況を再現する。
    config.setEntity(null);
    rerender(config.ui());

    expect(screen.queryByText(config.notFoundText)).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: config.loadingStatusLabel }),
    ).toBeInTheDocument();

    resolveRemove?.();

    expect(await screen.findByText(config.listScreenText)).toBeVisible();
  });

  it(config.testTitles.inFlightNav, async () => {
    const user = userEvent.setup();
    config.setEntity(config.createEntity());
    let resolveRemove: (() => void) | undefined;
    config.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );
    config.renderWithNavHelper();

    await user.click(
      screen.getByRole("button", { name: config.deleteButtonLabel }),
    );
    await user.click(screen.getByRole("button", { name: confirmButtonLabel }));

    // 削除が in-flight のまま、別の（購読側が null を返す＝存在しない）
    // エンティティへ client-side 遷移する。
    config.setEntity(null);
    await user.click(screen.getByRole("button", { name: "go-to-next" }));

    expect(screen.getByText(config.notFoundText)).toBeVisible();
    expect(
      screen.queryByRole("status", { name: config.loadingStatusLabel }),
    ).not.toBeInTheDocument();

    // 削除が完了しても、別エンティティを見ているユーザーを一覧へ強制遷移しない。
    await act(async () => {
      resolveRemove?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText(config.listScreenText)).not.toBeInTheDocument();
    expect(screen.getByText(config.notFoundText)).toBeVisible();
  });

  it(config.testTitles.concurrentDelete, async () => {
    const user = userEvent.setup();
    config.setEntity(config.createEntity());
    config.mutate.mockRejectedValueOnce(new ConvexError("削除に失敗しました"));
    const { rerender } = config.render();

    await user.click(
      screen.getByRole("button", { name: config.deleteButtonLabel }),
    );
    await user.click(screen.getByRole("button", { name: confirmButtonLabel }));

    // 自分の削除は失敗する一方、購読側は他ユーザーの削除により null を返す
    // （並行削除）。
    config.setEntity(null);
    rerender(config.ui());

    expect(screen.getByText(config.notFoundText)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("削除に失敗しました");
  });
}

// --- 確認パネル自動クローズ ---------------------------------------------------

interface ConfirmPanelAutoCloseConfig<
  TEntity,
> extends DetailFlowHarness<TEntity> {
  /** パネルを開くボタン（Issue: 削除ボタン／Task: 状態遷移ボタン）。 */
  openPanelButtonLabel: string;
  /** パネル表示中に出る確認文言。 */
  panelText: string;
  /** 現在表示中エンティティの overrides（遷移元 URL の number 等と一致させる）。 */
  currentEntityOverrides: Record<string, unknown>;
  /** 遷移先エンティティの overrides（別 number・別タイトル）。 */
  otherEntityOverrides: Record<string, unknown>;
  testTitle: string;
}

/**
 * 確認パネルを開いたまま別エンティティへ client-side 遷移すると、
 * パネルが自動的に閉じることを検証する（Issue #104 追加対応）。
 * Issue 側は削除確認パネル、Task 側は状態遷移確認パネルで検証されているが、
 * 「パネルを開く → 別エンティティへ遷移 → パネルが閉じ、mutate は呼ばれない」
 * という構造は共通のためここに集約する。
 */
export function itConfirmPanelAutoCloses<TEntity>(
  config: ConfirmPanelAutoCloseConfig<TEntity>,
) {
  it(config.testTitle, async () => {
    const user = userEvent.setup();
    config.setEntity(config.createEntity(config.currentEntityOverrides));
    config.renderWithNavHelper();

    await user.click(
      screen.getByRole("button", { name: config.openPanelButtonLabel }),
    );
    expect(screen.getByText(config.panelText)).toBeVisible();

    // 確認する前に、別の（実在する）エンティティへ client-side 遷移する。
    config.setEntity(config.createEntity(config.otherEntityOverrides));
    await user.click(screen.getByRole("button", { name: "go-to-next" }));

    expect(screen.queryByText(config.panelText)).not.toBeInTheDocument();
    expect(config.mutate).not.toHaveBeenCalled();
  });
}

// --- 楽観ロック（Issue #73） --------------------------------------------------

interface OptimisticLockFlowConfig<
  TEntity extends { revision: number },
> extends DetailFlowHarness<TEntity> {
  /** 編集フォームの aria-label（"Issue を編集" / "Task を編集"）。 */
  editFormLabel: string;
  testTitles: {
    conflictOnSave: string;
    retryAfterSuccess: string;
  };
}

/**
 * 楽観ロック（Issue #73）の2パターンを登録する。
 * サーバー側の楽観ロックは「購読中の最新 revision と expectedRevision が
 * 不一致なら競合」で模す（実装と同じ判定を mutate のモック実装に持たせる）。
 */
export function describeOptimisticLockFlows<
  TEntity extends { revision: number },
>(config: OptimisticLockFlowConfig<TEntity>) {
  const INITIAL_REVISION = 3;
  const ADVANCED_REVISION = 4;

  /** サーバー側の楽観ロックを模す: 購読中の最新 revision と不一致なら競合。 */
  const mockOptimisticLockServer = (current: () => TEntity) => {
    config.mutate.mockImplementation(async (args) => {
      if (args.expectedRevision !== current().revision) {
        throw new ConvexError(CONFLICT_MESSAGE);
      }
      return undefined;
    });
  };

  it(config.testTitles.conflictOnSave, async () => {
    const user = userEvent.setup();
    let entity = config.createEntity({ revision: INITIAL_REVISION });
    config.setEntity(entity);
    mockOptimisticLockServer(() => entity);
    const { rerender } = config.render();

    await user.click(screen.getByRole("button", { name: "編集" }));

    // 編集中に他者が更新し、購読値の revision が進む。
    entity = config.createEntity({
      revision: ADVANCED_REVISION,
      title: "他者による更新",
    });
    config.setEntity(entity);
    rerender(config.ui());

    await user.click(screen.getByRole("button", { name: "保存" }));

    // 編集開始時点の revision を送るため競合が検知され、再取得導線が出る。
    expect(config.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: INITIAL_REVISION }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(CONFLICT_MESSAGE);
    expect(
      screen.getByRole("button", { name: "最新の内容を読み込んで編集し直す" }),
    ).toBeVisible();
  });

  it(config.testTitles.retryAfterSuccess, async () => {
    const user = userEvent.setup();
    let entity = config.createEntity({ revision: INITIAL_REVISION });
    config.setEntity(entity);
    mockOptimisticLockServer(() => entity);
    const { rerender } = config.render();

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    expect(config.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: INITIAL_REVISION }),
    );

    // 保存の反映で購読値の revision が進む。
    entity = config.createEntity({ revision: ADVANCED_REVISION });
    config.setEntity(entity);
    rerender(config.ui());

    await user.click(screen.getByRole("button", { name: "編集" }));
    await user.click(screen.getByRole("button", { name: "保存" }));

    // 再編集の draft が新しい revision を持つため、競合にならず保存が完了する。
    expect(config.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: ADVANCED_REVISION }),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: config.editFormLabel }),
    ).not.toBeInTheDocument();
  });
}
