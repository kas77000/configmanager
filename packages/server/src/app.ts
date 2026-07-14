import express, { type Express, type RequestHandler } from 'express';
import type { ConfigRepo } from './git/repo';
import { ROLES, type Role, type UserDirectory, canApprove, canEdit, isAdmin } from './store/users';
import type { AuditLog } from './store/audit';
import type { Change, ChangeStore, ChangeTarget, JiraTicket } from './store/changes';
import { InstanceStore, isValidInstanceCode } from './store/instances';
import type { JiraClient } from './jira';
import { approvalEmail, recapEmail, toEml } from './email';
import { type AuthedRequest, identityMiddleware, requireUser } from './identity';
import { evaluateGate } from './gate';
import { checkDrift } from './verify';
import type { InstanceReader } from './instance-reader';
import { MANAGED_FILE, instanceBranch } from './config';

const SERVICE_ACCOUNT = { name: 'Service Account', email: 'service-account@local' };

export interface AppDeps {
  repo: ConfigRepo;
  users: UserDirectory;
  audit: AuditLog;
  changes: ChangeStore;
  instances: InstanceStore;
  reader: InstanceReader;
  jira: JiraClient;
  /** Base URL of the web app, used in email links. */
  appBaseUrl: string;
  identity: { header: string; devUser?: string };
}

const wrap =
  (fn: (req: AuthedRequest, res: express.Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req as AuthedRequest, res).catch(next);
  };

