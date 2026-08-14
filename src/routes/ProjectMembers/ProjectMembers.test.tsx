import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectMembers } from "./ProjectMembers";

/**
 * プロジェクトのメンバー管理画面（ADR-11 §7）を検証する。
 * - owner/member の表示仕様（自分自身の行は脱退ボタンのみ、member は操作列
 *   非表示、追加候補は既参加者を除外）
 * - INVARIANT-6 拒否（最後の owner への操作）の ConvexError を握り潰さず
 *   表示すること
 * Convex（useQuery / useMutation）は外部依存のためモックする。
 * projects.getByKey / projectMembers.listByProject / members.me /
 * members.list はいずれも異なる形の引数で呼ばれるため getFunctionName に
 * よる名前ベースディスパッチで出し分ける（TaskDetail.test.tsx と同方式）。
 * useMutation も呼び出し対象（add/changeRole/remove/leave）ごとに別の spy
 * を返すことで、どのミューテーションが呼ばれたかを個別に検証できるようにする。
 */

const mocks = vi.hoisted(() => ({
  project: undefined as unknown,
  memberships: undefined as unknown,
  me: undefined as unknown,
  allMembers: undefined as unknown,
  addMutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
  changeRoleMutate:
    vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
  removeMutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
  leaveMutate: vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: (query: unknown, _args?: unknown) => {
      const name = getFunctionName(
        query as Parameters<typeof getFunctionName>[0],
      );
      if (name === "projects:getByKey") return mocks.project;
      if (name === "projectMembers:listByProject") return mocks.memberships;
      if (name === "members:me") return mocks.me;
      if (name === "members:list") return mocks.allMembers;
      throw new Error(`ProjectMembers.test.tsx: 未対応のクエリ ${name}`);
    },
    useMutation: (mutation: unknown) => {
      const name = getFunctionName(
        mutation as Parameters<typeof getFunctionName>[0],
      );
      if (name === "projectMembers:add") return mocks.addMutate;
      if (name === "projectMembers:changeRole") return mocks.changeRoleMutate;
      if (name === "projectMembers:remove") return mocks.removeMutate;
      if (name === "projectMembers:leave") return mocks.leaveMutate;
      throw new Error(
        `ProjectMembers.test.tsx: 未対応のミューテーション ${name}`,
      );
    },
  };
});

const createProject = (overrides: Record<string, unknown> = {}) => ({
  _id: "project_1",
  _creationTime: 1000,
  key: "TASK",
  name: "タスク管理",
  nextTaskNumber: 1,
  nextIssueNumber: 1,
  ...overrides,
});

const createRow = (overrides: Record<string, unknown> = {}) => ({
  _id: "pm_1",
  role: "member",
  member: { _id: "member_1", name: "Alice" },
  ...overrides,
});

const renderProjectMembers = () =>
  render(
    <MemoryRouter initialEntries={["/TASK/settings/members"]}>
      <Routes>
        <Route element={<p>一覧画面</p>} path="/" />
        <Route
          element={<ProjectMembers />}
          path="/:projectKey/settings/members"
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  mocks.project = undefined;
  mocks.memberships = undefined;
  mocks.me = undefined;
  mocks.allMembers = undefined;
  mocks.addMutate.mockReset();
  mocks.addMutate.mockResolvedValue(undefined);
  mocks.changeRoleMutate.mockReset();
  mocks.changeRoleMutate.mockResolvedValue(undefined);
  mocks.removeMutate.mockReset();
  mocks.removeMutate.mockResolvedValue(undefined);
  mocks.leaveMutate.mockReset();
  mocks.leaveMutate.mockResolvedValue(undefined);
});

