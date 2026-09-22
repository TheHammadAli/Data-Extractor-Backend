import { createServer } from 'node:http';
import { parse, pathToFileURL } from 'node:url';

const PORT = Number(process.env.FIXTURE_PORT ?? 4310);

const LISTINGS = {
  'mobile-phones': {
    Lahore: [
      { id: 'mp-lhr-1', title: 'iPhone 15 Pro', price: 'Rs. 350,000', date: '21 Sep 2026', description: 'Excellent condition, barely used.<br/>Box included.', seller: 'Ahmed Khan', address: 'Gulberg, Lahore', phone: '0300 1234567' },
      { id: 'mp-lhr-2', title: 'Samsung Galaxy S24', price: 'Rs. 280,000', date: 'Yesterday', description: 'Brand new, sealed pack.', seller: 'Ali Raza', address: 'DHA, Lahore', phone: '0312-1234567' },
      { id: 'mp-lhr-3', title: 'Google Pixel 9', price: 'Rs. 210,000', date: 'Today', description: 'One year used, no scratches.', seller: 'Bilal Hussain', address: 'Johar Town, Lahore', phone: '+92 333 1234567' },
    ],
    'page2-Lahore': [
      { id: 'mp-lhr-4', title: 'OnePlus 12', price: 'Rs. 190,000', date: '18 Sep 2026', description: 'Minor scratch on back.', seller: 'Sara Ahmed', address: 'Model Town, Lahore', phone: '' },
    ],
  },
};

function renderPage(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function hasSession(req) {
  return (req.headers.cookie ?? '').includes('session=1');
}

function renderListingCard(l) {
  return `<div class="listing-card">
    <a href="/listing/${l.id}">${l.title}</a>
    <p>${l.price}</p>
  </div>`;
}

const server = createServer((req, res) => {
  const { pathname, query } = parse(req.url ?? '/', true);

  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      renderPage(
        'Login',
        `<h1>Fixture Marketplace</h1>
        <form method="POST" action="/login">
          <label for="username">Username</label>
          <input id="username" name="username" type="text" />
          <label for="password">Password</label>
          <input id="password" name="password" type="password" />
          <button type="submit">Log In</button>
        </form>`,
      ),
    );
    return;
  }

  if (pathname === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      res.writeHead(302, { Location: '/home', 'Set-Cookie': 'session=1; Path=/' });
      res.end();
    });
    return;
  }

  if (pathname === '/home') {
    if (!hasSession(req)) {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      renderPage(
        'Home',
        `<h1>Welcome</h1>
        <nav>
          <a href="/category/mobile-phones">Mobile Phones</a>
          <a href="/category/cars">Cars</a>
        </nav>
        <p id="logout-marker">Logged in — <a href="/logout">Log out</a></p>`,
      ),
    );
    return;
  }

  if (pathname?.startsWith('/category/')) {
    const category = pathname.replace('/category/', '');
    const location = String(query.location ?? '');
    const page = String(query.page ?? '1');

    if (!location) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        renderPage(
          'Choose location',
          `<h1>${category}</h1>
          <form method="GET" action="/category/${category}">
            <label for="location">Location</label>
            <select id="location" name="location">
              <option value="">Select...</option>
              <option value="Lahore">Lahore</option>
              <option value="Karachi">Karachi</option>
              <option value="Islamabad">Islamabad</option>
            </select>
            <button type="submit">Go</button>
          </form>`,
        ),
      );
      return;
    }

    const key = page === '2' ? `page2-${location}` : location;
    const listings = LISTINGS[category]?.[key] ?? [];
    const hasNext = page === '1' && (LISTINGS[category]?.[`page2-${location}`]?.length ?? 0) > 0;

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      renderPage(
        `${category} in ${location}`,
        `<h1>${category} in ${location}</h1>
        <div class="listings">
          ${listings.map((l) => renderListingCard(l)).join('\n')}
        </div>
        ${hasNext ? `<a rel="next" href="/category/${category}?location=${location}&page=2">Next</a>` : ''}`,
      ),
    );
    return;
  }

  if (pathname?.startsWith('/listing/')) {
    const id = pathname.replace('/listing/', '');
    const listing = Object.values(LISTINGS)
      .flatMap((byCategory) => Object.values(byCategory))
      .flat()
      .find((l) => l.id === id);

    if (!listing) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(renderPage('Not found', '<h1>404</h1>'));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      renderPage(
        listing.title,
        `<h1>${listing.title}</h1>
        <p>Date: ${listing.date}</p>
        <p>Description: ${listing.description}</p>
        <p>Seller Name: ${listing.seller}</p>
        <p>Address: ${listing.address}</p>
        <p>Price: ${listing.price}</p>
        ${
          listing.phone
            ? `<button id="show-phone" onclick="document.getElementById('phone-value').style.display='block'">Show Phone Number</button>
               <div id="phone-value" style="display:none">${listing.phone}</div>`
            : ''
        }`,
      ),
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/html' });
  res.end(renderPage('Not found', '<h1>404</h1>'));
});

export function startFixtureServer(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

export { server };

// Allow running this file directly (`node server.js`) for manual/local testing,
// in addition to being imported by the e2e test suite.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFixtureServer().then(() => {
    console.log(`Fixture site listening on http://localhost:${PORT}`);
  });
}

