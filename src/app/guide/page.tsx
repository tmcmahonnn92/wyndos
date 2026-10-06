import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/auth";

export const metadata = {
  title: "Getting started | Wyndos",
  description: "Set up Wyndos step by step: your business, areas, importing customers, planning, working a day, texts, workers and payments.",
};

/*
 * Getting started guide. Screenshots come from a made-up demo business:
 * scripts/seed-guide-demo.ts → scripts/guide-screenshots.mjs → scripts/guide-compress.py
 * (they land in public/screens/guide/). Re-run those when the screens change.
 */

const IMG = "/screens/guide";

const STEPS = [
  { id: "business", title: "Your business details" },
  { id: "areas", title: "Make your areas" },
  { id: "import", title: "Bring in your customers" },
  { id: "plan", title: "Plan your round" },
  { id: "day", title: "Work a day" },
  { id: "texts", title: "Text your customers" },
  { id: "workers", title: "Add your workers" },
  { id: "payments", title: "Keep track of money" },
  { id: "dashboard", title: "Your dashboard" },
  { id: "help", title: "Help and the app" },
];

function Shot({ src, alt, caption, phone = false }: { src: string; alt: string; caption?: string; phone?: boolean }) {
  return (
    <figure className={phone ? "mx-auto w-full max-w-[280px]" : "w-full"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`${IMG}/${src}.webp`}
        alt={alt}
        loading="lazy"
        width={phone ? 600 : 1280}
        height={phone ? 1299 : 800}
        className={phone
          ? "h-auto w-full rounded-[1.6rem] border-[6px] border-slate-900 bg-slate-900 shadow-lg"
          : "h-auto w-full rounded-xl border border-slate-200 shadow-md"}
      />
      {caption && <figcaption className="mt-2 text-center text-xs text-slate-500">{caption}</figcaption>}
    </figure>
  );
}

