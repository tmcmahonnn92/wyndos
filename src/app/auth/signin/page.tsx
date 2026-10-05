import Link from "next/link";
import {
  Check, CloudRain, Database, FileText, Layers, LifeBuoy, MapPinned, MessageSquare,
  NotebookPen, PoundSterling, Repeat, SlidersHorizontal, Smartphone, Upload, Users, Wrench,
} from "lucide-react";
import { WyndosLogo } from "@/components/nav";
import { SignInForm } from "./sign-in-form";
import { introOfferOpen, INTRO_LABEL, STANDARD_LABEL } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wyndos | Round software for window cleaners",
  description: "Put customers into areas, book the area onto a day and work through it on your phone. Workers included. 15-day free trial, no card needed.",
};

// What's different about Wyndos.
const PILLARS = [
  {
    icon: Layers,
    title: "You book the street, not every house",
    body: "Customers live in areas, and each area has its own cycle. Drop an area onto a day and everyone in it comes with it. Rained off? Move the area, not forty separate jobs.",
  },
  {
    icon: Users,
    title: "Your workers don't cost extra",
    body: "Give each worker their own login and choose what they can see. Hand them a whole day or a few single jobs. It's all in the same monthly price.",
  },
  {
    icon: Upload,
    title: "Bring your spreadsheet with you",
    body: "Upload the sheet you already keep. Wyndos builds your areas from it, and if you include last-cleaned dates your round lands on the planner already due.",
  },
  {
    icon: SlidersHorizontal,
    title: "Use as little of it as you want",
    body: "Some people only want a diary and a day sheet. Others want payments, invoices and accounts. Switch on what's useful and ignore the rest.",
  },
];

// The everyday jobs it covers.
const FUNCTIONS = [
  { icon: Repeat, title: "Any cycle", body: "Weekly, 4, 6, 8 or 12-weekly, or a set day each month. Finish a day and the next visits book themselves." },
  { icon: Smartphone, title: "Day sheets", body: "The day in order, with prices, notes and what each customer owes. Done, paid or skipped in one tap." },
  { icon: MapPinned, title: "Routes", body: "Open the day in Google Maps, stopping at each house or once per street." },
  { icon: NotebookPen, title: "Customer notes", body: "Gate codes, side access, dog in the garden. Shown on the day sheet, where you need them." },
  { icon: PoundSterling, title: "Who owes what", body: "Cash, transfer, card, whatever. See who's behind and by how long." },
  { icon: FileText, title: "Invoices", body: "PDF invoices with your logo and bank details. VAT invoices too, if you're registered." },
  { icon: MessageSquare, title: "Texts from your own phone", body: "Reminders, \"we've been\" and polite chasers, filled in per customer. No text credits to buy." },
  { icon: CloudRain, title: "Rain and changes", body: "Move a day, split an area over two days, skip a house or add a one-off without knocking the cycle out." },
  { icon: Wrench, title: "Quotes and extras", body: "Gutters, conservatories, fascias. Quote it, book it and invoice it alongside the round." },
  { icon: Database, title: "Year-end figures", body: "Income, expenses and profit for the tax year, ready for your self-assessment or your accountant." },
  { icon: Check, title: "Your data, any time", body: "Download a full backup or export customers, jobs and money to a spreadsheet whenever you like." },
];

// Honest limits, so nobody signs up expecting something it doesn't do.
const NOT_YET = [
  "Take Direct Debits for you",
  "Send texts on its own. You send them from your phone, a few taps each",
  "File your tax return. It gives you the figures to file it",
];

const SCREENS = {
  main: { src: "/screens/scheduler.jpg", alt: "The weekly planner with areas booked onto days", caption: "The weekly planner. Areas on days, coloured by how due they are." },
  phones: [
    { src: "/screens/day-phone.jpg", alt: "A day's work on a phone", caption: "The day, in walking order" },
    { src: "/screens/customer-phone.jpg", alt: "A customer's balance, next visit and history on a phone", caption: "A customer at a glance" },
    { src: "/screens/texts-phone.jpg", alt: "Choosing customers to text on a phone", caption: "Picking who to text" },
  ],
  more: [
    { src: "/screens/dashboard.jpg", alt: "The dashboard", caption: "Today's work, money owed and the year so far" },
    { src: "/screens/customers.jpg", alt: "The customer list", caption: "Every customer, area and price" },
  ],
};

const FAQ = [
  { q: "Do I need a card for the free trial?", a: "No. You get 15 days with everything switched on. If you subscribe during the trial, nothing is taken until the trial ends." },
  { q: "How long does it take to set up?", a: "If your customers are in a spreadsheet, most of it is done in an evening. Upload it, check the columns match up, and your areas are made for you." },
  { q: "I only want a diary for my round. Is it overkill?", a: "No. Payments, invoices, texts, workers and accounts are all optional. Plenty of people just use the planner and day sheets." },
  { q: "Does it work on my phone?", a: "Yes, it's made for the phone first. Add it to your home screen and it opens like any other app." },
  { q: "Do my workers cost extra?", a: "No. Each worker gets their own login and only sees what you let them. It's covered by your one subscription." },
  { q: "What if I get stuck?", a: "Use Help & support in the app or email support@wyndos.io. You'll get a reply from the person who builds it, usually within a working day." },
  { q: "Can I cancel?", a: "Any time, from the Billing page. Download a backup of your data first if you want to keep a copy." },
];

