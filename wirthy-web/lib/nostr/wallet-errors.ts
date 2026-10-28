// Some wallets (nos2x and relatives) latch into a "cancelled" state after a dismissed or
// stuck approval popup and then reject EVERY window.nostr call on the page without
// prompting. The flag lives in the page's injected window.nostr, so only a reload clears it.
export const WALLET_LATCHED_RE = /rejecting further|until the next reload/i;
