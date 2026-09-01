import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Reveal } from '@/lib/reveal'

const QUESTIONS = [
  {
    q: 'What is an ATS, and why does it matter?',
    a: 'Most medium and large employers put every application through software before a person reads it. It looks for particular words and a particular structure, and it discards what it cannot read. A good CV that the software cannot parse is rejected the same way a bad one is. That is the part we help with.',
  },
  {
    q: 'Is it really free?',
    a: 'Yes, permanently, for anyone looking for work. There is no card, no trial period, and no feature held back. Organisations that support jobseekers pay for the programme, which is what funds it.',
  },
  {
    q: 'What happens to my CV?',
    a: 'It is stored against your account and nobody else can see it. It is not sold, not used to train anything, and not shared with employers. You can download everything you have given us, or delete all of it, from your settings without asking anyone.',
  },
  {
    q: 'Do I have to connect Indeed or LinkedIn?',
    a: 'No. Connecting them saves you typing, because applications you make there appear here on their own. If you would rather not, you can add applications by hand and everything else works the same.',
  },
  {
    q: 'Will it write my CV for me?',
    a: 'No, and that is deliberate. It tells you what a specific job asks for, what your CV currently says, and where the two do not meet. The words stay yours, which matters when someone asks you about them in an interview.',
  },
  {
    q: 'My CV is a scan of a printed page. Can you read it?',
    a: 'Not yet, and we will say so rather than guess. A PDF made by scanning has no selectable text in it, so there is nothing to read. Exporting a fresh PDF from Word, Google Docs or LibreOffice fixes it.',
  },
] as const

/**
 * Written for someone who has never heard the phrase "applicant tracking
 * system" and should not have to look it up to use this. Every answer says
 * the thing plainly and stops.
 */
export function Questions() {
  return (
    <section aria-labelledby="questions-heading" className="px-4 section-y">
      <div className="shell">
        <div className="mx-auto max-w-3xl">
          <Reveal className="mb-10 lg:mb-12">
            <h2 id="questions-heading" className="text-section text-ink">
              Questions people ask
            </h2>
          </Reveal>

          <Reveal>
            <Accordion type="single" collapsible className="w-full">
              {QUESTIONS.map((item) => (
                <AccordionItem key={item.q} value={item.q}>
                  <AccordionTrigger>{item.q}</AccordionTrigger>
                  <AccordionContent>{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