export default function SignInPage() {
  const intro = introOfferOpen();
  const price = intro ? INTRO_LABEL : STANDARD_LABEL;
  // Google sign-in is switched off for now (email and password only).
  const googleEnabled = false;

  return (
    <div className="landing min-h-screen bg-[#F4F1EA] text-[#15181E]">
      {/* Top bar (dark so the logo reads) */}
      <header className="sticky top-0 z-30 bg-[#11151D]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <WyndosLogo variant="horizontal" pinHeight={30} />
          <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-2">
            <a href="#why" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white md:block">How it works</a>
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white md:block">Features</a>
            <a href="#pricing" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white sm:block">Price</a>
            <a href="#sign-in" className="rounded-lg px-3 py-2 text-slate-300 hover:text-white">Sign in</a>
            <Link href="/auth/signup" className="rounded-lg bg-[#3D8EF5] px-3 py-2 text-[#0B1220] hover:bg-[#62A4F7] sm:px-4">Try it free</Link>
          </nav>
        </div>
      </header>

      {/* Hero + sign in */}
      <section className="border-b border-[#E2DCCF]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-20">
          <div className="space-y-6">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#5B6271]">Round software for window cleaners</p>
            <h1 className="text-4xl font-bold leading-[1.1] sm:text-[3.4rem]">
              Book the street,{" "}
              <span className="bg-[linear-gradient(transparent_62%,#F5CF4A_62%)] px-0.5">not every house.</span>
            </h1>
            <p className="max-w-xl text-lg leading-8 text-[#444B58]">
              Put your customers into areas, drop an area onto a day, and work through it on your phone.
              Mark them done and paid as you go. When the day&apos;s finished, the next visits book themselves.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/auth/signup" className="rounded-xl bg-[#1F5FCC] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#184FAD]">
                Start a 15-day free trial
              </Link>
              <span className="text-sm text-[#5B6271]">No card needed. Then {price} a month, workers included.</span>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-[#2C323D]">
              {["Import your spreadsheet", "Works on any phone", "No charge per worker", "Cancel any time"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><Check size={15} className="text-[#1F5FCC]" />{t}</li>
              ))}
            </ul>
          </div>

          <div id="sign-in" className="scroll-mt-24 rounded-2xl bg-[#11151D] p-6 text-slate-100 shadow-[0_20px_50px_-20px_rgba(17,21,29,0.55)] sm:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white">Sign in</h2>
              <p className="mt-1 text-sm text-slate-400">
                New here? <Link href="/auth/signup" className="font-semibold text-[#62A4F7] hover:text-[#8DBCFA]">Start your free trial</Link>
              </p>
            </div>
            <SignInForm googleEnabled={googleEnabled} />
          </div>
        </div>
      </section>

      {/* Main screenshot */}
      <section className="py-14">
        <div className="mx-auto max-w-6xl px-4">
          <figure className="overflow-hidden rounded-xl border border-[#D9D2C3] bg-white shadow-[0_24px_60px_-30px_rgba(17,21,29,0.45)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SCREENS.main.src} alt={SCREENS.main.alt} width={2040} height={1275} className="h-auto w-full" />
            <figcaption className="border-t border-[#E2DCCF] px-4 py-2.5 text-sm text-[#5B6271]">{SCREENS.main.caption}</figcaption>
          </figure>
        </div>
      </section>

      {/* How it works */}
      <section id="why" className="scroll-mt-20 py-16">
        <div className="mx-auto max-w-6xl space-y-10 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold">Built around how a round actually works</h2>
            <p className="mt-3 leading-7 text-[#444B58]">
              A lot of job software treats every clean as its own appointment. That&apos;s fine for a plumber.
              On a round you do the same streets on the same cycle, so that&apos;s what Wyndos plans around.
            </p>
          </div>
          <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-t-2 border-[#15181E] pt-5">
                <Icon size={22} className="text-[#1F5FCC]" />
                <h3 className="mt-3 text-lg font-semibold">{title}</h3>
                <p className="mt-1.5 leading-7 text-[#444B58]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Phone screens */}
      <section className="bg-[#11151D] py-16 text-slate-100">
        <div className="mx-auto max-w-6xl space-y-10 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold text-white">Plan it at home. Work it from the van.</h2>
            <p className="mt-3 text-slate-400">Big buttons, the day in order, and the notes you need at each door.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {SCREENS.phones.map((s) => (
              <figure key={s.src} className="mx-auto w-full max-w-[250px]">
                <div className="overflow-hidden rounded-[1.75rem] border-[6px] border-[#262C38] bg-slate-900 shadow-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.src} alt={s.alt} width={1170} height={2532} loading="lazy" className="h-auto w-full" />
                </div>
                <figcaption className="mt-3 text-center text-sm text-slate-400">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 py-16">
        <div className="mx-auto max-w-6xl space-y-10 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold">What&apos;s in it</h2>
            <p className="mt-3 text-[#444B58]">All of this is in the one price. Use the bits you need.</p>
          </div>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCTIONS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3">
                <Icon size={20} className="mt-0.5 flex-shrink-0 text-[#1F5FCC]" />
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#444B58]">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-dashed border-[#C9C1B0] bg-[#FBF9F4] p-6">
            <h3 className="font-semibold">What it doesn&apos;t do (yet)</h3>
            <ul className="mt-3 space-y-1.5 text-sm leading-6 text-[#444B58]">
              {NOT_YET.map((t) => <li key={t}>· {t}</li>)}
            </ul>
          </div>
          <div className="grid gap-5 pt-2 md:grid-cols-2">
            {SCREENS.more.map((s) => (
              <figure key={s.src} className="overflow-hidden rounded-xl border border-[#D9D2C3] bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} width={2040} height={1275} loading="lazy" className="h-auto w-full" />
                <figcaption className="border-t border-[#E2DCCF] px-4 py-2.5 text-sm text-[#5B6271]">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Who makes it */}
      <section className="border-y border-[#E2DCCF] bg-[#FBF9F4] py-16">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold">Made by a window cleaner</h2>
            <p className="mt-3 leading-7 text-[#444B58]">
              I cleaned windows for years before I wrote software, and ran my round off spreadsheets and a diary.
              Wyndos is the app I wanted then: rain days, a customer who wasn&apos;t in, a new street picked up halfway
              through the cycle. It&apos;s new and it&apos;s small, and it gets better from what users ask for.
            </p>
          </div>
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold"><LifeBuoy size={22} className="text-[#1F5FCC]" /> Talk to the person who builds it</h2>
            <p className="mt-3 leading-7 text-[#444B58]">
              Ask from inside the app or email support@wyndos.io, with a screenshot if it helps. There&apos;s no call
              centre. I&apos;ll help you get your round in, and if you need something it doesn&apos;t do, tell me.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-md rounded-2xl border border-[#D9D2C3] bg-white p-8 text-center shadow-[0_20px_50px_-30px_rgba(17,21,29,0.35)]">
            <h2 className="text-lg font-semibold text-[#444B58]">One price. You and your workers.</h2>
            <p className="mt-3 text-5xl font-bold">{price}<span className="text-lg font-medium text-[#5B6271]"> a month</span></p>
            {intro && (
              <p className="mt-3 text-sm leading-6 text-[#444B58]">
                <span className="bg-[#F5CF4A]/60 px-1 font-semibold text-[#15181E]">Early joiner price.</span>{" "}
                Join while it&apos;s open and you keep {INTRO_LABEL} for as long as you subscribe. It goes up to {STANDARD_LABEL} for new sign-ups later.
              </p>
            )}
            <p className="mt-2 text-sm text-[#5B6271]">No charge per worker, no text credits, no contract.</p>
            <ul className="mt-6 space-y-2 text-left text-sm text-[#2C323D]">
              {[
                "As many customers, areas and worker logins as you need",
                "Planner, day sheets and routes",
                "Payments, money owed and invoices (VAT too)",
                "Customer texts from your own phone",
                "Year-end figures, backups and exports",
                "Help getting your round set up",
              ].map((t) => <li key={t} className="flex items-start gap-2"><Check size={16} className="mt-0.5 flex-shrink-0 text-[#1F5FCC]" />{t}</li>)}
            </ul>
            <Link href="/auth/signup" className="mt-7 block rounded-xl bg-[#1F5FCC] px-6 py-3.5 text-sm font-semibold text-white hover:bg-[#184FAD]">
              Start a 15-day free trial
            </Link>
            <p className="mt-3 text-xs text-[#5B6271]">No card needed to start.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-[#E2DCCF] py-16">
        <div className="mx-auto max-w-3xl space-y-6 px-4">
          <h2 className="text-3xl font-bold">Questions</h2>
          <div className="divide-y divide-[#E2DCCF] rounded-xl border border-[#E2DCCF] bg-white">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-semibold">
                  <span className="flex items-center justify-between gap-4">{f.q}<span className="text-[#8A8F99] transition group-open:rotate-45">+</span></span>
                </summary>
                <p className="mt-2 text-sm leading-6 text-[#444B58]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[#11151D] py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-slate-400">
          <span>© {new Date().getFullYear()} Wyndos</span>
          <span className="flex flex-wrap gap-4">
            <a href="mailto:support@wyndos.io" className="hover:text-white">support@wyndos.io</a>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
