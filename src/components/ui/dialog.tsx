import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@/components/ui/button"
import { shouldRestoreFocus, wasFocusLost } from "@/lib/focus-return.js"
import { XIcon } from "lucide-react"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Records what was focused at the moment the dialog opened.
 *
 * It has to be a CHILD of `DialogPrimitive.Content` rather than an effect in the wrapper:
 * the wrapper component is mounted for the life of the page (only Radix's `Presence` gates
 * the content), so an effect there would run once at startup and capture `<body>`. Content's
 * children mount when the dialog actually opens.
 *
 * A LAYOUT effect, because React flushes every layout effect before any passive one — and
 * Radix's FocusScope pulls focus into the dialog from a passive effect. This therefore still
 * sees the opener.
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

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  onCloseAutoFocus,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  /**
   * Classes for the overlay this content renders alongside itself. It exists for
   * stacking: a dialog that must sit above another one has to lift BOTH halves, and
   * the overlay is otherwise unreachable from the caller. Undefined by default, so
   * every other caller is unchanged.
   */
  overlayClassName?: string
}) {
  // Most of this app's dialogs are opened by flipping state, not by a `DialogTrigger`, so
  // Radix has no `triggerRef` to hand focus back to and the browser drops it on `<body>`.
  // Remembering the opener here covers every caller at once — see `src/lib/focus-return.js`.
  const openerRef = React.useRef<HTMLElement | null>(null)

  // One caller (AircraftDetailDialog) needs the node too, so the ref is composed rather
  // than claimed.
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
      // The caller's handler wins. `ScheduleControls` already restores focus itself, and
      // Radix's own default is skipped for the same reason once we prevent default.
      onCloseAutoFocus?.(event)
      if (event.defaultPrevented) return

      const active = document.activeElement as HTMLElement | null
      const content = contentRef.current
      const opener = openerRef.current
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
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        ref={composedRef}
        onCloseAutoFocus={handleCloseAutoFocus}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        <CaptureOpener openerRef={openerRef} />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              // 44px on touch (WCAG 2.5.5), matching the sheet's close pin; desktop
              // density returns from `md:`.
              className="absolute top-2 right-2 min-h-11 min-w-11 md:min-h-8 md:min-w-8"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
