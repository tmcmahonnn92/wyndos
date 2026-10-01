import Link from "next/link";
import {
  CalendarRange, Check, ClipboardList, CloudRain, FileText, MapPinned, MessageSquare,
  PoundSterling, ShieldCheck, Smartphone, Upload, Users,
} from "lucide-react";
import { WyndosLogo } from "@/components/nav";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Wyndos | Round planner for window cleaners",
  description: "Plan your rounds, run your days from your phone, and keep on top of who's paid. £9.99 a month, 15-day free trial, no card needed.",
};

const FEATURES = [
  { icon: CalendarRange, title: "A schedule that keeps itself", body: "Drag areas onto days. Finish a day and the next visit books itself at the right frequency, so nobody slips through the cracks." },
  { icon: Smartphone, title: "Run the day from your phone", body: "Your list in walking order, one tap to mark done or done-and-paid, notes for every house, and a route in Google Maps." },
  { icon: Users, title: "Customers and areas", body: "Every address, price and note in one place. Import your existing spreadsheet in minutes; areas are set up for you." },
  { icon: PoundSterling, title: "Know who owes what", body: "Record payments however your customers pay. See balances, how long things have been owed, and chase in a couple of taps." },
  { icon: MessageSquare, title: "Texts from your own phone", body: "Day-before reminders, cleaned-and-how-to-pay messages and polite chasers, filled in for each customer and sent from your phone." },
  { icon: FileText, title: "Invoices in a click", body: "Professional PDF invoices with your logo, payment terms and bank details. VAT invoices too, if you're registered." },
  { icon: ClipboardList, title: "Accounts made simple", body: "Income, expenses and profit for the UK tax year, with a starting figure if you join part-way through the year." },
  { icon: CloudRain, title: "Built for real weeks", body: "Rained off? Move the day. Split an area across days, skip a house, add a one-off, and the cycle still adds up." },
  { icon: ShieldCheck, title: "Your data, your control", body: "Team logins with the right access for each person, and a full backup you can download and restore whenever you like." },
];

const SCREENS = [
  { src: "/screens/scheduler.jpg", alt: "The scheduler: areas dragged onto days across the month", caption: "Plan the month at a glance" },
  { src: "/screens/dashboard.jpg", alt: "The dashboard: today's round, money owed and the year ahead", caption: "Today, what's owed, and the year ahead" },
  { src: "/screens/customers.jpg", alt: "The customer list with areas and prices", caption: "Every customer in one place" },
];
const PHONE_SCREENS = [
  { src: "/screens/day-phone.jpg", alt: "A day's work on a phone", caption: "Your day, in walking order" },
  { src: "/screens/customer-phone.jpg", alt: "A customer on a phone: balance, next visit and history", caption: "Every customer, what they owe" },
  { src: "/screens/texts-phone.jpg", alt: "Sending texts on a phone", caption: "Texts in a few taps" },
];

const FAQ = [
  { q: "Do I need a card to try it?", a: "No. You get 15 days free with everything switched on. Subscribe whenever you're ready; if you subscribe during the trial, you won't be charged until it ends." },
  { q: "Can I bring my customers across?", a: "Yes. Upload your existing spreadsheet (Excel or CSV) and Wyndos matches up the columns, creates your areas and, if you include last-cleaned dates, puts your rounds straight on the schedule." },
  { q: "Does it work on my phone?", a: "Yes, it's made for the phone first. Add it to your home screen and it works like an app, including on poor signal." },
  { q: "What about my team?", a: "Invite as many people as you need at no extra cost. Choose what each person can see, give them work, and they get their days on their own phone." },
  { q: "Can I cancel?", a: "Any time, in a couple of clicks. You can download a full backup of your data whenever you like." },
];

