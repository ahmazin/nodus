# Security Policy

Nodus (`@nodus/*`) is a headless, framework-agnostic diagram engine. Its security posture centers on
one fact: **it processes untrusted input** — pasted Mermaid/Terraform/Kubernetes sources, imported
`*.nodus.json` documents, and `#scene=` share links — entirely **client-side**, with **no network
egress**. Nothing you paste or open is uploaded or logged by the engine.

## Reporting a vulnerability

Please report suspected vulnerabilities **privately** — do not open a public issue for a security bug.

- Preferred: use the repository's **Security → Report a vulnerability** (GitHub private security
  advisories), which keeps the report confidential until a fix ships.
- If that is unavailable, contact the maintainers privately (see the repository's README for the
  current security contact) rather than filing publicly.

Please include: affected package(s) and version, a minimal reproduction (a payload / `.nodus.json` /
share link), the observed impact, and any suggested fix. We aim to acknowledge within a few business
days and to coordinate a fix and disclosure timeline with you.

**In scope:** the published `@nodus/*` packages (parsers, serialization, renderer, the MCP server, the
CLI). **Out of scope / lower priority:** the `examples/` demo app (unpublished), local dev scripts
(`scripts/*`), and issues that require a malicious *developer-configured* backend or a compromised
local environment.

## Supported versions

Nodus is pre-1.0 (`0.x`). Security fixes land on the latest published minor; there is no back-porting to
older `0.x` lines during the pre-1.0 phase. Pin exact versions and upgrade to pick up fixes.

## Threat model & hardening

The engine treats every parse/load boundary as a trust boundary and enforces bounded work there:

- **Parsers** (`@nodus/from-mermaid`, `@nodus/import-infra`, `@nodus/text-to-diagram`) use bounded
  regexes (no catastrophic backtracking), recursion-depth caps, and byte/element ceilings, so a large
  or adversarial input is rejected with a catchable error rather than freezing the thread.
- **Deserialization** (`restore()` / `parseSnapshot` / `decodeScene`) is defensive: malformed records
  are skipped and reported (never thrown for the caller), non-finite geometry is neutralized, and a
  record nesting deeper than a fixed cap is rejected before any serializer sees it.
- **SVG export** escapes every record-derived value at its interpolation site (text and attribute
  contexts). Exported SVG is a static document; the engine never re-inserts it into live DOM.

### Documented limits

| Boundary | Cap | Constant |
| --- | --- | --- |
| Mermaid source | 512 KB | `MAX_MERMAID_BYTES` |
| Snapshot / document text | 8 MB | `MAX_SNAPSHOT_BYTES` |
| `#scene=` share fragment | 8 MB | `MAX_SCENE_BYTES` |
| Terraform/K8s import | 8 MB text · 50k elements | `MAX_IMPORT_BYTES` · `MAX_IMPORT_ELEMENTS` |
| Diagram spec (text-to-diagram) | 10k elements | `MAX_SPEC_ELEMENTS` |
| Record nesting depth | 256 | `MAX_NEST_DEPTH` |
| Auto-layout node count | dagre 1500 · elk 8000 | `DAGRE_MAX_NODES` · `ELK_MAX_NODES` |

Inputs beyond these caps are refused with a clear, catchable error — this is a denial-of-service guard,
not a correctness limit. Very large diagrams may also hit performance ceilings well before these caps;
recommended working sizes are in the README.

## Privacy

Diagram sources routinely contain secrets (people paste real `terraform show -json` state and
Kubernetes manifests). The engine processes all of this **locally in the browser / process** and makes
**no network requests** and **writes no logs** of your diagram content. Even so, avoid pasting live
secrets or state you would not want rendered on screen. Optional integrations you configure yourself
(e.g. a remote persistence backend, or the example app's bring-your-own-key AI feature that calls only
`api.anthropic.com`) send data only to the endpoint you point them at.
