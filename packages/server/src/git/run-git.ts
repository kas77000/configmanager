import { execFile } from 'node:child_process';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a git command in `cwd`. Never rejects — inspect `code` for success (0) or failure. */
export function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code =
        err && typeof (err as NodeJS.ErrnoException & { code?: number }).code === 'number'
          ? (err as unknown as { code: number }).code
          : err
            ? 1
            : 0;
      resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/** Like runGit but throws on non-zero exit, for commands that must succeed. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const res = await runGit(cwd, args);
  if (res.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${res.code}): ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}
