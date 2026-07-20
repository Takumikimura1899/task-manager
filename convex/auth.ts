import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { linkAuthUserToMember } from "./lib/memberLink";
import { isValidEmail, normalizeEmail } from "./lib/validators";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(String(params.email ?? ""));
        if (!isValidEmail(email)) {
          throw new ConvexError("メールアドレスが不正です");
        }
        return { email };
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
