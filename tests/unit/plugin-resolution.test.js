import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assignResolvedNames, pluginListFromEntries } from '../../src/plugin-install.js';

test('assignResolvedNames maps newly added deps onto github-style entries in install order', () => {
  const entries = [
    { resolved: { kind: 'github', spec: 'github:a/one#v1', name: null } },
    { resolved: { kind: 'directory', spec: './local-two', name: 'local-two' } },
    { resolved: { kind: 'github', spec: 'github:a/three', name: null } },
  ];
  const named = assignResolvedNames(entries, ['local-two', 'resolved-one', 'resolved-three']);
  assert.deepEqual(named.map((entry) => entry.resolved.name), ['resolved-one', 'local-two', 'resolved-three']);
  assert.equal(entries[0].resolved.name, null, 'the input entries stay untouched');
});

test('assignResolvedNames leaves an entry nameless when fewer deps were added', () => {
  const entries = [
    { resolved: { kind: 'github', spec: 'github:a/one', name: null } },
    { resolved: { kind: 'github', spec: 'github:a/two', name: null } },
  ];
  const named = assignResolvedNames(entries, ['only-one']);
  assert.equal(named[0].resolved.name, 'only-one');
  assert.equal(named[1].resolved.name, null);
});

test('pluginListFromEntries echoes the real name@version read back from the profile', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-resolved-'));
  try {
    const installed = path.join(profileDir, 'node_modules', 'dsh-real-name');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(
      path.join(installed, 'package.json'),
      `${JSON.stringify({ name: 'dsh-real-name', version: '2.3.4' })}\n`,
      'utf8',
    );
    const entries = [
      {
        resolved: {
          kind: 'github',
          spec: 'github:author/claimed-name#v2',
          installSpec: 'github:author/claimed-name#v2',
          name: 'dsh-real-name',
          version: null,
        },
        findings: [],
      },
    ];
    const list = pluginListFromEntries(entries, profileDir, { seederDir: path.join(profileDir, 'missing') });
    assert.equal(list[0].advertisedSpec, 'github:author/claimed-name#v2');
    assert.equal(list[0].name, 'dsh-real-name');
    assert.equal(list[0].version, '2.3.4');
    assert.equal(list[0].resolvedName, 'dsh-real-name');
    assert.equal(list[0].resolvedVersion, '2.3.4');
    assert.equal(list[0].resolvedSpec, 'dsh-real-name@2.3.4');
    assert.equal(list[0].resolved, 'dsh-real-name@2.3.4');
    assert.equal(list[0].source, 'github');
    assert.equal(list[0].fixture, false);
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test('pluginListFromEntries falls back to unknown when the manifest is not installed', () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-lab-resolved-'));
  try {
    const entries = [
      {
        resolved: { kind: 'github', spec: 'github:a/b', installSpec: 'github:a/b', name: 'not-installed', version: '1.0.0' },
        findings: [],
      },
    ];
    const list = pluginListFromEntries(entries, profileDir, { seederDir: path.join(profileDir, 'missing') });
    assert.equal(list[0].resolvedSpec, 'not-installed@1.0.0');
    assert.equal(list[0].version, '1.0.0');
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});
