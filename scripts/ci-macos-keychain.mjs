// Explicit keychain setup avoids electron-builder 26.15.3 confusing the P12
// export password with its randomly generated keychain password.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
const dir = process.env.RUNNER_TEMP;
if (process.platform !== 'darwin' || !dir || !process.env.GITHUB_ENV) throw new Error('CI macOS runner required');
const keychain = path.join(dir, 'tmx-signing.keychain-db');
const p12 = path.join(dir, 'tmx-signing.p12');
const password = randomBytes(32).toString('hex');
const security = (...args) => {
  try { return execFileSync('/usr/bin/security', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { throw new Error(`Keychain operation failed: ${args[0]}`); }
};
const existing = security('list-keychains', '-d', 'user').split('\n').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
appendFileSync(process.env.GITHUB_ENV, `CSC_KEYCHAIN=${keychain}\n`);
writeFileSync(p12, Buffer.from(process.env.CSC_LINK, 'base64'), { mode: 0o600 });
try {
  security('create-keychain', '-p', password, keychain);
  security('set-keychain-settings', '-lut', '21600', keychain);
  security('unlock-keychain', '-p', password, keychain);
  security('import', p12, '-k', keychain, '-P', process.env.CSC_KEY_PASSWORD, '-T', '/usr/bin/codesign', '-T', '/usr/bin/productbuild');
  security('set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, keychain);
  security('list-keychains', '-d', 'user', '-s', keychain, ...existing);
  const identities = security('find-identity', '-v', '-p', 'codesigning', keychain);
  if (!identities.includes('Developer ID Application:')) throw new Error('No valid Developer ID Application identity');
  console.log('Developer ID Application identity imported and verified');
} finally {
  unlinkSync(p12);
}
