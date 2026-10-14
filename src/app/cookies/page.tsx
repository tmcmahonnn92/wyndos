import { LegalPage } from "@/components/legal-page";
import { AdsConsentChoice } from "@/components/meta-pixel";

export const metadata = {
  title: "Cookie Policy | Wyndos",
  description: "The cookies Wyndos uses: what's needed to sign in and stay secure, and (only if you agree) Facebook advert measurement on our website.",
};

const COOKIES: Array<[string, string, string]> = [
  ["authjs.session-token", "Keeps you signed in", "Until you sign out, or 30 days"],
  ["authjs.csrf-token", "Protects sign-in forms from forgery", "Session"],
  ["authjs.callback-url", "Returns you to the right page after signing in", "Session"],
  ["wyndos_active_tenant", "Remembers which business you are working in", "30 days"],
  ["wyndos_support_access", "Marks a logged support session (Wyndos staff only)", "Up to 2 hours"],
  ["wyndos_onboarding_refresh", "Finishes setting up a new account", "1 minute"],
];

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy">
      <p>
        Inside the Wyndos app we only use <strong>strictly necessary</strong> cookies: the ones needed to sign you in, keep your account secure and
        remember which business you are working in. They don&apos;t need consent.
      </p>
      <p>
        On our <strong>public website</strong> (the home page, sign-up and guides), and <strong>only if you click Allow</strong>, Meta (Facebook) sets
        cookies so we can see whether our Facebook adverts lead to people trying Wyndos. They are never used inside the app, and nothing about your
        customers or your round is ever sent to Meta.
      </p>
      <AdsConsentChoice />

      <h2>Cookies we set</h2>
      <table>
        <thead><tr><th>Name</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>
          {COOKIES.map(([name, what, how]) => (
            <tr key={name}><td className="font-mono text-xs">{name}</td><td>{what}</td><td>{how}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-500">On secure connections the sign-in cookies start with &quot;__Secure-&quot; or &quot;__Host-&quot;.</p>

      <h2>Facebook advert cookies (only if you allow them, public website only)</h2>
      <table>
        <thead><tr><th>Name</th><th>What it does</th><th>How long</th></tr></thead>
        <tbody>
          <tr><td className="font-mono text-xs">_fbp</td><td>Set by Meta: tells Meta a visit came from the same browser, to measure our adverts</td><td>90 days</td></tr>
          <tr><td className="font-mono text-xs">_fbc</td><td>Set by Meta when you arrive from one of our Facebook adverts</td><td>90 days</td></tr>
        </tbody>
      </table>
      <p>Meta uses this under its own privacy policy (<a href="https://www.facebook.com/privacy/policy">facebook.com/privacy/policy</a>). Your choice is remembered on this device (<span className="font-mono text-xs">wyndos-ads-consent</span>).</p>

      <h2>Stored on your device</h2>
      <ul>
        <li><strong>Light or dark mode</strong> (<span className="font-mono text-xs">wyndos-theme</span>): remembers your choice.</li>
        <li><strong>Offline pages</strong>: the app saves today&apos;s and the next few days&apos; day sheets on your device so they work without signal. They are cleared when you sign out.</li>
        <li><strong>Offline taps</strong>: jobs marked done or paid with no signal wait on your device until they can be sent.</li>
      </ul>

      <h2>Changes</h2>
      <p>If we add any other non-essential cookies, we will update this page and ask for your consent first.</p>
    </LegalPage>
  );
}
