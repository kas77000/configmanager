import express, { type Express, type RequestHandler } from 'express';
import type { ConfigRepo } from './git/repo';
import type { UserDirectory } from './store/users';
import type { AuditLog } from './store/audit';
import { type AuthedRequest, identityMiddleware, requireUser } from './identity';
import { evaluateGate } from './gate';
import { MAIN_BRANCH } from './config';

export interface AppDeps {
  repo: ConfigRepo;
  users: UserDirectory;
  audit: AuditLog;
  identity: { header: string; devUser?: string };
}

/** Wraps an async handler so rejected promises reach Express's error middleware. */
const wrap =
  (fn: (req: AuthedRequest, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req as AuthedRequest, res).catch(next);
  };

export function createApp(deps: AppDeps): Express {
  const { repo, users, audit } = deps;
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();
  api.use(identityMiddleware(users, deps.identity));

  api.get('/me', wrap(async (req, res) => {
    res.json(requireUser(req));
  }));

  // --- User administration -------------------------------------------------
  api.get('/users', wrap(async (req, res) => {
    if (requireUser(req).role !== 'admin') {
      res.status(403).json({ error: 'admin only' });
      return;
    }
    res.json(await users.list());
  }));

  api.post('/users/:id/role', wrap(async (req, res) => {
    if (requireUser(req).role !== 'admin') {
      res.status(403).json({ error: 'admin only' });
      return;
    }
    const role = req.body?.role;
    if (role !== 'admin' && role !== 'editor' && role !== 'pending') {
      res.status(400).json({ error: 'role must be admin|editor|pending' });
      return;
    }
    const updated = await users.setRole(req.params.id, role);
    if (!updated) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    res.json(updated);
  }));

  // --- File & branches -----------------------------------------------------
  api.get('/file', wrap(async (_req, res) => {
    res.json({ branch: MAIN_BRANCH, content: await repo.readFile(MAIN_BRANCH) });
  }));

  api.get('/branches', wrap(async (_req, res) => {
    res.json(await repo.listBranches());
  }));

  api.post('/branches', wrap(async (req, res) => {
    const user = requireUser(req);
    if (user.role === 'pending') {
      res.status(403).json({ error: 'your account is pending role assignment' });
      return;
    }
    const name = String(req.body?.name ?? '').trim();
    if (!name) {
      res.status(400).json({ error: 'name required' });
      return;
    }
    try {
      await repo.createBranch(name);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    await audit.append({ windowsId: user.windowsId, ip: req.ip, action: 'create-branch', branch: name });
    res.status(201).json({ name });
  }));

  api.get('/branches/:name/file', wrap(async (req, res) => {
    try {
      res.json({ branch: req.params.name, content: await repo.readFile(req.params.name) });
    } catch {
      res.status(404).json({ error: 'branch or file not found' });
    }
  }));

  api.put('/branches/:name/file', wrap(async (req, res) => {
    const user = requireUser(req);
    if (user.role === 'pending') {
      res.status(403).json({ error: 'your account is pending role assignment' });
      return;
    }
    const content = req.body?.content;
    const message = String(req.body?.message ?? '').trim();
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content (string) required' });
      return;
    }
    if (!message) {
      res.status(400).json({ error: 'message required' });
      return;
    }
    const author = { name: user.displayName, email: user.email || `${user.windowsId}@local` };
    const commit = await repo.writeCommit(req.params.name, content, author, message);
    await audit.append({
      windowsId: user.windowsId,
      ip: req.ip,
      action: 'edit',
      branch: req.params.name,
      commit,
    });
    res.json({ branch: req.params.name, commit });
  }));

  api.get('/branches/:name/diff', wrap(async (req, res) => {
    try {
      res.json({ branch: req.params.name, diff: await repo.diff(req.params.name) });
    } catch {
      res.status(404).json({ error: 'branch not found' });
    }
  }));

  api.get('/branches/:name/analysis', wrap(async (req, res) => {
    let content: string;
    try {
      content = await repo.readFile(req.params.name);
    } catch {
      res.status(404).json({ error: 'branch or file not found' });
      return;
    }
    res.json({ branch: req.params.name, ...evaluateGate(content) });
  }));

  // --- Merge (enforces the gate) ------------------------------------------
  api.post('/branches/:name/merge', wrap(async (req, res) => {
    const user = requireUser(req);
    if (user.role === 'pending') {
      res.status(403).json({ error: 'your account is pending role assignment' });
      return;
    }
    const branch = req.params.name;
    const acknowledgeWarnings = req.body?.acknowledgeWarnings === true;
    const override = req.body?.override === true;
    const overrideReason = String(req.body?.overrideReason ?? '').trim();

    let content: string;
    try {
      content = await repo.readFile(branch);
    } catch {
      res.status(404).json({ error: 'branch or file not found' });
      return;
    }
    const gate = evaluateGate(content);

    if (gate.errorCount > 0) {
      if (!override) {
        res.status(403).json({ error: 'blocked-by-errors', gate });
        return;
      }
      if (user.role !== 'admin') {
        res.status(403).json({ error: 'only an admin can override errors', gate });
        return;
      }
      if (!overrideReason) {
        res.status(400).json({ error: 'overrideReason required to override errors', gate });
        return;
      }
    }

    if (gate.warningCount > 0 && !acknowledgeWarnings) {
      res.status(409).json({ error: 'warnings-need-acknowledgement', gate });
      return;
    }

    const author = { name: user.displayName, email: user.email || `${user.windowsId}@local` };
    const result = await repo.merge(branch, author);
    if (!result.ok) {
      res.status(409).json({ error: 'merge-conflict', conflicts: result.conflicts });
      return;
    }

    await audit.append({
      windowsId: user.windowsId,
      ip: req.ip,
      action: 'merge',
      branch,
      commit: result.commit,
      details: {
        acknowledgedWarnings: acknowledgeWarnings && gate.warningCount > 0,
        override: override && gate.errorCount > 0,
        overrideReason: override && gate.errorCount > 0 ? overrideReason : undefined,
      },
    });
    res.json({ merged: true, commit: result.commit });
  }));

  // --- History -------------------------------------------------------------
  api.get('/history', wrap(async (_req, res) => {
    res.json({ commits: await repo.log(), audit: await audit.list() });
  }));

  app.use('/api', api);

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}
