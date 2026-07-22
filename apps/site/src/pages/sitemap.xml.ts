import type { APIRoute } from 'astro';
import { SITE } from '../config';

// Dependency-free sitemap. Pre-rendered to /sitemap.xml at build (static mode).
// Includes /playground/, which lives outside Astro (built separately by scripts/build.mjs).
const ROUTES = ['/', '/docs', '/docs/concepts', '/docs/schema', '/docs/cli', '/docs/mcp', '/playground/'];

export const GET: APIRoute = () => {
  const urls = ROUTES.map((r) => `  <url><loc>${new URL(r, SITE.origin).href}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
