import assert from 'node:assert/strict';
import { test } from 'node:test';

import { templateBlurb } from './blurbs.js';
import { channelPageUrl, extractChannelId, extractChannelTitle, feedUrl, parseVideoFeed, thumbnailUrl } from './youtube.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <id>yt:channel:AbCdEfGhIjKlMnOpQrStUv</id>
  <yt:channelId>UCAbCdEfGhIjKlMnOpQrStUv</yt:channelId>
  <title>نادي المستثمرين</title>
  <entry>
    <id>yt:video:CnWMWS_nDpM</id>
    <yt:videoId>CnWMWS_nDpM</yt:videoId>
    <title>قصة نادي المستثمرين</title>
    <published>2026-08-01T10:00:00+00:00</published>
    <media:group>
      <media:title>قصة نادي المستثمرين</media:title>
      <media:thumbnail url="https://i2.ytimg.com/vi/CnWMWS_nDpM/hqdefault.jpg" width="480" height="360"/>
      <media:description>كيف بدأ النادي وكيف وصل إلى آلاف الأعضاء.

تابعونا على المنصات.</media:description>
    </media:group>
  </entry>
  <entry>
    <id>yt:video:bad</id>
    <yt:videoId>bad</yt:videoId>
    <title>broken entry</title>
    <published>2026-08-02T10:00:00+00:00</published>
  </entry>
  <entry>
    <yt:videoId>XERenNWNziA</yt:videoId>
    <title>جولة في المقر</title>
    <published>2026-07-01T10:00:00+00:00</published>
  </entry>
</feed>`;

test('parseVideoFeed reads ids, titles, dates, descriptions and thumbnails; skips bad ids', () => {
  const { title, videos } = parseVideoFeed(FEED);
  assert.equal(title, 'نادي المستثمرين');
  assert.deepEqual(
    videos.map((video) => video.id),
    ['CnWMWS_nDpM', 'XERenNWNziA'],
  );
  assert.equal(videos[0]?.publishedAt, '2026-08-01T10:00:00.000Z');
  assert.equal(videos[0]?.thumbnail, 'https://i2.ytimg.com/vi/CnWMWS_nDpM/hqdefault.jpg');
  assert.match(videos[0]?.description ?? '', /^كيف بدأ النادي/);
  // Entries without media fall back to the deterministic thumbnail.
  assert.equal(videos[1]?.thumbnail, thumbnailUrl('XERenNWNziA'));
  assert.equal(videos[1]?.description, '');
});

test('channel id and title are extracted from a channel page', () => {
  const html = `<html><head><meta property="og:title" content="نادي المستثمرين &amp; شركاؤه"><link rel="canonical" href="https://www.youtube.com/channel/UCAbCdEfGhIjKlMnOpQrStUv"></head></html>`;
  assert.equal(extractChannelId(html), 'UCAbCdEfGhIjKlMnOpQrStUv');
  assert.equal(extractChannelTitle(html), 'نادي المستثمرين & شركاؤه');
  assert.equal(extractChannelId('<script>var x = {"channelId":"UCzzzzzzzzzzzzzzzzzzzzzz"}</script>'), 'UCzzzzzzzzzzzzzzzzzzzzzz');
  assert.equal(extractChannelId('<html>nothing</html>'), null);
  assert.equal(channelPageUrl('@investorscl'), 'https://www.youtube.com/@investorscl');
  assert.equal(channelPageUrl('investorscl'), 'https://www.youtube.com/@investorscl');
  assert.equal(channelPageUrl('UCAbCdEfGhIjKlMnOpQrStUv'), 'https://www.youtube.com/channel/UCAbCdEfGhIjKlMnOpQrStUv');
  assert.equal(feedUrl('UCAbCdEfGhIjKlMnOpQrStUv'), 'https://www.youtube.com/feeds/videos.xml?channel_id=UCAbCdEfGhIjKlMnOpQrStUv');
});

test('template blurbs use an informative Arabic first sentence, else the title', () => {
  assert.equal(
    templateBlurb({ id: 'a', title: 'x', description: 'كيف بدأ النادي وكيف وصل إلى آلاف الأعضاء خلال سنوات قليلة.\nتابعونا' }),
    'كيف بدأ النادي وكيف وصل إلى آلاف الأعضاء خلال سنوات قليلة.',
  );
  assert.equal(templateBlurb({ id: 'b', title: 'جولة في المقر', description: 'https://vcmem.com' }), 'في هذا الفيديو من نادي المستثمرين: جولة في المقر');
  // Lines that break the wording rules are not reused.
  assert.equal(templateBlurb({ id: 'c', title: 'ملتقى', description: 'استشارة مجانية لكل من يحضر الملتقى هذا الشهر.' }), 'في هذا الفيديو من نادي المستثمرين: ملتقى');
});
