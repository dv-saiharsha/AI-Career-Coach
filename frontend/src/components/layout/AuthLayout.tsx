import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/shared/Logo'
import { WovenPattern } from '@/components/shared/WovenPattern'

const BENEFITS = [
  'Know exactly what to improve next',
  'Turn preparation into stronger applications',
  'See your progress from search to offer',
]

function BrandPanel() {
  return (
    <section className="relative hidden min-h-screen overflow-hidden bg-[linear-gradient(145deg,#312e81,hsl(var(--primary))_55%,#4f46e5)] px-16 py-[54px] text-white lg:block">
      <WovenPattern />
      <div className="absolute -right-[140px] -bottom-[120px] h-[360px] w-[360px] rounded-full bg-coral opacity-[0.16] blur-[100px]" />
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-108px)] max-w-[560px] flex-col">
        <Link to="/">
          <Logo inverse />
        </Link>
        <div className="my-auto py-12">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#c7d2fe]">
            One connected career workflow
          </span>
          <span className="mt-1.5 block h-px w-9 bg-[#c7d2fe]/50" />
          <h1 className="mt-[18px] font-heading text-[54px] font-extrabold leading-[1.1] text-white">
            Prepare smarter.
            <br />
            Apply with confidence.
            <br />
            <em className="text-[#fdbaaa] not-italic">Never guess where you stand.</em>
          </h1>
          <div className="mt-8 grid gap-3.5 text-sm text-[#e0e7ff]">
            {BENEFITS.map((benefit) => (
              <div key={benefit} className="flex items-center gap-3">
                <span className="grid h-[25px] w-[25px] shrink-0 place-items-center rounded-full bg-white/10">
                  <Check size={15} />
                </span>
                {benefit}
              </div>
            ))}
          </div>
        </div>
        <blockquote className="rounded-xl border border-white/15 bg-white/10 p-[22px] text-[13px] leading-[1.6] text-[#eef2ff] backdrop-blur-sm">
          &ldquo;HireLoom replaced five scattered tools with one clear path. I stopped second-guessing every
          application.&rdquo;
          <footer className="mt-4 flex items-center gap-2.5">
            <span className="grid h-[33px] w-[33px] place-items-center rounded-full bg-[#f9a38f] text-[11px] font-extrabold text-[#7c2d12]">
              MN
            </span>
            <span className="grid">
              <strong className="text-xs">Maya N.</strong>
              <small className="mt-0.5 text-[#c7d2fe]">Product Designer at Arc</small>
            </span>
          </footer>
        </blockquote>
      </div>
    </section>
  )
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(420px,0.92fr)_minmax(520px,1.08fr)]">
      <BrandPanel />
      <main className="grid place-items-center p-6 sm:p-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <Link to="/">
              <Logo />
            </Link>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
