---
version: alpha
name: passe•trou
description: >-
  Console de contrôle dark-first pour le gateway LLM passe•trou. Inspiré de
  l'UI de T3 Code (pingdotgg/t3code, MIT) : noir vrai, surfaces alpha-blend,
  bleu primaire unique, densité de donnée façon control plane.
colors:
  primary: "#346BF1"
  primary-strong: "#1B4ED8"
  primary-hover: "#2E62E6"
  foreground: "#F5F5F5"
  secondary: "#A3A3A3"
  neutral: "#000000"
  surface: "#111111"
  muted: "#0A0A0A"
  border: "#141414"
  success: "#34D399"
  success-surface: "#082218"
  warning: "#FBBF24"
  warning-surface: "#281F05"
  error: "#F87171"
  error-surface: "#281212"
  info: "#60A5FA"
  info-surface: "#0F1A28"
typography:
  h1:
    fontFamily: Inter Variable
    fontSize: 1.5rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  h2:
    fontFamily: Inter Variable
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  h3:
    fontFamily: Inter Variable
    fontSize: 0.9375rem
    fontWeight: 600
    lineHeight: 1.4
  body-md:
    fontFamily: Inter Variable
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter Variable
    fontSize: 0.75rem
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Inter Variable
    fontSize: 0.6875rem
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0.04em"
  data-md:
    fontFamily: ui-monospace
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.4
  data-xs:
    fontFamily: ui-monospace
    fontSize: 0.6875rem
    fontWeight: 400
    lineHeight: 1.45
  code:
    fontFamily: ui-monospace
    fontSize: 0.8125rem
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: 10px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "#FFFFFF"
  button-primary-pressed:
    backgroundColor: "{colors.primary-strong}"
    textColor: "#FFFFFF"
  button-secondary:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: 10px
  button-secondary-hover:
    backgroundColor: "{colors.border}"
    textColor: "{colors.foreground}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  stat-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  stat-card-value:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
  sidebar-row:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.md}"
    padding: 8px
  sidebar-row-active:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: 8px
  nav-link:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
  feed-row:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: 8px
  feed-row-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
  table-header:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
  table-row-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
  chip-provider:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: 6px
  chip-model:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.full}"
    padding: 6px
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: 10px
  badge-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-error:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.sm}"
    padding: 4px
  badge-info:
    backgroundColor: "{colors.info-surface}"
    textColor: "{colors.info}"
    rounded: "{rounded.sm}"
    padding: 4px
  status-dot-healthy:
    backgroundColor: "{colors.success}"
    size: 8px
  status-dot-cooldown:
    backgroundColor: "{colors.warning}"
    size: 8px
  status-dot-down:
    backgroundColor: "{colors.error}"
    size: 8px
  kbd:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: 4px
---

## Overview

passe•trou est une console de contrôle pour un gateway LLM self-hosté :
live feed SSE, files de comptes upstream, quotas dérivés, routing par
modèles logiques. Le ton visuel est celui d'une salle de contrôle, pas
d'une page marketing : noir vrai, une seule couleur d'action, données
denses et lisibles.

L'esthétique est directement dérivée de l'UI de T3 Code
(pingdotgg/t3code, MIT — tokens extraits de `apps/web/src/index.css`) :
background `#000` en dark mode, surfaces obtenues par alpha-blend de
blanc (muted = blanc 3%, border = blanc 8%), bleu primaire
oklch(0.571 0.21 264) ≈ #346BF1, arrondi de base 0.5rem, piles de polices
système. Le produit applique la même philosophie : agent-first, la
console n'est qu'un client de l'admin REST.

Principes :

