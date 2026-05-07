#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');

if (wantsHelp) {
  console.log(`GitNexus launcher\n\nUsage:\n  npm run gitnexus            Start local GitNexus server\n  npm run gitnexus -- --help  Show this help\n\nNotes:\n  - This launcher only uses locally/globally available binaries (no registry fetch).\n  - If GitNexus is not installed yet, run: npm install -g gitnexus`);
  process.exit(0);
}

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { stdio: 'inherit' });

let result = run('gitnexus', ['serve', ...args]);
if (result.status === 0) process.exit(0);


console.error('\n[gitnexus] Unable to start GitNexus from local/global PATH.');
console.error('Install once with: npm install -g gitnexus');
process.exit(1);
