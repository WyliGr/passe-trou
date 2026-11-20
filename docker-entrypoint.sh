#!/bin/sh
set -e
cd /repo
prisma migrate deploy --config apps/api/prisma.config.ts
exec node apps/api/dist/index.js
