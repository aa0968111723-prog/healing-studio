import { spawn } from 'node:child_process';

const passthrough = process.argv.slice(2).filter(arg => arg !== '--runInBand');

const child = spawn('vitest', ['run', ...passthrough], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', code => {
  process.exit(code ?? 1);
});
