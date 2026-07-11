'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from 'react-intersection-observer';
import { ChevronDown } from 'lucide-react';

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
    a: 'Our evaluation model compares your response against a database of ideal answers from senior engineers, product managers, and recruiters. It scores on five dimensions: technical depth, completeness, communication clarity, structure (STAR method), and conciseness.',
  },
  {
    q: 'Can I use my own job description?',
    a: 'Yes. In the Resume Analyzer, you can paste any job description and we\'ll compare your resume against it specifically. The interview questions are also tailored to the role and JD you provide.',
  },
  {
    q: 'Is my resume data stored securely?',
    a: 'Yes. All uploaded files are encrypted at rest (AES-256) and in transit (TLS 1.3). Files are processed in isolated environments and you can request deletion at any time from your account settings.',
  },
  {
    q: 'Does it work for non-engineering roles?',
    a: 'Absolutely. We support 20+ roles including Product Manager, Data Scientist, ML Engineer, Frontend Engineer, Backend Engineer, DevOps, and more. We\'re actively expanding our role library.',
  },
  {
    q: 'What is included in the PDF report?',
    a: 'The PDF report includes: your ATS match score, keyword coverage analysis, identified skill gaps, AI-generated resume suggestions, a prioritized improvement plan, and your interview session scores if you\'ve practiced.',
  },
  {
    q: 'Can I cancel my subscription?',
    a: 'Yes. Cancel anytime from your account settings. Your access continues until the end of the billing period. We don\'t charge cancellation fees.',
  },
];

function FAQItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  const { ref, inView } = useInView({ threshold: 0.1, triggerOnce: true });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="border-b border-[var(--color-canvas-line-soft)] last:border-0"
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-left group focus:outline-none"
      >
        <span className="text-sm md:text-base font-medium text-[var(--color-ink)] group-hover:text-[var(--color-accent-lighter)] transition-colors pr-4">
          {q}
        </span>
        <motion.div
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 w-5 h-5 text-[var(--color-ink-faint)]"
        >
          <ChevronDown className="w-5 h-5" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <p className="text-sm text-[var(--color-ink-dim)] leading-relaxed pb-5">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function FAQSection() {
  const { ref, inView } = useInView({ threshold: 0.1, triggerOnce: true });

  return (
    <section className="py-24 px-4 border-t border-[var(--color-canvas-line-soft)] bg-[var(--color-canvas-deep)]">
      <div className="max-w-3xl mx-auto">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="section-eyebrow-violet mb-4 inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
            FAQ
          </span>
          <h2 className="text-4xl md:text-5xl font-display font-semibold tracking-tight mt-4 mb-5">
            Common questions
          </h2>
        </motion.div>

        <div className="bg-[var(--color-canvas-raise)] border border-[var(--color-canvas-line-soft)] rounded-2xl px-6 py-2">
          {FAQS.map((faq, i) => (
            <FAQItem key={faq.q} q={faq.q} a={faq.a} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
