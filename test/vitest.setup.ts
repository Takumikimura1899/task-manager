// jest-dom のマッチャ登録＋型拡張は副作用 import で行う仕様のため許容する
// oxlint-disable-next-line import/no-unassigned-import
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * frontend プロジェクト（jsdom）共通セットアップ。
 * - jest-dom のカスタムマッチャ（toBeInTheDocument 等）を expect に登録
 * - globals を有効化していないため testing-library の自動 cleanup が働かない。
 *   テスト間の DOM 汚染を防ぐため明示的にアンマウントする。
 */
afterEach(() => {
  cleanup();
});
