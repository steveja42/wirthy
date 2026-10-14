// Guards substituteAudioPlayers: an <audio> player (WordPress MediaElement.js,
// PowerPress podcasts) becomes a "▶ Listen" card instead of stray "00:00 00:00"
// text, and the link strip duplicating it goes. See audio-player.html.

import { describe, it, expect } from 'vitest';
import { captureContext } from '@/content/capture';
import { loadFixture } from '../helpers/loadFixture';

const MP3 = 'https://www.corbettreport.com/mp3/solutionswatch-unvandalism.mp3?_=1';

describe('audio player substitution', () => {
  const capture = async () => {
    loadFixture('audio-player.html', 'https://corbettreport.com/unvandalism/');
    return captureContext('article', { smartArticleDetection: false, stripInlineStyles: false });
  };

  it('replaces the player with a playable card linking the audio file', async () => {
    const html = (await capture()).bodyHtml ?? '';
    expect(html).toContain(`<a class="dx-video-link" href="${MP3}"`);
    expect(html).toContain('▶ Listen');
    expect(html, 'player timers').not.toContain('00:00');
  });

  it('drops the link strip that duplicates the card, but not prose linking the same file', async () => {
    const { bodyHtml = '', bodyText = '' } = await capture();
    expect(bodyText).not.toContain('Play in new window');
    expect(bodyHtml).not.toContain('Embed');
    expect(bodyText, 'prose link to the same MP3').toContain('PROSE-MP3-LINK');
  });

  it('removes a player with no playable file instead of leaving its timers', async () => {
    const html = (await capture()).bodyHtml ?? '';
    expect(html).not.toContain('12:34');
    expect(html.match(/▶ Listen/g)?.length, 'one card').toBe(1);
    expect(html).toContain('Join James');
  });
});
