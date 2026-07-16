import Link from 'next/link';
import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/lib/brand';
import { findSeoPage, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(findSeoPage('/terms'));

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="font-serif text-[22px] font-normal tracking-[-0.02em] text-text-primary">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function Subsection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <h3 className="text-[15px] font-medium text-text-primary">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }): JSX.Element {
  return <p>{children}</p>;
}

function Ul({ items }: { items: string[] }): JSX.Element {
  return (
    <ul className="list-disc space-y-2 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function TermsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto max-w-3xl px-5 py-16">
        <Link href="/" className="text-[12px] text-accent-primary hover:text-accent-dark">
          ← {PRODUCT_NAME}
        </Link>
        <h1 className="mt-8 font-serif text-[32px] font-normal tracking-[-0.025em]">Terms of Service</h1>
        <p className="mt-2 text-sm text-text-secondary">Last updated: July 6, 2026</p>

        <div className="mt-10 space-y-10 text-[15px] leading-7 text-text-secondary">
          <Section id="agreement" title="1. Agreement to Terms">
            <P>
              These Terms of Service (&ldquo;Terms&rdquo;) constitute a legally binding agreement between you
              (&ldquo;you&rdquo; or &ldquo;User&rdquo;) and {PRODUCT_NAME} (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or
              &ldquo;our&rdquo;) governing your access to and use of the {PRODUCT_NAME} platform and all associated
              services (the &ldquo;Service&rdquo;).
            </P>
            <P>
              By creating an account, connecting a social account, or using the Service, you agree to be bound by these
              Terms. If you are using the Service on behalf of an organization, you represent that you have the
              authority to bind that organization to these Terms.
            </P>
          </Section>

          <Section id="service" title="2. Description of Service">
            <P>
              {PRODUCT_NAME} is an AI-powered content operations platform that enables creators, founders, and teams
              to:
            </P>
            <Ul
              items={[
                'Generate, draft, and refine content trained on your voice and brand',
                'Schedule and publish posts to connected social platforms',
                'Manage engagement workflows, inbox replies, and warm-contact outreach',
                'Access analytics, signals, and content performance insights',
                'Integrate with third-party tools and agent APIs for automated workflows',
              ]}
            />
          </Section>

          <Section id="accounts" title="3. Account Registration">
            <Subsection title="3.1 Eligibility">
              <P>
                You must be at least 16 years old to use the Service. By creating an account, you represent that you
                meet this requirement and that all registration information you provide is accurate and complete.
              </P>
            </Subsection>
            <Subsection title="3.2 Account Security">
              <P>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. You must:</P>
              <Ul
                items={[
                  'Keep your password secure and not share it with others',
                  'Notify us immediately of any unauthorized access to your account',
                  'Ensure that anyone using the Service through your account complies with these Terms',
                ]}
              />
            </Subsection>
            <Subsection title="3.3 Workspaces">
              <P>
                You may create or join workspaces to collaborate with team members. Workspace owners and admins are
                responsible for managing members, roles, connected accounts, and permissions. Feature access and usage
                limits are determined by your subscription plan.
              </P>
            </Subsection>
          </Section>

          <Section id="acceptable-use" title="4. Acceptable Use">
            <P>You agree to use the Service only for lawful purposes and in accordance with these Terms. You must not:</P>
            <Ul
              items={[
                'Use the Service to spam, harass, impersonate others, or distribute fraudulent or misleading content',
                'Publish or automate content that violates applicable laws, platform policies, or third-party rights',
                'Attempt to circumvent security measures, rate limits, or access controls of the Service or any connected platform',
                'Use the Service to scrape, harvest, or collect data from third-party platforms without authorization',
                'Reverse-engineer, decompile, or disassemble any part of the Service',
                'Resell, sublicense, or redistribute access to the Service without our written consent',
                'Use the Service to generate phishing content, malware links, or other harmful material',
                'Connect social accounts you do not own or have explicit authorization to manage',
              ]}
            />
          </Section>

          <Section id="social-platforms" title="5. Connected Social Accounts & Third-Party Platforms">
            <Subsection title="5.1 Third-Party Platform Terms">
              <P>
                The Service currently integrates with LinkedIn and X (Twitter). Your use of those platforms
                through {PRODUCT_NAME} remains subject to each platform&apos;s own terms of service, community
                guidelines, developer policies, and applicable laws. You are solely responsible for understanding
                and complying with those third-party terms.
              </P>
            </Subsection>
            <Subsection title="5.2 No Guarantee of Account Status">
              <P>
                We do not operate, control, or guarantee the policies or enforcement actions of any third-party
                platform. We make no representation or warranty that your use of the Service will keep your social
                accounts in good standing. Account restrictions, suspensions, shadowbans, rate limits, content
                removals, loss of reach, loss of followers, or permanent bans may occur for reasons entirely outside
                our control - including platform policy changes, automated enforcement, user reports, or activity
                that predates your use of {PRODUCT_NAME}.
              </P>
            </Subsection>
            <Subsection title="5.3 Your Assumption of Risk">
              <P>
                By connecting a social account and enabling publishing, scheduling, automation, engagement, or agent
                API features, you acknowledge and accept that:
              </P>
              <Ul
                items={[
                  'Automated posting, bulk actions, AI-generated replies, and API-driven workflows may trigger platform safeguards or restrictions',
                  'You assume all risk associated with account access, content published through the Service, and any resulting platform action taken against your accounts',
                  'We are not responsible for investigating, appealing, or reversing platform enforcement decisions on your behalf',
                  'Outcomes such as reach, engagement, revenue, or account longevity are not guaranteed',
                ]}
              />
            </Subsection>
            <Subsection title="5.4 Authorization to Connect Accounts">
              <P>
                When you connect a social account via OAuth or other credentials, you represent that you are the
                account owner or have explicit written authorization to grant {PRODUCT_NAME} access to publish, read,
                and manage content on that account. You are liable for any unauthorized connections made through your
                {PRODUCT_NAME} account.
              </P>
            </Subsection>
            <Subsection title="5.5 Service Modifications for Platform Compliance">
              <P>
                We may modify, throttle, suspend, or disable features (including publishing, automation, or agent
                access) if we reasonably believe your use violates platform policies, poses legal risk, or threatens
                the integrity of the Service. We are not obligated to provide advance notice when immediate action is
                required to protect the Service or other users.
              </P>
            </Subsection>
          </Section>

          <Section id="content" title="6. Your Content & AI-Generated Output">
            <Subsection title="6.1 Your Content">
              <P>
                You retain ownership of all content you submit to the Service, including drafts, voice samples, brand
                materials, media, and configuration data (&ldquo;Your Content&rdquo;). By using the Service, you
                grant us a limited, non-exclusive license to process Your Content solely to provide the Service to
                you.
              </P>
            </Subsection>
            <Subsection title="6.2 AI-Generated Content">
              <P>
                Content generated or suggested by the Service is produced using AI models and automation. You are
                solely responsible for reviewing, editing, and approving all content before publishing. AI output may
                be inaccurate, incomplete, or inappropriate for your audience. We do not guarantee that generated
                content complies with platform rules, advertising standards, or legal requirements.
              </P>
            </Subsection>
            <Subsection title="6.3 Published Content">
              <P>
                Once you publish or schedule content through the Service, you are fully responsible for that content
                and its consequences on connected platforms - including moderation actions, takedowns, account
                penalties, and any claims from third parties.
              </P>
            </Subsection>
            <Subsection title="6.4 No Training on Your Data">
              <P>
                We do not use Your Content to train general-purpose AI or machine learning models for unrelated
                products. Your data is processed to deliver the Service, including personalization of your voice model
                and workspace features.
              </P>
            </Subsection>
          </Section>

          <Section id="credentials" title="7. OAuth Credentials & Agent Access">
            <Subsection title="7.1 Credential Security">
              <P>
                OAuth tokens, API keys, and session credentials you provide are encrypted at rest where configured and
                used only to operate features you enable. You must revoke access through the relevant platform if you
                suspect unauthorized use.
              </P>
            </Subsection>
            <Subsection title="7.2 Agent & API Keys">
              <P>
                If you create agent API keys or enable programmatic access, you are responsible for securing those
                keys, monitoring their usage, and ensuring all actions taken via the API comply with these Terms and
                applicable platform policies. Compromised or misused keys are your responsibility until revoked.
              </P>
            </Subsection>
          </Section>

          <Section id="billing" title="8. Subscription & Payment">
            <Subsection title="8.1 Plans">
              <P>
                The Service is available under various subscription plans, including free tiers with limited features.
                Paid plans offer additional capabilities and higher usage limits as described at checkout.
              </P>
            </Subsection>
            <Subsection title="8.2 Billing">
              <P>
                Paid subscriptions are billed in advance on a recurring basis through our payment processor. By
                subscribing, you authorize us to charge your payment method on file. All fees are quoted in USD unless
                otherwise stated.
              </P>
            </Subsection>
            <Subsection title="8.3 Cancellation">
              <P>
                You may cancel your subscription at any time through your account settings. Upon cancellation, you
                retain access to paid features until the end of your current billing period. We do not provide prorated
                refunds for partial billing periods except where required by law.
              </P>
            </Subsection>
            <Subsection title="8.4 Changes to Pricing">
              <P>
                We may change pricing with 30 days&apos; advance notice. Price changes take effect at the start of
                your next billing cycle following the notice period.
              </P>
            </Subsection>
          </Section>

          <Section id="ip" title="9. Intellectual Property">
            <Subsection title="9.1 Our Property">
              <P>
                The Service, including its software, design, documentation, trademarks, and associated intellectual
                property, is owned by {PRODUCT_NAME} and protected by applicable laws. Nothing in these Terms grants you
                any right to use our trademarks, logos, or branding without prior written consent.
              </P>
            </Subsection>
            <Subsection title="9.2 Feedback">
              <P>
                If you provide feedback, suggestions, or ideas about the Service, you grant us a perpetual,
                irrevocable, royalty-free license to use that feedback for any purpose without obligation to you.
              </P>
            </Subsection>
          </Section>

          <Section id="privacy" title="10. Privacy">
            <P>
              Your use of the Service is also governed by our{' '}
              <Link href="/privacy" className="text-accent-primary hover:text-accent-dark">
                Privacy Policy
              </Link>
              , which describes how we collect, use, and protect your information. By using the Service, you consent to
              the data practices described in our Privacy Policy.
            </P>
          </Section>

          <Section id="availability" title="11. Service Availability & Support">
            <Subsection title="11.1 Uptime">
              <P>
                We strive to maintain reliable availability for the Service. However, the Service is provided &ldquo;as
                is&rdquo; and we do not guarantee uninterrupted availability. Third-party platform API outages,
                policy changes, or authentication failures may affect features beyond our control.
              </P>
            </Subsection>
            <Subsection title="11.2 Modifications">
              <P>
                We reserve the right to modify, suspend, or discontinue any part of the Service at any time. We will
                provide reasonable notice for material changes that affect your use of the Service when practicable.
              </P>
            </Subsection>
          </Section>

          <Section id="liability" title="12. Limitation of Liability">
            <P>
              To the maximum extent permitted by law, {PRODUCT_NAME} and its officers, directors, employees,
              and agents shall not be liable for any indirect, incidental, special, consequential, or punitive damages,
              including but not limited to loss of profits, data, business opportunities, social account access,
              followers, reach, revenue, or goodwill, arising out of or related to your use of the Service.
            </P>
            <P>
              Without limiting the foregoing, we are not liable for any account suspension, ban, content removal, API
              restriction, or other enforcement action taken by a third-party platform in connection with your use of
              the Service - whether or not such action was triggered by content published, scheduled, or automated
              through {PRODUCT_NAME}.
            </P>
            <P>
              Our total aggregate liability for any claims arising under these Terms shall not exceed the amount you
              paid us in the twelve (12) months preceding the event giving rise to the claim.
            </P>
          </Section>

          <Section id="indemnification" title="13. Indemnification">
            <P>
              You agree to indemnify and hold harmless {PRODUCT_NAME}, its affiliates, and their respective officers,
              directors, employees, and agents from any claims, damages, losses, or expenses (including reasonable
              attorneys&apos; fees) arising from:
            </P>
            <Ul
              items={[
                'Your use of the Service, including content you publish, schedule, or automate',
                'Your violation of these Terms or any third-party platform terms',
                'Your connected social accounts, OAuth authorizations, or agent API usage',
                'Any claim that Your Content infringes or misappropriates third-party rights',
                'Platform enforcement actions, account bans, or penalties related to your activity',
              ]}
            />
          </Section>

          <Section id="warranties" title="14. Disclaimer of Warranties">
            <P>
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind,
              whether express, implied, or statutory, including but not limited to implied warranties of
              merchantability, fitness for a particular purpose, and non-infringement.
            </P>
            <P>
              We do not warrant that the Service will be error-free, secure, or uninterrupted, that third-party
              platform integrations will remain available, or that AI-generated content will be accurate, compliant,
              or safe to publish. Recommendations, drafts, and analytics are assistive tools and should not be treated
              as definitive business, legal, or compliance advice.
            </P>
          </Section>

          <Section id="termination" title="15. Termination">
            <Subsection title="15.1 By You">
              <P>
                You may terminate your account at any time through your account settings or by contacting support.
                Upon termination, your access to the Service will cease and we will delete your data in accordance
                with our Privacy Policy.
              </P>
            </Subsection>
            <Subsection title="15.2 By Us">
              <P>
                We may suspend or terminate your access if you violate these Terms, fail to pay applicable fees, misuse
                connected platforms, or engage in conduct we reasonably believe is harmful to the Service or other
                users. We will provide notice before termination when practicable.
              </P>
            </Subsection>
            <Subsection title="15.3 Effect of Termination">
              <P>
                Upon termination, your right to use the Service ceases immediately. Sections that by their nature
                should survive termination (including Connected Social Accounts, Limitation of Liability,
                Indemnification, and Dispute Resolution) will continue to apply.
              </P>
            </Subsection>
          </Section>

          <Section id="disputes" title="16. Dispute Resolution">
            <P>
              Any dispute arising out of or relating to these Terms or the Service shall first be attempted to be
              resolved through good-faith negotiation. If the dispute cannot be resolved within 30 days, it shall be
              submitted to binding arbitration in accordance with the rules of the American Arbitration Association.
              The arbitration shall be conducted in English.
            </P>
          </Section>

          <Section id="governing-law" title="17. Governing Law">
            <P>
              These Terms shall be governed by and construed in accordance with the laws of the State of Delaware,
              United States, without regard to its conflict of law provisions.
            </P>
          </Section>

          <Section id="changes" title="18. Changes to These Terms">
            <P>
              We may update these Terms from time to time. We will notify you of material changes by posting the
              updated Terms on this page and updating the &ldquo;Last updated&rdquo; date. Your continued use of the
              Service after changes constitutes acceptance of the updated Terms.
            </P>
          </Section>

          <Section id="general" title="19. General Provisions">
            <Ul
              items={[
                'Entire Agreement - These Terms, together with the Privacy Policy, constitute the entire agreement between you and ' +
                  PRODUCT_NAME +
                  ' regarding the Service.',
                'Severability - If any provision is found unenforceable, the remaining provisions remain in full force.',
                'Waiver - Our failure to enforce any provision does not constitute a waiver of that provision.',
                'Assignment - You may not assign your rights under these Terms without our prior written consent. We may assign our rights without restriction.',
              ]}
            />
          </Section>

          <Section id="contact" title="20. Contact Us">
            <P>
              If you have questions about these Terms, contact us through your account settings or the email on your
              invoice.
            </P>
            <P>
              See also our{' '}
              <Link href="/privacy" className="text-accent-primary hover:text-accent-dark">
                Privacy Policy
              </Link>
              .
            </P>
          </Section>
        </div>
      </div>
    </div>
  );
}