export function createApp(deps: AppDeps): Express {
  const { repo, users, audit, changes, instances, reader, jira } = deps;
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const api = express.Router();
  api.use(identityMiddleware(users, deps.identity));

  function requireAdmin(req: AuthedRequest, res: express.Response): boolean {
    if (!isAdmin(requireUser(req).roles)) { res.status(403).json({ error: 'admin only' }); return false; }
    return true;
  }
  function requireEdit(req: AuthedRequest, res: express.Response): boolean {
    if (!canEdit(requireUser(req).roles)) { res.status(403).json({ error: 'you do not have permission to create or edit changes' }); return false; }
    return true;
  }
  function requireApprove(req: AuthedRequest, res: express.Response): boolean {
    if (!canApprove(requireUser(req).roles)) { res.status(403).json({ error: 'you do not have permission to approve changes' }); return false; }
    return true;
  }
  const author = (req: AuthedRequest) => {
    const u = requireUser(req);
    return { name: u.displayName, email: u.email || `${u.windowsId}@local` };
  };

  api.get('/me', wrap(async (req, res) => res.json(requireUser(req))));

  // --- Users (admin) -------------------------------------------------------
  api.get('/users', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json(await users.list());
  }));
  const validRoles = (v: unknown): v is Role[] => Array.isArray(v) && v.every((r) => (ROLES as string[]).includes(r));

  api.post('/users', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const windowsId = String(req.body?.windowsId ?? '').trim();
    const roles = req.body?.roles ?? [];
    if (!windowsId) { res.status(400).json({ error: 'windowsId required' }); return; }
    if (!validRoles(roles)) { res.status(400).json({ error: `roles must be a subset of ${ROLES.join(', ')}` }); return; }
    const user = await users.upsert({
      windowsId,
      displayName: String(req.body?.displayName ?? '').trim() || windowsId,
      email: String(req.body?.email ?? '').trim(),
      roles,
    });
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'add-user', details: { user: windowsId, roles } });
    res.status(201).json(user);
  }));
  api.patch('/users/:id', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const existing = await users.get(req.params.id);
    if (!existing) { res.status(404).json({ error: 'user not found' }); return; }
    if (req.body?.roles !== undefined && !validRoles(req.body.roles)) { res.status(400).json({ error: 'invalid roles' }); return; }
    const user = await users.upsert({
      windowsId: existing.windowsId,
      displayName: req.body?.displayName !== undefined ? String(req.body.displayName) : existing.displayName,
      email: req.body?.email !== undefined ? String(req.body.email) : existing.email,
      roles: req.body?.roles !== undefined ? (req.body.roles as Role[]) : existing.roles,
    });
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'update-user', details: { user: user.windowsId, roles: user.roles } });
    res.json(user);
  }));
  api.delete('/users/:id', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const removed = await users.remove(req.params.id);
    if (!removed) { res.status(404).json({ error: 'user not found' }); return; }
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'remove-user', details: { user: req.params.id } });
    res.json({ deleted: true });
  }));

  // --- Instances -----------------------------------------------------------
  api.get('/instances', wrap(async (_req, res) => res.json(await instances.list())));

  api.post('/instances', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const code = String(req.body?.code ?? '').trim();
    const environment = req.body?.environment;
    const uat = req.body?.uat === true;
    const copyFrom = req.body?.copyFrom ? String(req.body.copyFrom) : undefined;
    if (!isValidInstanceCode(code)) { res.status(400).json({ error: 'invalid instance code' }); return; }
    if (environment !== 'pilot' && environment !== 'production') { res.status(400).json({ error: 'environment must be pilot|production' }); return; }
    if (await instances.has(code)) { res.status(409).json({ error: 'instance already exists' }); return; }
    const all = await instances.list();
    const template = copyFrom ? all.find((i) => i.code === copyFrom) : all[0];
    if (!template) { res.status(400).json({ error: 'no template instance to branch from' }); return; }

    await repo.createBranch(instanceBranch(code), instanceBranch(template.code));
    let created;
    try {
      created = await instances.create({ code, environment, uat, files: [...template.files] });
    } catch (e) {
      if (await repo.branchExists(instanceBranch(code))) await repo.deleteBranch(instanceBranch(code));
      res.status(409).json({ error: (e as Error).message });
      return;
    }
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'create-instance', branch: instanceBranch(code), details: { environment, uat } });
    res.status(201).json(created);
  }));

  api.patch('/instances/:code', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const patch: { environment?: 'pilot' | 'production'; uat?: boolean } = {};
    if (req.body?.environment !== undefined) {
      if (req.body.environment !== 'pilot' && req.body.environment !== 'production') { res.status(400).json({ error: 'environment must be pilot|production' }); return; }
      patch.environment = req.body.environment;
    }
    if (req.body?.uat !== undefined) patch.uat = req.body.uat === true;
    const updated = await instances.update(req.params.code, patch);
    if (!updated) { res.status(404).json({ error: 'instance not found' }); return; }
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'update-instance', branch: instanceBranch(req.params.code), details: patch });
    res.json(updated);
  }));

  api.delete('/instances/:code', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const code = req.params.code;
    if (!(await instances.has(code))) { res.status(404).json({ error: 'instance not found' }); return; }
    await instances.remove(code);
    if (await repo.branchExists(instanceBranch(code))) await repo.deleteBranch(instanceBranch(code));
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'delete-instance', branch: instanceBranch(code) });
    res.json({ deleted: true });
  }));

  api.post('/instances/:code/files', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const code = req.params.code;
    const file = String(req.body?.file ?? '').trim();
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) { res.status(400).json({ error: 'invalid file name' }); return; }
    if (!(await instances.has(code))) { res.status(404).json({ error: 'instance not found' }); return; }
    const branch = instanceBranch(code);
    if (!(await repo.fileExistsAt(branch, file))) {
      await repo.commitFile(branch, file, content, author(req), `add managed file ${file}`);
    }
    const updated = await instances.addFile(code, file);
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'add-file', branch, details: { file } });
    res.status(201).json(updated);
  }));

  api.delete('/instances/:code/files/:file', wrap(async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const updated = await instances.removeFile(req.params.code, req.params.file);
    if (!updated) { res.status(404).json({ error: 'instance not found' }); return; }
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'remove-file', branch: instanceBranch(req.params.code), details: { file: req.params.file } });
    res.json(updated);
  }));

  api.get('/instances/:code/file', wrap(async (req, res) => {
    const inst = await instances.get(req.params.code);
    if (!inst) { res.status(404).json({ error: 'unknown instance' }); return; }
    const file = typeof req.query.file === 'string' ? req.query.file : inst.files[0];
    if (!file) { res.status(404).json({ error: 'no managed file' }); return; }
    try {
      res.json({ instance: inst.code, file, content: await repo.readNamedFile(instanceBranch(inst.code), file) });
    } catch {
      res.status(404).json({ error: 'file not found on instance' });
    }
  }));

  api.post('/instances/:code/sync', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const code = req.params.code;
    if (!(await instances.has(code))) { res.status(404).json({ error: 'unknown instance' }); return; }
    const live = await reader.read(code, MANAGED_FILE);
    if (live === null) { res.status(502).json({ error: 'instance unreachable' }); return; }
    const recorded = await repo.readFile(instanceBranch(code));
    const drift = checkDrift(code, recorded, live);
    if (drift.inSync) { res.json({ updated: false, ...drift }); return; }
    const commit = await repo.commitFile(instanceBranch(code), MANAGED_FILE, live, SERVICE_ACCOUNT, `sync: import live ${MANAGED_FILE} from ${code}`);
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'sync-import', branch: instanceBranch(code), commit });
    res.json({ updated: true, commit, ...drift });
  }));

  // --- Changes -------------------------------------------------------------
  api.get('/changes', wrap(async (_req, res) => res.json(await changes.list())));

  api.post('/changes', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const description = String(req.body?.description ?? '').trim();
    const instList: unknown = req.body?.instances;
    const fileList: unknown = req.body?.files;
    if (!description) { res.status(400).json({ error: 'description required' }); return; }
    if (!Array.isArray(instList) || instList.length === 0) { res.status(400).json({ error: 'instances (non-empty array) required' }); return; }
    const codes = instList.map(String);
    const files = Array.isArray(fileList) && fileList.length ? fileList.map(String) : [MANAGED_FILE];

    for (const code of codes) {
      const inst = await instances.get(code);
      if (!inst) { res.status(400).json({ error: `unknown instance: ${code}` }); return; }
      const missing = files.filter((f) => !inst.files.includes(f));
      if (missing.length) { res.status(400).json({ error: `${code} does not manage: ${missing.join(', ')}` }); return; }
    }

    const change = await changes.create({ description, createdBy: requireUser(req).windowsId, instances: codes, files });
    for (const t of change.targets) await repo.createBranch(t.branch, instanceBranch(t.instance));
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'create-change', details: { changeId: change.id, instances: codes, files } });
    res.status(201).json(change);
  }));

  api.get('/changes/:id', wrap(async (req, res) => {
    const change = await changes.get(req.params.id);
    if (!change) { res.status(404).json({ error: 'change not found' }); return; }
    res.json(change);
  }));

  const resolveTarget = async (req: AuthedRequest, res: express.Response): Promise<{ change: Change; target: ChangeTarget } | null> => {
    const change = await changes.get(req.params.id);
    if (!change) { res.status(404).json({ error: 'change not found' }); return null; }
    const target = change.targets.find((t) => t.instance === req.params.code);
    if (!target) { res.status(404).json({ error: 'instance not part of this change' }); return null; }
    return { change, target };
  };

  const resolveFile = async (req: AuthedRequest, res: express.Response): Promise<{ change: Change; target: ChangeTarget; file: string } | null> => {
    const ctx = await resolveTarget(req, res);
    if (!ctx) return null;
    const file = req.params.file;
    if (!ctx.target.files.includes(file)) { res.status(404).json({ error: 'file not part of this change for this instance' }); return null; }
    return { ...ctx, file };
  };

  // Aggregate the merge gate across an instance target's fixmsg files.
  const instanceGate = async (target: ChangeTarget) => {
    const gate = { findings: [] as ReturnType<typeof evaluateGate>['findings'], errorCount: 0, warningCount: 0, infoCount: 0 };
    for (const file of target.files) {
      if (file !== MANAGED_FILE) continue; // shadow-analysis is specific to ai.fixmsg.properties
      const g = evaluateGate(await repo.readNamedFile(target.branch, file));
      gate.findings.push(...g.findings);
      gate.errorCount += g.errorCount;
      gate.warningCount += g.warningCount;
      gate.infoCount += g.infoCount;
    }
    return gate;
  };

  api.get('/changes/:id/instances/:code/files/:file', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const ctx = await resolveFile(req, res); if (!ctx) return;
    res.json({ instance: ctx.target.instance, file: ctx.file, content: await repo.readNamedFile(ctx.target.branch, ctx.file) });
  }));

  api.put('/changes/:id/instances/:code/files/:file', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const ctx = await resolveFile(req, res); if (!ctx) return;
    const content = req.body?.content;
    const message = String(req.body?.message ?? '').trim();
    if (typeof content !== 'string') { res.status(400).json({ error: 'content (string) required' }); return; }
    if (!message) { res.status(400).json({ error: 'message required' }); return; }
    const commit = await repo.commitFile(ctx.target.branch, ctx.file, content, author(req), message);
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'edit', branch: ctx.target.branch, commit, details: { changeId: ctx.change.id, instance: ctx.target.instance, file: ctx.file } });
    res.json({ instance: ctx.target.instance, file: ctx.file, commit });
  }));

  api.get('/changes/:id/instances/:code/files/:file/diff', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const ctx = await resolveFile(req, res); if (!ctx) return;
    res.json({ instance: ctx.target.instance, file: ctx.file, diff: await repo.diffNamed(ctx.target.branch, instanceBranch(ctx.target.instance), ctx.file) });
  }));

  api.get('/changes/:id/instances/:code/files/:file/analysis', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const ctx = await resolveFile(req, res); if (!ctx) return;
    const gate = ctx.file === MANAGED_FILE
      ? evaluateGate(await repo.readNamedFile(ctx.target.branch, ctx.file))
      : { findings: [], errorCount: 0, warningCount: 0, infoCount: 0 };
    res.json({ instance: ctx.target.instance, file: ctx.file, ...gate });
  }));

  api.post('/changes/:id/submit', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const change = await changes.submit(req.params.id, requireUser(req).windowsId);
    if (!change) { res.status(404).json({ error: 'change not found' }); return; }
    if (change.status !== 'submitted') { res.status(409).json({ error: 'change cannot be submitted from its current state' }); return; }
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'submit-change', details: { changeId: change.id } });
    res.json(change);
  }));

  api.post('/changes/:id/approve', wrap(async (req, res) => {
    if (!requireApprove(req, res)) return;
    const change = await changes.decide(req.params.id, requireUser(req).windowsId, 'approved');
    if (!change) { res.status(404).json({ error: 'change not found' }); return; }
    if (change.status !== 'approved') { res.status(409).json({ error: 'change is not awaiting approval' }); return; }

    // On approval, create one Jira ticket per config file. Jira failures never block approval.
    const files = [...new Set(change.targets.flatMap((t) => t.files))];
    const tickets: JiraTicket[] = [];
    for (const file of files) {
      const targeted = change.targets.filter((t) => t.files.includes(file)).map((t) => t.instance);
      try {
        const { key, url } = await jira.createIssue(
          `[Config] ${change.description} — ${file}`,
          `Change ${change.id}\nFile: ${file}\nInstances: ${targeted.join(', ')}\n${deps.appBaseUrl}/changes/${change.id}`,
        );
        tickets.push({ file, key, url });
      } catch { /* keep approval even if Jira is down */ }
    }
    const finalChange = tickets.length ? await changes.setJiraTickets(change.id, tickets) : change;
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'approve-change', details: { changeId: change.id, jira: tickets.map((t) => t.key) } });
    res.json(finalChange);
  }));

  // Downloadable Outlook draft (.eml with X-Unsent) for the approval request / recap.
  api.get('/changes/:id/email/:kind', wrap(async (req, res) => {
    if (!requireEdit(req, res)) return;
    const change = await changes.get(req.params.id);
    if (!change) { res.status(404).json({ error: 'change not found' }); return; }
    const kind = req.params.kind;
    if (kind !== 'approval' && kind !== 'recap') { res.status(404).json({ error: 'unknown email kind' }); return; }
    const recipients = (await users.list()).filter((u) => canApprove(u.roles) && u.email).map((u) => u.email);
    const email = kind === 'recap' ? recapEmail(change, deps.appBaseUrl) : approvalEmail(change, recipients, deps.appBaseUrl);
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename="change-${change.id}-${kind}.eml"`);
    res.send(toEml(email));
  }));

  api.post('/changes/:id/reject', wrap(async (req, res) => {
    if (!requireApprove(req, res)) return;
    const reason = String(req.body?.reason ?? '').trim();
    const change = await changes.decide(req.params.id, requireUser(req).windowsId, 'rejected', reason || undefined);
    if (!change) { res.status(404).json({ error: 'change not found' }); return; }
    if (change.status !== 'rejected') { res.status(409).json({ error: 'change is not awaiting approval' }); return; }
    await audit.append({ windowsId: requireUser(req).windowsId, ip: req.ip, action: 'reject-change', details: { changeId: change.id, reason } });
    res.json(change);
  }));

  api.post('/changes/:id/instances/:code/merge', wrap(async (req, res) => {
    const user = requireUser(req);
    if (!requireEdit(req, res)) return;
    const ctx = await resolveTarget(req, res); if (!ctx) return;
    if (ctx.change.status !== 'approved') { res.status(403).json({ error: 'change-not-approved' }); return; }
    const acknowledgeWarnings = req.body?.acknowledgeWarnings === true;
    const override = req.body?.override === true;
    const overrideReason = String(req.body?.overrideReason ?? '').trim();
    const gate = await instanceGate(ctx.target);

    if (gate.errorCount > 0) {
      if (!override) { res.status(403).json({ error: 'blocked-by-errors', gate }); return; }
      if (!isAdmin(user.roles)) { res.status(403).json({ error: 'only an admin can override errors', gate }); return; }
      if (!overrideReason) { res.status(400).json({ error: 'overrideReason required to override errors', gate }); return; }
    }
    if (gate.warningCount > 0 && !acknowledgeWarnings) { res.status(409).json({ error: 'warnings-need-acknowledgement', gate }); return; }

    const result = await repo.merge(ctx.target.branch, author(req), instanceBranch(ctx.target.instance));
    if (!result.ok) { res.status(409).json({ error: 'merge-conflict', conflicts: result.conflicts }); return; }
    await changes.markMerged(ctx.change.id, ctx.target.instance, result.commit!);
    await audit.append({
      windowsId: user.windowsId, ip: req.ip, action: 'merge', branch: instanceBranch(ctx.target.instance), commit: result.commit,
      details: {
        changeId: ctx.change.id, instance: ctx.target.instance,
        acknowledgedWarnings: acknowledgeWarnings && gate.warningCount > 0,
        override: override && gate.errorCount > 0,
        overrideReason: override && gate.errorCount > 0 ? overrideReason : undefined,
      },
    });
    res.json({ merged: true, instance: ctx.target.instance, commit: result.commit });
  }));

  // --- Commits & history ---------------------------------------------------
  api.get('/commits/:hash', wrap(async (req, res) => {
    try {
      res.json(await repo.commitDetail(req.params.hash));
    } catch {
      res.status(404).json({ error: 'commit not found' });
    }
  }));

  api.get('/history', wrap(async (_req, res) => {
    res.json({ commits: await repo.log(), audit: await audit.list() });
  }));

  app.use('/api', api);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}
