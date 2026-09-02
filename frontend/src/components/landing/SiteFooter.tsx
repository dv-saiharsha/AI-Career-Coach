import Link from 'next/link'
import { ApplyCenterMark } from '@/components/ApplyCenterMark'

/* Only routes that exist. The old footer linked About, Blog, Careers,
   Privacy Policy, Terms, Cookie Policy and Security at "#", which is worse
   than not listing them: a privacy link that goes nowhere is a broken
   promise on the exact subject where this audience is entitled to one.
   Those pages need writing; until they exist they are not listed. */
const COLUMNS = [
  {
    heading: 'What it does',
    links: [
      { label: 'How it works', href: '/how-it-works' },
      { label: 'What you get', href: '/features' },
      { label: 'Check your CV', href: '/resume' },
      { label: 'Practise interviews', href: '/interview' },
    ],
  },
  {
    heading: 'Organisations',
    links: [
      { label: 'For partners', href: '/pricing' },
      { label: 'hello@applycenter.org', href: 'mailto:hello@applycenter.org' },
    ],
  },
] as const

export function SiteFooter() {
  return (
    <footer className="px-4 pb-12 pt-8">
      <div className="shell">
        <div className="rounded-3xl bg-canvas-raise px-6 py-12 elev-md lg:px-12">
          <div className="grid gap-12 lg:grid-cols-[1.5fr_1fr_1fr]">
            <div className="max-w-[40ch]">
              <Link
                href="/"
                className="inline-flex items-center gap-2.5 rounded-full outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                <ApplyCenterMark className="size-7" />
                <span className="wordmark text-[15px] text-ink">ApplyCenter</span>
              </Link>
              <p className="mt-5 text-[14px] font-light leading-relaxed text-ink-dim">
                A free programme for people looking for work, run as a charity. Your CV stays
                yours, and you can take it back whenever you want.
              </p>
            </div>

            {COLUMNS.map((column) => (
              <nav key={column.heading} aria-labelledby={'footer-' + column.heading}>
                <h2
                  id={'footer-' + column.heading}
                  className="text-eyebrow text-ink-faint"
                >
                  {column.heading}
                </h2>
                <ul className="mt-5 flex flex-col gap-1">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="inline-flex min-h-11 items-center rounded-md text-[14px] font-light text-ink-dim transition-colors duration-200 ease-(--ease-enter) hover:text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          <p className="mt-12 text-[13px] text-ink-faint">
            &copy; {new Date().getFullYear()} ApplyCenter &middot; built at{' '}
            <a
              href="https://chieac.org"
              className="text-ink-dim underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
            >
              CHIEAC
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
