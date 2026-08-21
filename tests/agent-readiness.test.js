import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { FLEET_DB_COUNT, TRACKED_BOARDS } from '../src/data/facts.js';
import { PRODUCES, resolveAgentResponse } from '../src/lib/agent-negotiation.js';
import { agentMarkdown, notAcceptableText, notFoundMarkdown } from '../src/lib/agent-markdown.js';
import { isKnownRoutePath, normalizePathname } from '../src/lib/site-routes.js';
import { GET as getSitemap } from '../src/pages/sitemap.xml.ts';

// Agent-readiness pins (Ora "Is Agentic" audit, Aug 2026). Each block below guards one
// audited behaviour that lives in a static surface no other test covers:
//   1. the homepage carries a crawlable H1 + prose OUTSIDE <header>
//   2. dead paths 404 with a recoverable body
//   3. Accept: text/markdown negotiates, with Vary: Accept
//   4. llms.txt states when to use the site and how to call it
//   5. Organization JSON-LD carries contactPoint + address

const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const llmsTxt = readFileSync(new URL('../public/llms.txt', import.meta.url), 'utf8');
const llmsFullTxt = readFileSync(new URL('../public/llms-full.txt', import.meta.url), 'utf8');
const notFoundPage = readFileSync(new URL('../src/pages/404.astro', import.meta.url), 'utf8');
const vercelJson = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const middlewareSource = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');

/** Visible text of an HTML document, the way a crawler's extractor counts it. */
function textContent(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jsonLdBlocks(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html)) !== null) blocks.push(JSON.parse(match[1]));
  return blocks;
}

describe('1. homepage content without JavaScript', () => {
  it('carries an H1 in the main document flow, not only inside <header>', () => {
    const headerStart = indexHtml.indexOf('<header id="header"');
    expect(headerStart).toBeGreaterThan(-1);

    const h1Positions = [...indexHtml.matchAll(/<h1[\s>]/g)].map((m) => m.index);
    expect(h1Positions.length).toBeGreaterThan(0);
    // At least one H1 must sit before the canopy — readability-style extractors drop
    // <header>/<nav> as boilerplate, which is why the audit reported "no H1 tag" while
    // the brand H1 was right there in the markup.
    expect(h1Positions.some((at) => at < headerStart)).toBe(true);
  });

  it('names the product and the job in that H1', () => {
    const h1 = indexHtml.match(/<h1 id="page-brief-title">([^<]+)<\/h1>/);
    expect(h1).not.toBeNull();
    expect(h1[1]).toContain('The Blue Board');
    expect(h1[1]).toContain('United Airlines');
  });

  it('ships well past 500 characters of raw text', () => {
    expect(textContent(indexHtml).length).toBeGreaterThan(3000);
  });

  it('keeps the crawlable brief visually hidden so the dashboard looks unchanged', () => {
    expect(indexHtml).toContain('<section class="sr-only" aria-labelledby="page-brief-title">');
  });

  it('states the fleet count that facts.js is the source of truth for', () => {
    const brief = indexHtml.slice(
      indexHtml.indexOf('<section class="sr-only" aria-labelledby="page-brief-title">'),
      indexHtml.indexOf('<!-- Crawlable site navigation'),
    );
    expect(brief).toContain(FLEET_DB_COUNT.toLocaleString('en-US'));
  });
});

describe('2. agent-friendly 404s', () => {
  it('points a dead HTML path at the machine-readable indexes', () => {
    for (const target of ['/sitemap.xml', '/llms.txt', '/llms-full.txt', '/feed.xml']) {
      expect(notFoundPage, target).toContain(`href="${target}"`);
    }
  });

  it('offers the section indexes as recovery links', () => {
    for (const target of ['/fleet', '/hubs', '/trackers', '/news']) {
      expect(notFoundPage, target).toContain(`href="${target}"`);
    }
  });

  it('answers a dead path with a 404 Markdown body when Markdown is preferred', () => {
    const decision = resolveAgentResponse({
      pathname: '/some-path-that-does-not-exist',
      accept: 'text/markdown',
    });
    expect(decision).toMatchObject({ kind: 'markdown', status: 404 });
    expect(decision.body).toContain('# 404');
    expect(decision.body).toContain('https://theblueboard.co/sitemap.xml');
    expect(decision.body).toContain('https://theblueboard.co/llms.txt');
  });

  it('never caches a Markdown 404', () => {
    const decision = resolveAgentResponse({ pathname: '/nope', accept: 'text/markdown' });
    expect(decision.cacheControl).toBe('no-store');
  });

  it('strips CRLF out of the echoed path so the body cannot be used for injection', () => {
    const body = notFoundMarkdown('/evil\r\n# Fake heading');
    expect(body).not.toMatch(/\r/);
    expect(body.split('\n')[2]).toContain('/evil  # Fake heading');
  });

  it('does not 404 a real page just because it has no Markdown twin', () => {
    for (const path of ['/hubs/ord', '/fleet/737-800', '/news/anything', '/trackers/atc/iah', '/tsa']) {
      expect(resolveAgentResponse({ pathname: path, accept: 'text/markdown' }), path)
        .toEqual({ kind: 'html' });
    }
  });
});

