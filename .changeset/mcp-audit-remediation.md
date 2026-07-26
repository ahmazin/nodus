---
"@nodus/mcp": minor
---

MCP audit remediation. Harden the JSON-RPC / stdio transport (a lone `null` / non-object line no longer wedges the read loop; add a `-32600` Invalid Request path, a serialization-queue rejection backstop, an `unhandledRejection` net, and protocol-version negotiation up to `2025-06-18`) and add seven tools: `import_terraform`, `import_kubernetes`, `diff_docs`, `update_edge`, `set_theme`, `export_svg`, and `author_from_spec`. Also register `tree` + `force` layouts (widening the `layout` / `import_mermaid` engine enums), clamp `export_png` `pixelRatio` to a safe range, surface ambiguous label references instead of silently picking the first match, coerce mistyped array args, and source `serverInfo.version` from `package.json`.