export default function SignInPage() {
  // Google sign-in is switched off for now (email and password only).
  const googleEnabled = false;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <WyndosLogo variant="horizontal" pinHeight={30} />
          <nav className="flex items-center gap-1 text-sm font-semibold sm:gap-3">
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white sm:block">Features</a>
            <a href="#pricing" className="hidden rounded-lg px-3 py-2 text-slate-300 hover:text-white sm:block">Pricing</a>
            <a href="#sign-in" className="rounded-lg px-3 py-2 text-slate-300 hover:text-white">Sign in</a>
            <Link href="/auth/signup" className="rounded-xl bg-blue-600 px-3 py-2 text-white hover:bg-blue-500 sm:px-4">Start free trial</Link>
          </nav>
        </div>
      </header>

      {/* Hero + sign in */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,99,235,0.35),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(14,165,233,0.18),transparent_50%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.15fr_0.85fr] md:items-center md:py-20">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">Round planner for window cleaners</p>
            <h1 className="text-4xl font-black leading-[1.05] text-white sm:text-5xl">
              Plan your rounds. Run your day. Get paid.
            </h1>
            <p className="max-w-xl text-base leading-7 text-slate-300">
              Wyndos keeps every customer on cycle, puts the day in your pocket, and shows exactly who owes what.
              Less paperwork in the van, more time on the ladders.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/auth/signup" className="rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-900/40 hover:bg-blue-500">
                Start your 15-day free trial
              </Link>
              <span className="text-sm text-slate-400">No card needed · then £9.99/month</span>
            </div>
            <ul className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              {["Everything included, one price", "Unlimited customers and team", "Works on any phone", "Import your spreadsheet"].map((t) => (
                <li key={t} className="flex items-center gap-2"><Check size={15} className="text-emerald-400" />{t}</li>
              ))}
            </ul>
          </div>

          <div id="sign-in" className="scroll-mt-24 rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl sm:p-8">
            <div className="mb-5">
              <h2 className="text-2xl font-bold text-white">Sign in</h2>
              <p className="mt-1 text-sm text-slate-400">
                New to Wyndos? <Link href="/auth/signup" className="font-semibold text-blue-400 hover:text-blue-300">Start a free trial</Link>
              </p>
            </div>
            <SignInForm googleEnabled={googleEnabled} />
          </div>
        </div>
      </section>

      {/* Screenshots */}
      <section className="border-t border-slate-900 bg-slate-900/40 py-14">
        <div className="mx-auto max-w-6xl space-y-8 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-black text-white">See it in action</h2>
            <p className="mt-2 text-slate-400">The planning on a bigger screen at home, the doing on your phone in the street.</p>
          </div>
          <figure className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SCREENS[0].src} alt={SCREENS[0].alt} width={2040} height={1275} className="h-auto w-full" />
            <figcaption className="border-t border-slate-800 px-4 py-2.5 text-sm text-slate-400">{SCREENS[0].caption}</figcaption>
          </figure>
          <div className="grid gap-6 sm:grid-cols-3">
            {PHONE_SCREENS.map((s) => (
              <figure key={s.src} className="mx-auto w-full max-w-[260px]">
                <div className="overflow-hidden rounded-[2rem] border-[6px] border-slate-800 bg-slate-900 shadow-xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.src} alt={s.alt} width={1170} height={2532} loading="lazy" className="h-auto w-full" />
                </div>
                <figcaption className="mt-2 text-center text-sm text-slate-400">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {SCREENS.slice(1).map((s) => (
              <figure key={s.src} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} width={2040} height={1275} loading="lazy" className="h-auto w-full" />
                <figcaption className="border-t border-slate-800 px-4 py-2.5 text-sm text-slate-400">{s.caption}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 py-14">
        <div className="mx-auto max-w-6xl space-y-8 px-4">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-black text-white">Everything a round needs</h2>
            <p className="mt-2 text-slate-400">Made with window cleaners, for how a week actually goes.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/15 text-blue-400"><Icon size={20} /></span>
                <h3 className="mt-3 text-base font-bold text-white">{title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-400">
            <span className="flex items-center gap-2"><Upload size={14} className="text-blue-400" /> Spreadsheet import</span>
            <span className="flex items-center gap-2"><MapPinned size={14} className="text-blue-400" /> Google Maps routes</span>
            <span className="flex items-center gap-2"><Smartphone size={14} className="text-blue-400" /> Add to home screen</span>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-t border-slate-900 bg-slate-900/40 py-14">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mx-auto max-w-md rounded-3xl border border-blue-500/40 bg-slate-900 p-8 text-center shadow-2xl shadow-blue-950/50">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-400">One simple price</p>
            <p className="mt-4 text-5xl font-black text-white">£9.99<span className="text-lg font-semibold text-slate-400"> / month</span></p>
            <p className="mt-2 text-sm text-slate-400">Everything included. No add-ons, no per-user fees.</p>
            <ul className="mt-6 space-y-2 text-left text-sm text-slate-300">
              {[
                "Unlimited customers, areas and team logins",
                "Scheduler, day sheets and routes",
                "Payments, balances and invoices (VAT too)",
                "Customer texts from your own phone",
                "Accounts, backups and exports",
                "Help by email from real people",
              ].map((t) => <li key={t} className="flex items-start gap-2"><Check size={16} className="mt-0.5 flex-shrink-0 text-emerald-400" />{t}</li>)}
            </ul>
            <Link href="/auth/signup" className="mt-7 block rounded-2xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white hover:bg-blue-500">
              Start your 15-day free trial
            </Link>
            <p className="mt-3 text-xs text-slate-500">No card needed to start. Cancel any time.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-14">
        <div className="mx-auto max-w-3xl space-y-6 px-4">
          <h2 className="text-3xl font-black text-white">Questions</h2>
          <div className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/60">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="cursor-pointer list-none font-semibold text-white marker:hidden">
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
