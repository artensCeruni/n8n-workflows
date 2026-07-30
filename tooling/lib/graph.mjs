/**
 * Graph helpers over an n8n `connections` map.
 *
 * n8n stores connections keyed by *source node name*:
 *
 *   { "Route by Category": { "main": [ [ {node,type,index}, … ],   // output 0
 *                                      [ {node,type,index}, … ] ]  // output 1
 *                          } }
 *
 * The outer array is indexed by output slot, the inner array lists every target
 * on that slot. Subnode links (ai_languageModel, ai_outputParser, …) live under
 * their own connection type, which is why callers usually want to restrict
 * traversal to `main`.
 */

/**
 * Outgoing targets of a node, flattened across all output slots.
 * @returns {string[]} target node names
 */
export function targetsOf(connections, nodeName, connectionType = 'main') {
  const slots = connections?.[nodeName]?.[connectionType] ?? [];
  return slots
    .flat()
    .filter(Boolean)
    .map((connection) => connection.node);
}

/**
 * Outgoing targets grouped by output slot index.
 * @returns {string[][]} index 0 = first output, index 1 = second, …
 */
export function targetsBySlot(connections, nodeName, connectionType = 'main') {
  const slots = connections?.[nodeName]?.[connectionType] ?? [];
  return slots.map((slot) => (slot ?? []).filter(Boolean).map((connection) => connection.node));
}

/**
 * Every node reachable from `startNode`, following `main` connections.
 * Cycle-safe — n8n loops (splitInBatches feeding back) would otherwise hang this.
 * @returns {Set<string>}
 */
export function reachableFrom(connections, startNode, connectionType = 'main') {
  const seen = new Set();
  const queue = [startNode];

  while (queue.length > 0) {
    const current = queue.pop();
    for (const next of targetsOf(connections, current, connectionType)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return seen;
}

/**
 * True when every output slot of `startNode` eventually reaches `targetNode`.
 *
 * This is the check that guards the re-poll bug class: a Gmail trigger filtering
 * on unread mail will pick the same message up on every poll forever unless every
 * branch terminates in the node that marks it read. A branch added later without
 * that terminator is exactly the regression this catches.
 *
 * @returns {{ ok: boolean, missing: number[] }} missing = slot indices that never arrive
 */
export function everySlotReaches(connections, startNode, targetNode, connectionType = 'main') {
  const slots = targetsBySlot(connections, startNode, connectionType);
  const missing = [];

  slots.forEach((slotTargets, slotIndex) => {
    const arrives = slotTargets.some(
      (target) =>
        target === targetNode || reachableFrom(connections, target, connectionType).has(targetNode)
    );
    if (!arrives) missing.push(slotIndex);
  });

  return { ok: missing.length === 0, missing };
}

/** Nodes with no incoming `main` connection — trigger nodes and orphans. */
export function entryNodes(workflow, connectionType = 'main') {
  const hasIncoming = new Set();
  for (const sourceName of Object.keys(workflow.connections ?? {})) {
    for (const target of targetsOf(workflow.connections, sourceName, connectionType)) {
      hasIncoming.add(target);
    }
  }
  return (workflow.nodes ?? []).map((node) => node.name).filter((name) => !hasIncoming.has(name));
}

/** Look up a node by name. */
export function nodeByName(workflow, name) {
  return (workflow.nodes ?? []).find((node) => node.name === name);
}

/** Every connection target that does not correspond to an existing node. */
export function danglingConnections(workflow) {
  const names = new Set((workflow.nodes ?? []).map((node) => node.name));
  const dangling = [];

  for (const [sourceName, byType] of Object.entries(workflow.connections ?? {})) {
    if (!names.has(sourceName)) dangling.push({ from: sourceName, to: null });
    for (const slots of Object.values(byType ?? {})) {
      for (const slot of slots ?? []) {
        for (const connection of slot ?? []) {
          if (connection?.node && !names.has(connection.node)) {
            dangling.push({ from: sourceName, to: connection.node });
          }
        }
      }
    }
  }

  return dangling;
}
