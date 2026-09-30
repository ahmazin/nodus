import type { APIRoute } from 'astro';
import { absoluteUrl } from '../config';

// Dependency-free sitemap. Pre-rendered to /sitemap.xml at build (static mode).
// Doc routes are DERIVED from the docs pages (import.meta.glob) so a new page is never
// silently omitted. URLs are base-aware (absoluteUrl folds in the /nodus/ subpath).
// /playground/ lives outside Astro (built separately by scripts/build.mjs).
const docPages = import.meta.glob('./docs/*.md');
const docRoutes = Object.keys(docPages)
  .map((p) => {
    const slug = p.replace(/^\.\/docs\/(.*)\.md$/, '$1');
    return slug === 'index' ? '/docs' : `/docs/${slug}`;
  })
  .sort();

const ROUTES = ['/', ...docRoutes, '/playground/'];

export const GET: APIRoute = () => {
  const urls = ROUTES.map((r) => `  <url><loc>${absoluteUrl(r)}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
