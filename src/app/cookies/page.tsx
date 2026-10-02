import { LegalPage } from "@/components/legal-page";

export const metadata = {
  title: "Cookie Policy | Wyndos",
  description: "The cookies Wyndos uses. Only what's needed to sign in and stay secure.",
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
        Wyndos only uses <strong>strictly necessary</strong> cookies: the ones needed to sign you in, keep your account secure and remember which business
        you are working in. Because they are essential, the law doesn&apos;t require us to ask for consent, so you won&apos;t see a cookie banner.
      </p>
      <p><strong>We don&apos;t use analytics, advertising or tracking cookies, and we don&apos;t let other companies set cookies through Wyndos.</strong></p>

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

      <h2>Stored on your device</h2>
      <ul>
        <li><strong>Light or dark mode</strong> (<span className="font-mono text-xs">wyndos-theme</span>): remembers your choice.</li>
        <li><strong>Offline pages</strong>: the app saves today&apos;s and the next few days&apos; day sheets on your device so they work without signal. They are cleared when you sign out.</li>
        <li><strong>Offline taps</strong>: jobs marked done or paid with no signal wait on your device until they can be sent.</li>
      </ul>

      <h2>Changes</h2>
      <p>If we ever want to add non-essential cookies (for example analytics), we will update this page and ask for your consent first.</p>
    </LegalPage>
  );
}
