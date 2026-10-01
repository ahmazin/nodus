---
"@nodus-dev/mcp": patch
---

Annotate the stdio server's input stream as `NodeJS.ReadableStream` so it type-checks under `@types/node` 26. The bumped types added typed `ReadStream` event-map overloads, which made the inferred `ReadableStream | ReadStream` union's `.on`/`.setEncoding` non-callable (TS2349). No runtime change.
