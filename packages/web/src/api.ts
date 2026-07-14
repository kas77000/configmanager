import type { Finding } from '@config-manager/rule-engine';

export type { Finding };

export type Role = 'admin' | 'editor' | 'pending';
export interface User { windowsId: string; displayName: string; email: string; role: Role; }

export type Environment = 'pilot' | 'production';
export interface InstanceInfo { code: string; environment: Environment; uat: boolean; files: string[]; }

export interface ChangeTarget { instance: string; branch: string; files: string[]; mergedCommit?: string; }
export type ChangeStatus = 'draft' | 'merged' | 'cancelled';
export interface Change {
  id: string; description: string; createdBy: string; createdAt: string;
  status: ChangeStatus; targets: ChangeTarget[];
}

export interface Gate { findings: Finding[]; errorCount: number; warningCount: number; infoCount: number; }

export interface Commit {
  hash: string; authorName: string; authorEmail: string; date: string;
  parents: string[]; refs: string; subject: string;
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
  updateInstance: (code: string, patch: { environment?: Environment; uat?: boolean }) => req<InstanceInfo>('PATCH', `/instances/${code}`, patch),
  deleteInstance: (code: string) => req<{ deleted: boolean }>('DELETE', `/instances/${code}`),
  addInstanceFile: (code: string, file: string, content?: string) => req<InstanceInfo>('POST', `/instances/${code}/files`, { file, content }),
  removeInstanceFile: (code: string, file: string) => req<InstanceInfo>('DELETE', `/instances/${code}/files/${encodeURIComponent(file)}`),

  commit: (hash: string) => req<CommitDetail>('GET', `/commits/${hash}`),

  changes: () => req<Change[]>('GET', '/changes'),
  createChange: (description: string, instances: string[], files: string[]) => req<Change>('POST', '/changes', { description, instances, files }),
  change: (id: string) => req<Change>('GET', `/changes/${id}`),

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
