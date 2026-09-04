/** Shared by the Privacy Policy and Terms of Service pages — both are long-form
 *  legal text with no other structure in common with the rest of the app, so
 *  this stays local to `legal/` rather than joining the general UI primitives. */
export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-xl tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink-dim [&_ul]:mt-2">
        {children}
      </div>
    </section>
  )
}
