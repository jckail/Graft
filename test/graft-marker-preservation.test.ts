import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRetract } from '../src/hosts/retract.js';
import { GRAFT_MARKERS as a, BRAIN_MARKERS as b } from '../src/hosts/sections.js';

// Match existing host tests; target resolution must not probe PATH/install MCP.
process.env.GRAFT_MCP_NPX = '1';

function fixture(t: { after: (fn: () => void) => void }) {
  const owned = mkdtempSync(join(tmpdir(), 'graft-gf-host05-'));
  t.after(() => rmSync(owned, { recursive: true, force: true }));
  const repo = join(owned, 'repo'), home = join(owned, 'home');
  mkdirSync(repo); mkdirSync(home);
  const sentinel = join(home, 'foreign-global-state.txt');
  writeFileSync(sentinel, 'private fixture home must remain untouched\n');
  return { repo, home, sentinel, path: join(repo, 'AGENTS.md') };
}

function action(repo: string, home: string, path: string, apply: boolean) {
  const report = runRetract(repo, { home, global: false, cache: false, apply });
  const matching = report.filter(row => row.path === path);
  assert.equal(matching.length, 1, 'shared AGENTS target must be reported exactly once');
  return matching[0].action;
}
const lines = (...text: string[]) => text.join('\n') + '\n';
const malformed: Record<string, string> = {
  unclosedForeignTail: lines('foreign before', a.start, 'owned fragment', 'FOREIGN MUST SURVIVE'),
  nestedDifferentTypes: lines('foreign before', a.start, b.start, 'owned', b.end, a.end, 'foreign after'),
  duplicateCompletePair: lines('foreign before', a.start, 'one', a.end, a.start, 'two', a.end, 'foreign after'),
  duplicateOpening: lines('foreign before', a.start, a.start, 'owned', a.end, 'foreign after'),
  crossedPairs: lines('foreign before', a.start, b.start, a.end, b.end, 'foreign after'),
  strayClosingOnly: lines('foreign before', a.end, 'foreign after'),
  strayDifferentClosing: lines('foreign before', a.start, b.end, a.end, 'foreign after'),
  validThenUnclosed: lines('foreign before', a.start, 'owned', a.end, b.start, 'FOREIGN TAIL'),
  crlfUnclosed: lines('foreign before', a.start, 'owned', 'FOREIGN TAIL').replace(/\n/g, '\r\n'),
};
for (const [name, text] of Object.entries(malformed)) {
  test(`GF-HOST-05 public runRetract preserves malformed ${name} in report and apply`, t => {
    const f = fixture(t);
    writeFileSync(f.path, text); chmodSync(f.path, 0o640);
    const before = readFileSync(f.path), mode = statSync(f.path).mode & 0o777;
    for (const apply of [false, true]) {
      assert.equal(action(f.repo, f.home, f.path, apply), 'skipped-unparseable');
      assert.deepEqual(readFileSync(f.path), before, 'all foreign/managed bytes survive');
      assert.equal(statSync(f.path).mode & 0o777, mode);
      assert.equal(readFileSync(f.sentinel, 'utf8'), 'private fixture home must remain untouched\n');
    }
  });
}

for (const eol of ['\n', '\r\n']) {
  test(`GF-HOST-05 public runRetract removes different valid pairs preserving prose (${eol === '\n' ? 'LF' : 'CRLF'})`, t => {
    const f = fixture(t);
    const input = lines('foreign before', '', a.start, 'owned instruction', a.end, '', 'middle foreign', '', b.start, 'owned brain', b.end, '', 'foreign after');
    const expected = lines('foreign before', '', 'middle foreign', '', 'foreign after').replace(/\n/g, eol);
    writeFileSync(f.path, input.replace(/\n/g, eol)); chmodSync(f.path, 0o640);
    const before = readFileSync(f.path);
    assert.equal(action(f.repo, f.home, f.path, false), 'removed');
    assert.deepEqual(readFileSync(f.path), before, 'dry run never changes bytes');
    assert.equal(statSync(f.path).mode & 0o777, 0o640);
    assert.equal(action(f.repo, f.home, f.path, true), 'removed');
    assert.equal(readFileSync(f.path, 'utf8'), expected);
    assert.equal(statSync(f.path).mode & 0o777, 0o640);
    assert.equal(readFileSync(f.sentinel, 'utf8'), 'private fixture home must remain untouched\n');
  });
}

test('GF-HOST-05 public runRetract valid marker-only file reports deletion before applying', t => {
  const f = fixture(t), text = lines(a.start, 'owned', a.end);
  writeFileSync(f.path, text);
  assert.equal(action(f.repo, f.home, f.path, false), 'deleted');
  assert.equal(readFileSync(f.path, 'utf8'), text);
  assert.equal(action(f.repo, f.home, f.path, true), 'deleted');
  assert.ok(!existsSync(f.path));
  assert.ok(existsSync(f.sentinel));
});

test('GF-HOST-05 public runRetract preserves inline marker prose and marker-free text', t => {
  const f = fixture(t), text = lines(`foreign inline ${a.start} mention`, `foreign inline ${a.end} mention`, 'foreign tail');
  writeFileSync(f.path, text); chmodSync(f.path, 0o640);
  for (const apply of [false, true]) {
    assert.equal(action(f.repo, f.home, f.path, apply), 'absent');
    assert.equal(readFileSync(f.path, 'utf8'), text);
    assert.equal(statSync(f.path).mode & 0o777, 0o640);
  }
});
