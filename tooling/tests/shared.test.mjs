/**
 * Invariants that hold for EVERY workflow project in this repo.
 *
 * These are generated from whatever exists under workflows/, so a project added
 * six months from now is covered the moment its directory appears — nobody has
 * to remember to extend this file.
 *
 * Per-workflow behaviour lives in workflows/<slug>/tests/ instead.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadAllWorkflows, readWorkflowFile, validateManifest } from '../lib/manifest.mjs';
import { toRepoFormat } from '../lib/sanitize.mjs';
import { danglingConnections, entryNodes } from '../lib/graph.mjs';

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const ALLOWED_EMAIL_DOMAINS = /@(example\.(com|org|net)|users\.noreply\.github\.com|n8n\.io)$/;

const workflows = loadAllWorkflows();

test('the repo contains at least one workflow project', () => {
  assert.ok(workflows.length > 0, 'no workflows found under workflows/');
});

for (const { slug, manifest, workflow } of workflows) {
  describe(`workflows/${slug}`, () => {
    test('manifest is structurally valid', () => {
      assert.deepEqual(validateManifest(manifest, slug), []);
    });

    test('workflow has nodes and a name', () => {
      assert.ok(workflow.name, 'workflow.json has no name');
      assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, 'no nodes');
    });

    test('node names are unique', () => {
      const names = workflow.nodes.map((node) => node.name);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      assert.deepEqual([...new Set(duplicates)], [], 'duplicate node names');
    });

    test('every connection points at a node that exists', () => {
      assert.deepEqual(danglingConnections(workflow), []);
    });

    test('has at least one trigger node', () => {
      const triggers = workflow.nodes.filter(
        (node) =>
          /trigger/i.test(node.type) ||
          node.type === 'n8n-nodes-base.manualTrigger' ||
          node.type === 'n8n-nodes-base.webhook'
      );
      assert.ok(triggers.length > 0, 'no trigger node — this workflow can never run');
    });

    test('no node is left unreachable by accident', () => {
      // Sticky notes are canvas annotations, sub-nodes attach sideways, and the
      // Bootstrap-style helper nodes are deliberately disconnected. Everything
      // else with no inbound main connection should be a trigger.
      const orphans = entryNodes(workflow).filter((name) => {
        const node = workflow.nodes.find((candidate) => candidate.name === name);
        if (!node) return false;
        if (node.type === 'n8n-nodes-base.stickyNote') return false;
        if (node.disabled === true) return false;
        if (/trigger/i.test(node.type) || node.type === 'n8n-nodes-base.webhook') return false;
        // Sub-nodes (language models, parsers, tools) connect via their own
        // connection type, so they legitimately have no inbound `main`.
        const connectsSideways = Object.values(workflow.connections ?? {}).some((byType) =>
          Object.entries(byType).some(
            ([type, slots]) =>
              type !== 'main' && slots.flat().some((connection) => connection?.node === node.name)
          )
        );
        if (connectsSideways) return false;
        return !(name in (workflow.connections ?? {}));
      });

      assert.deepEqual(orphans, [], 'nodes that neither trigger nor receive data');
    });

    // ── Secret hygiene ─────────────────────────────────────────────────────
    // workflow.json is regenerated from a live instance, so these checks guard
    // an ongoing risk, not a one-off cleanup.

    test('contains no real email address', () => {
      const found = (JSON.stringify(workflow).match(EMAIL_PATTERN) ?? []).filter(
        (address) => !ALLOWED_EMAIL_DOMAINS.test(address)
      );
      assert.deepEqual(
        [...new Set(found)],
        [],
        'real email addresses must live in a Config node placeholder'
      );
    });

    test('contains no hardcoded Gmail label id', () => {
      const found = JSON.stringify(workflow).match(/"Label_\d+"/g) ?? [];
      assert.deepEqual([...new Set(found)], [], 'Gmail label ids are per-account');
    });

    test('no credential reference carries an instance-local id', () => {
      const withIds = [];
      for (const node of workflow.nodes) {
        for (const [type, ref] of Object.entries(node.credentials ?? {})) {
          if (ref && 'id' in ref) withIds.push(`${node.name}.${type}`);
        }
      }
      assert.deepEqual(withIds, [], 'credentials must be bound by name only');
    });

    test('every credential used is declared in the manifest, and vice versa', () => {
      const used = new Set();
      for (const node of workflow.nodes) {
        for (const [type, ref] of Object.entries(node.credentials ?? {})) {
          if (ref?.name) used.add(`${type}:${ref.name}`);
        }
      }
      const declared = new Set(
        (manifest.credentials ?? []).map((credential) => `${credential.type}:${credential.name}`)
      );
      assert.deepEqual([...used].sort(), [...declared].sort());
    });

    test('no credential export alias survives into the committed file', () => {
      // `liveName` is what the credential is called on the authoring instance;
      // `name` is the public contract cloners must reproduce. Export rewrites
      // one to the other, so seeing a liveName here means the file was
      // hand-edited or exported before the alias existed. See docs/adr/0005.
      const serialized = JSON.stringify(workflow);
      const leaked = (manifest.credentials ?? [])
        .map((credential) => credential.liveName)
        .filter((liveName) => liveName && serialized.includes(liveName));
      assert.deepEqual(leaked, [], 'instance-local credential names must not be committed');
    });

    test('does not read $env — blocked by default since n8n 2.0', () => {
      // Relying on $env would force every user of this repo to disable
      // N8N_BLOCK_ENV_ACCESS_IN_NODE. See docs/adr/0004.
      const uses = JSON.stringify(workflow).includes('$env');
      assert.equal(uses, false, 'use a Config node instead of $env');
    });

    test('every Config node field matches its manifest placeholder', () => {
      for (const [nodeName, fields] of Object.entries(manifest.configNodes ?? {})) {
        const node = workflow.nodes.find((candidate) => candidate.name === nodeName);
        assert.ok(node, `manifest declares config node "${nodeName}" which does not exist`);

        const assignments = node.parameters?.assignments?.assignments ?? [];
        const actual = new Map(assignments.map((entry) => [entry.name, entry.value]));

        assert.deepEqual(
          [...actual.keys()].sort(),
          Object.keys(fields).sort(),
          `config fields of "${nodeName}" drifted from the manifest`
        );

        for (const [field, placeholder] of Object.entries(fields)) {
          assert.equal(
            actual.get(field),
            placeholder,
            `"${nodeName}.${field}" holds a live value — run make export`
          );
        }
      }
    });

    // ── Determinism ────────────────────────────────────────────────────────

    test('the committed file is exactly what sanitize produces', () => {
      // If this fails, `make export` would rewrite the file even when nothing
      // changed in n8n, and every export would show a spurious diff.
      const onDisk = readWorkflowFile(slug);
      const { content } = toRepoFormat(workflow, manifest);
      assert.equal(content, onDisk, 'workflow.json is not in canonical form — run make export');
    });

    test('sanitize is idempotent', () => {
      const once = toRepoFormat(workflow, manifest).content;
      const twice = toRepoFormat(JSON.parse(once), manifest).content;
      assert.equal(twice, once);
    });

    test('file ends with exactly one trailing newline', () => {
      const raw = readWorkflowFile(slug);
      assert.ok(raw.endsWith('\n'), 'missing trailing newline');
      assert.ok(!raw.endsWith('\n\n'), 'more than one trailing newline');
    });

    test('file uses LF line endings', () => {
      assert.ok(!readWorkflowFile(slug).includes('\r'), 'CRLF found — check .gitattributes');
    });
  });
}
