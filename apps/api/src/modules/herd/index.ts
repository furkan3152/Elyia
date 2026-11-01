/**
 * The Herd: the Ely NFT collection, its WL platform and holder perks.
 *
 * Public
 *   GET  /herd?network=                       HerdConfigResponse (live from the recorded ElyHerd, else "not deployed")
 *   GET  /herd/tokens/:id                     HerdTokenMetadata (placeholder before reveal)
 *   GET  /herd/images/:id.png                 PNG (art folder, generator, or the placeholder) · /herd/images/placeholder.png
 *   GET  /herd/holder/:address                HerdHolderResponse (balanceOf on chain, ids from the indexer, perks)
 *   GET  /herd/raffles/:id                    HerdRaffle (verification inputs and winners)
 * WL (session = the wallet)
 *   GET  /herd/wl/tasks                       HerdTasksResponse
 *   POST /herd/wl/apply                       HerdApplication          (auth limit; one per wallet)
 *   GET  /herd/wl/me                          HerdMeResponse
 *   GET  /herd/wl/card/:wallet.png            the shareable WL card (public)
 *   GET  /herd/wl/proof/:wallet               HerdProofResponse (public: proofs are not secrets)
 *   POST /herd/wl/move/start {to}  POST /herd/wl/move/accept {from}   two-step wallet change
 * Admin (admin session; every action is in the audit log)
 *   GET  /admin/herd/overview                 config, settings, counts, builds, partners, raffles, audit
 *   PUT  /admin/herd/settings
 *   GET/POST /admin/herd/tasks   PATCH/DELETE /admin/herd/tasks/:id
 *   GET  /admin/herd/applications?status&minScore&flagged&tasksDone&q&sort&limit&cursor
 *   POST /admin/herd/applications/decision {ids,status,note?}
 *   POST /admin/herd/applications/:id/notes {text}   POST /admin/herd/applications/:id/flags {cleared}
 *   POST /admin/herd/applications/:id/verify         (X API, when X_API_BEARER is set)
 *   POST /admin/herd/applications/rescore {ids?}
 *   GET  /admin/herd/applications/export?format=csv|json
 *   GET/POST /admin/herd/raffles   POST /admin/herd/raffles/:id/draw   POST /admin/herd/raffles/:id/apply
 *   GET  /admin/herd/partners   PUT/DELETE /admin/herd/partners/:tag
 *   POST /admin/herd/merkle/:list/build   GET /admin/herd/merkle/:list/export?format=csv|json
 *   GET  /admin/herd/snapshot?format=csv|json
 *   POST /admin/herd/tx {functionName,args,network?}  HerdPreparedTx (calldata; the server never signs)
 *   POST /admin/herd/tx/sent {functionName,hash,network?}   records what the admin's wallet sent
 *   GET  /admin/herd/dashboard?network=        HerdDashboardResponse
 *   GET  /admin/herd/audit
 */
import { NETWORK_KEYS, NETWORKS, type NetworkKey } from "@elyia/core";
import { HERD_APPLICATION_STATUSES, HERD_EVIDENCE_KINDS, HERD_LISTS, HERD_TASK_KINDS, HERD_VERIFICATION_MODES, type HerdApplicationStatus, type HerdHolderResponse, type HerdListId, type HerdMeResponse, type HerdTasksResponse } from "@elyia/core/api/herd";
import type { Request, Response } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { ElyiaHttpError } from "../../http/errors.js";
import type { ApiModule } from "../../http/router.js";
import { evmAddress, parseBody, parseParams, parseQuery, queryBoolean, queryInteger, queryString, txHash } from "../../http/validate.js";
import { mustSession, requireSession } from "../ops/auth/session.js";
import { addNote, allApplications, applicationOf, apply, acceptMove, decide, listApplications, liveScore, me, rescore, setFlagsCleared, startMove, view } from "./applications.js";
import { renderCard } from "./card.js";
import { collectionView, forgetHerdCaches, herdLinks, herdNetwork, herdRecord, mintedBy } from "./chain.js";
import { allTokens, dashboardOf, indexState, startIndexer, stopIndexer, tokensOf } from "./indexer.js";
import { buildList, buildsOf, deletePartner, exportBuild, listPartners, proofFor, putPartner, snapshot } from "./lists.js";
import { artPng, placeholderPng, resolveToken, tokenMetadata } from "./metadata.js";
import { perksFor } from "./perks.js";
import { applyRaffle, commitRaffle, drawRaffle, listRaffles, raffleOf, raffleView } from "./raffles.js";
import { audit, auditLog, createTask, deleteTask, herdSettings, listTasks, taskUrl, updateSettings, updateTask } from "./state.js";
import { prepareTx } from "./txs.js";
import { verifyWithX } from "./xverify.js";

