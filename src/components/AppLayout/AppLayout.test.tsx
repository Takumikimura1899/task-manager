import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  createCurrentMember,
  createMember,
  createProject,
  createQueryDispatcher,
  type MutateMock,
  type QueryMock,
} from "../../../test/reactQuerySupport";
import { AppLayout } from "./AppLayout";

/**
 * AppLayout のローディング表示（Issue #29）・プロジェクト0件分岐・
 * タブナビ（/ Task・/issues Issue）・プロジェクト選択 select を検証する。
 * Convex は外部依存のためモックする。projects.list / members.list はいずれも
 * 引数なしで呼ばれるため args では区別できず、api の関数参照（anyApi）も
 * 参照同一性を持たない。ディスパッチの詳細は test/reactQuerySupport.ts 参照。
 */

const { useQueryMock, mutate, signOut } = vi.hoisted(() => ({
  useQueryMock: vi.fn<QueryMock>(),
  mutate: vi.fn<MutateMock>(),
  signOut: vi.fn<() => Promise<unknown>>(() => Promise.resolve()),
}));

vi.mock("convex/react", async () => {
  const { buildConvexReactMock } =
    await import("../../../test/reactQuerySupport");
  return buildConvexReactMock(useQueryMock, mutate);
});

// ログアウト導線（useAuthActions().signOut）を spy に差し替える
vi.mock("@convex-dev/auth/react", async () => {
  const { buildConvexAuthActionsMock } =
    await import("../../../test/reactQuerySupport");
  return buildConvexAuthActionsMock({ signOut });
});

// 子ルート（TasksView / IssuesView）の描画内容は各画面のテストに委ねる。
// ここでは AppLayout 自身の責務（ローディング・0件分岐・タブ・select）だけを
// 検証するため、プレースホルダを子ルートに置く。
const renderAppLayout = (initialEntries: string[] = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route element={<p>タスク画面</p>} path="/" />
          <Route element={<p>Issue画面</p>} path="/issues" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  useQueryMock.mockReset();
  mutate.mockReset();
  signOut.mockReset();
  signOut.mockResolvedValue(undefined);
  sessionStorage.clear();
});

describe("AppLayout のローディング表示（Issue #29）", () => {
  it("読み込み中もタイトルを維持したままスケルトンを表示する", () => {
    // すべての購読が読み込み中（undefined）
    renderAppLayout();

    expect(
      screen.getByRole("heading", { name: "Task Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "プロジェクトを読み込み中" }),
    ).toBeInTheDocument();
  });
});

describe("AppLayout のプロジェクト0件分岐", () => {
  it("プロジェクトが1件も無い場合は作成手段の案内を表示する", () => {
    useQueryMock.mockImplementation((name) =>
      name === "projects:list" ? [] : undefined,
    );
    renderAppLayout();

    expect(
      screen.getByRole("heading", { name: "Task Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "プロジェクトがありません。MCP もしくは Convex ダッシュボードから作成してください。",
      ),
    ).toBeInTheDocument();
  });
});

describe("AppLayout のタブナビ", () => {
  beforeEach(() => {
    const project = createProject();
    const member = createMember();
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [project],
        "members:list": [member],
      }),
    );
  });

  it.each([
    ["/", "Task", "Issue"],
    ["/issues", "Issue", "Task"],
  ] as const)(
    "現在地 %s では %s タブに aria-current=page が付く",
    (path, activeLabel, inactiveLabel) => {
      renderAppLayout([path]);

      expect(screen.getByRole("link", { name: activeLabel })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(
        screen.getByRole("link", { name: inactiveLabel }),
      ).not.toHaveAttribute("aria-current", "page");
    },
  );
});

describe("AppLayout の Member 未リンク案内（Issue #16 / #1）", () => {
  it("members.me が null（ロード完了・未リンク）なら NoMembersNotice を表示する", () => {
    const project = createProject();
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [project],
        "members:list": [],
        "members:me": null,
      }),
    );
    renderAppLayout();

    expect(screen.getByRole("note")).toHaveTextContent(
      "対応するメンバーが登録されていない",
    );
  });

  it("members.me がロード中（undefined）は NoMembersNotice を表示しない", () => {
    const project = createProject();
    useQueryMock.mockImplementation((name) =>
      name === "projects:list" ? [project] : undefined,
    );
    renderAppLayout();

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("Member がリンク済みの場合は NoMembersNotice を表示しない", () => {
    const project = createProject();
    const member = createMember();
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [project],
        "members:list": [member],
        "members:me": createCurrentMember(),
      }),
    );
    renderAppLayout();

    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

describe("AppLayout のログアウト導線（Issue #1）", () => {
  const setupSignedIn = () => {
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [createProject()],
        "members:list": [createMember()],
        "members:me": createCurrentMember({ name: "テスト太郎" }),
      }),
    );
  };

  it("ヘッダーにユーザー名とログアウトボタンを表示し、押下で signOut を呼ぶ", async () => {
    const user = userEvent.setup();
    setupSignedIn();
    renderAppLayout();

    expect(screen.getByText("テスト太郎")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("signOut が失敗したらエラーを画面に表示し、再操作できる", async () => {
    const user = userEvent.setup();
    signOut.mockRejectedValueOnce(new Error("network down"));
    setupSignedIn();
    renderAppLayout();

    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "ログアウトに失敗しました。再度お試しください。",
    );
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeEnabled();
  });

  it("プロジェクト0件でもログアウト導線を表示する", () => {
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [],
        "members:list": [],
        "members:me": createCurrentMember({ name: "テスト太郎" }),
      }),
    );
    renderAppLayout();

    expect(
      screen.getByRole("button", { name: "ログアウト" }),
    ).toBeInTheDocument();
  });
});

describe("AppLayout の sessionStorage 例外時のデグレード", () => {
  it("復元時に sessionStorage が例外を投げても console.warn を出し、既定（先頭プロジェクト）へデグレードする", () => {
    const projectA = createProject();
    const projectB = createProject({
      _id: "project_2" as Id<"projects">,
      key: "WEB",
      name: "Web サイト",
    });
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [projectA, projectB],
        "members:list": [createMember()],
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("sessionStorage disabled");
      });

    try {
      renderAppLayout();

      expect(warnSpy).toHaveBeenCalledWith(
        "プロジェクト選択の復元に失敗しました（sessionStorage 不可）",
        expect.any(Error),
      );
      expect(
        screen.getByRole("combobox", { name: "プロジェクト" }),
      ).toHaveValue(projectA._id);
    } finally {
      getItemSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe("AppLayout のプロジェクト select", () => {
  it("プロジェクト一覧を選択肢に表示し、先頭プロジェクトを選択値にする", () => {
    const projectA = createProject();
    const projectB = createProject({
      _id: "project_2" as Id<"projects">,
      key: "WEB",
      name: "Web サイト",
    });
    useQueryMock.mockImplementation(
      createQueryDispatcher({
        "projects:list": [projectA, projectB],
        "members:list": [createMember()],
      }),
    );
    renderAppLayout();

    const select = screen.getByRole("combobox", { name: "プロジェクト" });
    expect(select).toHaveValue(projectA._id);
    expect(
      screen.getByRole("option", { name: "TASK — タスク管理" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "WEB — Web サイト" }),
    ).toBeInTheDocument();
  });
});
