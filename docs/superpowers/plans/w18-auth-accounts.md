# W18 — Auth console par comptes (email + mot de passe) — remplace ADMIN_TOKEN

Repo: /root/passetrou-workers/w18 (clone frais de main). Travaille sur la branche `feat/auth-accounts`. Identité commits: `git config user.name heermes && git config user.email 82271052+WyliGr@users.noreply.github.com` (dans le clone, --local).

## Contexte produit
passe•trou a aujourd'hui une auth console = header `Authorization: Bearer <ADMIN_TOKEN>` (env). Le propriétaire veut de vrais comptes :
- **Si 0 compte en base : /auth/register ouvert** — le premier compte créé devient le compte admin.
- **Dès qu'il y a ≥1 compte : register fermé (403), login only.**
- Register = email + name + password. Login = email + password.
- Les clés `pt_…` des members (consommateurs LLM, routes /v1/*) ne changent PAS — cette tâche ne concerne que l'auth de la console (/admin/* + dashboard web).

## Backend (apps/api)

1. **Prisma** (`apps/api/prisma/schema.prisma`) — ajoute :
   - `model User { id String @id @default(cuid()), email String @unique, name String, passwordHash String, role String @default("admin"), createdAt DateTime @default(now()), updatedAt DateTime @updatedAt, sessions Session[] }`
   - `model Session { id String @id @default(cuid()), tokenHash String @unique, userId String, user User @relation(fields: [userId], references: [id], onDelete: Cascade), createdAt DateTime @default(now()), expiresAt DateTime }`
   - Migration: `npx prisma migrate dev --name auth-users` (DATABASE_URL fournie ci-dessous).
2. **`src/lib/passwords.ts`** : hash = `crypto.scryptSync(pw, salt, 64, {N:16384,r:8,p:1})`, format stocké `scrypt:N:r:p:<salt b64>:<hash b64>`, vérif `timingSafeEqual`. Pas de dépendance npm externe.
3. **`src/lib/sessions.ts`** : `createSession(userId)` → token `crypto.randomBytes(32).toString("base64url")`, stocke `sha256(token)` comme tokenHash, TTL 30 jours (expiresAt fixe, pas de glissement en v1). `getUserByToken(token)` → user ou null (expired → null). `destroySession(token)`. Token jamais stocké en clair.
4. **`src/routes/auth.ts`** (monté sur l'app, SANS auth, avant les routers admin) :
   - `GET /auth/status` → `{ open: boolean }` (open = userCount === 0).
   - `POST /auth/register` {email, name, password} — si userCount>0 → `403 {error:{code:"registration_closed"}}`. Validation : email regex simple, name 1..80 chars, password ≥ 8. Crée user role "admin" + session → `201 { user:{id,email,name,role}, token }` + `Set-Cookie: pt_session=<token>; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax` (+ `Secure` si NODE_ENV=production).
   - `POST /auth/login` {email, password} — mauvais email ou mdp → même `401 {error:{code:"invalid_credentials"}}` (pas de leak). Succès → `200 { user, token }` + même cookie.
   - `POST /auth/logout` (auth requis) → détruit la session courante, `Set-Cookie` expiré, 204.
   - `GET /auth/me` (auth requis) → `{ user }`.
   - Note `token` dans le body = le même token de session, pour les scripts/clients non-browser (Bearer).
5. **Middleware admin** — remplace la vérif ADMIN_TOKEN par : lire d'abord `Authorization: Bearer <t>`, sinon cookie `pt_session` (parse manuel du header Cookie, pas de lib) → `getUserByToken` → 401 `{error:{code:"unauthorized"}}` sinon. Pose `c.set("user", user)`. **Supprime toutes les références à ADMIN_TOKEN** : config, types, `.env.example`, README, docs, compose env comments. `ENCRYPTION_MASTER_KEY` reste.
6. **Tests** (`apps/api/tests/`) : le helper central `setup.ts` expose `adminHeaders`/`TEST_ADMIN_TOKEN` — refais-le : un helper crée un User + Session en DB et `adminHeaders` devient `{ authorization: "Bearer <sessionToken>" }`. Réécris `admin-auth.test.ts` (401 sans auth, 401 session inconnue/expirée, 200 via Bearer ET via cookie). Ajoute `auth.test.ts` couvrant : status open→closed, register 1er compte (201 + cookie), register 2e (403), login ok/ko (email inconnu vs mauvais mdp = même 401), me, logout (session invalidée), validation (email pourri, password <8). Tous les autres tests doivent rester verts à l'identique.
7. **`scripts/smoke.sh`** + README + docs : remplace le flow ADMIN_TOKEN par register (1er) + login + Bearer session. Met à jour `.env.example` (retire ADMIN_TOKEN).

## Frontend (apps/web)

1. **`lib/api.ts`** : supprime le localStorage token. `login(email,password)`, `register(name,email,password)`, `logout()`, `me()` (GET /auth/me), `authStatus()` (GET /auth/status). `authFetch` n'ajoute plus d'Authorization — cookies automatiques (same-origin via rewrite /api). 401 non-auth endpoints → `window.location.assign("/login")`.
2. **`middleware.ts`** : guard par présence du cookie `pt_session` (redirect /login), matcher les routes console sauf `/login`, `/register`, `/__dev__`, rewrite `/api`.
3. **`app/(public)/login/page.tsx`** (adapter l'existante) : email + password, submit → login → redirect `/`. Si `authStatus().open` → lien visible « First boot — create the admin account » vers /register, sinon pas de lien.
4. **`app/(public)/register/page.tsx`** (nouvelle) : name + email + password (+ confirm), submit → register → redirect `/`. Si déjà fermé → redirect /login.
5. **`lib/feed.ts`** : retire le header Authorization (cookies auto).
6. Logout : petit bloc en bas de la sidebar console — nom/email du user (`me()`) + bouton Sign out → logout() → /login.
7. Pas de changement visuel majeur ; reste dans le design existant (dark, tokens déjà en place).

## Environnement & gate (OBLIGATOIRE, tout doit être vert)
- DB de test : postgres docker `passetrou-pg` sur 127.0.0.1:5434 → crée `apps/api/.env` avec `DATABASE_URL="postgresql://passetrou:passetrou@127.0.0.1:5434/passetrou"`, `ENCRYPTION_MASTER_KEY="<64 hex>"` (génère avec openssl rand -hex 32), NODE tu l'as. Puis `npx prisma migrate dev` pour appliquer la migration.
- `cd apps/api && npx tsc --noEmit && npx vitest run` → tout vert (260+ tests actuels + nouveaux).
- `cd apps/web && npx tsc --noEmit && npm run build` → vert (npm install d'abord si besoin ; flake next/font/google possible : relancer).
- `./scripts/smoke.sh` depuis la racine → vert (adapte-le à la nouvelle auth).
- Commit(s) propres sur `feat/auth-accounts`, push. Message style `feat(api): session auth with first-account-admin (replaces ADMIN_TOKEN)`.
- NE PAS toucher : routes /v1/* (proxy), clés members, pricing, capture. ADMIN_TOKEN doit disparaître partout (grep final : `grep -rn ADMIN_TOKEN apps/ docs/ README.md scripts/` → vide, sauf mention historique éventuelle dans docs/CHANGELOG si existant).
