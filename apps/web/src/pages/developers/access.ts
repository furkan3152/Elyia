import type { SessionView } from "@elyia/core/api/ops";

/** What the visitor may do in the portal: read samples, register, or manage a project. */
export type DevAccess = "anonymous" | "user" | "developer";

export function devAccess(session: Pick<SessionView, "roles"> | null): DevAccess {
  if (!session) return "anonymous";
  return session.roles.includes("developer") ? "developer" : "user";
}
