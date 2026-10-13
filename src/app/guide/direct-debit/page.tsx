import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getActor } from "@/lib/guards";
import { goCardlessOn } from "@/lib/trial-features";

export const dynamic = "force-dynamic";
export const metadata = { title: "Direct Debit (GoCardless) | Wyndos" };

/*
 * Help for Direct Debit through GoCardless. Only shown to businesses that have Direct Debit
 * switched on (it's a trial feature, and Wyndos doesn't advertise GoCardless to everyone).
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

export default async function DirectDebitGuidePage() {
  const actor = await getActor().catch(() => null);
  if (!actor || !(await goCardlessOn(actor.tenantId))) redirect("/guide");

  return (
    <div className="bg-slate-50 px-4 py-6">
      <article className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-4">
          <Link href="/guide" className="text-sm text-blue-700 hover:underline">← Getting started</Link>
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
            <li>In GoCardless, go to <strong>Developers → Create → Access token</strong>.</li>
            <li>Name it (for example &quot;Wyndos&quot;) and choose <strong>Read-write access</strong>. Copy the token: GoCardless only shows it once.</li>
            <li>In Wyndos, open <strong>Settings → GoCardless (Direct Debit)</strong>. Pick <strong>Live</strong> (or <strong>Sandbox</strong> for a practice account), paste the token and press <strong>Save Changes</strong>.</li>
            <li>Press <strong>Test connection</strong>. You should see &quot;Connected to&quot; and your business name in GoCardless.</li>
          </ol>
          <p>
            <strong>Syncing:</strong> Wyndos doesn&apos;t hear from GoCardless the moment something happens. It catches up when it
            <strong> syncs</strong>: new sign-ups, money that&apos;s arrived, failed payments and cancelled Direct Debits all show after a sync.
            Press <strong>Sync now</strong> on <strong>Payments → Direct Debit</strong> whenever you want to check. Syncing only reads from
            GoCardless: it never takes money.
          </p>
          <p>The <strong>reference prefix</strong> (WD unless you change it) is put in front of each customer&apos;s reference, so you can spot Wyndos customers in GoCardless.</p>
          <Tip>The token is stored encrypted. Never send it to anyone, Wyndos support included.</Tip>
        </Section>

        <Section n={3} id="signup" title="Sign customers up">
          <ol>
            <li>Open the customer and find <strong>Direct Debit</strong> at the bottom of their page. Press <strong>Get sign-up link</strong>.</li>
            <li>Copy the link and send it to them by text or email. They fill in their own bank details on GoCardless&apos;s secure page. You never see or type their bank details.</li>
            <li>Once they&apos;ve finished, Wyndos picks it up the next time it syncs with GoCardless. To check straight away, press <strong>Sync now</strong> on <strong>Payments → Direct Debit</strong>. Their Direct Debit shows <strong>Being set up</strong>, then <strong>Active</strong>.</li>
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
          <p>
            Wyndos doesn&apos;t send refunds yet. To refund, do it in GoCardless (GoCardless switches refunds on for your account if you ask them),
            then record it in Wyndos as an <strong>expense</strong> so your money figures stay right. The clean stays marked as paid.
          </p>
          <p>If you took money by mistake (for example twice), contact support and we&apos;ll help tidy it up.</p>
        </Section>

        <Section n={10} id="disconnect" title="Disconnecting">
          <p>
            Delete the access token in GoCardless (<strong>Developers → Access tokens</strong>). Wyndos then stops
            collecting. Customers&apos; Direct Debits stay set up in GoCardless, and everything already recorded in Wyndos stays.
          </p>
        </Section>

        <footer className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-6 text-sm text-slate-500">
          <Link href="/payments/direct-debit" className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">Go to Direct Debit</Link>
          <Link href="/support" className="hover:text-slate-800">Help &amp; support</Link>
        </footer>
      </article>
    </div>
  );
}
