import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { CateringInboxError, listCateringInbox } from "@/lib/catering/inbox";
import { serverT } from "@/lib/i18n/server";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { InboxPane } from "./InboxPane";

export default async function CateringInboxPage() {
  const ctx = await requireSessionFromHeaders("/catering/inbox");
  let initial;
  try {
    initial = await listCateringInbox(ctx);
  } catch (error) {
    if (error instanceof CateringInboxError && error.status === 403) redirect("/catering");
    if (error instanceof CateringInboxError && error.code === "inbox_unavailable") return <main className="mx-auto max-w-5xl px-4 py-4">
      <Link href="/catering" className="inline-flex min-h-11 items-center">{serverT(ctx.user.language, "catering.inbox.back")}</Link>
      <h1 className="text-xl font-bold">{serverT(ctx.user.language, "catering.inbox.title")}</h1>
      <p role="status">{serverT(ctx.user.language, "catering.inbox.unavailable")}</p>
    </main>;
    throw error;
  }
  // Send draft (phase 1b) and the mode switch take Tier B: the provider hosts the password modal; the server re-asserts.
  // No TranslationProvider here: the (authed) layout owns it (a nested one kept its own language, and its unmount
  // reset <html lang> to "en" under a Spanish screen — W27 / B228).
  return <StepUpProvider unlocked={ctx.session.stepUpUnlocked} unlockedAt={ctx.session.stepUpUnlockedAt}>
        <main className="mx-auto max-w-5xl px-4 pb-32 pt-4">
          <Link href="/catering" className="inline-flex min-h-11 items-center">{serverT(ctx.user.language, "catering.inbox.back")}</Link>
          <InboxPane initial={initial} />
        </main>
      </StepUpProvider>;
}
