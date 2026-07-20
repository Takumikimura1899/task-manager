import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { linkAuthUserToMember } from "./lib/memberLink";
import { isValidEmail, normalizeEmail } from "./lib/validators";

/** 招待コードの受理上限。正規トークンは 64 文字（generateInviteToken の hex）。 */
const MAX_INVITE_CODE_LENGTH = 128;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(String(params.email ?? ""));
        if (!isValidEmail(email)) {
          throw new ConvexError("メールアドレスが不正です");
        }
        // inviteCode は招待トークン方式（招待ウィンドウ乗っ取り対策・Issue #1）で
        // signUp 時のみ渡される。undefined は Convex 値として不正なため、
        // string のときだけ条件付き spread で users doc へ書き込む。
        // 正規トークンは 64 文字（32 バイトの hex）固定。上限（余裕をみて 128 文字）を
        // 超える入力は users doc へ書き込む前に拒否し、巨大文字列の書き込みによる
        // 容量・リソース濫用を防ぐ（どのみち照合には一致し得ない）。
        if (
          typeof params.inviteCode === "string" &&
          params.inviteCode.length > MAX_INVITE_CODE_LENGTH
        ) {
          throw new ConvexError("招待コードが不正です");
        }
        return {
          email,
          ...(typeof params.inviteCode === "string"
            ? { inviteCode: params.inviteCode }
            : {}),
        };
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, args) {
      if (args.existingUserId) return; // 既存ユーザーの sign-in はリンク済み

      // 注意: ここで getAuthUserId(ctx) を使ってはならない。このコールバックは
      // store mutation（サインイン処理）の途中で呼ばれ、ctx.auth はまだ確立
      // されていない（セッション Cookie/JWT が発行済みでない）ため、
      // getAuthUserId(ctx) は常に null を返す。新規作成されたユーザーの id は
      // 引数 args.userId として渡されるので、必ずこちらを使う。
      await linkAuthUserToMember(ctx, args.userId);
    },
  },
});
