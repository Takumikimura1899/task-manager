import { useAuthActions } from "@convex-dev/auth/react";
import { type FormEvent, useId, useState } from "react";
import { Skeleton } from "../../components/Skeleton/Skeleton";
import { convexErrorMessage } from "../../lib/convexErrorMessage";
import s from "./SignIn.module.css";

type Flow = "signIn" | "signUp";

const SUBMIT_LABELS: Record<Flow, string> = {
  signIn: "ログイン",
  signUp: "新規登録",
};

// 資格情報不一致などの内部例外は詳細を晒さず「{操作}に失敗しました」形式へ
// 丸める（docs/UI文言・配置規約.md §6-2）。招待外拒否などサーバが意図して
// 投げた ConvexError は convexErrorMessage が data をそのまま表示する。
const FALLBACK_ERRORS: Record<Flow, string> = {
  signIn:
    "ログインに失敗しました。メールアドレスとパスワードを確認してください。",
  signUp:
    "新規登録に失敗しました。メールアドレスとパスワードを確認してください。",
};

/**
 * 未認証時の全画面サインイン（Issue #1）。
 * Convex Auth の Password プロバイダでログイン / 新規登録を行う。
 * 新規登録は招待制（members に登録済みの email のみ成功。convex/lib/memberLink.ts）。
 */
export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<Flow>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const inviteCodeId = useId();
  const errorId = useId();

  const canSubmit = email.trim() !== "" && password !== "" && !submitting;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmedInviteCode = inviteCode.trim();
      await signIn("password", {
        email: email.trim(),
        password,
        flow,
        // 空欄のときはキー自体を送らない（初回登録＝ブートストラップは
        // 招待コード不要。convex/lib/memberLink.ts のブートストラップ判定）。
        ...(flow === "signUp" && trimmedInviteCode !== ""
          ? { inviteCode: trimmedInviteCode }
          : {}),
      });
      // 成功時は Authenticated ゲート（App.tsx）が画面ごと切り替えるため、
      // アンマウント後の setState を避けて submitting は戻さない。
    } catch (err) {
      setError(convexErrorMessage(err, FALLBACK_ERRORS[flow]));
      setSubmitting(false);
    }
  }

  function switchFlow(next: Flow) {
    setFlow(next);
    setError(null);
  }

  return (
    <main className={s.page}>
      <div className={s.card}>
        <h1 className={s.title}>Task Manager</h1>
        <p className={s.subtitle}>
          {flow === "signIn"
            ? "登録済みのアカウントでログインしてください。"
            : "招待された（メンバー登録済みの）メールアドレスで新規登録してください。"}
        </p>
        <form className={s.form} onSubmit={handleSubmit}>
          <label className={s.label} htmlFor={emailId}>
            メールアドレス
          </label>
          <input
            aria-describedby={error !== null ? errorId : undefined}
            autoComplete="email"
            className={s.input}
            id={emailId}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            value={email}
          />
          <label className={s.label} htmlFor={passwordId}>
            パスワード
          </label>
          <input
            aria-describedby={error !== null ? errorId : undefined}
            autoComplete={
              flow === "signIn" ? "current-password" : "new-password"
            }
            className={s.input}
            id={passwordId}
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            value={password}
          />
          <p className={s.hint}>パスワードは 8 文字以上です。</p>
          {flow === "signUp" && (
            <>
              <label className={s.label} htmlFor={inviteCodeId}>
                招待コード
              </label>
              <input
                autoComplete="off"
                className={s.input}
                id={inviteCodeId}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="招待メールに記載のコード"
                type="text"
                value={inviteCode}
              />
              <p className={s.hint}>
                管理者から招待された場合のみ入力してください。初回登録は不要です。
              </p>
            </>
          )}
          {error !== null && (
            <p className="actionError" id={errorId} role="alert">
              {error}
            </p>
          )}
          <button className={s.submit} disabled={!canSubmit} type="submit">
            {submitting ? "送信中…" : SUBMIT_LABELS[flow]}
          </button>
        </form>
        {flow === "signIn" ? (
          <button
            className={s.switch}
            onClick={() => switchFlow("signUp")}
            type="button"
          >
            新規登録へ
          </button>
        ) : (
          <button
            className={s.switch}
            onClick={() => switchFlow("signIn")}
            type="button"
          >
            ログインへ
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * 認証状態の確認中（AuthLoading）の全画面プレースホルダ。
 * SignIn / アプリ本体のどちらへ分岐するか不明な間、枠だけを示す。
 */
export function AuthLoadingScreen() {
  return (
    <main className={s.page}>
      <output aria-label="認証状態を確認中" className={s.card}>
        <Skeleton className={s.loadingSkeleton} />
      </output>
    </main>
  );
}
