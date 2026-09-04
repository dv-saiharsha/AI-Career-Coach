import type { Metadata } from 'next'
import { SiteNav } from '@/components/landing/SiteNav'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { LegalSection } from '@/components/legal/LegalSection'

export const metadata: Metadata = {
  title: 'Privacy Policy — ApplyCenter',
  description: 'What ApplyCenter holds about you, why, and how to see or remove it.',
}

const EFFECTIVE_DATE = 'September 4, 2026'

/**
 * Written from what this codebase actually does, not a generic template.
 *
 * Every specific claim below traces to real code: the export/deletion
 * endpoints in app/modules/user_profile/, the Google-only OAuth decision in
 * lib/auth/oauth.ts, the Deepgram transcription path that discards audio in
 * interview_coach/voice.py, and the "no ad or analytics cookies" claim,
 * checked against package.json before writing it rather than assumed.
 *
 * This is a good-faith draft grounded in the real system, not a substitute
 * for review by a qualified lawyer — flagged to the person who asked for it,
 * not printed on the page itself.
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[var(--color-canvas-deep)]">
      <SiteNav />
      <main className="shell py-16 sm:py-24">
        <div className="mx-auto max-w-[68ch]">
          <p className="text-eyebrow text-ink-faint">Privacy</p>
          <h1 className="mt-3 font-display text-3xl tracking-[-0.02em] text-ink sm:text-4xl">
            Privacy Policy
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
            . This page explains what we hold about you, why, and — since a promise you can&apos;t
            check is just a sentence — exactly how to see it or take it back.
          </p>

          <LegalSection title="The short version">
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Your CV is read to score it against a job description. It is not sold, listed, or
                shown to employers.
              </li>
              <li>Everything you&apos;ve given us is kept until you delete it — never longer.</li>
              <li>
                You can download everything we hold, or delete your account and every row tied to
                it, from <strong className="font-medium text-ink">Settings</strong> at any time.
              </li>
              <li>No advertising cookies, no analytics trackers, no data brokers.</li>
            </ul>
          </LegalSection>

          <LegalSection title="What we collect">
            <p>Only what the product needs to do the job you asked it to do:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-medium text-ink">Account.</strong> Your email address, and
                your name and profile photo if you sign in with Google.
              </li>
              <li>
                <strong className="font-medium text-ink">Your resume.</strong> The file you upload
                and the text extracted from it — including whatever contact details, employment
                history and skills appear on it.
              </li>
              <li>
                <strong className="font-medium text-ink">Job descriptions you paste</strong>, so we
                can score your resume against them.
              </li>
              <li>
                <strong className="font-medium text-ink">Applications you track</strong> — company,
                role, status, and any notes you add.
              </li>
              <li>
                <strong className="font-medium text-ink">Interview practice.</strong> The questions
                you&apos;re asked, the answers you give, and our feedback on them. If you answer by
                voice, the recording is sent to our transcription provider, converted to text, and
                discarded — we keep the transcript, not the audio.
              </li>
              <li>
                <strong className="font-medium text-ink">Device information</strong> for push
                notifications, if you enable them on mobile.
              </li>
            </ul>
          </LegalSection>

          <LegalSection title="What we don't collect">
            <p>
              We don&apos;t run advertising or analytics trackers, and we don&apos;t buy or sell
              data about you from anyone. The only cookie involved in using ApplyCenter is the one
              that keeps you signed in.
            </p>
          </LegalSection>

          <LegalSection title="How we use it">
            <ul className="list-disc space-y-2 pl-5">
              <li>To score your resume against a job description and show you what to improve.</li>
              <li>
                To generate a tailored version of your own resume — reorganised and rewritten from
                what you gave us, never invented.
              </li>
              <li>To run mock interview sessions and give you feedback on your answers.</li>
              <li>To show you job postings and track the applications you tell us about.</li>
              <li>To keep your account secure and respond when you contact us.</li>
            </ul>
            <p>
              We do not use your resume, your answers, or anything else you give us to train a
              model, ours or anyone else&apos;s.
            </p>
          </LegalSection>

          <LegalSection title="Who else sees it">
            <p>
              A short list, because it is short on purpose — we&apos;d rather have fewer
              processors than more:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-medium text-ink">Supabase</strong> hosts our database,
                handles sign-in, and stores uploaded files.
              </li>
              <li>
                <strong className="font-medium text-ink">Anthropic</strong> (Claude) reads your
                resume and job description text to score and tailor them, and powers the interview
                and career coach features.
              </li>
              <li>
                <strong className="font-medium text-ink">Deepgram</strong> transcribes voice
                interview answers to text in real time and does not retain the audio.
              </li>
              <li>
                <strong className="font-medium text-ink">Google</strong>, only if you choose
                &ldquo;Continue with Google&rdquo; to sign in.
              </li>
            </ul>
            <p>
              Job postings you see come from employers&apos; own public career sites and
              third-party job listing services — that is public hiring information, not something
              we collect about you.
            </p>
            <p>
              None of these companies are permitted to use your information for their own purposes.
              We do not sell, rent, or share your data with advertisers, data brokers, or
              employers.
            </p>
          </LegalSection>

          <LegalSection title="How long we keep it">
            <p>
              Until you tell us to remove it. There is no automatic expiry — this data is yours,
              and deleting it is your call, not a retention schedule we impose on you.
            </p>
          </LegalSection>

          <LegalSection title="Your rights, and how to use them today">
            <p>Both of these are live in the product right now, not a promise to build later:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="font-medium text-ink">See everything we hold.</strong> Go to{' '}
                <strong className="font-medium text-ink">Settings → Privacy → Download my
                data</strong> for a complete export as a file you can open yourself.
              </li>
              <li>
                <strong className="font-medium text-ink">Delete your account.</strong> Go to{' '}
                <strong className="font-medium text-ink">Settings → Danger Zone</strong>. This
                removes your profile, resumes, applications, interview history, and your sign-in
                itself — permanently, and it cannot be undone.
              </li>
            </ul>
            <p>
              If you&apos;d rather not do this yourself, email us at{' '}
              <a
                href="mailto:hello@applycenter.org"
                className="text-ink underline decoration-line-strong underline-offset-2 hover:text-accent"
              >
                hello@applycenter.org
              </a>{' '}
              and we&apos;ll do it for you. If you are in the UK, EU, or California, the rights
              described above are the same rights those laws give you (access, portability, and
              erasure) — we just don&apos;t gate them behind a form, because you shouldn&apos;t
              have to prove you deserve your own data.
            </p>
          </LegalSection>

          <LegalSection title="Children">
            <p>
              ApplyCenter is not directed at children, and we don&apos;t knowingly collect
              information from anyone under 16. If you believe a child has created an account,
              contact us and we will remove it.
            </p>
          </LegalSection>

          <LegalSection title="Security">
            <p>
              Data is encrypted in transit, access to it is restricted to what each part of the
              system needs to do its job, and account deletion removes rows from every table that
              holds your data — not just the obvious ones. No system is unbreakable, and we will
              tell you directly if something ever goes wrong with your data.
            </p>
          </LegalSection>

          <LegalSection title="Changes to this policy">
            <p>
              If this changes in a way that matters — what we collect, who we share it with, or
              your rights — we&apos;ll post the update here and, for anything material, tell you
              directly rather than let it sit in a changelog.
            </p>
          </LegalSection>

          <LegalSection title="Contact">
            <p>
              Questions, concerns, or a request you&apos;d rather send by email than click through:{' '}
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
