// One-time setup: generate a VAPID keypair for web-push.
// Run: bun scripts/generate-vapid-keys.mjs
// Then add the printed values to Vercel env vars:
//   VAPID_PUBLIC_KEY  — exposed to clients via /pro/flights page
//   VAPID_PRIVATE_KEY — server-only, used by api/_alert-dispatcher.ts
//   VAPID_SUBJECT     — mailto: address (e.g. mailto:hello@theblueboard.co)
//
// Regenerating keys invalidates all existing push subscriptions — clients
// must re-subscribe. Don't rotate without a plan.

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log('');
console.log('Add these to your Vercel project env vars:');
console.log('');
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
console.log('VAPID_SUBJECT=mailto:hello@theblueboard.co');
console.log('');
console.log('Public key is safe to expose to clients (used as applicationServerKey).');
console.log('Private key MUST stay server-side. Never commit it.');
