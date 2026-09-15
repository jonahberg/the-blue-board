"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as SheetPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { shouldRestoreFocus, wasFocusLost } from "@/lib/focus-return.js"
import { XIcon } from "lucide-react"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Records what was focused at the moment the sheet opened.
 *
 * A CHILD of `SheetPrimitive.Content`, not an effect in the wrapper: the wrapper is mounted
 * for the life of the page (only Radix's `Presence` gates the content), so an effect there
 * would run once at startup and capture `<body>`. A LAYOUT effect, because React flushes
 * every layout effect before any passive one, and Radix's FocusScope moves focus into the
 * sheet from a passive effect.
 */
function CaptureOpener({
  openerRef,
}: {
  openerRef: React.RefObject<HTMLElement | null>
}) {
  React.useLayoutEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null
  }, [openerRef])
  return null
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  showOverlay = true,
  onCloseAutoFocus,
  ref,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
  /**
   * Render the dimming overlay. Set false for a NON-MODAL sheet (`<Sheet modal={false}>`)
   * that sits beside live content the viewer must keep using — the flight panel next to the
   * map, where the overlay would otherwise swallow every pan, zoom and marker click.
   */
  showOverlay?: boolean
}) {
  // The flight panel, the watch panel and the mobile nav are all opened by flipping state
  // rather than by a `SheetTrigger`, so Radix has no `triggerRef` and focus lands on
  // `<body>` when they close. Remembering the opener here covers every caller at once.
  const openerRef = React.useRef<HTMLElement | null>(null)

  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = node
    },
    [ref]
  )

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      // The caller's handler wins — `ScheduleControls` restores focus itself and prevents
      // default, which also stops Radix's own handler.
      onCloseAutoFocus?.(event)
      if (event.defaultPrevented) return

      const active = document.activeElement as HTMLElement | null
      const content = contentRef.current
      const opener = openerRef.current
      // The non-modal case is the one to get right: the flight panel closed by clicking the
      // map leaves focus on the Leaflet container, and `wasFocusLost` says no — so the user
      // keeps the focus they just moved.
      const lost = wasFocusLost({
        activeElement: active,
        insideClosingContent: Boolean(content && active && content.contains(active)),
      })
      if (!shouldRestoreFocus({ opener, focusWasLost: lost })) return

      event.preventDefault()
      opener?.focus?.()
    },
    [onCloseAutoFocus]
  )

  return (
    <SheetPortal>
      {showOverlay && <SheetOverlay />}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        ref={composedRef}
        onCloseAutoFocus={handleCloseAutoFocus}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=bottom]:data-open:slide-in-from-bottom-10 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=bottom]:data-closed:slide-out-to-bottom-10 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          className
        )}
        {...props}
      >
        <CaptureOpener openerRef={openerRef} />
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              // 44px on touch (WCAG 2.5.5; the dashboard's flight panel inherits the
              // legacy popup's explicit 44x44 close pin), desktop density from `md:`.
              className="absolute top-3 right-3 min-h-11 min-w-11 md:min-h-8 md:min-w-8"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
