# syntax=docker/dockerfile:1
# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/
COPY apps/api/prisma.config.ts apps/api/
COPY apps/api/src apps/api/src
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build

# ---------- runtime ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /repo
RUN npm i -g prisma@7
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts --workspace @passe-trou/api --include-workspace-root=false
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/prisma.config.ts apps/api/prisma.config.ts
COPY --from=build /repo/apps/api/src/env.ts apps/api/src/env.ts
COPY --from=build /repo/apps/api/src/generated apps/api/src/generated
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY docker-entrypoint.sh ./
EXPOSE 8477
CMD ["./docker-entrypoint.sh"]
