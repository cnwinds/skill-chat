#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const nativeDependencies = [
  {
    name: 'better-sqlite3',
    check: "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();",
  },
];

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: repoRoot,
  env: process.env,
  encoding: 'utf8',
  ...options,
});

const runNpm = (args) => {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args]);
  }
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(command, args, { shell: process.platform === 'win32' });
};

const checkDependency = (dependency) => run(process.execPath, [
  '-e',
  dependency.check,
]);

const formatOutput = (result) => [
  result.stdout,
  result.stderr,
].filter(Boolean).join('\n').trim();

const isLockedNativeOutput = (output) => (
  /better_sqlite3\.node/i.test(output) &&
  /(EBUSY|EPERM|resource busy|locked|operation not permitted)/i.test(output)
);

const findProjectServerProcessIds = () => {
  if (process.platform !== 'win32') {
    return [];
  }

  const normalizedRoot = repoRoot.replace(/\\/g, '/').toLowerCase();
  const command = [
    `$root = ${JSON.stringify(normalizedRoot)}`,
    'Get-CimInstance Win32_Process | Where-Object {',
    "  $_.Name -eq 'node.exe' -and $_.CommandLine -and",
    '  $_.CommandLine.Replace(\'\\\', \'/\').ToLowerInvariant().Contains($root) -and',
    "  $_.CommandLine.Replace('\\\\', '/').ToLowerInvariant() -match 'src/index\\.ts'",
    '} | Select-Object -ExpandProperty ProcessId',
  ].join('\n');

  const result = run('powershell.exe', ['-NoProfile', '-Command', command]);
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
};

const stopProjectServerProcesses = () => {
  const pids = findProjectServerProcessIds();
  if (pids.length === 0) {
    return false;
  }

  console.warn(`[native-deps] Stopping project server process(es) locking native modules: ${pids.join(', ')}`);
  for (const pid of pids) {
    run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
  }
  return true;
};

const rebuildOnce = (dependency) => {
  const result = runNpm(['rebuild', dependency.name]);
  const output = formatOutput(result);
  if (output) {
    const stream = result.status === 0 ? process.stdout : process.stderr;
    stream.write(`${output}\n`);
  }
  return {
    status: result.status,
    output,
    error: result.error,
  };
};

const rebuild = (dependency) => {
  console.warn(`[native-deps] ${dependency.name} is not loadable for Node ${process.version}. Rebuilding...`);
  let result = rebuildOnce(dependency);
  if (result.status !== 0 && isLockedNativeOutput(result.output) && stopProjectServerProcesses()) {
    result = rebuildOnce(dependency);
  }

  if (result.status !== 0) {
    const errorDetail = result.error ? `: ${result.error.message}` : '';
    throw new Error(`npm rebuild ${dependency.name} failed with exit code ${result.status ?? 'unknown'}${errorDetail}`);
  }
};

for (const dependency of nativeDependencies) {
  const firstCheck = checkDependency(dependency);
  if (firstCheck.status === 0) {
    continue;
  }

  const firstError = formatOutput(firstCheck);
  rebuild(dependency);

  const secondCheck = checkDependency(dependency);
  if (secondCheck.status !== 0) {
    const secondError = formatOutput(secondCheck);
    throw new Error([
      `${dependency.name} still cannot be loaded after rebuild.`,
      firstError ? `Before rebuild:\n${firstError}` : '',
      secondError ? `After rebuild:\n${secondError}` : '',
    ].filter(Boolean).join('\n\n'));
  }

  console.warn(`[native-deps] ${dependency.name} rebuild completed.`);
}
