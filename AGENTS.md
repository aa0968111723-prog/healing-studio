# Healing Studio Agent Notes

## Codex CLI install troubleshooting

If `npm install -g @openai/codex` fails with `403 Forbidden` in this environment, the failure is usually caused by the enforced HTTP(S) proxy (`proxy:8080`) blocking access to `registry.npmjs.org`.

### Verified behavior in this container
- With proxy env vars enabled: request returns `403 Forbidden` from the proxy tunnel.
- With proxy env vars disabled: DNS lookup fails (`EAI_AGAIN`), so direct internet access is not available.

### Practical fix options
1. Ask the environment/network admin to allow `https://registry.npmjs.org/@openai%2fcodex` through the proxy.
2. Use an approved internal npm mirror that contains `@openai/codex`.
3. Install Codex CLI via Homebrew (`brew install codex`) in an environment where Homebrew access is allowed.