const networkSchema = z.enum(NETWORK_KEYS as unknown as [NetworkKey, ...NetworkKey[]]).refine((key) => NETWORKS[key].vm === "evm", "Expected an EVM network.");
const NetworkQuery = z.object({ network: networkSchema.optional() });
const TokenParams = z.object({ id: z.string().regex(/^\d{1,6}$/u).transform(Number) });
const ImageParams = z.object({ file: z.string().regex(/^(?:\d{1,6}|placeholder)\.png$/u) });
const CardParams = z.object({ file: z.string().regex(/^0x[0-9a-fA-F]{40}\.png$/u) });
const AddressParams = z.object({ address: evmAddress });
const WalletParams = z.object({ wallet: evmAddress });
const IdParams = z.object({ id: z.string().min(3).max(64).regex(/^[A-Za-z0-9_x]+$/u) });
const TagParams = z.object({ tag: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}$/u, "Tags are 1-31 of a-z, 0-9 and -.") });
const ListParams = z.object({ list: z.enum(HERD_LISTS as unknown as [HerdListId, ...HerdListId[]]) });
const FormatQuery = z.object({ format: z.enum(["csv", "json"]).optional(), network: networkSchema.optional() });
const status = z.enum(HERD_APPLICATION_STATUSES as unknown as [HerdApplicationStatus, ...HerdApplicationStatus[]]);

const ApplyBody = z
  .object({
    wallet: evmAddress,
    xHandle: z.string().trim().min(1).max(60),
    evidence: z.record(z.string().max(64), z.string().max(400)).refine((value) => Object.keys(value).length <= 30, "At most 30 tasks."),
    referredBy: z.string().regex(/^[0-9a-f]{8}$/u).optional(),
    device: z.string().regex(/^[0-9a-f]{16,64}$/u).optional(),
  })
  .strict();
const MoveStartBody = z.object({ to: evmAddress }).strict();
const MoveAcceptBody = z.object({ from: evmAddress }).strict();
const SettingsBody = z.object({ applicationsOpen: z.boolean().optional(), reapplyLimit: z.number().int().min(0).max(10).optional(), moveLimit: z.number().int().min(0).max(5).optional() }).strict();
const httpsUrl = z.string().trim().url().max(400).refine((value) => value.startsWith("https://"), "Expected an https URL.");
const TaskBody = z
  .object({
    kind: z.enum(HERD_TASK_KINDS as unknown as [string, ...string[]]),
    label: z.string().trim().min(2).max(120),
    description: z.string().trim().max(400).nullable().optional(),
    url: httpsUrl.nullable().optional(),
    required: z.boolean().optional(),
    points: z.number().int().min(0).max(100).optional(),
    verification: z.enum(HERD_VERIFICATION_MODES as unknown as [string, ...string[]]).optional(),
    evidence: z.enum(HERD_EVIDENCE_KINDS as unknown as [string, ...string[]]).optional(),
    active: z.boolean().optional(),
    order: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
const TaskPatch = TaskBody.partial().strict();
const ApplicationsQuery = z.object({
  status: status.optional(),
  minScore: queryInteger(0, 100).optional(),
  flagged: queryBoolean.optional(),
  tasksDone: queryBoolean.optional(),
  q: queryString(80).optional(),
  sort: z.enum(["score", "created", "updated"]).optional(),
  limit: queryInteger(1, 500).optional(),
  cursor: z.string().regex(/^\d{1,7}$/u).optional(),
});
const DecisionBody = z.object({ ids: z.array(z.string().min(3).max(64)).min(1).max(1_000), status, note: z.string().trim().max(500).optional() }).strict();
const NoteBody = z.object({ text: z.string().trim().min(1).max(500) }).strict();
const FlagsBody = z.object({ cleared: z.boolean() }).strict();
const RescoreBody = z.object({ ids: z.array(z.string().min(3).max(64)).max(1_000).optional() }).strict();
const RaffleBody = z.object({ winners: z.number().int().min(1).max(3_333), targetBlock: z.number().int().positive().optional(), blocksAhead: z.number().int().min(20).max(5_000_000).optional(), network: networkSchema.optional() }).strict();
const PartnerBody = z.object({ name: z.string().trim().min(1).max(80), cap: z.number().int().min(0).max(3_333), wallets: z.array(evmAddress).max(5_000) }).strict();
const TxBody = z.object({ functionName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u), args: z.array(z.unknown()).max(12), network: networkSchema.optional() }).strict();
const SentBody = z.object({ functionName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u), hash: txHash, network: networkSchema.optional() }).strict();
const BuildBody = z.object({ network: networkSchema.optional() }).strict();