describe("ProjectMembers のローディング表示", () => {
  it("project 未解決の間はスケルトンを表示し、戻り導線を維持する", () => {
    renderProjectMembers();

    expect(
      screen.getByRole("status", { name: "メンバーを読み込み中" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 一覧へ" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("ProjectMembers の not-found", () => {
  it("project が存在しない場合は見つからない旨を表示する", () => {
    mocks.project = null;
    mocks.memberships = [];
    mocks.me = null;
    mocks.allMembers = [];
    renderProjectMembers();

    expect(
      screen.getByText("プロジェクトが見つかりませんでした。"),
    ).toBeInTheDocument();
  });
});

describe("ProjectMembers の一覧表示", () => {
  it("メンバーの名前とロールバッジを表示する", () => {
    mocks.project = createProject();
    mocks.memberships = [
      createRow({
        _id: "pm_owner",
        role: "owner",
        member: { _id: "member_1", name: "Alice" },
      }),
      createRow({
        _id: "pm_member",
        role: "member",
        member: { _id: "member_2", name: "Bob" },
      }),
    ];
    // 閲覧のみを検証したいテストのため、viewer は未リンク（操作列を持たない
    // member 未満の状態）にし、select の選択肢テキストとバッジのテキストが
    // 衝突しないようにする（操作列の検証は owner/member 各 describe 側）。
    mocks.me = null;
    mocks.allMembers = [];
    renderProjectMembers();

    expect(
      screen.getByRole("heading", { name: "メンバー一覧（2）" }),
    ).toBeInTheDocument();
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Alice")).toBeInTheDocument();
    expect(table.getByText("Bob")).toBeInTheDocument();
    expect(table.getByText("オーナー")).toBeInTheDocument();
    expect(table.getByText("メンバー")).toBeInTheDocument();
  });
});

describe("ProjectMembers の owner としての表示（表示仕様: 非対称防止）", () => {
  const setupAsOwner = () => {
    mocks.project = createProject();
    mocks.memberships = [
      createRow({
        _id: "pm_owner",
        role: "owner",
        member: { _id: "member_1", name: "Alice" },
      }),
      createRow({
        _id: "pm_member",
        role: "member",
        member: { _id: "member_2", name: "Bob" },
      }),
    ];
    mocks.me = { _id: "member_1", name: "Alice", role: "member" };
    mocks.allMembers = [
      { _id: "member_1", name: "Alice" },
      { _id: "member_2", name: "Bob" },
      { _id: "member_3", name: "Carol" },
    ];
  };

  it("＋ メンバーを追加ボタンを表示する", () => {
    setupAsOwner();
    renderProjectMembers();

    expect(
      screen.getByRole("button", { name: "＋ メンバーを追加" }),
    ).toBeInTheDocument();
  });

  it("自分自身の行には脱退するボタンのみを表示し、ロール変更・除名は出さない", () => {
    setupAsOwner();
    renderProjectMembers();

    expect(
      screen.getByRole("button", { name: "脱退する" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Alice のロール" }),
    ).not.toBeInTheDocument();
  });

  it("他メンバーの行にはロール変更 select と除名するボタンを表示する", () => {
    setupAsOwner();
    renderProjectMembers();

    expect(
      screen.getByRole("combobox", { name: "Bob のロール" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "除名する" }),
    ).toBeInTheDocument();
  });

  it("追加候補は全 members から既参加者を除外した一覧になる", async () => {
    setupAsOwner();
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "＋ メンバーを追加" }));

    const select = screen.getByRole("combobox", { name: "メンバー" });
    expect(
      screen.queryByRole("option", { name: "Alice" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Bob" }),
    ).not.toBeInTheDocument();
    expect(select).toContainHTML("Carol");
  });

  it("メンバーを選び追加すると projectMembers.add を呼ぶ", async () => {
    setupAsOwner();
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "＋ メンバーを追加" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "メンバー" }),
      "Carol",
    );
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(mocks.addMutate).toHaveBeenCalledWith({
      project: "project_1",
      member: "member_3",
      role: "member",
    });
  });

  it("追加に失敗した場合はエラーを role=alert で表示する", async () => {
    setupAsOwner();
    mocks.addMutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(
        "このメンバーは既にプロジェクトに参加しています",
      ),
    );
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "＋ メンバーを追加" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "メンバー" }),
      "Carol",
    );
    await user.click(screen.getByRole("button", { name: "追加" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "このメンバーは既にプロジェクトに参加しています",
    );
  });

  it("他メンバーのロールを変更すると projectMembers.changeRole を呼ぶ", async () => {
    setupAsOwner();
    const user = userEvent.setup();
    renderProjectMembers();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Bob のロール" }),
      "オーナー",
    );

    expect(mocks.changeRoleMutate).toHaveBeenCalledWith({
      project: "project_1",
      member: "member_2",
      role: "owner",
    });
  });

  it("ロール変更が失敗（INVARIANT-6 拒否）した場合はエラーを role=alert で表示する", async () => {
    setupAsOwner();
    mocks.changeRoleMutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(
        "最後の owner は降格・除名・脱退できません",
      ),
    );
    const user = userEvent.setup();
    renderProjectMembers();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Bob のロール" }),
      "オーナー",
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "最後の owner は降格・除名・脱退できません",
    );
  });

  it("除名するボタンは確認パネルを挟み、承認すると projectMembers.remove を呼ぶ", async () => {
    setupAsOwner();
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "除名する" }));

    expect(mocks.removeMutate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "「Bob」をこのプロジェクトから除名します。取り消せません。",
      ),
    ).toBeVisible();

    // ConfirmPanel 内の確定ボタンも同じ「除名する」ラベルのため、
    // 直近にマウントされた要素（パネル側）を取る。
    const confirmButtons = screen.getAllByRole("button", { name: "除名する" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(mocks.removeMutate).toHaveBeenCalledWith({
      project: "project_1",
      member: "member_2",
    });
  });

  it("除名に失敗したらエラーを確認パネル内に role=alert で表示する", async () => {
    setupAsOwner();
    mocks.removeMutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(
        "最後の owner は降格・除名・脱退できません",
      ),
    );
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "除名する" }));
    const confirmButtons = screen.getAllByRole("button", { name: "除名する" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "最後の owner は降格・除名・脱退できません",
    );
  });

  it("自分自身の脱退するボタンは確認パネルを挟み、承認すると projectMembers.leave を呼び一覧へ戻る", async () => {
    setupAsOwner();
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "脱退する" }));

    expect(
      screen.getByText("このプロジェクトから脱退します。取り消せません。"),
    ).toBeVisible();

    const confirmButtons = screen.getAllByRole("button", { name: "脱退する" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(mocks.leaveMutate).toHaveBeenCalledWith({ project: "project_1" });
    expect(await screen.findByText("一覧画面")).toBeVisible();
  });

  it("最後の owner の脱退はサーバーに拒否され、確認パネルにエラーを表示したまま一覧へ遷移しない", async () => {
    setupAsOwner();
    mocks.leaveMutate.mockRejectedValueOnce(
      new (await import("convex/values")).ConvexError(
        "最後の owner は降格・除名・脱退できません",
      ),
    );
    const user = userEvent.setup();
    renderProjectMembers();

    await user.click(screen.getByRole("button", { name: "脱退する" }));
    const confirmButtons = screen.getAllByRole("button", { name: "脱退する" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "最後の owner は降格・除名・脱退できません",
    );
    expect(screen.queryByText("一覧画面")).not.toBeInTheDocument();
  });
});

