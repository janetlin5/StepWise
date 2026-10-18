This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Anonymous demo cookie signing

Set `ANONYMOUS_DEMO_COOKIE_SECRET` in Vercel's server environment and redeploy to
enable HMAC signing of the demo usage cookie. Use a randomly generated secret
(e.g. 32 random bytes); the implementation requires at least 16 characters.
Never use a `NEXT_PUBLIC_` prefix or commit the secret.

Without a valid secret, cookies remain unsigned for compatibility and the server
logs a warning. With signing enabled, malformed, edited, and old unsigned cookies
are treated as having exhausted the anonymous allowance. Rotating the secret
also invalidates existing signed cookies.

Signing detects edits; it does not prevent deleting cookies, replaying an earlier
valid cookie, or starting a new browser session. Durable abuse prevention needs
a separate server-side rate limit or identity-based quota.
