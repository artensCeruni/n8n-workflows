/**
 * Invariants specific to Email AI Classifier.
 *
 * Each test here corresponds to a decision recorded in docs/adr/. The point is
 * that the reasoning survives contact with future edits: if someone adds a fifth
 * routing branch and forgets the terminator, or "fixes" spam handling by
 * switching to Gmail's system SPAM label, the build fails and points at the ADR
 * rather than at a merge conflict six months later.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  everySlotReaches,
  targetsBySlot,
  nodeByName,
  reachableFrom
} from '../../../tooling/lib/graph.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(readFileSync(join(HERE, '..', 'workflow.json'), 'utf8'));
const fixtures = JSON.parse(readFileSync(join(HERE, 'fixtures', 'emails.json'), 'utf8'));

const ROUTER = 'Route by Category';
const TERMINATOR = 'Mark as Processed';
const CATEGORIES = ['urgent', 'sales', 'personal', 'spam'];

describe('ADR-0002: every branch marks the email processed', () => {
  test(`every output of "${ROUTER}" reaches "${TERMINATOR}"`, () => {
    // The Gmail trigger filters on unread mail. A branch that ends without
    // marking the message read leaves it unread, so the next poll — one minute
    // later — picks up the same email again, forever. This is the single most
    // expensive mistake available in this workflow.
    const { ok, missing } = everySlotReaches(workflow.connections, ROUTER, TERMINATOR);
    assert.ok(
      ok,
      `router output(s) ${missing.join(', ')} never reach "${TERMINATOR}" — ` +
        'those emails would be re-processed on every poll'
    );
  });

  test(`"${TERMINATOR}" sits at the end of each branch, not before the side effect`, () => {
    // Ordering matters: marking read first would mean a failed side effect is
    // never retried, because the next poll can no longer see the message.
    const terminator = nodeByName(workflow, TERMINATOR);
    assert.ok(terminator, `"${TERMINATOR}" is missing`);
    assert.equal(terminator.parameters.operation, 'markAsRead');

    const downstream = reachableFrom(workflow.connections, TERMINATOR);
    assert.deepEqual([...downstream], [], `nothing should run after "${TERMINATOR}"`);
  });

  test(`"${TERMINATOR}" reads the id from a node that always runs`, () => {
    // $json would carry whatever the branch last emitted — a draft response, a
    // label response. Referencing Merge Classification explicitly is what makes
    // the same node correct on all four branches.
    const terminator = nodeByName(workflow, TERMINATOR);
    assert.match(terminator.parameters.messageId, /\$\('Merge Classification'\)/);
  });
});

describe('ADR-0001: spam is labelled, never moved to Gmail SPAM', () => {
  const spamNode = nodeByName(workflow, 'Label as AI Spam');

  test('uses addLabels rather than a delete or trash operation', () => {
    assert.ok(spamNode, '"Label as AI Spam" is missing');
    assert.equal(spamNode.parameters.operation, 'addLabels');
  });

  test('never references the system SPAM or TRASH labels', () => {
    // Applying the system SPAM label removes mail from the inbox *and* trains
    // Gmail's own filter on the account, so an AI false positive would hide
    // real mail and keep compounding.
    const serialized = JSON.stringify(spamNode);
    for (const forbidden of ['"SPAM"', '"TRASH"']) {
      assert.ok(!serialized.includes(forbidden), `must not use the ${forbidden} system label`);
    }
    assert.notEqual(spamNode.parameters.operation, 'delete');
  });

  test('takes its label id from the Config node', () => {
    assert.match(JSON.stringify(spamNode.parameters.labelIds), /\$\('Config'\)/);
  });
});

describe('routing covers every category exactly once', () => {
  const router = nodeByName(workflow, ROUTER);

  test('three explicit rules plus a fallback, not four rules', () => {
    // spam is the fallback rather than a fourth rule: the classifier is
    // constrained to these four categories, so anything that is not urgent,
    // sales or personal is spam by construction. A fourth rule would silently
    // drop items whose category did not match any rule.
    assert.equal(router.parameters.rules.values.length, 3);
    assert.equal(router.parameters.options.fallbackOutput, 'extra');
    assert.equal(router.parameters.options.renameFallbackOutput, 'spam');
  });

  test('rules match urgent, sales, personal in that order', () => {
    const matched = router.parameters.rules.values.map(
      (rule) => rule.conditions.conditions[0].rightValue
    );
    assert.deepEqual(matched, ['urgent', 'sales', 'personal']);
  });

  test('the router has exactly four wired outputs', () => {
    const slots = targetsBySlot(workflow.connections, ROUTER);
    assert.equal(slots.length, 4, 'expected urgent, sales, personal, spam');
    slots.forEach((targets, index) => {
      assert.ok(targets.length > 0, `router output ${index} is not connected to anything`);
    });
  });
});

describe('the classifier contract matches the router', () => {
  const parser = nodeByName(workflow, 'Classification Parser');
  const agent = nodeByName(workflow, 'Classify Email');

  test('the output parser constrains category to the four routed values', () => {
    const schema = JSON.parse(parser.parameters.inputSchema);
    assert.deepEqual(schema.properties.category.enum, CATEGORIES);
    assert.deepEqual(schema.required.sort(), ['category', 'draft_reply', 'reason']);
    assert.equal(schema.additionalProperties, false);
  });

  test('the agent is wired to an output parser', () => {
    // Without hasOutputParser the agent returns prose and Merge Classification
    // silently produces undefined for every field.
    assert.equal(agent.parameters.hasOutputParser, true);
  });

  test('every category the prompt can emit has a branch', () => {
    const prompt = agent.parameters.options.systemMessage;
    for (const category of CATEGORIES) {
      assert.ok(prompt.includes(category), `prompt never mentions "${category}"`);
    }
  });

  test('Merge Classification tolerates both wrapped and bare parser output', () => {
    // The structured parser returns { output: {...} } in some n8n versions and a
    // bare object in others; the optional-chaining fallback covers both.
    const merge = nodeByName(workflow, 'Merge Classification');
    const category = merge.parameters.assignments.assignments.find(
      (entry) => entry.name === 'category'
    );
    assert.match(category.value, /\$json\.output\?\.category \?\? \$json\.category/);
  });
});

describe('the Gmail trigger and field extraction agree', () => {
  const trigger = nodeByName(workflow, 'New Gmail Email');

  test('trigger requests the full message, not the simplified shape', () => {
    // With simple:true the payload uses different key casing and drops the body,
    // so Extract Email Fields would silently produce empty strings.
    assert.equal(trigger.parameters.simple, false);
  });

  test('trigger only looks at the inbox', () => {
    // Also stops the workflow's own urgent-alert email from re-triggering it.
    assert.equal(trigger.parameters.filters.q, 'in:inbox');
  });

  test('extraction reads from.text, because `from` is an object', () => {
    const extract = nodeByName(workflow, 'Extract Email Fields');
    const from = extract.parameters.assignments.assignments.find((entry) => entry.name === 'from');
    assert.match(from.value, /\$json\.from\?\.text/);
  });

  test('extraction bounds the body so a huge email cannot blow the token budget', () => {
    const extract = nodeByName(workflow, 'Extract Email Fields');
    const body = extract.parameters.assignments.assignments.find((entry) => entry.name === 'body');
    assert.match(body.value, /slice\(0, \d+\)/);
  });
});

describe('configuration is reachable from every consumer', () => {
  test('Config runs before the nodes that read it', () => {
    const reachable = reachableFrom(workflow.connections, 'Config');
    for (const consumer of ['Email Urgent Alert', 'Label as AI Spam']) {
      assert.ok(reachable.has(consumer), `"${consumer}" reads Config but Config never runs first`);
    }
  });

  test('Test Config runs before the test sender', () => {
    const reachable = reachableFrom(workflow.connections, 'Test Config');
    assert.ok(reachable.has('Send Test Email To Self'));
  });

  test('Config passes upstream fields through', () => {
    // includeOtherFields:false would drop the Gmail payload and leave
    // Extract Email Fields with nothing to read.
    const config = nodeByName(workflow, 'Config');
    assert.equal(config.parameters.includeOtherFields, true);
  });
});

describe('test fixtures stay in sync with the injector node', () => {
  test('fixtures cover all four categories', () => {
    assert.deepEqual(
      fixtures.map((fixture) => fixture.expectedCategory).sort(),
      [...CATEGORIES].sort()
    );
  });

  test('the injector node embeds the same cases as the fixtures', () => {
    const code = nodeByName(workflow, 'Generate 4 Test Emails').parameters.jsCode;
    for (const fixture of fixtures) {
      assert.ok(
        code.includes(fixture.subject),
        `injector is missing the "${fixture.expectedCategory}" case — fixtures have drifted`
      );
    }
  });
});
