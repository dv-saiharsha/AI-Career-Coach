import Link from 'next/link';
import { Mail, Globe, MessageCircle } from 'lucide-react';
import { ApplyCenterMark } from './ApplyCenterMark';

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
  { icon: Mail, href: 'mailto:hello@applycenter.ai', label: 'Email' },
];

export default function Footer() {
  return (
    <footer className="border-t border-[var(--color-canvas-line)] bg-[var(--color-canvas)]">
      <div className="shell pt-20 pb-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-12 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-12 mb-16">
          {/* Brand */}
          {/* Brand takes two of the five columns so the three link columns
              each get a full track and stop truncating. */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-2 lg:pr-8">
            <Link href="/" className="flex items-center gap-2.5 mb-4 group">
              <ApplyCenterMark className="w-7 h-7" />
              <span className="wordmark font-semibold text-[var(--color-ink)] text-[15px]">ApplyCenter</span>
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
                  className="touch-target w-8 h-8 rounded-lg bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line)] flex items-center justify-center text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] hover:border-[var(--color-accent)]/30 transition-all"
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
        <div className="flex flex-col gap-4 border-t border-canvas-line pt-10 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-[var(--color-ink-faint)]">
            © {new Date().getFullYear()} ApplyCenter. All rights reserved.
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