describe('2b. the route surface stays in step with the sitemap', () => {
  it('recognises every URL the sitemap publishes', async () => {
    const xml = await getSitemap().text();
    const paths = [...xml.matchAll(/<loc>https:\/\/theblueboard\.co([^<]*)<\/loc>/g)]
      .map((m) => m[1] || '/');
    expect(paths.length).toBeGreaterThan(40);
    for (const path of paths) {
      expect(isKnownRoutePath(path), `sitemap path ${path}`).toBe(true);
    }
  });

  it('still calls obvious junk a 404', () => {
    for (const path of ['/some-path-that-does-not-exist', '/wp-admin', '/fleetx', '/hub', '/.env']) {
      expect(isKnownRoutePath(path), path).toBe(false);
    }
  });

  it('treats a trailing slash as the same page (cleanUrls is on)', () => {
    expect(normalizePathname('/fleet/')).toBe('/fleet');
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('')).toBe('/');
    expect(resolveAgentResponse({ pathname: '/hubs/', accept: 'text/markdown' }).status).toBe(200);
  });
});

describe('3. Markdown content negotiation (acceptmarkdown.com)', () => {
  it('serves Markdown for the homepage', () => {
    const decision = resolveAgentResponse({ pathname: '/', accept: 'text/markdown' });
    expect(decision).toMatchObject({ kind: 'markdown', status: 200 });
    expect(decision.body.startsWith('# The Blue Board')).toBe(true);
  });

  it('serves HTML to every browser Accept header', () => {
    const browsers = [
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      '*/*',
      null,
    ];
    for (const accept of browsers) {
      expect(resolveAgentResponse({ pathname: '/', accept }), String(accept))
        .toEqual({ kind: 'html' });
    }
  });

  it('returns 406 with a body naming what it can produce', () => {
    const decision = resolveAgentResponse({ pathname: '/', accept: 'application/pdf' });
    expect(decision).toMatchObject({ kind: 'not-acceptable', status: 406 });
    expect(decision.body).toContain('text/html');
    expect(decision.body).toContain('text/markdown');
    expect(decision.body).toContain('application/pdf');
  });

  it('never negotiates a non-GET request into a Markdown document', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      expect(resolveAgentResponse({ pathname: '/', accept: 'text/markdown', method }), method)
        .toEqual({ kind: 'html' });
    }
    expect(resolveAgentResponse({ pathname: '/', accept: 'text/markdown', method: 'HEAD' }).kind)
      .toBe('markdown');
  });

  it('declares HTML first so an unconstrained client keeps getting the dashboard', () => {
    expect(PRODUCES[0]).toBe('text/html');
  });

  it('sets Vary: Accept on every response via vercel.json', () => {
    const global = vercelJson.headers.find((rule) => rule.source === '/(.*)');
    const vary = global.headers.find((header) => header.key === 'Vary');
    expect(vary).toBeDefined();
    expect(vary.value.toLowerCase()).toContain('accept');
  });

  it('sets Content-Type, Vary, and nosniff on the synthesised Markdown response', () => {
    expect(middlewareSource).toContain("'Content-Type': 'text/markdown; charset=utf-8'");
    expect(middlewareSource).toContain("Vary: 'Accept, Accept-Encoding'");
    expect(middlewareSource).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('never puts a noindex header on a negotiated page — same URL as the HTML', () => {
    expect(middlewareSource).not.toContain('X-Robots-Tag');
  });

  it('keeps polling traffic out of the middleware matcher', () => {
    const matcher = middlewareSource.match(/matcher: \[\s*'([^']+)'/)?.[1];
    expect(matcher).toBeDefined();
    // The matcher is a plain JS regex in this form; assert what it does, not how it reads.
    const re = new RegExp(`^${matcher.replace(/\\\\/g, '\\')}$`);
    for (const skipped of ['/api/irops', '/js/dashboard.js', '/css/style.css', '/data/fleet.json',
      '/fonts/satoshi-latin.woff2', '/icons/icon-192.png', '/og/og-news.jpg', '/sw.js',
      '/manifest.json', '/robots.txt', '/favicon.svg', '/og-image.png', '/_astro/x.js']) {
      expect(re.test(skipped), `should skip ${skipped}`).toBe(false);
    }
    for (const matched of ['/', '/hubs/ord', '/fleet', '/llms.txt', '/sitemap.xml',
      '/some-path-that-does-not-exist']) {
      expect(re.test(matched), `should match ${matched}`).toBe(true);
    }
  });

  it('degrades to the unmodified site if the resolver ever throws', () => {
    expect(middlewareSource).toContain('} catch {');
    expect(middlewareSource).toMatch(/catch \{[\s\S]*?return next\(\);/);
  });
});

describe('4. agent instruction / when-to-use', () => {
  for (const [name, source] of [['llms.txt', llmsTxt], ['llms-full.txt', llmsFullTxt]]) {
    it(`${name} names when to use the site and how to call it`, () => {
      expect(source).toContain('## When To Use This Site');
      expect(source).toContain('## How An Agent Should Call It');
      // Specific jobs, not marketing copy.
      expect(source).toContain('?flight=UA1234');
      expect(source).toContain('/trackers/atc.json');
      expect(source).toContain('Accept: text/markdown');
      // And an explicit statement of what it is NOT for.
      expect(source).toContain('Do **not** use The Blue Board');
    });
  }

  it('does not advertise a path robots.txt disallows', () => {
    for (const source of [llmsTxt, llmsFullTxt, agentMarkdown['/'], agentMarkdown['/news']]) {
      expect(source).not.toContain('/data/news-latest.json');
    }
  });
});

describe('5. Organization schema completeness', () => {
  const organization = jsonLdBlocks(indexHtml).find((node) => node['@type'] === 'Organization');

  it('exists with a stable @id', () => {
    expect(organization).toBeDefined();
    expect(organization['@id']).toBe('https://theblueboard.co/#organization');
  });

  it('has a contactPoint an agent can act on', () => {
    expect(organization.contactPoint).toMatchObject({
      '@type': 'ContactPoint',
      contactType: 'customer support',
      email: 'hello@theblueboard.co',
    });
  });

  it('has a PostalAddress', () => {
    expect(organization.address).toMatchObject({
      '@type': 'PostalAddress',
      addressLocality: 'Los Angeles',
      addressRegion: 'CA',
      addressCountry: 'US',
    });
  });

  it('publishes the same contact address the privacy page and email footer use', () => {
    expect(organization.email).toBe('hello@theblueboard.co');
  });

  it('leaves every other JSON-LD block parseable', () => {
    expect(jsonLdBlocks(indexHtml).length).toBeGreaterThanOrEqual(6);
  });
});

describe('Markdown representations stay factually pinned to facts.js', () => {
  it('quotes the fleet database count from facts.js', () => {
    const expected = FLEET_DB_COUNT.toLocaleString('en-US');
    expect(agentMarkdown['/']).toContain(expected);
    expect(agentMarkdown['/fleet']).toContain(expected);
  });

  it('quotes the tracked-board count from facts.js', () => {
    expect(agentMarkdown['/']).toContain(`${TRACKED_BOARDS} tracked boards`);
  });

  it('carries no Starlink figure — those are stamped into dist/ at build time', () => {
    for (const body of Object.values(agentMarkdown)) {
      expect(body).not.toMatch(/\d{3}\+? (?:United )?aircraft (?:now )?equipped/);
      expect(body).not.toContain('425+');
      expect(body).not.toContain('500+');
    }
  });

  it('carries the independence disclaimer on every page', () => {
    for (const [path, body] of Object.entries(agentMarkdown)) {
      expect(body, path).toContain('not affiliated with, endorsed by, or operated by United Airlines');
    }
  });

  it('opens every representation with a single H1', () => {
    for (const [path, body] of Object.entries(agentMarkdown)) {
      expect(body.startsWith('# '), path).toBe(true);
      expect(body.match(/^# /gm).length, path).toBe(1);
    }
  });

  it('406 text tells the client what to retry with', () => {
    const body = notAcceptableText('application/pdf', PRODUCES);
    expect(body).toContain('This resource is available in:');
    expect(body).toContain('acceptmarkdown.com');
  });
});
