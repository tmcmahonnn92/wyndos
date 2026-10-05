import { LegalPage } from "@/components/legal-page";
import { DATA_PERMISSION_TEXT, OPERATOR, SUB_PROCESSORS } from "@/lib/legal";

export const metadata = {
  title: "Terms of Service | Wyndos",
  description: "The terms for using Wyndos, including how we process your customers' details for you.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms are between you (the business using Wyndos) and {OPERATOR.legalName} (&quot;Wyndos&quot;, &quot;we&quot;, &quot;us&quot;).
        {OPERATOR.address ? ` Our address is ${OPERATOR.address}.` : ""} You can contact us at <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>.
        By creating an account or using Wyndos you agree to these terms.
      </p>

      <h2>1. The service</h2>
      <p>
        Wyndos is software for window cleaning and similar businesses to manage customers, rounds, jobs, payments and records.
        Wyndos is for businesses and sole traders acting in the course of their business, not for consumers.
      </p>

      <h2>2. Trial, price and cancelling</h2>
      <ul>
        <li>New accounts get a free trial (15 days unless we tell you otherwise). No card is needed for the trial.</li>
        <li>After the trial Wyndos costs the monthly price shown on your Billing page, billed monthly in advance by our payment provider, Stripe. Your team&apos;s logins are included.</li>
        <li>Businesses that signed up during our introductory offer pay £9.99 a month for life: that price won&apos;t go up for them. New sign-ups after the offer pay £14.99 a month.</li>
        <li>You can cancel at any time from the Billing page. You keep access until the end of the month you have paid for. We don&apos;t refund part months.</li>
        <li>If a payment fails or you cancel, planning and day sheets are locked, but you can still see, export and back up your data.</li>
        <li>We will give you at least 30 days&apos; notice by email of any price change.</li>
      </ul>

      <h2>3. Your account</h2>
      <ul>
        <li>Keep your login details safe. You are responsible for what happens in your account, including what your team members do.</li>
        <li>Only give team members the access they need. You can remove a team member at any time.</li>
        <li>Tell us straight away at {OPERATOR.email} if you think someone else has got into your account.</li>
      </ul>

      <h2>4. Your customers&apos; details</h2>
      <p>
        The details you put into Wyndos about your own customers (names, addresses, phone numbers, emails, prices, job and payment history, notes)
        belong to you. For data protection law you are the <strong>controller</strong> of that data and Wyndos is your <strong>processor</strong>.
      </p>
      <p>When you sign up you confirm:</p>
      <p className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 text-slate-200">&ldquo;{DATA_PERMISSION_TEXT}&rdquo;</p>
      <p>That means you agree that:</p>
      <ul>
        <li>you have a lawful reason to hold and use your customers&apos; details (for most window cleaners this is to carry out the service your customer asked for, and to get paid);</li>
        <li>you tell your customers who you are and how you use their details (a short privacy notice on your website, invoices or a card is usually enough);</li>
        <li>you only add what you need to run your business, and you don&apos;t store sensitive details (such as health information) unless you really need them;</li>
        <li>you only send texts or emails to customers that the law allows, for example service messages about their cleans and payments;</li>
        <li>you keep your customers&apos; details accurate and remove customers you no longer need to keep.</li>
      </ul>

      <h2>5. Data processing terms</h2>
      <p>These terms apply when we process your customers&apos; details for you (UK GDPR Article 28).</p>
      <ul>
        <li><strong>What and why:</strong> we store and process the customer details you add, for as long as you have an account, only to provide Wyndos to you.</li>
        <li><strong>Your instructions:</strong> we only process the data to provide the service as you use it, or as the law requires. We never sell it, use it for marketing or contact your customers ourselves.</li>
        <li><strong>Confidentiality:</strong> anyone working on Wyndos who can access your data is bound to keep it confidential. We only look at your data when you ask for support, and support access is logged.</li>
        <li><strong>Security:</strong> we use encrypted connections, hashed passwords, encrypted storage of sensitive settings, access controls, and regular backups kept off the main server.</li>
        <li><strong>Sub-processors:</strong> you agree we may use the companies listed below. We will update this list and email you before adding a new one. If you object, you can close your account.</li>
        <li><strong>Helping you:</strong> we will help you answer your customers&apos; requests (for example to see, correct or delete their details). Wyndos lets you edit, export and delete customer records yourself.</li>
        <li><strong>Breaches:</strong> if we find a personal data breach affecting your data we will tell you without undue delay, and within 48 hours of finding out, with what we know.</li>
        <li><strong>When you leave:</strong> you can download a full backup at any time (Settings, then Data). When you close your account we delete your data straight away, and it drops out of our backups within 35 days.</li>
        <li><strong>Checks:</strong> we will give you the information you reasonably need to show these terms are being met.</li>
        <li><strong>Transfers:</strong> if any data leaves the UK we make sure the law&apos;s safeguards are in place.</li>
      </ul>
      <table>
        <thead><tr><th>Sub-processor</th><th>What for</th><th>Where</th></tr></thead>
        <tbody>
          {SUB_PROCESSORS.map((s) => (
            <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.location}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>6. Fair use</h2>
      <ul>
        <li>Don&apos;t use Wyndos for anything unlawful, to send spam, or to store data you have no right to hold.</li>
        <li>Don&apos;t try to break, overload, copy or get around the security of Wyndos.</li>
        <li>We may suspend an account that breaks these rules, and will tell you why.</li>
      </ul>

      <h2>7. Availability and backups</h2>
      <p>
        We work hard to keep Wyndos running and back it up regularly, but we can&apos;t promise it will never be unavailable or that data can never be lost.
        We recommend you download a backup from time to time (Settings, then Data).
      </p>

      <h2>8. Our liability</h2>
      <ul>
        <li>Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or anything else the law doesn&apos;t allow us to limit.</li>
        <li>Otherwise, we are not liable for loss of profit, business or goodwill, or for indirect losses.</li>
        <li>Our total liability to you in any 12 months is limited to the amount you paid us in those 12 months.</li>
      </ul>

      <h2>9. Changes</h2>
      <p>
        We may update these terms. If a change matters, we will tell you and ask you to accept the new terms the next time you sign in.
      </p>

      <h2>10. Ending</h2>
      <p>
        You can close your account at any time (Settings, then Account). We can end your account with 30 days&apos; notice, or straight away if you
        seriously break these terms. Sections 4, 5 and 8 keep applying for as long as needed.
      </p>

      <h2>11. Law</h2>
      <p>These terms are governed by the law of England and Wales, and the courts of England and Wales deal with any dispute.</p>
    </LegalPage>
  );
}
