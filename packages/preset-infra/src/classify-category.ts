/**
 * classifyCategory — a pure label -> infra category (`InfraKind`) classifier: the colour-side twin of
 * `classifyIcon`. Used as a DRAW-TIME fallback (never written to the record) so a plain drawn shape
 * (`draw.rect` / `draw.ellipse` / `draw.diamond`) named e.g. "Kafka" still picks up the queue category
 * hue, matching the Playground design where every node colours from its label. An explicit per-element
 * stroke always wins over this inference (see the example app's category-coloured shape wrappers).
 *
 * The returned kind is always one of the six `INFRA_TYPES`, whose hues live in `ACCENTS` (dark) /
 * `ACCENTS_LIGHT` (light); `undefined` when nothing matches (or the label is missing/empty).
 *
 * Matching is first-match-wins against an ORDERED, most-specific-first list — order encodes priority.
 * Data stores (redis/cache) resolve to `cache` (cyan) and relational/object stores to `db` (purple),
 * so an untyped shape lines up with the app's *typed* nodes rather than the design's single "data" hue.
 */

import type { InfraKind } from './theme.js';

const RULES: ReadonlyArray<readonly [RegExp, InfraKind]> = [
  // queue — messaging / streaming
  [/\b(queue|kafka|sqs|rabbit|topic|stream|events?|bus|pubsub|broker)\b/, 'queue'],
  // cache — in-memory stores
  [/\b(cache|redis|memcache)\b/, 'cache'],
  // db — relational / NoSQL / object storage (the design's "data" bucket, minus caches)
  [/\b(db|database|postgres|mysql|sql|mongo|dynamo|rds|s3|bucket|blob|storage|disk|datastore)\b/, 'db'],
  // lb — gateways / routers / load balancers (the design's "gateway")
  [/\b(gateway|api|router|route|ingress|proxy|nginx|balancer|lb|load)\b/, 'lb'],
  // edge — clients / browsers / CDN (the design's "client")
  [/\b(client|browser|user|web|cdn|mobile|frontend|edge)\b/, 'edge'],
  // service — generic / serverless compute (the design's "compute")
  [/\b(auth|lambda|function|fn|service|worker|compute|app|ec2|instance|server|micro|pod|container|backend)\b/, 'service'],
];

/**
 * Classify a node label into an `InfraKind`, or `undefined` if nothing matches. Case-insensitive;
 * the first rule (in priority order) whose pattern matches the lowercased label wins.
 */
export function classifyCategory(label: string | undefined): InfraKind | undefined {
  if (!label) return undefined;
  const lower = label.toLowerCase();
  for (const [pattern, kind] of RULES) {
    if (pattern.test(lower)) return kind;
  }
  return undefined;
}
