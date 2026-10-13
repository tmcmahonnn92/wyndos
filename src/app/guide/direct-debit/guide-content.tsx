import Link from "next/link";
import type { ReactNode } from "react";

/*
 * Help for Direct Debit through GoCardless. Shown in the app to businesses with Direct Debit
 * switched on. publicView: a copy without app links (for a public guide, if one is published).
 */

const SECTIONS = [
  { id: "before", title: "Before you start" },
  { id: "connect", title: "Connect GoCardless" },
  { id: "signup", title: "Sign customers up" },
  { id: "moving", title: "Moving customers already on GoCardless" },
  { id: "collect", title: "Collect for cleans" },
  { id: "arrives", title: "When the money arrives" },
  { id: "problems", title: "Failed payments and charge-backs" },
  { id: "changes", title: "Undo, cancelled Direct Debits and payments made in GoCardless" },
  { id: "refunds", title: "Refunds" },
  { id: "disconnect", title: "Disconnecting" },
];

function Section({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3 border-t border-slate-200 pt-8">
      <h2 className="flex items-center gap-3 text-lg font-bold text-slate-900 sm:text-xl">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{n}</span>
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-7 text-slate-700 [&_strong]:text-slate-900 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><strong className="text-amber-900">Tip:</strong> {children}</p>;
}

export function DirectDebitGuide({ publicView = false }: { publicView?: boolean }) {
  return (
    <div className="bg-slate-50 px-4 py-6">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-4">
          {publicView
            ? <a href="https://wyndos.io" className="text-sm text-blue-700 hover:underline">Wyndos: window cleaning round management</a>
            : <Link href="/guide" className="text-sm text-blue-700 hover:underline">← Getting started</Link>}
          <h1 className="text-3xl font-black leading-tight text-slate-900">Direct Debit with GoCardless</h1>
          <p className="text-[15px] leading-7 text-slate-700">
            Customers sign a Direct Debit once. After that, when you finish a clean, Wyndos asks GoCardless to take the money,
            and marks the clean paid when it arrives. No chasing, no matching bank transfers.
          </p>
          <nav aria-label="Sections" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <ol className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {SECTIONS.map((s, i) => (
                <li key={s.id}><a href={`#${s.id}`} className="text-blue-700 hover:underline">{i + 1}. {s.title}</a></li>
              ))}
            </ol>
          </nav>
        </header>

        <Section n={1} id="before" title="Before you start">
          <ul>
            <li>You need your own <strong>GoCardless account</strong> (gocardless.com), with your business and bank details checked by GoCardless. Money goes from your customers to GoCardless and then to your bank.</li>
            <li><strong>GoCardless charges its own fees</strong> per payment. Wyndos doesn&apos;t add anything.</li>
            <li>Want to try it first? A GoCardless <strong>sandbox</strong> account lets you practise with pretend bank details. No real money moves.</li>
          </ul>
        </Section>

        <Section n={2} id="connect" title="Connect GoCardless">
          <ol>
            <li>In Wyndos, open <strong>Settings → Business → GoCardless (Direct Debit)</strong>.</li>
            <li>Press <strong>Connect my GoCardless account</strong> (or <strong>Create a GoCardless account</strong> if you haven&apos;t got one). GoCardless opens with your business name and email filled in.</li>
            <li>Log in (or sign up) and press <strong>Allow</strong>. You come back to Wyndos and it says <strong>Connected to GoCardless</strong>, with your GoCardless account name.</li>
            <li>Next to it Wyndos shows your <strong>GoCardless account status</strong>: <em>Account verified</em>, <em>GoCardless is checking your account</em>, or <em>GoCardless needs more details</em>. You can sign customers up straight away, but GoCardless only pays money out to you once your account is verified.</li>
          </ol>
          <p>
            <strong>Keeping up to date:</strong> GoCardless tells Wyndos when something happens (a sign-up finished, money confirmed, a failed payment,
            a cancelled Direct Debit) and Wyndos updates within a minute. You can also press <strong>Sync now</strong> on <strong>Payments → Direct Debit</strong> at any time.
            Syncing only reads from GoCardless: it never takes money.
          </p>
          <p>The <strong>reference prefix</strong> (WD unless you change it) is put in front of each customer&apos;s reference, so you can spot Wyndos customers in GoCardless.</p>
          <p><strong>Prefer an access token?</strong> Under <strong>Or paste an access token instead</strong> you can paste a read-write token from GoCardless (<strong>Developers → Create → Access token</strong>). Connecting with the button is easier and lets GoCardless update Wyndos straight away.</p>
          <Tip>Wyndos never sees your GoCardless password. The connection is stored encrypted, and you can disconnect at any time.</Tip>
        </Section>

        <Section n={3} id="signup" title="Sign customers up">
          <ol>
            <li>Open the customer and find <strong>Direct Debit</strong> at the bottom of their page. Press <strong>Get sign-up link</strong>.</li>
            <li>Copy the link and send it to them by text or email. They fill in their own bank details on GoCardless&apos;s secure page. You never see or type their bank details.</li>
            <li>Once they&apos;ve finished, Wyndos picks it up (straight away if you connected with the button, otherwise at the next sync: press <strong>Sync now</strong> on <strong>Payments → Direct Debit</strong>). Their Direct Debit shows <strong>Being set up</strong>, then <strong>Active</strong>.</li>
          </ol>
          <p>You can also do it from <strong>Payments → Direct Debit</strong>: pick the customer under <strong>Set up Direct Debit for</strong> and press <strong>Get sign-up link</strong>.</p>
          <p>
            <strong>Already have customers in GoCardless?</strong> Use <strong>Payments → Direct Debit → Link GoCardless customers</strong>.
            Wyndos suggests matches by name and postcode; check each one and link it. Nobody has to sign up again.
            See <a href="#moving" className="text-blue-700 underline">Moving customers already on GoCardless</a>.
          </p>
        </Section>

        <Section n={4} id="moving" title="Moving customers already on GoCardless">
          <p>Coming from another program, or already taking Direct Debits in GoCardless? Your customers&apos; Direct Debits belong to <strong>your</strong> GoCardless account, so they come with you.</p>
          <ol>
            <li><strong>Bring your customers in first</strong> (Customers → Import, or the CleanerPlanner / Aworka import), including their past payments if you have them.</li>
            <li><strong>Connect GoCardless</strong> (step 2), then <strong>Payments → Direct Debit → Link GoCardless customers</strong>. Check the suggested matches and link them.</li>
            <li>Press <strong>Sync now</strong>. Each Direct Debit shows as <strong>Active</strong>.</li>
          </ol>
          <ul>
            <li><strong>Nothing is counted twice.</strong> Payments taken in GoCardless before you linked a customer are left alone: they&apos;re already in the history you imported. Only payments from then on are added.</li>
            <li>
              <strong>Customers on a GoCardless plan</strong> (a subscription, e.g. £15 a month): GoCardless keeps taking those payments and Wyndos records each one against their regular cleans,
              so their regular cleans are <strong>never</strong> collected again (no charging twice). <strong>Extra jobs</strong> (gutters, a conservatory: any one-off that isn&apos;t their usual service)
              aren&apos;t covered by the plan, so they show under <strong>To collect</strong> like anyone else&apos;s and are taken on the same Direct Debit. Their Direct Debit shows the plan.
              To switch someone to paying per clean, cancel the plan in GoCardless (their Direct Debit stays) and sync.
            </li>
            <li>Turn on <strong>Collect automatically</strong> only once everyone&apos;s linked and you&apos;ve checked who&apos;s on a plan.</li>
            <li><strong>Moving from Aworka?</strong> The Aworka import brings each customer&apos;s Direct Debit across with them, so there&apos;s nothing to link: connect GoCardless and sync. Past GoCardless payments in the Aworka history are recognised, so nothing is counted twice.</li>
            <li>If your old program used <strong>its own</strong> GoCardless account rather than yours, the Direct Debits can&apos;t simply be linked. Ask GoCardless support about moving them to your account (they can usually do this without customers signing again), or send each customer a sign-up link.</li>
          </ul>
        </Section>

        <Section n={5} id="collect" title="Collect for cleans">
          <p>Tick the clean off as normal (<strong>Done</strong>). Then either:</p>
          <ul>
            <li><strong>Collect yourself:</strong> open <strong>Payments → Direct Debit</strong>. Cleans owing for Direct Debit customers are under <strong>To collect</strong>. Choose them and press <strong>Collect</strong>.</li>
            <li><strong>Let Wyndos do it:</strong> tick <strong>Collect automatically when a clean is done</strong> on the same page. From then on, every clean you tick off for a Direct Debit customer is collected straight away. Cleans done before you turned it on are left for you to collect.</li>
          </ul>
          <p>Only what&apos;s still owed is collected: if they had credit, or paid part in cash, the rest is taken.</p>
          <Tip>Don&apos;t press <strong>Done &amp; Paid</strong> for a Direct Debit customer: that records cash or a transfer, and nothing is collected. Just press <strong>Done</strong>.</Tip>
        </Section>

        <Section n={6} id="arrives" title="When the money arrives">
          <ul>
            <li>A Direct Debit takes about <strong>3 to 5 working days</strong>. While it&apos;s on its way the clean shows under <strong>In progress</strong>.</li>
            <li>When GoCardless confirms it, the next sync records the payment against the clean, and it shows as paid on the customer&apos;s page, in Payments and in Accounting.</li>
            <li>The customer gets their own emails from GoCardless before each payment.</li>
          </ul>
        </Section>

        <Section n={7} id="problems" title="Failed payments and charge-backs">
          <ul>
            <li><strong>Failed</strong> (not enough money in the account, for example): the clean shows under <strong>Failed</strong> and still owes. Check with the customer, then press <strong>Try again</strong>. Wyndos never retries on its own.</li>
            <li><strong>Charged back</strong> (the customer claimed it back from their bank under the Direct Debit Guarantee): the payment is cancelled in Wyndos and the clean owes again.</li>
            <li>A failed clean that&apos;s later paid another way (cash, transfer) drops off the Failed list by itself.</li>
          </ul>
        </Section>

        <Section n={8} id="changes" title="Undo, cancelled Direct Debits and payments made in GoCardless">
          <ul>
            <li>
              <strong>Ticked Done by mistake?</strong> Press <strong>Undo</strong>. If the Direct Debit hasn&apos;t gone to the bank yet it&apos;s cancelled and nothing is taken.
              If it&apos;s too late to stop, Wyndos tells you, and when the money arrives it&apos;s kept as credit for their next clean.
            </li>
            <li><strong>Customer cancels their Direct Debit:</strong> it shows as <strong>Cancelled</strong> after the next sync and nothing more is collected. To start again, send them a new sign-up link.</li>
            <li><strong>Payment taken in GoCardless itself</strong> (not from Wyndos, after the customer was linked): the sync finds it, pays their oldest unpaid cleans, and keeps anything left over as credit.</li>
          </ul>
        </Section>

        <Section n={9} id="refunds" title="Refunds">
          <ol>
            <li>Open the customer. Under <strong>Payments</strong>, press the refund button on the payment.</li>
            <li>Enter how much (all or part of it) and how it goes back: <strong>Back through GoCardless</strong> for a Direct Debit payment that&apos;s been collected, or cash, bank transfer or card if you give it back yourself.</li>
            <li>Choose what happens to the clean: <strong>Write it off</strong> (they don&apos;t owe it: a poor job or goodwill) or <strong>Leave it owing</strong> (they still owe: paid by mistake or charged twice).</li>
          </ol>
          <ul>
            <li>The refund shows on the customer as <strong>Refund −£…</strong>. It comes off your money in, Accounting and Making Tax Digital figures on the day of the refund. The original payment stays as it was.</li>
            <li>GoCardless refunds take a few working days, and GoCardless emails the customer. If GoCardless can&apos;t complete a refund, Wyndos undoes it and the clean goes back to how it was.</li>
            <li>Refunds made in the GoCardless dashboard are picked up too (the clean is written off, so it isn&apos;t collected again).</li>
            <li>Spare <strong>credit</strong> (paid in advance or paid too much) can be given back with <strong>Refund credit</strong> on the customer&apos;s page.</li>
            <li>GoCardless switches refunds on for your account when you ask them. Until then, choose bank transfer and send it yourself.</li>
          </ul>
        </Section>

        <Section n={10} id="disconnect" title="Disconnecting">
          <p>
            Press <strong>Disconnect</strong> in <strong>Settings → GoCardless</strong> (or remove Wyndos in your GoCardless dashboard). Wyndos then stops
            collecting and syncing. Customers&apos; Direct Debits stay set up in GoCardless, and everything already recorded in Wyndos stays.
          </p>
        </Section>

        {!publicView && <footer className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <Link href="/payments/direct-debit" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Go to Direct Debit</Link>
          <Link href="/support" className="hover:text-slate-800">Help &amp; support</Link>
        </footer>}
      </article>
    </div>
  );
}
