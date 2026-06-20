// Diagnostic: apply drizzle migrations against a FRESH dev DB, one statement at a
// time, with clear per-statement errors. On a migration failure, log it and skip the
// rest of that migration, continuing to the next -- so we surface ALL broken
// migrations in one pass instead of one-at-a-time. Run with Node 20 from the repo dir.
//   node dev-environment/migrate-debug.mjs
// DATABASE_URL is read from the environment (fallback = local dev default below).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 自我定位：本檔在 <repo>/dev-environment/，上層即 repo 根
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// resolve modules from the repo's node_modules, not this script's folder
const require = createRequire(path.join(REPO_ROOT, 'package.json'));
const mysql = require('mysql2/promise');

const DRIZZLE = path.join(REPO_ROOT, 'drizzle');
const URL = process.env.DATABASE_URL ?? 'mysql://hs:hs_dev_pw@127.0.0.1:3306/healing_studio';

const journal = JSON.parse(fs.readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8'));
const conn = await mysql.createConnection(URL); // multipleStatements defaults to false (matches prod)

const failures = [];
let appliedOk = 0;
for (const e of journal.entries) {
  const file = path.join(DRIZZLE, e.tag + '.sql');
  if (!fs.existsSync(file)) { failures.push({ tag: e.tag, why: 'FILE MISSING' }); continue; }
  const sql = fs.readFileSync(file, 'utf8');
  const stmts = sql.split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
  let migOk = true;
  for (let i = 0; i < stmts.length; i++) {
    const st = stmts[i];
    // skip chunks that are only SQL comments / blank
    const noComments = st.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim();
    if (!noComments) continue;
    try {
      await conn.query(st);
    } catch (err) {
      migOk = false;
      const snippet = st.replace(/\s+/g, ' ').slice(0, 220);
      failures.push({ tag: e.tag, stmt: i + 1, code: err.code, msg: err.sqlMessage, snippet });
      console.log(`\nFAIL  ${e.tag}  [stmt ${i + 1}/${stmts.length}]  ${err.code}`);
      console.log(`   ${err.sqlMessage}`);
      console.log(`   SQL> ${snippet}`);
      break; // skip rest of this migration, continue to next
    }
  }
  if (migOk) appliedOk++;
}

console.log('\n===== SUMMARY =====');
console.log(`journal entries: ${journal.entries.length}   applied-clean: ${appliedOk}   failed: ${failures.length}`);
for (const f of failures) console.log(` - ${f.tag}${f.stmt ? ` [stmt ${f.stmt}]` : ''}: ${f.why || (f.code + ' ' + f.msg)}`);
await conn.end();
process.exit(failures.length ? 1 : 0);
