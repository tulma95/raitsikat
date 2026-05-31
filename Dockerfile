FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# --include=optional is required so sharp pulls its linuxmusl prebuilt
# binaries (@img/sharp-linuxmusl-* + @img/sharp-libvips-linuxmusl-*).
# Without these, `require('sharp')` throws at startup on alpine.
# devDeps are kept: astro + @astrojs/node + @astrojs/check are needed
# to run `astro build` below.
RUN npm ci --include=optional

COPY server ./server
COPY public ./public
COPY src ./src
COPY astro.config.mjs tsconfig.json tsconfig.server.json ./

# Produce dist/server/entry.mjs + dist/client/. The runtime CMD imports
# the prebuilt, self-contained dist/server/entry.mjs (via server/index.ts),
# so astro is not needed at runtime.
RUN npm run build

# Drop devDeps now that the build is done. Re-run --include=optional so
# sharp's musl prebuilts survive the prune.
RUN npm prune --omit=dev --include=optional

USER node

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "server/index.ts"]
