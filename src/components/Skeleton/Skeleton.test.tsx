import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./Skeleton";
import s from "./Skeleton.module.css";

/**
 * 共通スケルトン（Issue #29）の契約を検証する。
 * 装飾要素として SR から隠されること（読み上げは呼び出し側の
 * role="status" が担う）と、呼び出し側が寸法用クラスを合成できること。
 */

describe("Skeleton", () => {
  it("aria-hidden の装飾要素として描画され、SR に読まれない", () => {
    const { container } = render(<Skeleton />);

    const skeleton = container.firstElementChild;
    expect(skeleton).toHaveAttribute("aria-hidden", "true");
    expect(skeleton).toHaveClass(s.skeleton);
  });

  it("呼び出し側の寸法クラスを基底クラスと合成する", () => {
    const { container } = render(<Skeleton className="sizing" />);

    expect(container.firstElementChild).toHaveClass(s.skeleton, "sizing");
  });
});
