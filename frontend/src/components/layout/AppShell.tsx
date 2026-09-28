import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Toaster } from 'sonner'

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Desktop Persistent Sidebar */}
      <div className="hidden md:flex shrink-0">
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed(!collapsed)}
        />
      </div>

      {/* Mobile Drawer (shadcn Sheet) */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <Sidebar onItemClick={() => setMobileNavOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Column */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <Header onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Figma's `.page-content` — full width next to the sidebar, capped
              only at a very wide 1560px so it never over-stretches on an
              ultra-wide monitor. Pages must not add their own max-width or
              horizontal padding on top of this. */}
          <div className="mx-auto w-full max-w-[1560px] px-[30px] pb-[46px] pt-[27px]">
            <Outlet />
          </div>
        </main>
      </div>

      <Toaster
        position="bottom-right"
        richColors
        toastOptions={{
          classNames: {
            toast: 'rounded-[10px] border border-border bg-card shadow-elevated font-sans',
            title: 'text-foreground text-[13px]',
            description: 'text-muted-foreground text-xs',
          },
        }}
      />
    </div>
  )
}
