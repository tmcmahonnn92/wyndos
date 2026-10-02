# Data protection: what Wyndos needs to do (UK GDPR)

Not legal advice. A short check by a UK data protection solicitor before charging customers is worth it.

## Your two roles

- **Controller** for your own users' data: owners and team members (names, emails, billing, logins, support messages).
- **Processor** for your users' customer data (names, addresses, phones, prices, payments). Each window cleaner is the
  controller of their customers' details. Wyndos only processes them on their behalf.

## Must do before taking paying customers

1. **Register with the ICO and pay the fee.** Tier 1 (micro business) is £52 a year, or £47 by direct debit.
   Use the ICO's registration self-assessment to confirm. Put the number in `NEXT_PUBLIC_ICO_NUMBER`.
2. **Fill in the legal details** (production env, then redeploy):
   - `NEXT_PUBLIC_LEGAL_NAME`, e.g. `Thomas McMahon trading as Wyndos`
   - `NEXT_PUBLIC_LEGAL_ADDRESS`, a UK postal address (a virtual office is fine if you don't want your home address public)
   - `NEXT_PUBLIC_HOSTING_LOCATION`, where your Hostinger VPS is (hPanel shows the data centre, e.g. "United Kingdom" or "Lithuania (EU)")
   - `NEXT_PUBLIC_ICO_NUMBER`
3. **Processor contract (Article 28).** Done in the app: the Terms include data processing terms, and every owner now
   ticks two boxes (terms + "I have the right to store and use my customers' details"). Existing owners are asked on
   their next visit. Change `TERMS_VERSION` in `src/lib/legal.ts` whenever the terms change, and everyone is asked again.
4. **Sub-processor list.** In `src/lib/legal.ts`. Keep it true: Hostinger, Brevo, Stripe, Google sign-in, OpenStreetMap.
   If you add one (e.g. SMS provider), add it there and email owners first.
5. **The old public repo.** Customer addresses were in the public GitHub history from March to September 2026.
   Make the repo private now. Then use the ICO's "report a breach" self-assessment to decide whether to report it
   (deadline is 72 hours from becoming aware, if reportable) and keep a note of your decision either way.

## Security (what's in place and what to keep doing)

- In place: HTTPS, hashed passwords, encrypted secrets in settings, per-business data separation, logged support
  access, hourly encrypted off-site backups (once set up), bank statements never uploaded.
- Keep the VPS patched (`unattended-upgrades`), SSH by key only, firewall (`ufw`) to 22/80/443.
- 2FA on GitHub, Hostinger, Stripe, Brevo, Cloudflare/Backblaze and your email.
- Keep secrets (`_devtools/config.js`, backup key) in a password manager, never in git.
- Working from Thailand is generally fine: you are the business, and the data stays on your UK/EU server. Use a
  password-locked laptop with disk encryption, and don't keep customer data exports on it longer than needed.

## Records to keep (simple documents)

- **Record of processing (ROPA):** what data, why, where it's stored, how long. One page is enough at this size.
- **Breach log:** date, what happened, who was affected, what you did, whether you reported it.
- **Retention:** account data deleted on account close; backups expire after 35 days; billing records 6 years.
- **Requests log:** any access/deletion requests and when you answered (one month limit).

## Tell your window cleaners

Window cleaners using Wyndos need their own short privacy notice for their customers (who they are, what they keep,
why, how long, that they use Wyndos to store it). A one-paragraph template in the help docs would be a useful extra.

## Marketing and cookies

- Only strictly necessary cookies, so no cookie banner is needed (PECR exemption). The Cookie Policy lists them.
- No marketing emails. If you start, get opt-in consent first (separate unticked box) and add an unsubscribe link.
- Service emails (sign-up, password reset, billing, notifications users switch on) are fine without consent.

## Sources

- ICO data protection fee: https://ico.org.uk/for-organisations/data-protection-fee/
- ICO controller/processor contracts: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/
- ICO breach reporting: https://ico.org.uk/for-organisations/report-a-breach/
- ICO cookies (PECR): https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/
