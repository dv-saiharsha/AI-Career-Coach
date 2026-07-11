import Link from 'next/link';
import { Mail, Globe, MessageCircle } from 'lucide-react';

const LINKS = {
  Product: [
    { label: 'Resume Analyzer', href: '/resume' },
    { label: 'Interview Coach', href: '/interview' },
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Dashboard', href: '/dashboard' },
  ],
  Company: [
    { label: 'How It Works', href: '/how-it-works' },
    { label: 'About', href: '#' },
    { label: 'Blog', href: '#' },
    { label: 'Careers', href: '#' },
    { label: 'Contact', href: '#' },
  ],
  Legal: [
    { label: 'Privacy Policy', href: '#' },
    { label: 'Terms of Service', href: '#' },
    { label: 'Cookie Policy', href: '#' },
    { label: 'Security', href: '#' },
  ],
};

const SOCIALS = [
  { icon: Globe, href: '#', label: 'Website' },
  { icon: MessageCircle, href: '#', label: 'Community' },
  { icon: Mail, href: 'mailto:hello@aicareercoach.ai', label: 'Email' },
];

export default function Footer() {
  return (
    <footer className="border-t border-[var(--color-canvas-line)] bg-[var(--color-canvas)]">
      <div className="max-w-6xl mx-auto px-4 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-14">
          {/* Brand */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4 group">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[var(--color-accent)] to-[var(--color-accent-light)]" />
              <span className="font-display font-semibold text-[var(--color-ink)] text-[15px]">AI Career Coach</span>
            </Link>
            <p className="text-sm text-[var(--color-ink-faint)] leading-relaxed mb-5">
              AI-powered resume analysis and interview practice for the modern job seeker.
            </p>
            <div className="flex items-center gap-3">
              {SOCIALS.map(({ icon: Icon, href, label }) => (
                <Link
                  key={label}
                  href={href}
                  aria-label={label}
                  className="w-8 h-8 rounded-lg bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] flex items-center justify-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)]/30 transition-all"
                >
                  <Icon className="w-3.5 h-3.5" />
                </Link>
              ))}
            </div>
          </div>

          {/* Links */}
          {Object.entries(LINKS).map(([category, links]) => (
            <div key={category}>
              <div className="text-xs font-mono uppercase tracking-[0.15em] text-[var(--color-ink-faint)] mb-4">{category}</div>
              <ul className="space-y-3">
                {links.map(({ label, href }) => (
                  <li key={label}>
                    <Link href={href} className="text-sm text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] transition-colors">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col md:flex-row items-center justify-between pt-8 border-t border-[var(--color-canvas-line-soft)] gap-4">
          <p className="text-xs text-[var(--color-ink-faint)]">
            Â© {new Date().getFullYear()} AI Career Coach. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <span className="text-xs text-[var(--color-ink-faint)]">Made with precision for job seekers worldwide</span>
            <div className="flex items-center gap-1.5 bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
              <span className="text-xs text-[var(--color-accent)] font-medium">All systems operational</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
