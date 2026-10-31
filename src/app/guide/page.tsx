import Link from "next/link";
import type { ReactNode } from "react";
import { auth } from "@/auth";

export const metadata = {
  title: "Getting started | Wyndos",
  description: "Set up Wyndos step by step: your business, areas, importing customers, planning, working a day, texts, workers, payments and Direct Debit.",
};

/*
 * Getting started guide. Screenshots come from a made-up demo business:
 * scripts/seed-guide-demo.ts → scripts/guide-screenshots.mjs → scripts/guide-compress.py
 * (they land in public/screens/guide/). Re-run those when the screens change.
 * Also scripts/guide-day-order-shots.mjs, and scripts/seed-guide-dd.ts → scripts/guide-extra-shots.mjs
 * (Direct Debit, money buttons, no signal).
 */

const IMG = "/screens/guide";

const STEPS = [
  { id: "business", title: "Your business details" },
  { id: "areas", title: "Make your areas" },
  { id: "import", title: "Bring in your customers" },
  { id: "plan", title: "Plan your round" },
  { id: "day", title: "Work a day" },
  { id: "order", title: "Set the order of your day" },
  { id: "texts", title: "Text your customers" },
  { id: "workers", title: "Add your workers" },
  { id: "payments", title: "Keep track of money" },
  { id: "direct-debit", title: "Direct Debit (GoCardless)" },
  { id: "quotes", title: "Quotes and the price calculator" },
  { id: "extras", title: "Extra jobs for next time" },
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
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm print:hidden">
            <p className="mb-2 text-sm font-semibold text-emerald-900">New in Wyndos</p>
            <ul className="space-y-1.5 text-sm text-emerald-950">
              <li><a href="#quotes" className="font-semibold underline">Price calculator</a>: price a house, a detailed job or commercial work in seconds, with how long it takes. Set your own prices.</li>
              <li><a href="#extras" className="font-semibold underline">Extra jobs for next time</a>: &quot;do the conservatory next time&quot; goes on their next clean by itself.</li>
              <li><a href="#direct-debit" className="font-semibold underline">Pay by bank</a>: send a link and get paid from their banking app in minutes.</li>
              <li><a href="#direct-debit" className="font-semibold underline">Success+</a>: GoCardless retries payments that failed for lack of funds, and Wyndos never takes them twice.</li>
              <li><a href="#workers" className="font-semibold underline">Team permissions</a> for the price calculator and your price list.</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
            <p className="mb-2 text-sm font-semibold text-slate-900">More guides</p>
            <Link href="/guide/direct-debit" className="flex items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 hover:bg-blue-100">
              <span><b>Direct Debit with GoCardless</b><span className="block text-blue-800/80">Connect, sign customers up, collect, refunds, and one person paying for several houses.</span></span>
              <span className="font-semibold">Open →</span>
            </Link>
          </div>
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
          <p>
            Moving from Aworka? Use <strong>Moving from Aworka?</strong> on the import page and upload your Aworka full export.
            Customers, rounds, prices, due dates, balances, history and expenses come across, and so do customers&apos; Direct Debits
            (see <Link href="/guide/direct-debit#moving" className="font-semibold text-blue-700 underline">Moving customers already on GoCardless</Link>).
            You check everything before it&apos;s saved.
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
            On the day, open <strong>Workday</strong> on your phone and tap today. You&apos;ll see everyone in route order,
            with their price, notes (gate codes, dogs and so on) and how they usually pay.
          </p>
          <Pair>
            <Shot phone src="p-day" alt="A day on the phone: progress, cash to collect and a list of customers with Done and Done & Paid buttons" caption="The day, in order" />
            <Shot phone src="p-done-paid" alt="Done & Paid opened: price this time, what they paid, and Cash, Card or Bank" caption="Done & Paid: check the amount and how they paid" />
          </Pair>
          <ul>
            <li>Press <strong>Start Area</strong> when you begin.</li>
            <li>Press <strong>Done</strong> when a house is cleaned, or <strong>Done &amp; Paid</strong> if they paid you there and then.</li>
            <li>Customers on Direct Debit show <strong>Done · Direct Debit</strong>: just press it, and the money is collected through GoCardless. Don&apos;t take cash from them as well.</li>
            <li>
              With Done &amp; Paid you can change <strong>Price this time</strong> (front only, say) and <strong>They paid</strong>
              (if they gave you £10 for an £8 clean, the extra is kept as credit for next time).
            </li>
            <li>The arrow button opens the houses still to do in Google Maps, in the day&apos;s order.</li>
            <li>
              Press <strong>Complete Day</strong> at the end. Anyone you didn&apos;t get to can be skipped or moved,
              and everyone&apos;s next visit is booked automatically.
            </li>
          </ul>
          <Tip>Rained off? On the day, press <strong>More → Rained off</strong> to move the whole day in one go.</Tip>
          <p><strong>No signal?</strong> Keep going.</p>
          <ul>
            <li><strong>Done</strong>, <strong>Skip</strong>, <strong>Done &amp; Paid</strong>, notes and price changes are saved on the phone. A bar at the top says how many are waiting.</li>
            <li>They&apos;re sent by themselves when signal comes back, oldest first. On iPhone that happens while Wyndos is open, so open it once you have signal.</li>
            <li>Starting or completing the day, moving houses and adding customers need signal.</li>
            <li>If something can&apos;t be saved when it&apos;s sent (say the house was deleted in the meantime), it shows under <strong>offline changes need checking</strong>, with what it was and why. Press <strong>Try again</strong> or <strong>Remove</strong>.</li>
            <li>Don&apos;t sign out while changes are waiting: Wyndos warns you, because signing out deletes them.</li>
          </ul>
          <Pair>
            <Shot phone src="p-offline" alt="A day with no signal: a bar at the top says 2 changes saved on this phone" caption="No signal: taps are saved on the phone" />
            <Shot phone src="p-needs-checking" alt="A red bar: 1 offline change needs checking, with what it was, why it wasn't saved, Try again and Remove" caption="If one can't be saved, it's listed to check" />
          </Pair>
          <Tip>Add Wyndos to your home screen (see <a href="#help" className="underline">Help and the app</a>). Phones keep saved changes safer for apps on the home screen.</Tip>
        </Step>

        <Step n={6} id="order" title="Set the order of your day">
          <p>
            Each area has its own walking order, and a day uses it. When you have more than one area on a date, open the
            <strong> whole day</strong> (in the Scheduler, click the date or any empty part of the day) to set the order you do them in.
          </p>
          <ul>
            <li><strong>Areas:</strong> drag the area rows at the top, or use the ▲▼ arrows. This is for that day only.</li>
            <li>
              <strong>Houses:</strong> press <strong>Reorder</strong>, then drag a house or use its arrows. Moving a house within its
              own area changes that area&apos;s walking order for every run.
            </li>
            <li>
              <strong>A house from another area</strong> (say an 8-weekly on the same street as your 4-weeklies): drag it in among them.
              Wyndos asks <strong>Just today</strong> or <strong>Yes, always</strong>. Always means it goes straight after that house
              whenever they&apos;re on the same day.
            </li>
            <li><strong>Sort each area by street</strong> puts each area in street order for that day, then tidy it by hand.</li>
            <li><strong>Back to normal order</strong> undoes that day&apos;s changes.</li>
          </ul>
          <Shot src="d-day-order" alt="A whole day with two areas: the area list with arrows, and Reorder on with Sort each area by street and Back to normal order" caption="The whole day: area order at the top, houses below" />
          <div className="mx-auto max-w-md"><Shot src="d-day-always" alt="A popup asking whether a house should always come straight after another house on the same day" caption="Moved a house in among another area: today only, or always" /></div>
          <Tip>Extra jobs and one-offs go at the end of their area. Printed run sheets and the PDF follow the same order. To remove an &quot;always&quot; link, open the customer.</Tip>
        </Step>

        <Step n={7} id="texts" title="Text your customers">
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

        <Step n={8} id="workers" title="Add your workers">
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
          <p>
            <strong>Change job order:</strong> tick this for a worker if they may reorder their day. Leave it off and they always see
            their whole day in the order you set, with no Reorder button.
          </p>
          <p>
            <strong>Price calculator</strong> and <strong>Change price list</strong> are permissions too: tick the first for anyone who prices
            quotes, the second only for whoever sets your prices. You always have both. <strong>Office / admin</strong> gets both,
            <strong> Senior worker</strong> gets the calculator.
          </p>
          <Shot src="d-team-reorder" alt="Editing a worker's permissions, with Change Job Order next to Their Days" caption="Settings → Team → edit permissions" />
          <Pair>
            <Shot phone src="p-worker" alt="A worker's dashboard on the phone: their work this month, coming up and cash to hand over" caption="A worker's dashboard" />
            <Shot phone src="p-worker-day" alt="A worker's day on the phone, the same Done and Done & Paid list" caption="Their day" />
          </Pair>
          <Tip>Cash your workers collect is tracked. They hand it over to you under <strong>Payments → Cash</strong>, so you always know who&apos;s holding what.</Tip>
        </Step>

        <Step n={9} id="payments" title="Keep track of money">
          <p>
            <strong>Payments</strong> shows who owes you, for which cleans, and for how long. From here you can
            <strong> Log payment</strong>, send a <strong>Remind</strong> text, or add <strong>credit</strong> for someone who&apos;s paid in advance.
          </p>
          <Shot src="d-payments" alt="Payments: totals owed, late, taken this month and credit; then each customer who owes" />
          <ul>
            <li>Paid by bank transfer? Use <strong>Bank statement</strong> to match payments from your bank&apos;s download. The file is read on your device and never stored.</li>
            <li><strong>Accounting</strong> adds up income and expenses for the tax year, ready for your self-assessment.</li>
            <li><strong>Pays by</strong> at the top of Payments and Texts shows just the customers who pay a certain way (cash, bank, Direct Debit and so on).</li>
          </ul>
          <p>On a customer&apos;s page, under <strong>Payments</strong>, you can put their money right:</p>
          <ul>
            <li><strong>Refund this payment</strong>: all or part of it, back through GoCardless or given back yourself. Back through GoCardless, the clean&apos;s price comes down by the refund. Given back yourself, choose whether the clean is <strong>written off</strong> or <strong>left owing</strong>.</li>
            <li><strong>Move payment to another customer</strong>: logged against the wrong person.</li>
            <li><strong>Use credit for another customer</strong>: one person paying for two houses. It pays the other customer&apos;s oldest unpaid cleans and isn&apos;t counted as new money.</li>
            <li><strong>Write off what they owe</strong>, <strong>Remove credit</strong> or <strong>Add credit</strong> (credit that isn&apos;t money received, such as carried over from your old system). <strong>Refund credit</strong> gives spare credit back.</li>
          </ul>
          <div className="mx-auto grid max-w-xl items-start gap-6 sm:grid-cols-2">
            <Shot src="d-customer-money" alt="A customer's balance showing £10 credit, with Refund credit, Use for another customer, Remove credit and Add credit" caption="Credit and what you can do with it" />
            <Shot src="d-customer-payments" alt="A customer's payments, each with a Refund button and buttons to move, edit or delete it" caption="Each payment: refund, move, edit" />
          </div>
        </Step>

        <Step n={10} id="direct-debit" title="Direct Debit (GoCardless)">
          <p>
            Customers sign a Direct Debit once. When you tick a clean <strong>Done</strong>, Wyndos asks GoCardless to take the money
            and marks the clean paid when it arrives. You need your own GoCardless account; GoCardless charges its own fees.
          </p>
          <ol>
            <li><strong>Settings → Business → GoCardless</strong>: press <strong>Connect my GoCardless account</strong>.</li>
            <li>Open a customer and press <strong>Get sign-up link</strong> under <strong>Direct Debit</strong>. Send them the link.</li>
            <li>Collect from <strong>Payments → Direct Debit</strong>, or tick <strong>Collect automatically</strong>.</li>
          </ol>
          <Shot src="d-dd-collect" alt="Payments, Direct Debit, To collect: three cleans ticked with names, addresses and amounts, and a Collect button" caption="Payments → Direct Debit: collect for finished cleans" />
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <p>
              One person paying for several houses? Keep each house as its own customer and choose
              <strong> Use another customer&apos;s Direct Debit</strong>. Each clean is still collected separately, with the address on it.
            </p>
            <Shot phone src="p-customer-dd" alt="A customer's Direct Debit section: Active, shared with another customer, each clean collected separately" caption="A house on someone else's Direct Debit" />
          </div>
          <ul>
            <li>
              <strong>Pay by bank:</strong> for money you want now (paid on the day, a catch-up, an extra job), open a finished clean and press
              <strong> Pay by bank (link)</strong>, or <strong>Pay by bank</strong> on the customer. They pay from their banking app (no card, no
              Direct Debit needed) and it shows as paid in minutes. Open the link on your phone for them, or text it.
            </li>
            <li>
              <strong>Success+</strong> (switch it on in your GoCardless account): payments that fail for lack of funds are retried by GoCardless
              around payday. They show as <strong>GoCardless will retry</strong>, with no Try again, so nobody is charged twice.
            </li>
          </ul>
          <p>
            <Link href="/guide/direct-debit" className="font-semibold text-blue-700 underline">Read the full Direct Debit guide →</Link>{" "}
            (failed payments, Success+, refunds, Pay by bank, moving from another program, sharing).
          </p>
        </Step>

        <Step n={11} id="quotes" title="Quotes and the price calculator">
          <p>
            <strong>Quotes</strong> keeps track of quote visits and whether they turned into customers. The <strong>Price calculator</strong>{" "}
            works out a price on the spot, on the doorstep or over the phone, from your own price list, and says roughly how long the job takes.
          </p>
          <ol>
            <li>Open <strong>Quotes → Price calculator</strong>, or press <strong>Price it</strong> on a quote.</li>
            <li>
              Choose how to price it:
              <ul>
                <li><strong>House:</strong> property type and bedrooms, plus any extras (solar panels, conservatory roof and so on).</li>
                <li><strong>Detailed:</strong> count windows by type (standard, large, bay, sash, roof), doors, frames, gutters, cladding. Pick the storey for higher ones.</li>
                <li><strong>Commercial:</strong> add each building or elevation, the number of people and any access kit or hire. Price it by the items, or by time (your labour rate plus margin).</li>
              </ul>
            </li>
            <li>Pick <strong>how often</strong> and tick any <strong>adjustments</strong> (first clean, inside as well, hard water, difficult access, discount).</li>
            <li>Read the price per visit, the time, and what it&apos;s worth a month and a year. <strong>Show workings</strong> lists every line.</li>
            <li>On a quote, press <strong>Save as the quote</strong>. From the calculator page, <strong>Put this price on a quote</strong> and pick the quote.</li>
          </ol>
          <Shot src="d-calculator" alt="The price calculator: a semi-detached 3 bed with solar panels and a conservatory roof, price per visit, time, a month and a year, and the workings" caption="Quotes → Price calculator" />
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <ul>
              <li>The answers are saved with the quote, so <strong>Price it</strong> opens where you left off.</li>
              <li>When the quote becomes a customer, the time comes with it: their page shows <strong>about 25 min</strong>, and a day shows roughly how long is left.</li>
            </ul>
            <Shot phone src="p-price-it" alt="Price it on a phone: detached 4 bed, inside as well, £47 every 4 weeks, about 28 minutes" caption="Price it on a quote" />
          </div>
          <Shot src="d-calculator-commercial" alt="Commercial pricing: two buildings of glass panes, one on the third storey, two people, priced by items or by time" caption="Commercial: buildings, people and access kit" />
          <p><strong>Your price list</strong> (Price calculator → <strong>Price list</strong>) is yours to set. It starts with example UK prices: change them to your own and press <strong>Save price list</strong>.</p>
          <ul>
            <li><strong>Houses:</strong> a price and time for each property type and number of bedrooms.</li>
            <li><strong>Items:</strong> anything you count, with its unit (each, per pane, per m², per metre, per panel, per hour), price and minutes. Tick <strong>Height</strong> for items that cost more higher up.</li>
            <li><strong>Adjustments</strong> (% or £), <strong>Frequency</strong> (how the price changes with how often), and <strong>Rules</strong>: minimum charge, call-out, rounding, VAT, labour rate, margin and the height multipliers.</li>
          </ul>
          <Shot src="d-price-list-items" alt="The price list's Items: name, group, unit, price, minutes and whether it's priced by height" caption="Price list → Items" />
          <Tip>Price the same house a few ways and compare with what you charge now, then adjust the list until it matches. After that, everyone in your team quotes the same way.</Tip>
        </Step>

        <Step n={12} id="extras" title="Extra jobs for next time">
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <p>Asked on the doorstep to do the conservatory or gutters next time? Add it now, even though their next clean isn&apos;t booked yet.</p>
              <ol>
                <li>Open the customer and press <strong>One-off Job</strong>.</li>
                <li>Leave <strong>With their next visit</strong> chosen, give it a name and price, and add it.</li>
              </ol>
              <ul>
                <li>It shows on the customer under <strong>For their next visit</strong> until it&apos;s booked.</li>
                <li>It goes on the same day as their next clean as soon as that&apos;s booked, for example when you finish today&apos;s run. Never twice.</li>
                <li>For something to do today, choose <strong>On a set date</strong> instead.</li>
              </ul>
            </div>
            <Shot phone src="p-next-visit" alt="Add One-off Job with 'With their next visit' chosen: Conservatory roof, £35, inside and out" caption="An extra for their next visit" />
          </div>
        </Step>

        <Step n={13} id="dashboard" title="Your dashboard">
          <div className="grid items-start gap-6 sm:grid-cols-[1fr_280px]">
            <div className="space-y-4">
              <p>
                The <strong>Dashboard</strong> is your start point each morning: today&apos;s round, a short <strong>To do</strong> list
                (reminders to send, people to chase, areas overdue) and what you&apos;re owed.
              </p>
              <p>Each to-do has a button that takes you straight to the job. The first five show; press <strong>Show more</strong> for the rest.</p>
            </div>
            <Shot phone src="p-dashboard" alt="The dashboard on a phone: today's round, to-do list, round value and money owed" />
          </div>
        </Step>

        <Step n={14} id="help" title="Help and the app">
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
                <a href="mailto:support@wyndos.io" className="font-semibold text-blue-700 underline">support@wyndos.io</a>, or WhatsApp{" "}
                <a href="https://wa.me/447947939782" className="font-semibold text-blue-700 underline">07947 939782</a>. Struggling to get your round in? Send your spreadsheet or old app&apos;s export and it&apos;ll be imported for you.
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
