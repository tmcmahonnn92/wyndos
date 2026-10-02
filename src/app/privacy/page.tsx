import { LegalPage } from "@/components/legal-page";
import { OPERATOR, SUB_PROCESSORS } from "@/lib/legal";

export const metadata = {
  title: "Privacy Policy | Wyndos",
  description: "How Wyndos uses personal data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains how {OPERATOR.legalName} (&quot;Wyndos&quot;, &quot;we&quot;) uses personal data.
        {OPERATOR.icoNumber ? ` We are registered with the Information Commissioner's Office (ICO), number ${OPERATOR.icoNumber}.` : ""}
        {" "}Contact: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>{OPERATOR.address ? `, ${OPERATOR.address}` : ""}.
      </p>

      <h2>Two kinds of data</h2>
      <ul>
        <li>
          <strong>Your account details</strong> (business owners and team members). Wyndos decides how this is used, so we are the controller. This policy covers it.
        </li>
        <li>
          <strong>Your customers&apos; details</strong> that you add to Wyndos. The business using Wyndos is the controller and we only process it for them,
          under the data processing terms in our <a href="/terms">Terms of Service</a>. If you are a customer of a window cleaner who uses Wyndos,
          please contact them about your details. We will pass on any request we receive.
        </li>
      </ul>

      <h2>What we collect about account holders</h2>
      <ul>
        <li>Name, email, password (stored only as a secure hash), business name, phone, address and website.</li>
        <li>What you tell us at sign-up (rough number of customers, team size, how you take payment, how you heard about us).</li>
        <li>Billing details: Stripe holds your card details. We only see the subscription status and the last few digits.</li>
        <li>Support messages and attachments you send us.</li>
        <li>Security records: sign-ins, support access logs and server logs (including IP addresses).</li>
      </ul>

      <h2>Why we use it (and the legal basis)</h2>
      <ul>
        <li>To provide your account and the service, and to bill you (<strong>contract</strong>).</li>
        <li>To keep Wyndos secure, fix problems, answer support and improve the service (<strong>legitimate interests</strong>).</li>
        <li>To keep tax and accounting records (<strong>legal obligation</strong>).</li>
      </ul>
      <p>
        We send service emails only: sign-up, password reset, receipts, important changes and the notifications you choose in your account.
        <strong> We don&apos;t send marketing emails, we don&apos;t use advertising or tracking cookies, and we never sell personal data.</strong>
        If we ever want to send marketing, we will ask first.
      </p>

      <h2>Who we share it with</h2>
      <p>Only the companies that help us run Wyndos, under contracts that protect the data:</p>
      <table>
        <thead><tr><th>Company</th><th>What for</th><th>Where</th></tr></thead>
        <tbody>
          {SUB_PROCESSORS.map((s) => (
            <tr key={s.name}><td>{s.name}</td><td>{s.purpose}</td><td>{s.location}</td></tr>
          ))}
        </tbody>
      </table>
      <p>We may also share data if the law requires it. Where data leaves the UK, we rely on UK adequacy rules or approved contract terms.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account and business data: while your account is open. When you close it, it is deleted straight away and drops out of backups within 35 days.</li>
        <li>Billing records: 6 years, as tax law requires.</li>
        <li>Support messages: up to 2 years after the issue is closed.</li>
        <li>Server and security logs: up to 90 days.</li>
      </ul>

      <h2>Bank statements</h2>
      <p>
        When you match payments from a bank statement, the file is read on your own device. It is never uploaded to or stored by Wyndos.
        Only the payments you confirm are recorded, as payments against your customers.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct or delete your data, to restrict or object to how we use it, or to get a copy to take elsewhere.
        Email <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>. We will reply within one month.
        You can also complain to the ICO: <a href="https://ico.org.uk/make-a-complaint/" rel="noopener noreferrer" target="_blank">ico.org.uk/make-a-complaint</a>.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over encrypted connections, passwords are hashed, sensitive settings are encrypted, access is limited and logged, and backups are kept
        off the main server. No system is perfectly secure; if something goes wrong we will act quickly and tell the people affected as the law requires.
      </p>

      <h2>Cookies</h2>
      <p>We only use cookies needed to sign you in and keep you secure. See our <a href="/cookies">Cookie Policy</a>.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we will tell account holders before it applies.</p>
    </LegalPage>
  );
}
