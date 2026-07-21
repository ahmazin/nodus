/**
 * classifyIcon — a pure label -> core glyph classifier. Used as a draw-time fallback (never
 * written to the record) when a node has no explicit `props.icon`: infer a more specific glyph
 * from the node's label text so e.g. a node labeled "Auth Lambda" draws the `function` glyph
 * instead of the generic per-kind default.
 *
 * The returned name is ALWAYS either `undefined` or one of the 14 names registered in the core
 * icon registry (`packages/core/src/icons/index.ts`): server, database, cache, queue, balancer,
 * globe, cloud, user, gear, code, box, lock, function, bucket. Any other name would silently
 * no-op when passed to `api.icon(...)` (the registry draws nothing for unregistered names), so
 * this list must never grow a name that isn't registered there.
 *
 * Matching is first-match-wins against an ORDERED list of [RegExp, glyphName] pairs — order
 * encodes priority, most specific first, e.g. `auth` before the generic `service`/`server` bucket
 * so "Auth service" classifies as `user`, not `server`.
 */

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // function — serverless compute keywords
  [/\b(lambda|function|func|fn)\b/, 'function'],
  // queue — messaging/streaming keywords
  [/\b(queue|kafka|sqs|rabbit|topic|stream)\b/, 'queue'],
  // cache — in-memory cache keywords
  [/\b(cache|redis|memcache)\b/, 'cache'],
  // database — relational/NoSQL store keywords
  [/\b(db|database|postgres|mysql|sql|mongo|dynamo|rds)\b/, 'database'],
  // bucket — object storage keywords
  [/\b(bucket|s3|blob|storage|object store)\b/, 'bucket'],
  // globe — network edge / API surface keywords
  [/\b(gateway|api|router|route|ingress|proxy|cdn|edge)\b/, 'globe'],
  // balancer — load balancing keywords
  [/\b(balancer|lb|load)\b/, 'balancer'],
  // user — identity/auth keywords (must precede the generic server/service bucket)
  [/\b(auth|user|client|account|identity|login)\b/, 'user'],
  // lock — secrets/security keywords
  [/\b(lock|secret|vault|kms|security)\b/, 'lock'],
  // server — generic compute keywords
  [/\b(server|service|compute|ec2|vm|host|worker|backend)\b/, 'server'],
  // code — application/frontend keywords
  [/\b(code|app|web|frontend|ui|function app)\b/, 'code'],
  // gear — configuration/ops keywords
  [/\b(config|settings|gear|ops)\b/, 'gear'],
  // cloud — generic cloud keyword
  [/\bcloud\b/, 'cloud'],
];

/**
 * Classify a node label into a registered core glyph name, or `undefined` if nothing matches
 * (or the label is missing/empty). Matching is case-insensitive; the first rule (in priority
 * order) whose pattern matches the lowercased label wins.
 */
export function classifyIcon(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const lower = label.toLowerCase();
  for (const [pattern, glyph] of RULES) {
    if (pattern.test(lower)) return glyph;
  }
  return undefined;
}
