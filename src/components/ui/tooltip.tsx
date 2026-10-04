"use client"

import * as React from "react"
import { cn } from "cn"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { tapToggleOpen } from "@/lib/tap-tooltip.js"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

// Radix tooltips never open on a touch tap, so on a phone every "?" and jargon term did nothing.
// Tooltip owns its open state so TooltipTrigger can flip it on a touch/pen tap (tapToggleOpen).
// Mouse and keyboard behaviour is unchanged, and the trigger's own click still runs — a tapped
// hub-guide link still navigates; the tap only adds the explanation, it never swallows the action.
const TooltipTapContext = React.createContext<{
  open: boolean
  setOpen: (open: boolean) => void
} | null>(null)

function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [openProp, onOpenChange]
  )
  const tap = React.useMemo(() => ({ open, setOpen }), [open, setOpen])
  return (
    <TooltipTapContext.Provider value={tap}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        open={open}
        onOpenChange={setOpen}
        {...props}
      />
    </TooltipTapContext.Provider>
  )
}

function TooltipTrigger({
  onPointerDown,
  onClick,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const tap = React.useContext(TooltipTapContext)
  const press = React.useRef<{ pointerType: string; wasOpen: boolean } | null>(null)
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onPointerDown={(event) => {
        // Before Radix's own pointerdown handler, which closes an open tooltip.
        press.current = { pointerType: event.pointerType, wasOpen: Boolean(tap?.open) }
        onPointerDown?.(event)
      }}
      onClick={(event) => {
        onClick?.(event)
        const next = tapToggleOpen(press.current)
        press.current = null
        // Applied after this event: on a real tap the trigger's focus (which fires between
        // pointerup and click) opens the tooltip and Radix's close-on-click, which runs right
        // after this handler, shuts it again — so setting it here would be overwritten, and the
        // first tap did nothing while the second looked like the first.
        if (next !== null && tap) window.setTimeout(() => tap.setOpen(next), 0)
      }}
      {...props}
    />
  )
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
