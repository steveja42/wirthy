// useFollowMutation: an optimistic toggle shows at once, is dropped once the
// live follow list agrees (so a later change made elsewhere is not masked), and
// is reverted when the extension reports the publish failed.

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFollowMutation } from '@/hooks/useFollowMutation';
import type { FollowProfile } from '@/lib/nostr/follows';

vi.mock('@/lib/bridge/extension-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/bridge/extension-bridge')>()),
  sendFollowPubkeyToExtension: vi.fn(),
  sendUnfollowPubkeyToExtension: vi.fn(),
}));

const PK = 'a'.repeat(64);
const list = (...pubkeys: string[]) => pubkeys.map((pubkey) => ({ pubkey }) as FollowProfile);

describe('useFollowMutation', () => {
  it('drops the optimistic override once the follow list agrees', () => {
    const { result, rerender } = renderHook(({ follows }) => useFollowMutation(follows, true),
      { initialProps: { follows: list() } });
    act(() => result.current.toggleFollow(PK));
    expect(result.current.isFollowing(PK)).toBe(true);

    rerender({ follows: list(PK) });   // the relay caught up
    expect(result.current.isFollowing(PK)).toBe(true);
    rerender({ follows: list() });     // unfollowed elsewhere: no stale override may mask it
    expect(result.current.isFollowing(PK)).toBe(false);
  });

  it('reverts the toggle and reports the error when the publish fails', () => {
    const { result } = renderHook(() => useFollowMutation(list(), true));
    act(() => result.current.toggleFollow(PK));
    expect(result.current.isFollowing(PK)).toBe(true);

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'WIRTHY_BRIDGE_FOLLOW_RESULT', pubkey: PK, ok: false, error: 'relay refused' },
      }));
    });
    expect(result.current.isFollowing(PK)).toBe(false);
    expect(result.current.lastError).toEqual({ pubkey: PK, message: 'relay refused' });
  });

  it('does nothing without the extension', () => {
    const { result } = renderHook(() => useFollowMutation(list(), false));
    act(() => result.current.toggleFollow(PK));
    expect(result.current.isFollowing(PK)).toBe(false);
  });
});
