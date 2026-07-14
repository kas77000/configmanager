import express, { type Express, type RequestHandler } from 'express';
import type { ConfigRepo } from './git/repo';
import type { UserDirectory } from './store/users';
import type { AuditLog } from './store/audit';
import type { Change, ChangeStore } from './store/changes';
import { type AuthedRequest, identityMiddleware, requireUser } from './identity';
import { evaluateGate } from './gate';
import { checkDrift } from './verify';
import { INSTANCES, changeBranch, instanceBranch, isInstance } from './config';

export interface AppDeps {
  repo: ConfigRepo;
  users: UserDirectory;
  audit: AuditLog;
  changes: ChangeStore;
  identity: { header: string; devUser?: string };
}

const wrap =
  (fn: (req: AuthedRequest, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req as AuthedRequest, res).catch(next);
  };

/** Resolves the working branch for a (change, instance) pair, or null if the pair is invalid. */
function targetBranch(change: Change, instance: string): string | null {
  const t = change.targets.find((x) => x.instance === instance);
  return t ? t.branch : null;
}

export function createApp(deps: AppDeps): Express {
  const { repo, users, audit, changes } = deps;
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();
  api.use(identityMiddleware(users, deps.identity));

  const denyPending = (req: AuthedRequest, res: express.Response): boolean => {
    if (requireUser(req).role === 'pending') {
      res.status(403).json({ error: 'your account is pending role assignment' });
      return true;
    }
    return false;
  };

  api.get('/me', wrap(async (req, res) => {
    res.json(requireUser(req));
  }));

  // --- User administration -------------------------------------------------
  api.get('/users', wrap(async (req, res) => {
    if (requireUser(req).role !== 'admin') { res.status(403).json({ error: 'admin only' }); return; }
    res.json(await users.list());
  }));

  api.post('/users/:id/role', wrap(async (req, res) => {
    if (requireUser(req).role !== 'admin') { res.status(403).json({ error: 'admin only' }); return; }
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'editor' && role !== 'pending') {
      res.status(400).json({ error: 'role must be admin|editor|pending' });
      return;
    }
    const updated = await users.setRole(req.params.id, role);
    if (!updated) { res.status(404).json({ error: 'user not found' }); return; }
    res.json(updated);
  }));

  // --- Instances (per-instance canonical versions) -------------------------
  api.get('/instances', wrap(async (_req, res) => {
    res.json(INSTANCES);
  }));

  api.get('/instances/:code/file', wrap(async (req, res) => {
    if (!isInstance(req.params.code)) { res.status(404).json({ error: 'unknown instance' }); return; }
    res.json({ instance: req.params.code, content: await repo.readFile(instanceBranch(req.params.code)) });
  }));

  // Read-only drift check: caller supplies the live file content; the app never pushes.
  api.post('/instances/:code/verify', wrap(async (req, res) => {
    const code = req.params.code;
    if (!isInstance(code)) { res.status(404).json({ error: 'unknown instance' }); return; }
    const live = req.body?.liveContent;
    if (typeof live !== 'string') { res.status(400).json({ error: 'liveContent (string) required' }); return; }
    const recorded = await repo.readFile(instanceBranch(code));
    const result = checkDrift(code, recorded, live);
    await audit.append({
      windowsId: requireUser(req).windowsId,
      ip: req.ip,
      action: 'verify-instance',
      branch: instanceBranch(code),
      details: { inSync: result.inSync },
    });
    res.json(result);
  }));

  // --- Changes (a methodology fanned out across instances) -----------------
  api.get('/changes', wrap(async (_req, res) => {
    res.json(await changes.list());
  }));

  api.post('/changes', wrap(async (req, res) => {
    const user = requireUser(req);
    if (denyPending(req, res)) return;
    const description = String(req.body?.description ?? '').trim();
    const instances: unknown = req.body?.instances;
    if (!description) { res.status(400).json({ error: 'description required' }); return; }
    if (!Array.isArray(instances) || instances.length === 0) {
      res.status(400).json({ error: 'instances (non-empty array) required' });
      return;
    }
    const bad = instances.filter((c) => !isInstance(String(c)));
    if (bad.length) { res.status(400).json({ error: `unknown instances: ${bad.join(', ')}` }); return; }

    const change = await changes.create({
      description,
      createdBy: user.windowsId,
      instances: instances.map(String),
    });
    for (const target of change.targets) {
      await repo.createBranch(target.branch, instanceBranch(target.instance));
    }
    await audit.append({
      windowsId: user.windowsId,
      ip: req.ip,
      action: 'create-change',
      details: { changeId: change.id, instances: change.targets.map((t) => t.instance) },
    });
    res.status(201).json(change);
  }));

  api.get('/changes/:id', wrap(async (req, res) => {
    const change = await changes.get(req.params.id);
    if (!change) { res.status(404).json({ error: 'change not found' }); return; }
    res.json(change);
  }));

  // --- Per-(change, instance) editing --------------------------------------
  const resolve = async (
    req: AuthedRequest,
    res: express.Response,
  ): Promise<{ change: Change; instance: string; branch: string } | null> => {
    const change = await changes.get(req.params.id);
    if (!change) { res.status(404).json({ error: 'change not found' }); return null; }
    const instance = req.params.code;
    const branch = targetBranch(change, instance);
    if (!branch) { res.status(404).json({ error: 'instance not part of this change' }); return null; }
    return { change, instance, branch };
  };

  api.get('/changes/:id/instances/:code/file', wrap(async (req, res) => {
    const ctx = await resolve(req, res);
    if (!ctx) return;
    res.json({ instance: ctx.instance, content: await repo.readFile(ctx.branch) });
  }));

  api.put('/changes/:id/instances/:code/file', wrap(async (req, res) => {
    const user = requireUser(req);
    if (denyPending(req, res)) return;
    const ctx = await resolve(req, res);
    if (!ctx) return;
    const content = req.body?.content;
    const message = String(req.body?.message ?? '').trim();
    if (typeof content !== 'string') { res.status(400).json({ error: 'content (string) required' }); return; }
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    const author = { name: user.displayName, email: user.email || `${user.windowsId}@local` };
    const commit = await repo.writeCommit(ctx.branch, content, author, message);
    await audit.append({
      windowsId: user.windowsId,
      ip: req.ip,
      action: 'edit',
      branch: ctx.branch,
      commit,
      details: { changeId: ctx.change.id, instance: ctx.instance },
    });
    res.json({ instance: ctx.instance, commit });
  }));

  api.get('/changes/:id/instances/:code/diff', wrap(async (req, res) => {
    const ctx = await resolve(req, res);
    if (!ctx) return;
    res.json({ instance: ctx.instance, diff: await repo.diff(ctx.branch, instanceBranch(ctx.instance)) });
  }));

  api.get('/changes/:id/instances/:code/analysis', wrap(async (req, res) => {
    const ctx = await resolve(req, res);
    if (!ctx) return;
    res.json({ instance: ctx.instance, ...evaluateGate(await repo.readFile(ctx.branch)) });
  }));

  api.post('/changes/:id/instances/:code/merge', wrap(async (req, res) => {
    const user = requireUser(req);
    if (denyPending(req, res)) return;
    const ctx = await resolve(req, res);
    if (!ctx) return;

    const acknowledgeWarnings = req.body?.acknowledgeWarnings === true;
    const override = req.body?.override === true;
    const overrideReason = String(req.body?.overrideReason ?? '').trim();

    const gate = evaluateGate(await repo.readFile(ctx.branch));

    if (gate.errorCount > 0) {
      if (!override) { res.status(403).json({ error: 'blocked-by-errors', gate }); return; }
      if (user.role !== 'admin') { res.status(403).json({ error: 'only an admin can override errors', gate }); return; }
      if (!overrideReason) { res.status(400).json({ error: 'overrideReason required to override errors', gate }); return; }
    }
    if (gate.warningCount > 0 && !acknowledgeWarnings) {
      res.status(409).json({ error: 'warnings-need-acknowledgement', gate });
      return;
    }

    const author = { name: user.displayName, email: user.email || `${user.windowsId}@local` };
    const result = await repo.merge(ctx.branch, author, instanceBranch(ctx.instance));
    if (!result.ok) { res.status(409).json({ error: 'merge-conflict', conflicts: result.conflicts }); return; }

    await changes.markMerged(ctx.change.id, ctx.instance, result.commit!);
    await audit.append({
      windowsId: user.windowsId,
      ip: req.ip,
      action: 'merge',
      branch: instanceBranch(ctx.instance),
      commit: result.commit,
      details: {
        changeId: ctx.change.id,
        instance: ctx.instance,
        acknowledgedWarnings: acknowledgeWarnings && gate.warningCount > 0,
        override: override && gate.errorCount > 0,
        overrideReason: override && gate.errorCount > 0 ? overrideReason : undefined,
      },
    });
    res.json({ merged: true, instance: ctx.instance, commit: result.commit });
  }));

  // --- History -------------------------------------------------------------
  api.get('/history', wrap(async (_req, res) => {
    res.json({ commits: await repo.log(), audit: await audit.list() });
  }));

  app.use('/api', api);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}