function Step({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-4 border-t border-slate-200 pt-10 print:break-before-page">
      <h2 className="flex items-center gap-3 text-xl font-bold text-slate-900 sm:text-2xl">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">{n}</span>
        {title}
      </h2>
      <div className="space-y-4 text-[15px] leading-7 text-slate-700 [&_strong]:text-slate-900 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong className="text-amber-900">Tip:</strong> {children}</p>;
}

/** Two pictures side by side on a computer, one under the other on a phone. */
function Pair({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-6 sm:grid-cols-2">{children}</div>;
}

export default async function GuidePage() {
  const session = await auth().catch(() => null);
  const signedIn = Boolean(session?.user);

  return (
    <div className={signedIn ? "bg-slate-50 px-4 py-6" : "min-h-screen bg-slate-50 px-4 py-10"}>
      <article className="mx-auto max-w-3xl space-y-10">
        <header className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-600">Wyndos</p>
          <h1 className="text-3xl font-black leading-tight text-slate-900 sm:text-4xl">Getting started</h1>
          <p className="text-[15px] leading-7 text-slate-700">
            This guide takes you from a new account to a working round. Most people get through it in an evening.
            The pictures use a made-up business, Brightside Window Cleaning, so yours will look a little different.
          </p>
          <div className="rounded-2xl border border-blue-100 bg-white p-4 text-[15px] leading-7 text-slate-700 shadow-sm">
            <p className="font-semibold text-slate-900">How Wyndos works, in one line</p>
            <p>
              Customers live in <strong>areas</strong>. You put an area on a <strong>day</strong>, work through it on your phone,
              and when the day is finished each customer&apos;s next visit books itself.
            </p>
          </div>
          <nav aria-label="Steps" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
            <p className="mb-2 text-sm font-semibold text-slate-900">Steps</p>
            <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-blue-700 hover:underline">{i + 1}. {s.title}</a>
                </li>
              ))}
            </ol>
          </nav>
        </header>

        <Step n={1} id="business" title="Your business details">
          <p>
            Go to <strong>Settings → Business</strong>. Add your business name, phone, email and address.
            Further down, add your <strong>bank details</strong>: they go on invoices and on the &quot;how to pay&quot; text
            customers get after a clean.
          </p>
          <Shot src="d-business" alt="Settings, Business tab, with name, phone, email and address filled in" />
          <p>You can add your logo here too. It shows on invoices.</p>
        </Step>

        <Step n={2} id="areas" title="Make your areas">
          <p>
            An area is a group of customers you clean on the same day, like a street, an estate or a village.
            Each area has its own cycle (every 4 weeks, 8 weeks and so on). When you book an area onto a day,
            everyone in it comes with it.
          </p>
          <ol>
            <li>Go to <strong>Areas</strong> and press <strong>Add Area</strong>.</li>
            <li>Give it a name and a colour. The colour is how you&apos;ll spot it on the planner.</li>
            <li>Choose how often it&apos;s cleaned, e.g. <strong>4w</strong> for every 4 weeks.</li>
            <li>Press <strong>Create Area</strong>.</li>
          </ol>
          <Pair>
            <Shot src="d-areas" alt="The Areas page listing five areas with colours, frequency, customers and value" caption="Your areas, with when each is next due" />
            <Shot src="d-area-add" alt="The Add New Area box with name, colour, frequency and next due date" caption="Adding an area" />
          </Pair>
          <Tip>Don&apos;t want to make areas by hand? Put an area name in a column of your spreadsheet and the import will make them for you (next step).</Tip>
        </Step>

        <Step n={3} id="import" title="Bring in your customers">
          <p>If your customers are in a spreadsheet (Excel or CSV), you can bring them all in at once.</p>
          <ol>
            <li>Go to <strong>Customers → Import</strong> and upload your file. Your columns can be in any order.</li>
            <li>Check each Wyndos field is matched to the right column. Wyndos guesses most of them for you.</li>
            <li>Tick <strong>Create new areas automatically</strong> if your file has area names that aren&apos;t in Wyndos yet.</li>
            <li>
              Leave <strong>Put areas on the schedule from these dates</strong> ticked if you have a &quot;last cleaned&quot; column.
              Your round then lands on the planner already due.
            </li>
            <li>Press <strong>Preview</strong>, pick a colour and frequency for any new areas, then press <strong>Import</strong>.</li>
          </ol>
          <Shot src="d-import-map" alt="Import, step 2: matching spreadsheet columns to Wyndos fields" caption="Matching your columns" />
          <Shot src="d-import-preview" alt="Import, step 3: preview showing two new areas and all rows OK" caption="The preview: new areas and every row checked before anything is saved" />
          <p>
            Moving from CleanerPlanner? Use <strong>Moving from CleanerPlanner</strong> at the top of the import page and upload
            your CleanerPlanner backup. Customers, rounds, due dates and balances all come across.
          </p>
          <p>Your customers then appear under <strong>Customers</strong>. Tap anyone to see their details, history and what they owe.</p>
          <Shot src="d-customers" alt="The Customers list with names, addresses, area, due date and price" />
          <Tip>Adding one customer? Press <strong>Add Customer</strong> on the Customers page, or the blue + button on your phone.</Tip>
        </Step>

        <Step n={4} id="plan" title="Plan your round">
          <p>
            Open the <strong>Scheduler</strong>. Areas waiting to be booked sit along the top. <strong>Drag an area onto a day</strong>
            to book it. Everyone in that area who&apos;s due goes onto that day.
          </p>
          <Shot src="d-scheduler-month" alt="The Scheduler month view with areas booked on days and one area waiting at the top" caption="Month view: drag the area at the top onto a day" />
          <ul>
            <li>Switch between <strong>Week</strong> and <strong>Month</strong> at the top.</li>
            <li>Need to move a day? Drag it to another date.</li>
            <li>Off on holiday? Add it under <strong>Holidays</strong> and Wyndos warns you about anything booked then.</li>
            <li>While you drag, each day lights up to show how due the area would be: green is on time, through amber and orange, to red for two weeks or more overdue.</li>
          </ul>
          <Shot src="d-scheduler-week" alt="The Scheduler week view with three areas booked" caption="Week view" />
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <p>
              <strong>On your phone</strong> the Scheduler is a simpler calendar for quick changes on the go. Tap a day to see
              what&apos;s on, move a run, change who&apos;s doing it, or book an area. Drag and drop works best on a computer or tablet.
            </p>
            <Shot phone src="p-scheduler" alt="The phone Scheduler: a month calendar with coloured bars and the runs for the chosen day" />
          </div>
        </Step>

        <Step n={5} id="day" title="Work a day">
          <p>
            On the day, open <strong>Schedule</strong> on your phone and tap today. You&apos;ll see everyone in route order,
            with their price, notes (gate codes, dogs and so on) and how they usually pay.
          </p>
          <Pair>
            <Shot phone src="p-day" alt="A day on the phone: progress, cash to collect and a list of customers with Done and Done & Paid buttons" caption="The day, in order" />
            <Shot phone src="p-done-paid" alt="Done & Paid opened: price this time, what they paid, and Cash, Card or Bank" caption="Done & Paid: check the amount and how they paid" />
          </Pair>
          <ul>
            <li>Press <strong>Start Area</strong> when you begin.</li>
            <li>Press <strong>Done</strong> when a house is cleaned, or <strong>Done &amp; Paid</strong> if they paid you there and then.</li>
            <li>
              With Done &amp; Paid you can change <strong>Price this time</strong> (front only, say) and <strong>They paid</strong>
              (if they gave you £10 for an £8 clean, the extra is kept as credit for next time).
            </li>
            <li>The arrow button opens the route in Google Maps. <strong>By street</strong> groups houses by street.</li>
            <li>
              Press <strong>Complete Day</strong> at the end. Anyone you didn&apos;t get to can be skipped or moved,
              and everyone&apos;s next visit is booked automatically.
            </li>
          </ul>
          <Tip>Rained off? On the day, press <strong>More → Rained off</strong> to move the whole day in one go.</Tip>
          <p>
            No signal? Keep going. Wyndos saves what you tap on the phone and sends it when you&apos;re back online.
          </p>
        </Step>

        <Step n={6} id="texts" title="Text your customers">
          <p>
            Texts go from <strong>your own phone</strong>, so there are no text credits to buy. Wyndos fills in each message
            (name, date, amount owed) and opens it in your Messages app. You press Send, come back, and the next one is ready.
          </p>
          <ul>
            <li><strong>Before a run:</strong> on the day, press <strong>More → Text reminders</strong>, check the message and who it goes to.</li>
            <li><strong>After a run:</strong> on a finished day, <strong>Text everyone</strong> sends a &quot;we&apos;ve been&quot; text with how to pay.</li>
            <li>
              <strong>Anything else:</strong> the <strong>Texts</strong> page. Pick what you&apos;re sending (cleans coming up,
              chasing payment, or a message to anyone), who to, the message, then <strong>Start sending from my phone</strong>.
            </li>
          </ul>
          <Shot src="d-reminders" alt="The Text reminders box with the message, a preview for one customer and the list of customers ticked" caption="Text reminders for a day" />
          <Shot src="d-texts" alt="The Texts page: what you're sending, who to, and the message" caption="The Texts page" />
          <Tip>On a computer? Wyndos shows a code. Point your phone&apos;s camera at it and the same texts open on your phone, ready to send.</Tip>
        </Step>

        <Step n={7} id="workers" title="Add your workers">
          <p>Workers are included in the price. Each gets their own login and only sees what you allow.</p>
          <ol>
            <li>Go to <strong>Settings → Team</strong>.</li>
            <li>Enter their email and choose a role: <strong>Worker</strong> (works their own days and takes payment), <strong>Senior worker</strong> (also sees customers and can plan), or <strong>Office / admin</strong>.</li>
            <li>Press <strong>Send Invite</strong>. They get a link to set their password.</li>
          </ol>
          <Shot src="d-team" alt="Settings, Team: invite a worker by email and pick a role; team members listed below" />
          <p>
            To give someone a day, open the day and tap the bar under the buttons (it says who&apos;s doing it). Choose them under
            <strong> Day</strong>. Use <strong>Assign / move jobs</strong> to give them just a few houses. You can also pick a worker when
            booking from the phone Scheduler.
          </p>
          <Shot src="d-assign" alt="A day with the worker bar open: Day set to Jamie Brooks, with Print, Share, Assign / move jobs, Take back day and Rained off" caption="Choosing who does the day" />
          <p>Your worker sees their own days on their phone, and nothing else unless you allow it.</p>
          <Pair>
            <Shot phone src="p-worker" alt="A worker's dashboard on the phone: their work this month, coming up and cash to hand over" caption="A worker's dashboard" />
            <Shot phone src="p-worker-day" alt="A worker's day on the phone, the same Done and Done & Paid list" caption="Their day" />
          </Pair>
          <Tip>Cash your workers collect is tracked. They hand it over to you under <strong>Payments → Cash</strong>, so you always know who&apos;s holding what.</Tip>
        </Step>

        <Step n={8} id="payments" title="Keep track of money">
          <p>
            <strong>Payments</strong> shows who owes you, for which cleans, and for how long. From here you can
            <strong> Log payment</strong>, send a <strong>Remind</strong> text, or add <strong>credit</strong> for someone who&apos;s paid in advance.
          </p>
          <Shot src="d-payments" alt="Payments: totals owed, late, taken this month and credit; then each customer who owes" />
          <ul>
            <li>Paid by bank transfer? Use <strong>Bank statement</strong> to match payments from your bank&apos;s download. The file is read on your device and never stored.</li>
            <li><strong>Accounting</strong> adds up income and expenses for the tax year, ready for your self-assessment.</li>
          </ul>
        </Step>

        <Step n={9} id="dashboard" title="Your dashboard">
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <p>
                The <strong>Dashboard</strong> is your start point each morning: today&apos;s round, a short <strong>To do</strong> list
                (reminders to send, people to chase, areas overdue) and what you&apos;re owed.
              </p>
              <p>Each to-do has a button that takes you straight to the job.</p>
            </div>
            <Shot phone src="p-dashboard" alt="The dashboard on a phone: today's round, to-do list, round value and money owed" />
          </div>
        </Step>

        <Step n={10} id="help" title="Help and the app">
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <p>
                On your phone, the blue <strong>+</strong> button opens quick actions (new customer, one-off job, quote), the rest of
                the menu, and your account: <strong>Help</strong>, <strong>Install app</strong>, dark mode and sign out.
              </p>
              <p>
                <strong>Install app</strong> puts Wyndos on your home screen so it opens like any other app. On an iPhone:
                open Wyndos in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
              </p>
              <p>
                Stuck? Use <strong>Help</strong> in the app or email{" "}
                <a href="mailto:support@wyndos.io" className="font-semibold text-blue-700 underline">support@wyndos.io</a>.
                You&apos;ll hear back from the person who builds Wyndos, usually within a working day.
              </p>
            </div>
            <Shot phone src="p-menu" alt="The phone + menu: quick add, more pages and account options" />
          </div>
        </Step>

        <footer className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500 print:hidden">
          {signedIn ? (
            <Link href="/" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Go to your dashboard</Link>
          ) : (
            <Link href="/auth/signup" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Start a free trial</Link>
          )}
          <Link href="/support" className="hover:text-slate-800">Help &amp; support</Link>
          <span>Print this guide or save it as a PDF from your browser&apos;s print menu.</span>
        </footer>
      </article>
    </div>
  );
}
