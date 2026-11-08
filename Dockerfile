# Build stage: install everything, build the client
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Keep only what the server needs at runtime (tsx runs server.ts directly)
RUN npm prune --omit=dev

# Runtime stage
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/server ./server
COPY --from=build /app/prompts ./prompts
COPY --from=build /app/tsconfig.json ./tsconfig.json
# Cloud Run sets PORT (8080); the server reads it and listens on 0.0.0.0
USER node
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "server.ts"]
