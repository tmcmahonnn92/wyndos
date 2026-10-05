import Link from "next/link";
import {
  CalendarRange, Check, CloudRain, Database, FileText, Layers, LifeBuoy, MapPinned, MessageSquare,
  NotebookPen, PoundSterling, Repeat, SlidersHorizontal, Smartphone, Upload, Users, Wrench,
} from "lucide-react";
import { WyndosLogo } from "@/components/nav";
import { SignInForm } from "./sign-in-form";
import { introOfferOpen, INTRO_LABEL, STANDARD_LABEL } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wyndos | Round management for window cleaners",
  description: "Plan by area, work from your phone and keep track of who's paid. Designed by window cleaners. 15-day free trial, no card needed.",
};

// The four things that make Wyndos different.
const PILLARS = [
  {
    icon: Layers,
    title: "Plan by area, not by job",
    body: "Group your customers into areas and schedule the area. Each one stays on its own cycle, so you're never adjusting hundreds of individual jobs. Move a day and everyone on it moves with it.",
  },
  {
    icon: CalendarRange,
    title: "Simple to plan, simple to work",
    body: "Drag areas onto a weekly or monthly planner. On the day, your list is on your phone in walking order: tick it off, take payment, move on.",
  },
  {
    icon: Upload,
    title: "Up and running in an evening",
    body: "Upload the spreadsheet you already use. Wyndos sets up your areas and, if you include last-cleaned dates, puts your round straight onto the planner.",
  },
  {
    icon: SlidersHorizontal,
    title: "As simple or as detailed as you like",
    body: "Use it as a diary and nothing more, or bring in payments, invoices, a team and your accounts when you're ready. Nothing is forced on you.",
  },
];

// The everyday window-cleaning jobs it covers.
const FUNCTIONS = [
  { icon: Repeat, title: "Round scheduling", body: "Weekly, 4, 6, 8 or 12-weekly, or a set day each month. Next visits book themselves when a day is finished." },
  { icon: Smartphone, title: "Day sheets", body: "The day in order with prices, notes and what each customer owes. Done, done and paid, or skip in one tap." },
  { icon: MapPinned, title: "Routes", body: "Open the day in Google Maps, one stop per house or one per street." },
  { icon: NotebookPen, title: "Customer notes", body: "Gate codes, side access, poles or ladders: shown on the day sheet where you need them." },
  { icon: PoundSterling, title: "Payments and arrears", body: "Cash, bank transfer, card or anything else. See who owes what and for how long." },
  { icon: FileText, title: "Invoices", body: "PDF invoices with your logo, terms and bank details. VAT invoices if you're registered." },
  { icon: MessageSquare, title: "Customer texts", body: "Reminders, cleaned-and-how-to-pay and polite chasers, filled in for each customer, sent from your phone." },
  { icon: CloudRain, title: "Rain days and changes", body: "Move a day, split an area over two days, skip a house or add a one-off without breaking the cycle." },
  { icon: Users, title: "Workers", body: "Give staff their own login, choose what they can see, and hand them days or single jobs." },
  { icon: Wrench, title: "Quotes and one-offs", body: "Gutters, conservatories, fascias: quote, book and invoice extra work alongside the round." },
  { icon: Database, title: "Accounts", body: "Income, expenses and profit for the UK tax year, ready for your self-assessment." },
  { icon: Check, title: "Backups and exports", body: "Download a full backup any time, and export customers, jobs and money to a spreadsheet." },
];

const SCREENS = {
  main: { src: "/screens/scheduler.jpg", alt: "The weekly planner with areas booked onto days", caption: "The weekly planner: areas on days, colour-coded by how due they are" },
  phones: [
    { src: "/screens/day-phone.jpg", alt: "A day's work on a phone", caption: "The day, in walking order" },
    { src: "/screens/customer-phone.jpg", alt: "A customer's balance, next visit and history on a phone", caption: "Each customer at a glance" },
    { src: "/screens/texts-phone.jpg", alt: "Choosing customers to text on a phone", caption: "Texts in a few taps" },
  ],
  more: [
    { src: "/screens/dashboard.jpg", alt: "The dashboard", caption: "Today's work, money owed and the year ahead" },
    { src: "/screens/customers.jpg", alt: "The customer list", caption: "Every customer, area and price" },
  ],
};

