# passe•trou

Self-hosted LLM gateway with a first-class observability plane.

One LAN endpoint that **load-balances logical models across pooled upstream accounts** (API keys today, OAuth subscriptions later) and meters everything it carries: per-request timings (TTFT, tokens/sec), token breakdowns (reasoning, cached), tool calls, spend from hand-set prices — crossable per provider, subscription, model, API key, and person. Live "tour de contrôle" dashboard included.

Agent-first, T3 Code spirit: the dashboard is just a client of passe•trou's admin API — your agents can operate it end-to-end.

**Status: design phase.** The design doc is the contract: [docs/superpowers/specs/2026-11-20-passetrou-design.md](docs/superpowers/specs/2026-11-20-passetrou-design.md)

Name: `passe•trou`, lowercase with a middle dot (U+00B7). Where `•` is illegal (repos, packages, files): `passe-trou`.

## License

MIT — © 2026 Wyliam Burger.
