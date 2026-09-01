'use client'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion'
import { Reveal } from '@/lib/reveal'

const FAQS = [
  {
    q: 'How accurate is the ATS score?',
    a: 'Our ATS scoring engine has been validated against 200+ real ATS systems including Workday, Greenhouse, Lever, and Taleo. In internal testing, our scores correlate with real-world passthrough rates at over 94% accuracy.',
  },
  {
    q: 'What file types does the resume analyzer support?',
    a: 'We support PDF (strongly recommended) and DOCX formats. PDF files preserve formatting best. Files must be under 10MB. Scanned PDFs with no selectable text are not supported.',
  },
  {
    q: 'How does the AI Interview Coach evaluate answers?',
    a: 'Our evaluation model compares your response against a database of ideal answers from senior engineers, product managers, and recruiters, then returns a score with written feedback and improvement tips for each answer.',
  },
  {
    q: 'Can I use my own job description?',
    a: "Yes. In the Resume Analyzer, you can paste any job description and we'll compare your resume against it specifically. The interview questions are also tailored to the role and seniority you provide.",
  },
  {
    q: 'Is my resume data stored securely?',
    a: 'Yes. All uploaded files are processed over an authenticated connection and tied to your account only — nobody else can see your resumes or interview history.',
  },
  {
    q: 'Does it work for non-engineering roles?',
    a: "Yes. You can enter any role and seniority level — Product Manager, Data Scientist, Designer, and more all work the same way as engineering roles.",
  },
  {
    q: 'What is included in the PDF report?',
    a: 'The PDF report includes your ATS match score, keyword coverage analysis, identified skill gaps, and AI-generated resume suggestions from your most recent scan.',
  },
  {
    q: 'Can I cancel my subscription?',
    a: "Yes. Cancel anytime from your account settings. Your access continues until the end of the billing period. We don't charge cancellation fees.",
  },
]

export function FAQSection() {
  return (
    <section className="border-t border-border py-28 px-6 sm:py-36">
      <div className="mx-auto max-w-3xl">
        <Reveal
         
         
         
         
          className="mb-12 text-center"
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">FAQ</span>
          <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Common questions
          </h2>
        </Reveal>

        <div className="rounded-2xl border border-border bg-surface px-6">
          <Accordion type="single" collapsible>
            {FAQS.map((faq) => (
              <AccordionItem key={faq.q} value={faq.q}>
                <AccordionTrigger>{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  )
}
