import { chromium } from 'playwright';
import { ListingCardDetectorService } from './listing-card-detector.service.js';

/** The real results page from the failing run. */
const RESULTS_URL = 'https://www.olx.com.pk/lahore_g4060673/mobile-phones_c1453';

/** The category menu the detector wrongly locked onto — taken verbatim from that run's log. */
const CATEGORY_LINKS = [
  'https://www.olx.com.pk/lahore_g4060673/other-wearables_c1500',
  'https://www.olx.com.pk/lahore_g4060673/landline-phones_c1459',
  'https://www.olx.com.pk/lahore_g4060673/cars-accessories_c2027',
  'https://www.olx.com.pk/lahore_g4060673/rickshaw-chingchi_c2026',
  'https://www.olx.com.pk/lahore_g4060673/buses-vans-trucks_c85',
  'https://www.olx.com.pk/lahore_g4060673/tractors-trailers_c1951',
];

const AD_LINKS = [
  'https://www.olx.com.pk/item/iphone-13-pro-max-iid-1099887766',
  'https://www.olx.com.pk/item/samsung-galaxy-s23-iid-1099887767',
  'https://www.olx.com.pk/item/infinix-hot-40i-iid-1099887768',
];

describe('ListingCardDetectorService.pickListingUrls', () => {
  const detector = new ListingCardDetectorService();

  it('ignores the category menu even when it is the bigger group', () => {
    const picked = detector.pickListingUrls([CATEGORY_LINKS, AD_LINKS], RESULTS_URL);

    expect(picked).toEqual(AD_LINKS);
  });

  it('never returns the results page itself', () => {
    const picked = detector.pickListingUrls([[RESULTS_URL, `${RESULTS_URL}/`, ...AD_LINKS]], RESULTS_URL);

    expect(picked).toEqual(AD_LINKS);
  });

  it('drops off-site links', () => {
    const picked = detector.pickListingUrls([[...AD_LINKS, 'https://facebook.com/olxpakistan']], RESULTS_URL);

    expect(picked).toEqual(AD_LINKS);
  });

  it('deduplicates repeated hrefs within a group', () => {
    const picked = detector.pickListingUrls([[...AD_LINKS, AD_LINKS[0], AD_LINKS[1]]], RESULTS_URL);

    expect(picked).toEqual(AD_LINKS);
  });

  it('rejects city filter links as well as category links', () => {
    const cityLinks = [
      'https://www.olx.com.pk/karachi_g4060695',
      'https://www.olx.com.pk/islamabad_g4060615',
      'https://www.olx.com.pk/rawalpindi_g4060681',
      'https://www.olx.com.pk/faisalabad_g4060617',
    ];

    const picked = detector.pickListingUrls([cityLinks, CATEGORY_LINKS, AD_LINKS], RESULTS_URL);

    expect(picked).toEqual(AD_LINKS);
  });

  it('returns nothing rather than falling back to index links', () => {
    // Extracting from a category menu is the bug this detector exists to prevent — an empty
    // result lets the executor stop and ask the user instead.
    expect(detector.pickListingUrls([CATEGORY_LINKS], RESULTS_URL)).toEqual([]);
  });
});

/**
 * Real-DOM regression test. Mirrors the OLX markup traits that each broke detection once:
 * the whole results grid inside a <header>, a featured first card styled with different classes,
 * empty full-card overlay links with the title in a sibling, and a "popular searches" block with
 * more links than there are results.
 */
describe('ListingCardDetectorService.detectListingUrls on OLX-shaped markup', () => {
  const card = (n: number, featured = false) => `
    <li class="${featured ? 'f86388f3' : ''}">
      <article class="${featured ? 'f114c800' : '_617daaaa'}">
        <a href="/item/phone-${n}-for-sale-iid-10000000${n}"><div></div></a>
        <div>Phone number ${n} for sale in Lahore — Rs 50,000</div>
      </article>
    </li>`;

  const html = `<html><body>
    <header>
      <ul class="_1aad128c">${card(1, true)}${[2, 3, 4, 5, 6].map((n) => card(n)).join('')}</ul>
    </header>
    <div class="popular">
      ${['google-pixel-pro', 'samsung-s-ultra', 'iphone-pta-approved', 'iphone-pro-max', 'redmi-note',
         'infinix-hot', 'tecno-spark', 'oppo-reno']
        .map((q) => `<a href="/lahore_g4060673/mobile-phones_c1453/q-${q}">Popular search: ${q}</a>`)
        .join('')}
    </div>
    <div class="cats">
      ${CATEGORY_LINKS.map((u) => `<a href="${new URL(u).pathname}">Browse this category now</a>`).join('')}
    </div>
  </body></html>`;

  it('returns every result in page order, featured card first, and nothing else', async () => {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.route('**/*', (route) =>
        route.request().url() === RESULTS_URL
          ? route.fulfill({ body: html, contentType: 'text/html' })
          : route.abort(),
      );
      await page.goto(RESULTS_URL);

      const urls = await new ListingCardDetectorService().detectListingUrls(page);

      expect(urls).toEqual(
        [1, 2, 3, 4, 5, 6].map((n) => `https://www.olx.com.pk/item/phone-${n}-for-sale-iid-10000000${n}`),
      );
    } finally {
      await browser.close();
    }
  }, 60000);
});
