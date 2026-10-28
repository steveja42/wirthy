// Explore is read-only (no trash can, no note editor) and shows likes and threaded
// replies. Relays are never contacted: the engagement subscription is mocked.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Event } from 'nostr-tools';
import CastFeed from '@/components/feed/CastFeed';
import ClipRow from '@/components/feed/ClipRow';
import { CastReplies, LikeButton } from '@/components/feed/CastEngagement';
import { EMPTY_FILTERS } from '@/lib/feed-url';
import type { ClipData } from '@/lib/types';
import type { CastEngagementView } from '@/hooks/useCastEngagement';

vi.mock('@/lib/nostr/engagement-sub', () => ({ subscribeEngagement: () => () => {} }));
vi.mock('@/lib/nostr/profiles', async (orig) => ({
  ...(await orig<typeof import('@/lib/nostr/profiles')>()),
  subscribeAuthorProfiles: () => () => {},
}));

const AUTHOR = 'a'.repeat(64);

const cast: ClipData = {
  capture: {
    id: '1'.repeat(64), kind: 1, format: 'article', url: 'https://example.com/a', title: 'A public cast',
    timestamp: 1_740_000_000_000, bodyText: 'Body', note: 'The caster’s note', authorPubkey: AUTHOR,
  },
  evaluation: { qualifiers: [], category: 'Science' },
  encrypted: '',
};

function reply(id: string, pubkey: string, content: string): Event {
  return { id, pubkey, content, kind: 1, created_at: 1_700_000_000, tags: [], sig: '' };
}

const view = (over: Partial<CastEngagementView> = {}): CastEngagementView => ({
  noteId: cast.capture.id, likes: 0, myReactionIds: [], replyCount: 0, replies: [],
  liked: false, likePending: false, error: null, ...over,
});

describe('Explore detail', () => {
  it('has no delete button and no note editor', () => {
    const { container } = render(<CastFeed clips={[cast]} filters={EMPTY_FILTERS} onFiltersChange={() => {}} />);
    expect(container.querySelector('.btn-detail-delete')).toBeNull();
    expect(container.querySelector('.note-edit-trigger, .note-add-prompt, .note-textarea:not(.reply-textarea)')).toBeNull();
    expect(container.querySelector('.detail-note-row')).toHaveTextContent('The caster’s note');
    // Signed out: replies section shows the sign-in hint rather than a composer.
    expect(screen.getByText(/Sign in with a Nostr signing extension/)).toBeInTheDocument();
  });
});

describe('<ClipRow /> engagement', () => {
  it('shows like and reply counts when there are any', () => {
    render(<ClipRow clip={cast} selected={false} onClick={() => {}} engagement={{ likes: 3, replies: 1 }} />);
    expect(screen.getByLabelText('3 likes')).toBeInTheDocument();
    expect(screen.getByLabelText('1 reply')).toBeInTheDocument();
  });

  it('shows nothing for a cast nobody engaged with', () => {
    const { container } = render(<ClipRow clip={cast} selected={false} onClick={() => {}} engagement={{ likes: 0, replies: 0 }} />);
    expect(container.querySelector('.clip-engagement')).toBeNull();
  });
});

describe('<CastReplies />', () => {
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);
  const threaded = view({
    replyCount: 2,
    replies: [{ event: reply('r1', B, 'Top reply https://example.org/x.'), children: [{ event: reply('r2', C, 'Nested reply'), children: [] }] }],
  });

  it('renders a nested thread with links but no HTML', () => {
    const { container } = render(
      <CastReplies view={{ ...threaded, replies: [{ ...threaded.replies[0], event: reply('r1', B, '<b>bold?</b> https://example.org/x.') }] }}
        canAct={false} onToggleLike={() => {}} onReply={async () => {}} />,
    );
    expect(container.querySelector('.reply-list--nested')).not.toBeNull();
    expect(screen.getByText('Nested reply')).toBeInTheDocument();
    expect(container.querySelector('.reply-text b')).toBeNull();
    expect(screen.getByRole('link', { name: 'https://example.org/x' })).toHaveAttribute('rel', 'noopener nofollow ugc');
  });

  it('replies to a reply with that reply as the parent', async () => {
    const onReply = vi.fn(async () => {});
    render(<CastReplies view={threaded} canAct onToggleLike={() => {}} onReply={onReply} />);
    fireEvent.click(screen.getAllByText('Reply', { selector: '.reply-action' })[1]);
    const box = screen.getByLabelText(/^Reply to /);
    fireEvent.change(box, { target: { value: 'Me too' } });
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
    await vi.waitFor(() => expect(onReply).toHaveBeenCalledWith({ id: 'r2', pubkey: C, tags: [] }, 'Me too'));
  });

  it('repeats the like/reply bar above the thread: like toggles, reply focuses the composer', () => {
    const onToggleLike = vi.fn();
    const { container } = render(<CastReplies view={view({ likes: 4, replyCount: 2 })} canAct onToggleLike={onToggleLike} onReply={async () => {}} />);
    const bar = container.querySelector('.cast-replies-bar')!;
    fireEvent.click(bar.querySelector('.btn-detail-like')!);
    expect(onToggleLike).toHaveBeenCalled();
    expect(bar.querySelector('.btn-detail-like')).toHaveTextContent('4');
    fireEvent.click(bar.querySelector('.btn-detail-replies')!);
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Write a reply…'));
  });

  it('offers sign-in instead of a composer when the session cannot sign', () => {
    const onSignIn = vi.fn();
    render(<CastReplies view={view()} canAct={false} onToggleLike={() => {}} onReply={async () => {}} onSignIn={onSignIn} />);
    expect(screen.queryByPlaceholderText('Write a reply…')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalled();
  });
});

describe('<LikeButton />', () => {
  it('toggles when the session can sign, and asks to sign in otherwise', () => {
    const onToggleLike = vi.fn();
    const onSignIn = vi.fn();
    const { rerender } = render(<LikeButton view={view({ likes: 2, liked: true })} canAct onToggleLike={onToggleLike} onReply={async () => {}} />);
    const btn = screen.getByRole('button', { pressed: true });
    expect(btn).toHaveTextContent('2');
    fireEvent.click(btn);
    expect(onToggleLike).toHaveBeenCalled();

    rerender(<LikeButton view={view()} canAct={false} onToggleLike={onToggleLike} onReply={async () => {}} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSignIn).toHaveBeenCalled();
    expect(onToggleLike).toHaveBeenCalledTimes(1);
  });

  it('waits for the cast note before allowing a like', () => {
    render(<LikeButton view={view({ noteId: undefined })} canAct onToggleLike={() => {}} onReply={async () => {}} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
