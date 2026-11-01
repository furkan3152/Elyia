/**
 * Optional X verification through the official X API v2 (X_API_BEARER).
 * Without a token every X task is a self-reported link an admin reviews.
 * Never scrapes x.com pages, never logs in, never works around bot checks:
 * an endpoint the token's access level does not cover leaves the task for
 * manual review.
 */
import { parseXStatusUrl, type HerdTask, type HerdTaskCheck } from "@elyia/core/api/herd";
import type { AppContext } from "../../context.js";

const API = "https://api.x.com/2";

async function xGet(ctx: AppContext, path: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const response = await ctx.fetch(`${API}${path}`, { method: "GET", headers: { Authorization: `Bearer ${ctx.config.herd.xApiBearer}` }, signal: AbortSignal.timeout(8_000) } as never);
  let body: Record<string, unknown> | null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function userId(ctx: AppContext, handle: string): Promise<string | null> {
  const { status, body } = await xGet(ctx, `/users/by/username/${encodeURIComponent(handle)}`);
  if (status !== 200) return null;
  return String((body?.data as { id?: string } | undefined)?.id ?? "") || null;
}

export async function verifyWithX(ctx: AppContext, task: HerdTask, check: HerdTaskCheck, handle: string, taskUrl: string | null): Promise<HerdTaskCheck> {
  if (!ctx.config.herd.xApiBearer || task.verification !== "x-api") return check;
  try {
    if (task.evidence === "tweet-url" && check.evidence) {
      const post = parseXStatusUrl(check.evidence);
      if (!post) return { ...check, state: "failed", detail: "Not an X post link." };
      const { status, body } = await xGet(ctx, `/tweets/${post.id}?expansions=author_id&tweet.fields=referenced_tweets&user.fields=username`);
      if (status === 401 || status === 403 || status === 429) return { ...check, detail: `X API answered ${status}: left for manual review.` };
      if (status !== 200 || !body?.data) return { ...check, state: "failed", detail: "The post was not found on X." };
      const author = ((body.includes as { users?: { username?: string }[] } | undefined)?.users?.[0]?.username ?? "").toLowerCase();
      if (author && author !== handle) return { ...check, state: "failed", detail: `The post is by @${author}.` };
      if (task.kind === "engage-post" && taskUrl) {
        const target = parseXStatusUrl(taskUrl)?.id;
        const refs = ((body.data as { referenced_tweets?: { id?: string }[] }).referenced_tweets ?? []).map((ref) => ref.id);
        if (target && !refs.includes(target)) return { ...check, state: "failed", detail: "The post does not reply to or quote the task's post." };
      }
      return { ...check, state: "verified", detail: "Checked with the X API." };
    }
    if (task.kind === "follow-x" && taskUrl) {
      const target = /(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/iu.exec(taskUrl)?.[1];
      const [source, followed] = await Promise.all([userId(ctx, handle), target ? userId(ctx, target) : Promise.resolve(null)]);
      if (!source || !followed) return { ...check, detail: "X API could not resolve the accounts: left for manual review." };
      const { status, body } = await xGet(ctx, `/users/${source}/following?max_results=1000`);
      if (status !== 200) return { ...check, detail: `X API answered ${status} for follows (needs a higher access level): left for manual review.` };
      const ids = ((body?.data as { id?: string }[] | undefined) ?? []).map((user) => user.id);
      return ids.includes(followed) ? { ...check, state: "verified", detail: "Follow checked with the X API." } : { ...check, state: "failed", detail: "Not following (first 1000 follows checked)." };
    }
  } catch {
    return { ...check, detail: "X API unreachable: left for manual review." };
  }
  return check;
}