const FAQ = [
  { q: "Do I need a card for the free trial?", a: "No. You get 15 days with everything switched on. If you subscribe during the trial, the first payment is taken when the trial ends." },
  { q: "How long does it take to set up?", a: "Most people are planning their first week the same evening. Upload your customer spreadsheet, check the columns line up, and your areas are made for you." },
  { q: "I only want a diary for my round. Is it overkill?", a: "Not at all. Payments, invoices, texts, team and accounts are all optional. Use the planner and day sheets on their own if that's all you need." },
  { q: "Does it work on my phone?", a: "Yes. It's built for the phone first and can be added to your home screen like an app." },
  { q: "Can my workers use it?", a: "Yes, at no extra cost. Each person gets their own login and only sees what you allow." },
  { q: "What if I get stuck?", a: "Use Help & support inside the app or email support@wyndos.io. You'll hear back from the people who build it, usually within a working day." },
  { q: "Can I cancel?", a: "Any time, from the Billing page. Download a full backup of your data first if you'd like a copy." },
];

export default function SignInPage() {
  const intro = introOfferOpen();
  const price = intro ? INTRO_LABEL : STANDARD_LABEL;
  // Google sign-in is switched off for now (email and password only).
  const googleEnabled = false;

  return (
    <div className="landing min-h-screen bg-slate-950 text-slate-100">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <WyndosLogo variant="horizontal" pinHeight={30} />
          <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-2">
            <a href="#why" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white md:block">Why Wyndos</a>
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white md:block">Features</a>
            <a href="#pricing" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white sm:block">Pricing</a>
            <a href="#sign-in" className="rounded-lg px-3 py-2 text-slate-300 hover:text-white">Sign in</a>
            <Link href="/auth/signup" className="rounded-lg bg-blue-600 px-3 py-2 text-white hover:bg-blue-500 sm:px-4">Free trial</Link>
          </nav>
        </div>
      </header>

      {/* Hero + sign in */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.28),transparent_55%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-20">
          <div className="space-y-6">
            <p className="text-sm font-semibold text-blue-400">Designed by window cleaners</p>
            <h1 className="text-4xl font-bold leading-tight text-white sm:text-5xl">
              Round management for window cleaners
            </h1>
            <p className="max-w-xl text-lg leading-8 text-slate-300">
              Plan your work by area so every customer stays on schedule, run the day from your phone,
              and always know who&apos;s paid. Simple to start with, and there&apos;s more when you need it.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/auth/signup" className="rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-500">
                Start a 15-day free trial
              </Link>
              <span className="text-sm text-slate-400">No card needed. {price} a month after{intro ? ", locked in for life" : ""}.</span>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-300">
              {["Set up in an evening", "Works on any phone", "Unlimited customers and staff", "Support from real people"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><Check size={15} className="text-emerald-400" />{t}</li>
              ))}
            </ul>
          </div>

          <div id="sign-in" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white">Sign in</h2>
              <p className="mt-1 text-sm text-slate-400">
                New to Wyndos? <Link href="/auth/signup" className="font-semibold text-blue-400 hover:text-blue-300">Start your free trial</Link>
              </p>
            </div>
            <SignInForm googleEnabled={googleEnabled} />
          </div>
        </div>
      </section>

      {/* Main screenshot */}
      <section className="border-t border-slate-900 bg-slate-900/40 py-14">
        <div className="mx-auto max-w-6xl px-4">
          <figure className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SCREENS.main.src} alt={SCREENS.main.alt} width={2040} height={1275} className="h-auto w-full" />
            <figcaption className="border-t border-slate-800 px-4 py-2.5 text-sm text-slate-400">{SCREENS.main.caption}</figcaption>
          </figure>
        </div>
      </section>

      {/* Why Wyndos */}
      <section id="why" className="scroll-mt-20 py-16">
        <div className="mx-auto max-w-6xl space-y-10 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold text-white">Why window cleaners choose Wyndos</h2>
            <p className="mt-3 text-slate-400">
              Most round software is built around single jobs. Wyndos is built around areas, the way a round is actually worked.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600/15 text-blue-400"><Icon size={22} /></span>
                <div>
                  <h3 className="text-lg font-semibold text-white">{title}</h3>
                  <p className="mt-1.5 leading-7 text-slate-400">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Phone screens */}
      <section className="border-t border-slate-900 bg-slate-900/40 py-16">
        <div className="mx-auto max-w-6xl space-y-10 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-bold text-white">Plan at home, work from your phone</h2>
            <p className="mt-3 text-slate-400">Everything you need on the round, without hunting through menus.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {SCREENS.phones.map((s) => (
              <figure key={s.src} className="mx-auto w-full max-w-[250px]">
                <div className="overflow-hidden rounded-[1.75rem] border-[6px] border-slate-800 bg-slate-900 shadow-xl">
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
            <h2 className="text-3xl font-bold text-white">Everything the round needs</h2>
            <p className="mt-3 text-slate-400">All included in one price. Use the parts you need.</p>
          </div>
          <div className="grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {FUNCTIONS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3">
                <Icon size={20} className="mt-0.5 flex-shrink-0 text-blue-400" />
                <div>
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-5 pt-4 md:grid-cols-2">
            {SCREENS.more.map((s) => (
              <figure key={s.src} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} width={2040} height={1275} loading="lazy" className="h-auto w-full" />
                <figcaption className="border-t border-slate-800 px-4 py-2.5 text-sm text-slate-400">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Built by window cleaners + support */}
      <section className="border-t border-slate-900 bg-slate-900/40 py-16">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-7">
            <h2 className="text-2xl font-bold text-white">Designed by window cleaners</h2>
            <p className="mt-3 leading-7 text-slate-400">
              Wyndos was built by people who work a round, for how a week really goes: rain days, a customer who wasn&apos;t in,
              a new street picked up mid-cycle. It does the everyday things quickly and stays out of your way.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-7">
            <h2 className="flex items-center gap-2 text-2xl font-bold text-white"><LifeBuoy size={22} className="text-blue-400" /> Help when you need it</h2>
            <p className="mt-3 leading-7 text-slate-400">
              Ask from inside the app or email support@wyndos.io, with screenshots if it helps. You&apos;ll get a reply from the
              people who build Wyndos, and we&apos;ll help you get your round set up. Suggestions are welcome and regularly make it in.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-300">One price, everything included</h2>
            <p className="mt-3 text-5xl font-bold text-white">{price}<span className="text-lg font-medium text-slate-400"> / month</span></p>
            {intro && <p className="mt-2 text-sm font-semibold text-emerald-400">Early joiner price, yours for life. It goes up to {STANDARD_LABEL} for new sign-ups later.</p>}
            <p className="mt-2 text-sm text-slate-400">No add-ons, no per-user charges, no contract.</p>
            <ul className="mt-6 space-y-2 text-left text-sm text-slate-300">
              {[
                "Unlimited customers, areas and staff logins",
                "Planner, day sheets and routes",
                "Payments, arrears and invoices (including VAT)",
                "Customer texts from your own phone",
                "Accounts, backups and exports",
                "Email support and help getting set up",
              ].map((t) => <li key={t} className="flex items-start gap-2"><Check size={16} className="mt-0.5 flex-shrink-0 text-emerald-400" />{t}</li>)}
            </ul>
            <Link href="/auth/signup" className="mt-7 block rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-500">
              Start a 15-day free trial
            </Link>
            <p className="mt-3 text-xs text-slate-500">No card needed to start. Cancel any time.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-slate-900 py-16">
        <div className="mx-auto max-w-3xl space-y-6 px-4">
          <h2 className="text-3xl font-bold text-white">Common questions</h2>
          <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/60">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-semibold text-white">
                  <span className="flex items-center justify-between gap-4">{f.q}<span className="text-slate-500 transition group-open:rotate-45">+</span></span>
                </summary>
                <p className="mt-2 text-sm leading-6 text-slate-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-900 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} Wyndos</span>
          <span className="flex flex-wrap gap-4">
            <a href="mailto:support@wyndos.io" className="hover:text-slate-300">support@wyndos.io</a>
            <Link href="/privacy" className="hover:text-slate-300">Privacy</Link>
            <Link href="/terms" className="hover:text-slate-300">Terms</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
