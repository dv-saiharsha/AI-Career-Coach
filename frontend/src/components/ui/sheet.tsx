'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* The right-hand drawer: the largest raised surface in the system, sliding
   in over a violet scrim at 320ms on the decelerating curve.

   Radix handles focus trapping and restore-on-close for us, which is the
   reason this is built on it rather than hand-rolled. */

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      /* A violet scrim, not black: the page beneath should read as dimmed,
         not as a different material. */
      'fixed inset-0 z-50 bg-[rgb(16_11_36/0.72)]',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className
    )}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

const sheetVariants = cva(
  [
    'fixed z-50 flex flex-col gap-4 bg-canvas-raise elev-lg',
    'data-[state=open]:animate-in data-[state=closed]:animate-out',
    'data-[state=open]:duration-[320ms] data-[state=closed]:duration-200',
    'data-[state=open]:ease-(--ease-enter) data-[state=closed]:ease-(--ease-exit)',
  ],
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 rounded-b-3xl data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 rounded-t-3xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
        left: 'inset-y-0 left-0 h-full w-full rounded-r-3xl data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-md',
        /* Full width below sm so a drawer is usable at 360px, where a
           three-quarter drawer leaves a dead strip nobody can tap. */
        right:
          'inset-y-0 right-0 h-full w-full rounded-l-3xl data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-md',
      },
    },
    defaultVariants: { side: 'right' },
  }
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className={cn(
          'absolute right-5 top-5 inline-flex size-11 cursor-pointer items-center justify-center rounded-full',
          'bg-canvas-raise text-ink-dim elev-interactive-sm',
          'outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'
        )}
      >
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = DialogPrimitive.Content.displayName

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 p-[22px] pb-0 pr-16 lg:p-[30px] lg:pb-0 lg:pr-16', className)} {...props} />
)

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn('text-card-title text-ink', className)} {...props} />
))
SheetTitle.displayName = DialogPrimitive.Title.displayName

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm leading-relaxed text-ink-dim', className)}
    {...props}
  />
))
SheetDescription.displayName = DialogPrimitive.Description.displayName

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
}
