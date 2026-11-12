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
import type { DeepLinkIntent } from '../state/deep-links';
import { useFollowDeepLink } from '../state/follow-link';
import { LINK_HIT, LINK_TONE } from './link-style';
import type { LinkHit, LinkTone } from './link-style';

/**
 * The click handler for a link to `href`. A plain function rather than a hook, so a list can
 * build one per item from one `useFollowDeepLink()` call.
 */
export function dashLinkClick(
  follow: (intent: DeepLinkIntent) => void,
  href: string,
): (event: MouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const intent = resolveDeepLink(href);
    if (!intent) return;
    event.preventDefault();
    follow(intent);
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
  children: ReactNode;
};

export function DashLink({ href, tone = 'quiet', hit = 'box', className, title, children, ...data }: DashLinkProps) {
  const follow = useFollowDeepLink();
  return (
    <a
      {...data}
      href={href}
      title={title}
      onClick={dashLinkClick(follow, href)}
      className={cn(LINK_TONE[tone], LINK_HIT[hit], className)}
    >
      {children}
    </a>
  );
}

export default DashLink;
