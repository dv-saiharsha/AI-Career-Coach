import type { Metadata } from 'next'
import { SiteNav } from '@/components/landing/SiteNav'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { LegalSection } from '@/components/legal/LegalSection'

export const metadata: Metadata = {
  title: 'Terms of Service — ApplyCenter',
  description: 'The terms that apply when you use ApplyCenter.',
}

const EFFECTIVE_DATE = 'September 4, 2026'

/**
 * See privacy/page.tsx's header comment — same standard applies here.
 * The AI-output disclaimer and the "no employment guarantee" clause are not
 * boilerplate: they exist because the product makes a specific, checkable
 * promise (see resume_builder's zero-fabrication rule) and the terms need to
 * describe that promise accurately rather than the generic disclaimer every
 * SaaS ships.
 */
export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[var(--color-canvas-deep)]">
      <SiteNav />
      <main className="shell py-16 sm:py-24">
        <div className="mx-auto max-w-[68ch]">
          <p className="text-eyebrow text-ink-faint">Legal</p>
          <h1 className="mt-3 font-display text-3xl tracking-[-0.02em] text-ink sm:text-4xl">
            Terms of Service
          </h1>
          <p className="mt-3 text-sm text-ink-faint">Effective {EFFECTIVE_DATE}</p>

          <p className="mt-8 text-[15px] leading-relaxed text-ink-dim">
            ApplyCenter is a free programme for people looking for work, run as a charity by{' '}
            <a
              href="https://chieac.org"
              className="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
            >
              CHIEAC
            </a>
            . By creating an account or using the service, you agree to these terms. If you
            don&apos;t agree with them, please don&apos;t use ApplyCenter.
          </p>

          <LegalSection title="What ApplyCenter is">
            <p>
              A resume scoring and tailoring tool, an interview practice coach, and a job listing
              board, offered free of charge. It is a tool to help your search — it is not a
              recruiter, an employer, or a guarantee of any outcome.
            </p>
          </LegalSection>

          <LegalSection title="Your account">
            <ul className="list-disc space-y-2 pl-5">
              <li>One account per person. Keep your login credentials to yourself.</li>
              <li>
                Give us accurate information — an account built on a false identity is one we can
                close without notice.
              </li>
              <li>
                You&apos;re responsible for what happens under your account. If you think someone
                else has access to it, tell us.
              </li>
              <li>You must be at least 16 years old to use ApplyCenter.</li>
            </ul>
          </LegalSection>

          <LegalSection title="Your content">
            <p>
              Your resume, your answers, your notes — they&apos;re yours. Uploading them gives us
              only the limited license we need to do what you asked: read a file to score it,
              rewrite it into a tailored version, evaluate an interview answer. We don&apos;t claim
              ownership of anything you give us, and we don&apos;t use it for anything beyond
              running the feature you used it for.
            </p>
            <p>You&apos;re responsible for what you upload. Please don&apos;t give us:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Someone else&apos;s personal information without their permission.</li>
              <li>Content you don&apos;t have the right to share.</li>
              <li>Anything unlawful, abusive, or intended to harm someone else.</li>
            </ul>
          </LegalSection>

          <LegalSection title="What our AI features do and don't do">
            <p>
              Read this section before you act on anything the product tells you — it is the part
              most likely to matter to you directly.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-medium text-ink">Tailoring reorganises; it doesn&apos;t
                invent.</strong> When we generate a tailored resume, we select and rewrite from
                content you actually provided. We do not fabricate work history, credentials,
                metrics, or skills you didn&apos;t give us. Review anything we generate before you
                send it to an employer — you are the one representing it as your own.
              </li>
              <li>
                <strong className="font-medium text-ink">Scores are estimates, not
                promises.</strong> An ATS match score reflects our model&apos;s read of a resume
                against a job description. It is not a guarantee you&apos;ll be shortlisted,
                interviewed, or hired, and different employers&apos; real systems may score
                differently.
              </li>
              <li>
                <strong className="font-medium text-ink">Interview feedback is practice, not
                certification.</strong> It&apos;s meant to help you prepare — it is not a
                professional evaluation of your skills or fitness for a role.
              </li>
              <li>
                <strong className="font-medium text-ink">We do not guarantee employment,
                interviews, or any specific outcome</strong> from using ApplyCenter.
              </li>
            </ul>
          </LegalSection>

          <LegalSection title="Job listings">
            <p>
              Postings shown in the job board come from employers&apos; own career sites and
              third-party listing sources. We link you to the employer&apos;s real application
              page — applying happens on their site, under their terms, not ours. We don&apos;t
              control whether a listing is accurate, current, or still open, and we&apos;re not a
              party to any application, interview, or hiring decision that results from it.
            </p>
          </LegalSection>

          <LegalSection title="Acceptable use">
            <p>Please don&apos;t:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Scrape, crawl, or bulk-download data from ApplyCenter.</li>
              <li>Try to bypass rate limits, security controls, or access another user&apos;s data.</li>
              <li>
                Use the AI features to generate content intended to deceive an employer about who
                you are or what you&apos;ve done.
              </li>
              <li>Reverse-engineer or resell access to the service.</li>
            </ul>
            <p>
              We can suspend or close an account that does any of this, and we&apos;ll tell you why
              if we do.
            </p>
          </LegalSection>

          <LegalSection title="Ending your account">
            <p>
              You can delete your account at any time from{' '}
              <strong className="font-medium text-ink">Settings → Danger Zone</strong> — this
              permanently removes your data, as described in our{' '}
              <a
                href="/privacy"
                className="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
              >
                Privacy Policy
              </a>
              . We may suspend or close an account that violates these terms; where we can, we will
              tell you why before we do.
            </p>
          </LegalSection>

          <LegalSection title="No warranty">
            <p>
              ApplyCenter is provided as-is, as a free service. We work to keep it accurate and
              available, but we don&apos;t promise it will be error-free, uninterrupted, or fit for
              every purpose. To the extent the law allows, we&apos;re not liable for indirect,
              incidental, or consequential damages arising from your use of the service — including
              decisions made based on a score, a generated document, or feedback it gave you.
              Nothing here limits liability that cannot be limited under the law that applies to
              you.
            </p>
          </LegalSection>

          <LegalSection title="Changes to these terms">
            <p>
              If we change these terms in a way that matters, we&apos;ll post the update here and,
              for anything material, let you know directly rather than leave you to notice on your
              own.
            </p>
          </LegalSection>

          <LegalSection title="Contact">
            <p>
              Questions about these terms:{' '}
              <a
                href="mailto:hello@applycenter.org"
                className="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
              >
                hello@applycenter.org
              </a>
              .
            </p>
          </LegalSection>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
