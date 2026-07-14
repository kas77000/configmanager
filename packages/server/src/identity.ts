import type { NextFunction, Request, Response } from 'express';
import type { User, UserDirectory } from './store/users';

export interface AuthedRequest extends Request {
  user?: User;
}

export interface IdentityOptions {
  header: string;
  /** Fallback Windows ID for local development when the header is absent. */
  devUser?: string;
}

/** Reads the Windows ID (from the reverse-proxy header or dev fallback) and attaches req.user. */
export function identityMiddleware(users: UserDirectory, opts: IdentityOptions) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const raw = (req.header(opts.header) ?? opts.devUser ?? '').trim();
    if (!raw) {
      res.status(401).json({ error: 'No Windows identity present; reverse proxy is misconfigured.' });
      return;
    }
    // Accept both "DOMAIN\\user" and bare "user".
    const windowsId = raw.includes('\\') ? raw.split('\\').pop()!.trim() : raw;
    try {
      req.user = await users.ensure(windowsId);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Returns the authenticated user or throws (routes run after identityMiddleware). */
export function requireUser(req: AuthedRequest): User {
  if (!req.user) throw new Error('user not resolved');
  return req.user;
}
