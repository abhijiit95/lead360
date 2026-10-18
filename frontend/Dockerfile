# Build Vite assets. VITE_API_BASE_URL is embedded in browser JavaScript at build time.
FROM node:22-alpine AS build

WORKDIR /app/frontend

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src ./src

# This URL is reached by the user's browser, not from inside the frontend container.
# Supply the browser-accessible API URL for every image build. Local Compose
# supplies its localhost default; production builds must pass an HTTPS URL.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ARG FRONTEND_BUILD_ENV=production
ENV FRONTEND_BUILD_ENV=${FRONTEND_BUILD_ENV}

COPY scripts/validate-api-url.mjs ./scripts/validate-api-url.mjs
RUN node scripts/validate-api-url.mjs
RUN npm run build

# Serve static files as an unprivileged Nginx process.
FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
