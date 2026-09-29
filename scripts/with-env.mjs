// Cross-platform env-file switcher.
//
// Usage:
//   node scripts/with-env.mjs --file .env --app-env local -- <command...>
//   node scripts/with-env.mjs --file .env.production --app-env production -- tsx watch src/server.ts
//
// Why a wrapper instead of `dotenv-cli` / shell-inline env?
// - Works identically on Windows PowerShell, bash, and CI (no `VAR=x cmd` syntax).
// - Explicit file selection: `dev:local` vs `dev:production` can't silently
//   fall back to the wrong `.env`.
// - Pre-loads the file with override:true, so `import 'dotenv/config'` in
//   src/server.ts / prisma.config.ts (override:false by default) keeps these
//   values instead of re-loading the default `.env` over them.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage(exitCode) {
  console.log(
    'Usage: node scripts/with-env.mjs --file <env-file> --app-env <name> -- <command...>',
  );
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) usage(0);

let file = '';
let appEnv = '';
const separator = args.indexOf('--');
const flagArgs = separator === -1 ? args : args.slice(0, separator);
const command = separator === -1 ? [] : args.slice(separator + 1);

for (let i = 0; i < flagArgs.length; i += 1) {
  const flag = flagArgs[i];
  if (flag === '--file') file = flagArgs[i + 1] ?? '';
  if (flag === '--app-env') appEnv = flagArgs[i + 1] ?? '';
  if (flag === '--file' || flag === '--app-env') i += 1;
}

if (!file || !appEnv || command.length === 0) usage(1);

const filePath = resolve(root, file);
if (!existsSync(filePath)) {
  console.error(`[with-env] env file not found: ${file}`);
  console.error(`[with-env] copy .env.example to ${file} and fill in real values.`);
  process.exit(1);
}

loadEnv({ path: filePath, override: true });
process.env['APP_ENV'] = appEnv;

const redactedDb = (process.env['DATABASE_URL'] ?? '').replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
console.log(`[with-env] APP_ENV=${appEnv} file=${file} NODE_ENV=${process.env['NODE_ENV'] ?? 'unset'}`);
console.log(`[with-env] DATABASE_URL=${redactedDb || 'unset'} -> ${command.join(' ')}`);

function quoteArg(arg) {
  if (arg === '') return '""';
  if (process.platform === 'win32') {
    // cmd.exe: wrap args with whitespace/specials in double quotes,
    // escaping embedded quotes for CommandLineToArgvW.
    if (!/[\s"^&|()<>!]/.test(arg)) return arg;
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"')}"`;
  }
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

const fullCommand = command.map(quoteArg).join(' ');
const child = spawn(fullCommand, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
