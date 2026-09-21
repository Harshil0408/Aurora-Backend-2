# ---- Base ----
FROM node:24-alpine AS base
RUN apk add --no-cache openssl libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .

# ---- Development ----
FROM base AS development
EXPOSE 4000
CMD ["npm", "run", "dev"]

# ---- Production build ----
FROM base AS build
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS production
RUN apk add --no-cache openssl libc6-compat && addgroup -S app && adduser -S app -G app
WORKDIR /app
USER app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma ./prisma
EXPOSE 4000
CMD ["node", "dist/server.js"]