describe("ProjectMembers の member としての表示（表示仕様: 非対称防止）", () => {
  const setupAsMember = () => {
    mocks.project = createProject();
    mocks.memberships = [
      createRow({
        _id: "pm_owner",
        role: "owner",
        member: { _id: "member_1", name: "Alice" },
      }),
      createRow({
        _id: "pm_member",
        role: "member",
        member: { _id: "member_2", name: "Bob" },
      }),
    ];
    // ログイン中は Bob（member ロール）。
    mocks.me = { _id: "member_2", name: "Bob", role: "member" };
    mocks.allMembers = [
      { _id: "member_1", name: "Alice" },
      { _id: "member_2", name: "Bob" },
    ];
  };

  it("＋ メンバーを追加ボタンを表示しない", () => {
    setupAsMember();
    renderProjectMembers();

    expect(
      screen.queryByRole("button", { name: "＋ メンバーを追加" }),
    ).not.toBeInTheDocument();
  });

  it("一覧の操作列（ロール変更・除名）を一切表示しない", () => {
    setupAsMember();
    renderProjectMembers();

    expect(
      screen.queryByRole("columnheader", { name: "操作" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Alice のロール" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "除名する" }),
    ).not.toBeInTheDocument();
  });

  it("一覧は閲覧でき、自分の脱退するボタンは表示する", async () => {
    setupAsMember();
    const user = userEvent.setup();
    renderProjectMembers();

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "脱退する" }));

    expect(
      screen.getByText("このプロジェクトから脱退します。取り消せません。"),
    ).toBeVisible();
  });
});
