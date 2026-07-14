import { createHash } from 'node:crypto';

export interface DriftResult {
  instance: string;
  inSync: boolean;
  recordedSha: string;
  liveSha: string;
}

function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}

/**
 * Read-only drift check: compares the version the app recorded for an instance against the
 * live content pulled from that instance. The app never writes to the instance.
 */
export function checkDrift(instance: string, recorded: string, live: string): DriftResult {
  const recordedSha = sha1(recorded);
  const liveSha = sha1(live);
  return { instance, inSync: recordedSha === liveSha, recordedSha, liveSha };
}
