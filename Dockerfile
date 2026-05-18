# Resona — single-image build.
# Stage 1 builds the React client; stage 2 runs the Express server, which in
# production serves both the JSON API and the built client (see server/index.js).

FROM node:22-slim AS build
WORKDIR /app
# Install the full workspace dependency tree (needs every workspace's manifest).
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci
# Build the client bundle into client/dist.
COPY . .
RUN npm run build --workspace=client

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production dependencies only (drops Vite and the client build toolchain).
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev && npm cache clean --force
# Server code + migrations, and the built client from the build stage.
COPY server ./server
COPY --from=build /app/client/dist ./client/dist
EXPOSE 3030
# Migrations run automatically on boot (server/index.js).
CMD ["node", "server/index.js"]
