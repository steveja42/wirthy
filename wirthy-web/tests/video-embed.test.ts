import { describe, it, expect } from 'vitest';
import { resolveVideoEmbed } from '@/lib/video-embed';

describe('resolveVideoEmbed', () => {
  it('resolves the common YouTube URL shapes to one nocookie embed', () => {
    const id = 'dQw4w9WgXcQ';
    for (const url of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://m.youtube.com/watch?v=${id}`,
    ]) {
      const r = resolveVideoEmbed(url);
      expect(r, url).not.toBeNull();
      expect(r!.provider).toBe('YouTube');
      // youtube-nocookie sets no tracking cookie until playback begins.
      expect(r!.embedUrl).toContain('youtube-nocookie.com/embed/' + id);
      expect(r!.href).toBe(`https://www.youtube.com/watch?v=${id}`);
    }
  });

  it('carries a YouTube start time through, in seconds', () => {
    expect(resolveVideoEmbed('https://youtu.be/dQw4w9WgXcQ?t=90')!.embedUrl).toContain('start=90');
    // "1m30s" is the shape the share dialog produces.
    expect(resolveVideoEmbed('https://youtu.be/dQw4w9WgXcQ?t=1m30s')!.embedUrl).toContain('start=90');
  });

  it('rejects a YouTube path segment that is not an 11-char id', () => {
    // /playlist and /channel paths must not be mistaken for a video.
    expect(resolveVideoEmbed('https://www.youtube.com/playlist?list=PL123')).toBeNull();
  });

  it('embeds Instagram reels through the singular /reel/ canonical form', () => {
    // Instagram SERVES the player at /reels/ but only /reel/ is embeddable.
    const plural = resolveVideoEmbed('https://www.instagram.com/reels/Dc1goBzv1Rm/');
    expect(plural!.provider).toBe('Instagram');
    expect(plural!.embedUrl).toBe('https://www.instagram.com/reel/Dc1goBzv1Rm/embed/');
    expect(plural!.href).toBe('https://www.instagram.com/reel/Dc1goBzv1Rm/');
    // A photo post keeps its own /p/ prefix.
    expect(resolveVideoEmbed('https://www.instagram.com/p/ABC123/')!.embedUrl)
      .toBe('https://www.instagram.com/p/ABC123/embed/');
  });

  it('resolves Vimeo, TikTok, X and Facebook', () => {
    expect(resolveVideoEmbed('https://vimeo.com/123456789')!.embedUrl)
      .toBe('https://player.vimeo.com/video/123456789');
    expect(resolveVideoEmbed('https://www.tiktok.com/@nasa/video/7212345678901234567')!.provider)
      .toBe('TikTok');
    expect(resolveVideoEmbed('https://x.com/user/status/1234567890123456')!.embedUrl)
      .toContain('platform.twitter.com/embed/Tweet.html?id=1234567890123456');
    expect(resolveVideoEmbed('https://www.facebook.com/reel/123456')!.provider).toBe('Facebook');
  });

  it('resolves Odysee embeds (percent-encoded, as its embed code emits them) and watch pages', () => {
    const embed = 'https://odysee.com/%24/embed/%40corbettreport%3A0%2Fsolutionswatch-unvandalism%3A1';
    for (const url of [
      `${embed}?r=4dTXQMGJ`,
      'https://odysee.com/$/embed/@corbettreport:0/solutionswatch-unvandalism:1',
      'https://odysee.com/@corbettreport:0/solutionswatch-unvandalism:1',
    ]) {
      const r = resolveVideoEmbed(url);
      expect(r, url).not.toBeNull();
      expect(r!.provider).toBe('Odysee');
      expect(r!.embedUrl).toBe(`${embed}?autoplay=true`);
      expect(r!.href).toBe('https://odysee.com/@corbettreport:0/solutionswatch-unvandalism:1');
    }
    // A channel page is not a video.
    expect(resolveVideoEmbed('https://odysee.com/@corbettreport:0')).toBeNull();
  });

  it('plays a direct https media file natively', () => {
    const url = 'https://r2a.primal.net/uploads2/1/76/d9/176d929e.mp4';
    expect(resolveVideoEmbed(url)).toEqual({ embedUrl: url, provider: 'video', href: url, direct: true });
    expect(resolveVideoEmbed('https://cdn.example.com/clip.webm?x=1')!.direct).toBe(true);
    // A page URL is never direct, even when a provider is known.
    expect(resolveVideoEmbed('https://vimeo.com/123456789')!.direct).toBeUndefined();
  });

  it('plays a direct https audio file natively, as audio', () => {
    const url = 'https://www.corbettreport.com/mp3/solutionswatch-unvandalism.mp3?_=1';
    expect(resolveVideoEmbed(url)).toEqual({ embedUrl: url, provider: 'audio', href: url, direct: true, audio: true });
    expect(resolveVideoEmbed('https://cdn.example.com/clip.mp4')!.audio).toBeUndefined();
    expect(resolveVideoEmbed('http://example.com/show.mp3')).toBeNull();
  });

  it('returns null for unknown hosts and non-http schemes', () => {
    // Callers must keep the plain link-out card in these cases, never error.
    expect(resolveVideoEmbed('https://example.com/watch/123')).toBeNull();
    expect(resolveVideoEmbed('http://example.com/video.mp4')).toBeNull();
    expect(resolveVideoEmbed('blob:https://www.instagram.com/abc-123')).toBeNull();
    expect(resolveVideoEmbed('javascript:alert(1)')).toBeNull();
    expect(resolveVideoEmbed('not a url')).toBeNull();
  });
});
