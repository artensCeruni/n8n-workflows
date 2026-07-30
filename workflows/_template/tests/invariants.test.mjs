/**
 * Invariants specific to __NAME__.
 *
 * The shared suite (tooling/tests/shared.test.mjs) already covers schema
 * validity, secret hygiene, credential parity and export determinism for every
 * workflow — do not repeat those here.
 *
 * What belongs here: assertions that encode a decision this workflow made, so a
 * later edit that breaks the reasoning fails the build. Rule of thumb — if you
 * wrote an ADR, write the test that enforces it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeByName, reachableFrom, everySlotReaches } from '../../../tooling/lib/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(readFileSync(join(HERE, '..', 'workflow.json'), 'utf8'));

describe('__NAME__', () => {
  test('has a trigger', () => {
    const triggers = workflow.nodes.filter((node) => /trigger|webhook/i.test(node.type));
    assert.ok(triggers.length > 0);
  });

  // Example — delete once you have real invariants:
  //
  // test('every branch reaches the cleanup step', () => {
  //   const { ok, missing } = everySlotReaches(workflow.connections, 'Router', 'Cleanup');
  //   assert.ok(ok, `outputs ${missing.join(', ')} never reach Cleanup`);
  // });
});