- **Dark-first.** Le dark n'est pas un thème alternatif, c'est le thème.
  Un light mode peut exister plus tard, dérivé des mêmes tokens
  (background zinc-25 #FCFCFC, foreground zinc-900, primaire #1B4ED8).
- **Lean over loud.** Une couleur d'action, zéro gradient décoratif en
  surface de travail. Le statut (healthy/cooldown/down, succès/erreur)
  porte la seule autre couleur.
- **La donnée est le héros.** Le live feed et le drill-down des requêtes
  priment sur les charts décoratifs (leçon Trello de Will).
- **Densité assumée.** Tailles 11–13 px en mono pour les métriques et
  lignes de feed, comme les badges et diagnostics de T3.

## Colors

- **Primary (#346BF1) :** le bleu T3 Code dark mode. Une seule action
  forte par écran. Jamais en fond de page, jamais en texte courant sauf
  liens sur fond noir.
- **Primary-strong (#1B4ED8) :** la version light-mode du primaire
  (oklch(0.488 0.217 264)), utilisée aussi pour les états actifs en dark
  quand #346BF1 manque de poids.
- **Neutral (#000000) :** le fond. Noir vrai comme T3, pas de gris-bleu
  « presque noir ».
- **Surface (#111111) :** cards, popovers, lignes hover. Équivalent au
  neutral-950 lifté à 3% de T3 — un cran au-dessus du fond, juste
  perceptible.
- **Muted (#0A0A0A) :** fonds secondaires (rows actives, chips,
  secondary buttons, kbd). Blanc à ~4%.
- **Border (#141414) :** blanc à 8% sur noir — la séparation par défaut.
  Jamais plus clair : si une séparation doit être visible, on change de
  surface, pas de border.
- **Secondary (#A3A3A3) :** texte secondaire et métadonnées
  (neutral-400). Réservé aux labels, timestamps, unités.
- **Success/Warning/Error (#34D399 / #FBBF24 / #F87171) :**
  emerald/amber/red 400 — états des comptes et requêtes, sur leurs
  surfaces teintées à 16% (`-*-surface`).

Les logos providers (CommandCode, Mistral…) gardent leurs brand colors
officielles — ajoutées comme tokens au moment où l'asset entre, pas
d'invention ici.

## Typography

- **Sans :** Inter Variable (fallback pile système : -apple-system,
  BlinkMacSystemFont, Segoe UI). Titres en 600 avec letterSpacing négatif,
  corps courant en 0.875rem (14px) comme la plupart des control planes.
- **Mono :** ui-monospace / SF Mono / Menlo. Réservée à la donnée :
  statistiques (TTFT, tokens/sec, coût), feed, IDs de requêtes, noms de
  modèles. `data-xs` (11px) et `data-md` (13px) correspondent aux 2xs/xs
  étendues de T3.
- **Label :** 11px, 500, letterSpacing +0.04em — badges, en-têtes de
  tableaux, sections de sidebar. Pas de ALL CAPS agressif : la taille et
  l'interlettrage suffisent.
- Jamais de mono pour le corps de texte, jamais de sans pour une valeur
  numérique de métrique.

## Layout

Sidebar icône à gauche (référence prox/CLIProxyAPI), contenu en colonnes
de cards, pas de largeur de page marketing. Base 4px : xs 4, sm 8, md 16
(rythme courant), lg 24 (entre sections), xl 32 (entre groupes). Le feed
SSE vit en pleine hauteur du viewport : la console doit pouvoir rester
ouverte sur un écran secondaire. Densité horizontale généreuse dans les
tableaux (padding 8px), jamais de padding 24 dans une cellule.

## Elevation & Depth

Pas de drop shadows porteuses sur noir : l'élévation se fait par surface
(#000 → #0A0A0A → #111111) plus border #141414, comme T3 (composer =
dégradé de shade, pas d'ombre portée). Une ombre douce `0 14px 32px
-18px rgb(0 0 0 / 75%)` existe pour les overlays (popovers, dialogs)
uniquement. Zéro glow, zéro glassmorphism en surface de travail.

## Shapes

Base 8px (`lg`) pour les cards et dialogs — l'arrondi natif de T3.
`md` 6px pour boutons, inputs, rows de sidebar. `sm` 4px pour badges,
chips de statut, kbd. `full` pour les chips provider/modèle et les
status dots. `xl` 12px réservé aux grands overlays.

## Components

- **Buttons :** `button-primary` est la seule action forte par vue (bleu,
  texte blanc). Tout le reste est `button-secondary` (muted, texte
  foreground, hover border). Pas de bouton outline fantôme.
- **Cards / stat-cards :** surface + border implicite, padding 16px.
  `stat-card-value` = `data-md` mono en foreground ; le label au-dessus en
  `label` secondary.
- **Sidebar :** rows 6px, muted texte secondary, active = fond muted +
  texte foreground. Pas de couleur primaire sur l'état actif.
- **Feed :** `feed-row` texte secondary sur noir, hover = muted +
  foreground. Les événements d'erreur colorent le texte via `badge-error`,
  pas la row entière.
- **Chips :** filtres provider (fond muted, `full`) et modèles (fond
  surface). Un chip sélectionné passe le texte en foreground, sans changer
  de fond — la cohérence prime.
- **Badges & status dots :** le sémantique (success/warning/error/info)
  ne vit que là. Dot 8px + badge 4px padding.
- **Input :** surface, border au focus = primaire, jamais de fond blanc.

## Do's and Don'ts

**Do**

- Une action primaire par écran ; le reste en secondary.
- Texte de métrique en mono, label en `label` secondary, valeur en
  foreground.
- Élévation par surfaces, jamais par ombres portées en dark.
- État vide = une ligne secondary centrée + un bouton secondary, pas
  d'illustration.

**Don't**

- Pas de gradient décoratif, pas de glow, pas de glassmorphism.
- Pas de bleu primaire sur de grandes surfaces ni sur les états actifs de
  navigation.
- Pas de fond coloré plein pour une alerte : badge + texte seulement.
- Pas de taille sous 10px, pas de texte courant en secondary (#A3A3A3) —
  le secondary est pour les métadonnées.
- Pas de chart décoratif qui double une info déjà dans le feed.
