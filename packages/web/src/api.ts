import type { Finding } from '@config-manager/rule-engine';

export type { Finding };

export type Role = 'admin' | 'editor' | 'stakeholder';
export const ROLES: Role[] = ['admin', 'editor', 'stakeholder'];
export interface User { windowsId: string; displayName: string; email: string; roles: Role[]; }

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Quant',
  stakeholder: 'Stakeholder',
};

export function isAdmin(roles?: Role[]): boolean {
  return !!roles?.includes('admin');
}
export function canEdit(roles?: Role[]): boolean {
  return !!roles && (roles.includes('admin') || roles.includes('editor'));
}
export function canApprove(roles?: Role[]): boolean {
  return !!roles && (roles.includes('admin') || roles.includes('stakeholder'));
}
export function roleSummary(roles?: Role[]): string {
  return roles && roles.length ? roles.map((r) => ROLE_LABEL[r]).join(', ') : 'Pending';
}

export type Environment = 'pilot' | 'production';
export interface InstanceInfo {
  code: string; environment: Environment; uat: boolean; files: string[];
  serverAddress?: string; paths?: Record<string, string>;
}
export interface Settings { quantDistributionEmail: string; }

export interface ChangeTarget { instance: string; branch: string; files: string[]; mergedCommit?: string; }
export interface ChangeItem { file: string; description: string; instances: string[]; }
export type ChangeStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'merged' | 'cancelled';
export interface ChangeDecision { by: string; at: string; action: 'approved' | 'rejected'; reason?: string; }
export interface JiraTicket { file: string; key: string; url: string; }
export interface Change {
  id: string; description: string; effectiveDate?: string; items: ChangeItem[]; createdBy: string; createdAt: string;
  status: ChangeStatus; targets: ChangeTarget[];
  submittedBy?: string; submittedAt?: string; jiraTickets?: JiraTicket[]; decision?: ChangeDecision;
}

export interface Gate { findings: Finding[]; errorCount: number; warningCount: number; infoCount: number; }

export interface Commit {
  hash: string; authorName: string; authorEmail: string; date: string;
  parents: string[]; refs: string; subject: string; instances: string[];
}
export interface AuditEvent {
  id: number; timestamp: string; windowsId: string; ip?: string;
  action: string; branch?: string; commit?: string; details?: Record<string, unknown>;
}
export interface DriftResult { instance: string; inSync: boolean; recordedSha: string; liveSha: string; }

export interface CommitFileChange { file: string; additions: number; deletions: number; patch: string; }
export interface CommitDetail {
  hash: string; authorName: string; authorEmail: string; date: string;
  parents: string[]; refs: string; subject: string; instances: string[]; files: CommitFileChange[];
}

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(typeof body?.error === 'string' ? body.error : `HTTP ${status}`);
  }
}

const DEV_USER_KEY = 'cm.devUser';
export function getDevUser(): string { return localStorage.getItem(DEV_USER_KEY) ?? 'salavat'; }
export function setDevUser(id: string): void { localStorage.setItem(DEV_USER_KEY, id); }

/** Downloads a change's Outlook draft (.eml). The user opens it to review and send. */
export async function downloadEml(id: string, kind: 'approval' | 'recap'): Promise<void> {
  const res = await fetch(`/api/changes/${id}/email/${kind}`, { headers: { 'x-remote-user': getDevUser() } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `change-${id}-${kind}.eml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      'content-type': 'application/json',
      // Dev only: a reverse proxy sets this from Windows Integrated Auth in production.
      'x-remote-user': getDevUser(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  me: () => req<User>('GET', '/me'),
  instances: () => req<InstanceInfo[]>('GET', '/instances'),
  instanceFile: (code: string, file?: string) =>
    req<{ instance: string; file: string; content: string }>('GET', `/instances/${code}/file${file ? `?file=${encodeURIComponent(file)}` : ''}`),
  sync: (code: string) => req<DriftResult & { updated: boolean; commit?: string }>('POST', `/instances/${code}/sync`, {}),

  createInstance: (body: { code: string; environment: Environment; uat: boolean; copyFrom?: string }) => req<InstanceInfo>('POST', '/instances', body),
  updateInstance: (code: string, patch: { environment?: Environment; uat?: boolean; serverAddress?: string }) => req<InstanceInfo>('PATCH', `/instances/${code}`, patch),
  deleteInstance: (code: string) => req<{ deleted: boolean }>('DELETE', `/instances/${code}`),
  addInstanceFile: (code: string, file: string, content?: string, path?: string) => req<InstanceInfo>('POST', `/instances/${code}/files`, { file, content, path }),
  setInstanceFilePath: (code: string, file: string, path: string) => req<InstanceInfo>('PATCH', `/instances/${code}/files/${encodeURIComponent(file)}`, { path }),
  removeInstanceFile: (code: string, file: string) => req<InstanceInfo>('DELETE', `/instances/${code}/files/${encodeURIComponent(file)}`),

  settings: () => req<Settings>('GET', '/settings'),
  updateSettings: (patch: Partial<Settings>) => req<Settings>('PATCH', '/settings', patch),

  commit: (hash: string) => req<CommitDetail>('GET', `/commits/${hash}`),

  users: () => req<User[]>('GET', '/users'),
  createUser: (body: { windowsId: string; displayName?: string; email?: string; roles: Role[] }) => req<User>('POST', '/users', body),
  updateUser: (id: string, patch: { displayName?: string; email?: string; roles?: Role[] }) => req<User>('PATCH', `/users/${id}`, patch),
  deleteUser: (id: string) => req<{ deleted: boolean }>('DELETE', `/users/${id}`),

  changes: () => req<Change[]>('GET', '/changes'),
  createChange: (description: string, items: ChangeItem[], effectiveDate?: string) => req<Change>('POST', '/changes', { description, items, effectiveDate }),
  change: (id: string) => req<Change>('GET', `/changes/${id}`),
  cancelChange: (id: string) => req<Change>('POST', `/changes/${id}/cancel`, {}),
  submitChange: (id: string) => req<Change>('POST', `/changes/${id}/submit`, {}),
  approveChange: (id: string) => req<Change>('POST', `/changes/${id}/approve`, {}),
  rejectChange: (id: string, reason: string) => req<Change>('POST', `/changes/${id}/reject`, { reason }),

  changeFile: (id: string, code: string, file: string) =>
    req<{ instance: string; file: string; content: string }>('GET', `/changes/${id}/instances/${code}/files/${encodeURIComponent(file)}`),
  putChangeFile: (id: string, code: string, file: string, content: string, message: string) =>
    req<{ instance: string; file: string; commit: string }>('PUT', `/changes/${id}/instances/${code}/files/${encodeURIComponent(file)}`, { content, message }),
  changeDiff: (id: string, code: string, file: string) =>
    req<{ instance: string; file: string; diff: string }>('GET', `/changes/${id}/instances/${code}/files/${encodeURIComponent(file)}/diff`),
  changeAnalysis: (id: string, code: string, file: string) =>
    req<{ instance: string; file: string } & Gate>('GET', `/changes/${id}/instances/${code}/files/${encodeURIComponent(file)}/analysis`),
  mergeChange: (id: string, code: string, opts: { acknowledgeWarnings?: boolean; override?: boolean; overrideReason?: string }) =>
    req<{ merged: boolean; instance: string; commit: string }>('POST', `/changes/${id}/instances/${code}/merge`, opts),

  history: () => req<{ commits: Commit[]; audit: AuditEvent[] }>('GET', '/history'),
};
