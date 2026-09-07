// Legal copy, verbatim from mockup-v2/public-src/30-auth-legal.js.
export interface LegalSection {
  heading: string;
  body: string;
}

export const LEGAL_UPDATED = "Last updated: March 30, 2026";

export const LEGAL: Record<"privacy" | "terms" | "disclaimer", { title: string; sections: LegalSection[] }> = {
  privacy: {
    title: "Privacy Policy",
    sections: [
      {
        heading: "1. Information We Collect",
        body: "We collect information you provide when creating an account, including your name, email address, and mobile number. We also collect usage data such as pages visited and features used.",
      },
      {
        heading: "2. How We Use Your Information",
        body: "Your information is used to provide and improve our services, personalize your experience, and ensure platform security. We do not sell your personal data to third parties.",
      },
      {
        heading: "3. Data Storage & Security",
        body: "Your data is stored securely using industry-standard encryption and appropriate technical measures.",
      },
      {
        heading: "4. Cookies & Tracking",
        body: "We use essential cookies to maintain your session and preferences. You can manage cookie preferences through your browser settings.",
      },
      {
        heading: "5. Third-Party Services",
        body: "We integrate with Delta Exchange for market data. Their respective privacy policies also apply.",
      },
      {
        heading: "6. Your Rights",
        body: "You have the right to access, update, or delete your personal information at any time through your account settings.",
      },
      { heading: "7. Contact Us", body: "Questions? Contact us at support@hapiecoin.com." },
    ],
  },
  terms: {
    title: "Terms of Service",
    sections: [
      {
        heading: "1. Acceptance of Terms",
        body: "By accessing or using HapieCoin, you agree to be bound by these Terms of Service.",
      },
      {
        heading: "2. Description of Service",
        body: "HapieCoin provides crypto options analytics tools including real-time options chain data, strategy building, payoff analysis, Greeks calculations, and paper trading.",
      },
      {
        heading: "3. Account Responsibilities",
        body: "You are responsible for maintaining the confidentiality of your account credentials. You must be at least 18 years old.",
      },
      {
        heading: "4. Acceptable Use",
        body: "You agree not to misuse our services or use the platform for any illegal activity.",
      },
      {
        heading: "5. Intellectual Property",
        body: "All content and functionality of HapieCoin are owned by us and protected by intellectual property laws.",
      },
      {
        heading: "6. Limitation of Liability",
        body: 'HapieCoin is provided "as is" without warranties. We are not liable for trading losses or service interruptions.',
      },
      { heading: "7. Modifications", body: "We reserve the right to modify these terms at any time." },
      { heading: "8. Contact", body: "Contact us at support@hapiecoin.com." },
    ],
  },
  disclaimer: {
    title: "Disclaimer",
    sections: [
      {
        heading: "Not Financial Advice",
        body: "HapieCoin is an analytics and educational platform. Nothing on this platform constitutes financial advice, investment advice, or trading advice.",
      },
      {
        heading: "Trading Risks",
        body: "Options trading involves substantial risk of loss and is not suitable for all investors. You may lose more than your initial investment. Past performance is not indicative of future results.",
      },
      {
        heading: "Cryptocurrency Risks",
        body: "Cryptocurrency markets are highly volatile and unregulated in many jurisdictions. You should only trade with funds you can afford to lose.",
      },
      {
        heading: "Data Accuracy",
        body: "While we strive to provide accurate real-time data, we cannot guarantee the accuracy, completeness, or timeliness of any information displayed on the platform.",
      },
      {
        heading: "Paper Trading",
        body: "Paper trading results are simulated and do not represent actual trading. Real trading results may differ significantly due to slippage, liquidity, fees, and other market conditions.",
      },
      {
        heading: "No Guarantee",
        body: "We do not guarantee any specific outcomes from using our analytics tools. All trading decisions are your own responsibility.",
      },
      {
        heading: "Third-Party Integrations",
        body: "HapieCoin integrates with third-party exchanges and data providers. We are not responsible for the actions, services, or policies of these third parties.",
      },
    ],
  },
};
