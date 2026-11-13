/**
 * A link to a dashboard address that is followed in place.
 *
 * It is a real `<a href>`: the address is what a new tab, "copy link" and a crawler get. An
 * unmodified primary click on an address `resolveDeepLink` can apply is applied through the
 * dashboard's state instead (`useFollowDeepLink`), so the dashboard never reloads. Every other
 * click (Cmd, Ctrl, Shift, Alt, middle) and every address the resolver turns down (a hub or
 * flight page, another site, a dashboard address with more in it than an in-place follow can
 * apply) is left to the browser untouched.
 *
 * Quiet by default: most links in a row are not what the row is about (link-style.ts).
 */

import type { MouseEvent, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { resolveDeepLink } from '../state/deep-links';
import { useFollowDeepLink } from '../state/follow-link';
import type { FollowDeepLink, FollowOptions } from '../state/follow-link';
import { LINK_HIT, LINK_TONE } from './link-style';
import type { LinkHit, LinkTone } from './link-style';

/**
 * The click handler for a link to `href`. A plain function rather than a hook, so a list can
 * build one per item from one `useFollowDeepLink()` call. The handler returns true when it
 * followed the link in place (and cancelled the page load), false when it left the click to the
 * browser.
 */
export function dashLinkClick(
  follow: FollowDeepLink,
  href: string,
  options?: FollowOptions,
): (event: MouseEvent<HTMLAnchorElement>) => boolean {
  return (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    const intent = resolveDeepLink(href);
    if (!intent) return false;
    event.preventDefault();
    if (options) follow(intent, options);
    else follow(intent);
    return true;
  };
}

/** `data-*` attributes, passed through to the `<a>`. */
type DataAttributes = { [key: `data-${string}`]: string | undefined };

export type DashLinkProps = DataAttributes & {
  href: string;
  tone?: LinkTone;
  hit?: LinkHit;
  className?: string;
  title?: string;
  /**
   * The link is inside an overlay (the flight sheet, the aircraft dialog, the FR24 or delay
   * dialog, the search palette): following it closes those first and lands as an arrival, even
   * on the tab already showing (`FollowOptions` in state/follow-link.tsx).
   */
  fromOverlay?: boolean;
  children: ReactNode;
};

export function DashLink({ href, tone = 'quiet', hit = 'box', className, title, fromOverlay, children, ...data }: DashLinkProps) {
  const follow = useFollowDeepLink();
  return (
    <a
      {...data}
      href={href}
      title={title}
      onClick={dashLinkClick(follow, href, fromOverlay ? { fromOverlay: true } : undefined)}
      className={cn(LINK_TONE[tone], LINK_HIT[hit], className)}
    >
      {children}
    </a>
  );
}

export default DashLink;
