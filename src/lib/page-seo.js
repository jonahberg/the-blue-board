/**
 * page-seo.js — how `<title>`, meta description and share-card copy are assembled for the
 * data-driven content pages (fleet types, hubs, news articles).
 *
 * The style is "keep-rank": the page's main search phrase comes FIRST ("United O'Hare",
 * "United 787-9"), the rest is trimmed, and the brand suffix is appended only when the
 * whole title still fits the SERP target. Limits (checked over every built page by
 * `tests/seo-lengths.test.js`):
 *   - `<title>`: target ≤ 60 characters, hard max 65
 *   - meta description: ≤ 160 characters (aim for ~140–155)
 *   - og:title / twitter:title: ≤ 70 characters
 *
 * Fleet copy carries a `{count}` token instead of a hand-typed aircraft count, so the SEO
 * strings can never drift from `data.count`.
 */

export const BRAND_SUFFIX = ' | The Blue Board';
export const TITLE_TARGET = 60;
export const TITLE_MAX = 65;
export const DESCRIPTION_MAX = 160;
export const SHARE_TITLE_MAX = 70;

/**
 * Append " | The Blue Board" when the result stays within {@link TITLE_TARGET}; otherwise
 * return the headline alone (the search phrase wins over the brand).
 * @param {string} headline
 * @returns {string}
 */
export function withBrand(headline) {
  const branded = `${headline}${BRAND_SUFFIX}`;
  return branded.length <= TITLE_TARGET ? branded : headline;
}

/**
 * Replace every `{count}` token with the formatted count ("1,139", "59").
 * @param {string | undefined} text
 * @param {number} count
 */
export function fillCount(text, count) {
  if (text == null) return text;
  return text.replaceAll('{count}', Number(count).toLocaleString('en-US'));
}

/**
 * Resolved SEO strings for a fleet type page (`src/data/fleet/*.js`).
 * `data.title` is the headline without the brand; the suffix is added here so a count
 * that changes digit-length cannot push the title over the target.
 */
export function fleetSeo(data) {
  const fill = (text) => fillCount(text, data.count);
  return {
    title: withBrand(fill(data.title)),
    description: fill(data.description),
    ogTitle: fill(data.ogTitle),
    ogDescription: fill(data.ogDescription),
    twitterTitle: fill(data.twitterTitle),
    twitterDescription: fill(data.twitterDescription),
  };
}

/** Resolved SEO strings for a hub page (`src/data/hubs/*.js`). */
export function hubSeo(data) {
  return {
    title: withBrand(data.title),
    description: data.description,
    ogTitle: data.ogTitle,
    ogDescription: data.ogDescription,
    twitterTitle: data.twitterTitle,
    twitterDescription: data.twitterDescription,
  };
}

/**
 * The short search headline for a news article. The full headline stays in the h1, the
 * JSON-LD and the RSS feed; `<title>` uses `article.seoTitle` when set, otherwise the part
 * of the headline before its first ": " or " — " (e.g. "Live Football at 35,000 Feet").
 */
export function newsHeadline(article) {
  if (article.seoTitle) return article.seoTitle;
  const cut = article.title.search(/: | — /);
  return cut >= 20 ? article.title.slice(0, cut) : article.title;
}

/** Resolved SEO strings for a news article (`src/data/news/index.js`). */
export function newsSeo(article) {
  const headline = newsHeadline(article);
  return {
    title: withBrand(headline),
    // `summary` is body copy (index cards, RSS) and runs long; the meta description is
    // its own, SERP-sized field.
    description: article.seoDescription ?? article.summary,
    ogTitle: article.title.length <= SHARE_TITLE_MAX ? article.title : headline,
  };
}
