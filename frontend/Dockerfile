# Build Vite assets. VITE_API_BASE_URL is embedded in browser JavaScript at build time.
FROM node:22-alpine AS build

WORKDIR /app/frontend

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src ./src

# This URL is reached by the user's browser, not from inside the frontend container.
# Override it for deployments where the API has a different browser-accessible URL.
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# Serve static files as an unprivileged Nginx process.
FROM nginxinc/nginx-unprivileged:alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
