# Security boundaries

Bot `.env` values are resolved for that bot only. Global ChatGPT OAuth and Google/Gateway API-key profiles live in the user's Vian credential directory with restrictive permissions and may be shared by several bots. Do not copy profile JSON into bot directories or logs. `vian inspect` prints references, not secret values. `vian auth set google|vercel-ai-gateway` and `vian telegram connect <bot>` use hidden prompts; never pass keys or bot tokens as command arguments.

The Unix control socket is local to the user and mode 0600. Each bot also has an exclusive process owner lock; startup takes that lock before interruption recovery can clear leases. A second daemon cannot independently poll the same bot. Keep the global Vian data directory, bot roots and tool code readable only by trusted local users.

Trusted native tools and configured MCP servers execute with local privileges. Review their code and dependencies before enabling them. Vian does not expose generic shell, unrestricted filesystem, arbitrary HTTP or SQL tools by default. Tool input schemas and opaque attachment IDs limit the model's direct surface, but trusted tool code remains a security boundary.