function netOf(ctx: AppContext, req: Request): NetworkKey {
  return parseQuery(req, NetworkQuery).network ?? herdNetwork(ctx);
}

function baseUrl(ctx: AppContext, req: Request): string {
  return ctx.config.herd.publicBaseUrl ?? `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Leading = + - @ would run as formulas in spreadsheets.
  const safe = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return /[",\n]/u.test(safe) ? `"${safe.replace(/"/gu, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [header.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n") + "\n";
}

function sendFile(res: Response, name: string, format: "csv" | "json", body: string): void {
  res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.${format}"`);
  res.send(body);
}

function sendPng(res: Response, png: Buffer, maxAge: number): void {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", `public, max-age=${maxAge}`);
  res.send(png);
}

async function onListOf(ctx: AppContext, network: NetworkKey, wallet: string): Promise<HerdMeResponse["onList"]> {
  const proof = await proofFor(ctx, network, wallet);
  if (proof.list) return { list: proof.list, partner: proof.partnerTag };
  const doc = await applicationOf(ctx, wallet);
  return doc?.status === "approved" ? { list: "wl", partner: null } : null;
}

export const herdModule: ApiModule = {
  name: "herd",
  register(router, ctx) {
    const admin = requireSession(ctx, "admin");
    const session = requireSession(ctx);

    /* ---------------------------------------------------------- public */

    router.get("/herd", async (req, res) => {
      const body = await collectionView(ctx, netOf(ctx, req));
      res.setHeader("Cache-Control", "public, max-age=3");
      res.json(body);
    });

    router.get("/herd/tokens/:id", async (req, res) => {
      const { id } = parseParams(req, TokenParams);
      const body = await tokenMetadata(ctx, netOf(ctx, req), id, baseUrl(ctx, req));
      res.setHeader("Cache-Control", body.revealed ? "public, max-age=300" : "public, max-age=60");
      res.json(body);
    });

    router.get("/herd/images/:file", async (req, res) => {
      const { file } = parseParams(req, ImageParams);
      if (file === "placeholder.png") return sendPng(res, placeholderPng(), 3_600);
      const resolved = await resolveToken(ctx, netOf(ctx, req), Number(file.slice(0, -4)));
      if (!resolved.revealed || resolved.artIndex === null) return sendPng(res, placeholderPng(), 60);
      const png = await artPng(ctx, resolved.artIndex);
      sendPng(res, png ?? placeholderPng(), png ? 86_400 : 60);
    });

    router.get("/herd/holder/:address", async (req, res) => {
      const { address } = parseParams(req, AddressParams);
      const network = netOf(ctx, req);
      const record = await herdRecord(ctx, network);
      const perks = await perksFor(ctx, address);
      const body: HerdHolderResponse = {
        address,
        network,
        balance: perks.balance,
        tokenIds: record ? await tokensOf(ctx, network, address) : [],
        minted: record ? await mintedBy(ctx, network, record.address, address) : null,
        perks,
      };
      res.json(body);
    });

    router.get("/herd/raffles/:id", async (req, res) => {
      const { id } = parseParams(req, IdParams);
      const doc = await raffleOf(ctx, id);
      if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such raffle.");
      res.json(raffleView(doc as never));
    });

    /* -------------------------------------------------------------- WL */

    router.get("/herd/wl/tasks", async (_req, res) => {
      const settings = await herdSettings(ctx);
      const tasks = (await listTasks(ctx, { activeOnly: true })).map((task) => ({ ...task, url: taskUrl(ctx, task) }));
      const body: HerdTasksResponse = { tasks, applicationsOpen: settings.applicationsOpen, reapplyLimit: settings.reapplyLimit, links: herdLinks(ctx) };
      res.json(body);
    });

    router.post("/herd/wl/apply", ctx.limits.auth, session, async (req, res) => {
      const body = parseBody(req, ApplyBody);
      const application = await apply(ctx, { ...body, sessionWallet: mustSession(req).address, ip: req.ip ?? null });
      res.status(201).json(application);
    });

    router.get("/herd/wl/me", session, async (req, res) => {
      const wallet = mustSession(req).address;
      res.json(await me(ctx, wallet, await onListOf(ctx, herdNetwork(ctx), wallet)));
    });

    router.get("/herd/wl/card/:file", ctx.limits.heavy, async (req, res) => {
      const { file } = parseParams(req, CardParams);
      const wallet = file.slice(0, 42).toLowerCase();
      const doc = await applicationOf(ctx, wallet);
      const score = doc?.score ?? (await liveScore(ctx, wallet));
      const network = herdNetwork(ctx);
      sendPng(res, await renderCard({ wallet, application: doc ? view(doc) : null, score, testnet: NETWORKS[network].environment === "testnet" }), 300);
    });

    router.get("/herd/wl/proof/:wallet", async (req, res) => {
      const { wallet } = parseParams(req, WalletParams);
      res.json(await proofFor(ctx, netOf(ctx, req), wallet));
    });

    router.post("/herd/wl/move/start", ctx.limits.auth, session, async (req, res) => {
      const { to } = parseBody(req, MoveStartBody);
      res.json(await startMove(ctx, mustSession(req).address, to));
    });

    router.post("/herd/wl/move/accept", ctx.limits.auth, session, async (req, res) => {
      const { from } = parseBody(req, MoveAcceptBody);
      res.json(await acceptMove(ctx, mustSession(req).address, from));
    });

    /* ----------------------------------------------------------- admin */

    const by = (req: Request) => mustSession(req).address;

    router.get("/admin/herd/overview", admin, async (req, res) => {
      const network = netOf(ctx, req);
      const [config, settings, tasks, builds, partners, raffles, recent, apps, index] = await Promise.all([
        collectionView(ctx, network),
        herdSettings(ctx),
        listTasks(ctx),
        buildsOf(ctx, network),
        listPartners(ctx),
        listRaffles(ctx),
        auditLog(ctx, 30),
        listApplications(ctx, { limit: 1 }),
        indexState(ctx, network),
      ]);
      res.json({ config, settings, tasks, builds, partners, raffles, audit: recent, counts: apps.counts, index: index ? { next: index.next, head: index.head, lastError: index.lastError } : null, xApi: ctx.config.herd.xApiBearer !== null });
    });

    router.put("/admin/herd/settings", admin, async (req, res) => {
      res.json(await updateSettings(ctx, by(req), parseBody(req, SettingsBody)));
    });

    router.get("/admin/herd/tasks", admin, async (_req, res) => {
      res.json({ tasks: (await listTasks(ctx)).map((task) => ({ ...task, resolvedUrl: taskUrl(ctx, task) })) });
    });

    router.post("/admin/herd/tasks", admin, async (req, res) => {
      res.status(201).json(await createTask(ctx, by(req), parseBody(req, TaskBody) as never));
    });

    router.patch("/admin/herd/tasks/:id", admin, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await updateTask(ctx, by(req), id, parseBody(req, TaskPatch) as never));
    });

    router.delete("/admin/herd/tasks/:id", admin, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json({ deleted: await deleteTask(ctx, by(req), id) });
    });

    router.get("/admin/herd/applications/export", admin, async (req, res) => {
      const { format = "csv" } = parseQuery(req, FormatQuery);
      const all = (await allApplications(ctx)).map(view);
      await audit(ctx, by(req), "applications.export", `${all.length} rows as ${format}`);
      if (format === "json") return sendFile(res, "herd-applications", "json", JSON.stringify({ exportedAt: new Date(ctx.clock.now()).toISOString(), applications: all }, null, 2));
      sendFile(
        res,
        "herd-applications",
        "csv",
        toCsv(
          ["id", "wallet", "x_handle", "status", "score", "weight", "flags", "flags_cleared", "attempts", "tasks", "referral", "referred_by", "moved_from", "created_at", "decided_at", "decided_by"],
          all.map((app) => [app.id, app.wallet, app.xHandle, app.status, app.score.score, app.score.weight, app.flags.map((flag) => `${flag.severity}:${flag.code}`).join(" "), app.flagsCleared, app.attempts, app.tasks.map((task) => `${task.taskId}=${task.state}`).join(" "), app.referral, app.referredBy, app.movedFrom, app.createdAt, app.decidedAt, app.decidedBy]),
        ),
      );
    });

    router.get("/admin/herd/applications", admin, async (req, res) => {
      res.json(await listApplications(ctx, parseQuery(req, ApplicationsQuery)));
    });

    router.post("/admin/herd/applications/decision", admin, async (req, res) => {
      const body = parseBody(req, DecisionBody);
      res.json(await decide(ctx, by(req), body.ids, body.status, body.note));
    });

    router.post("/admin/herd/applications/rescore", admin, ctx.limits.heavy, async (req, res) => {
      const body = parseBody(req, RescoreBody);
      res.json({ rescored: await rescore(ctx, by(req), body.ids) });
    });

    router.post("/admin/herd/applications/:id/notes", admin, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await addNote(ctx, by(req), id.toLowerCase(), parseBody(req, NoteBody).text));
    });

    router.post("/admin/herd/applications/:id/flags", admin, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await setFlagsCleared(ctx, by(req), id.toLowerCase(), parseBody(req, FlagsBody).cleared));
    });

    router.post("/admin/herd/applications/:id/verify", admin, ctx.limits.heavy, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      if (!ctx.config.herd.xApiBearer) throw new ElyiaHttpError("X_API_NOT_CONFIGURED", 409, "X_API_BEARER is not set: review X tasks manually.");
      const doc = (await allApplications(ctx)).find((entry) => entry.id === id || entry.wallet === id.toLowerCase());
      if (!doc) throw new ElyiaHttpError("NOT_FOUND", 404, "No such application.");
      const tasks = await listTasks(ctx);
      const checks = [];
      for (const check of doc.tasks) {
        const task = tasks.find((entry) => entry.id === check.taskId);
        checks.push(task ? await verifyWithX(ctx, task, check, doc.xHandle, taskUrl(ctx, task)) : check);
      }
      await ctx.store.collection("herd_applications").put(doc.wallet, { ...doc, tasks: checks } as never);
      await audit(ctx, by(req), "application.verify", `${doc.id}: ${checks.map((check) => `${check.taskId}=${check.state}`).join(", ")}`);
      res.json(view({ ...doc, tasks: checks }));
    });

    router.get("/admin/herd/raffles", admin, async (_req, res) => {
      res.json({ raffles: await listRaffles(ctx) });
    });

    router.post("/admin/herd/raffles", admin, async (req, res) => {
      const body = parseBody(req, RaffleBody);
      res.status(201).json(await commitRaffle(ctx, by(req), body.network ?? herdNetwork(ctx), body));
    });

    router.post("/admin/herd/raffles/:id/draw", admin, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await drawRaffle(ctx, by(req), id));
    });

    router.post("/admin/herd/raffles/:id/apply", admin, async (req, res) => {
      const { id } = parseParams(req, IdParams);
      res.json(await applyRaffle(ctx, by(req), id));
    });

    router.get("/admin/herd/partners", admin, async (_req, res) => {
      res.json({ partners: await listPartners(ctx) });
    });

    router.put("/admin/herd/partners/:tag", admin, async (req, res) => {
      const { tag } = parseParams(req, TagParams);
      res.json(await putPartner(ctx, by(req), tag, parseBody(req, PartnerBody)));
    });

    router.delete("/admin/herd/partners/:tag", admin, async (req, res) => {
      const { tag } = parseParams(req, TagParams);
      res.json({ deleted: await deletePartner(ctx, by(req), tag) });
    });

    router.post("/admin/herd/merkle/:list/build", admin, async (req, res) => {
      const { list } = parseParams(req, ListParams);
      const network = parseBody(req, BuildBody).network ?? herdNetwork(ctx);
      res.json(await buildList(ctx, by(req), network, list));
    });

    router.get("/admin/herd/merkle/:list/export", admin, async (req, res) => {
      const { list } = parseParams(req, ListParams);
      const query = parseQuery(req, FormatQuery);
      const network = query.network ?? herdNetwork(ctx);
      const format = query.format ?? "json";
      const out = await exportBuild(ctx, network, list);
      await audit(ctx, by(req), "merkle.export", `${list} on ${network} as ${format} (${out.entries.length} leaves, root ${out.build.root})`);
      if (format === "json") return sendFile(res, `herd-${list}-${network}`, "json", JSON.stringify(out, null, 2));
      sendFile(res, `herd-${list}-${network}`, "csv", toCsv(["member", "leaf", "proof", "root"], out.entries.map((entry) => [entry.member, entry.leaf, entry.proof.join(" "), out.build.root])));
    });

    router.get("/admin/herd/snapshot", admin, async (req, res) => {
      const query = parseQuery(req, FormatQuery);
      const network = query.network ?? herdNetwork(ctx);
      const snap = await snapshot(ctx, network);
      await audit(ctx, by(req), "snapshot.export", `${network}: ${snap.count} addresses, root ${snap.root}`);
      if ((query.format ?? "json") === "json") return sendFile(res, `herd-snapshot-${network}`, "json", JSON.stringify(snap, null, 2));
      sendFile(res, `herd-snapshot-${network}`, "csv", toCsv(["address", "reasons", "root"], snap.entries.map((entry) => [entry.address, entry.reasons.join(" "), snap.root])));
    });

    router.post("/admin/herd/tx", admin, async (req, res) => {
      const body = parseBody(req, TxBody);
      res.json(await prepareTx(ctx, { network: body.network ?? herdNetwork(ctx), functionName: body.functionName, args: body.args, by: by(req) }));
    });

    router.post("/admin/herd/tx/sent", admin, async (req, res) => {
      const body = parseBody(req, SentBody);
      forgetHerdCaches(ctx);
      await audit(ctx, by(req), "tx.sent", `${body.functionName} on ${body.network ?? herdNetwork(ctx)}: ${body.hash}`);
      res.json({ recorded: true });
    });

    router.get("/admin/herd/dashboard", admin, async (req, res) => {
      const network = netOf(ctx, req);
      const [config, tokens, index, apps] = await Promise.all([collectionView(ctx, network), allTokens(ctx, network), indexState(ctx, network), listApplications(ctx, { limit: 1 })]);
      let balance: string | null = null;
      if (config.address && ctx.chains.isAvailable(network)) balance = await ctx.chains.client(network).getBalance({ address: config.address as `0x${string}` }).then((value) => value.toString(), () => null);
      const { flagged: _flagged, ...counts } = apps.counts;
      res.json({ network, address: config.address, indexedTo: index ? index.next - 1 : null, head: index?.head ?? null, ...dashboardOf(tokens), contractBalanceWei: balance, applications: counts, note: config.address ? (index?.lastError ? `Indexer: ${index.lastError}` : null) : config.note });
    });

    router.get("/admin/herd/audit", admin, async (_req, res) => {
      res.json({ audit: await auditLog(ctx, 500) });
    });
  },
  start(ctx) {
    startIndexer(ctx);
  },
  stop(ctx) {
    stopIndexer(ctx);
  },
};
