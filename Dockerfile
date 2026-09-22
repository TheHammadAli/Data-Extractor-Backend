# Chromium and its system libraries come with this image. Render's default Node environment has
# neither, which is why launching a browser there failed with ENOENT.
# The tag must track the "playwright" version in package.json — Playwright refuses to drive a
# browser build it wasn't shipped with.
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
# --legacy-peer-deps is required, not cosmetic: npm 11's strict peer resolver crashes on this
# dependency set (arborist "#loadPeerSet ... edgesOut of null"), so the lockfile is generated in
# legacy mode and `npm ci` has to read it the same way or it reports packages as missing.
RUN npm ci --legacy-peer-deps

COPY . .
RUN npx prisma generate && npm run build

# No user browser exists on a server, so the agent runs one of its own, with no screen to show it on.
ENV NODE_ENV=production
ENV BROWSER_MODE=launch
ENV BROWSER_HEADLESS=true

EXPOSE 3001

# Migrations run on boot so a fresh database matches the schema this build expects.
CMD ["sh", "-c", "npx prisma migrate deploy && node --enable-source-maps dist/main"]
