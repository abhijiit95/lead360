# Compile the existing TypeScript application using the lockfile-pinned toolchain.
FROM node:22-alpine AS build

WORKDIR /app/backend

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Keep the runtime image small and exclude TypeScript/build-only dependencies.
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app/backend

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/backend/dist ./dist

USER node

EXPOSE 4000
CMD ["node", "dist/server.js"]
