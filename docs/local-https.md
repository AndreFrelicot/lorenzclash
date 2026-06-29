# Local HTTPS for device testing

WebGPU and camera access require a secure context.

- `http://localhost` and `http://127.0.0.1` count as secure, so desktop development works without HTTPS.
- `http://<LAN-IP>` does not count as secure, so a phone opening `http://192.168.1.122:5173` will not get WebGPU or camera permissions.

For phone and tablet testing, Caddy serves a local HTTPS endpoint and proxies it to the Vite dev server.

## Setup

Install Caddy:

```bash
brew install caddy
```

Trust Caddy's local certificate authority on this Mac:

```bash
caddy start
caddy trust
caddy stop
```

## Run

Use two terminals from the repo root:

```bash
pnpm dev
pnpm proxy
```

Then open:

- Desktop: `https://localhost:8443`
- Phone on the same Wi-Fi: `https://192.168.1.122:8443`

If this Mac's LAN IP changes, update it in `Caddyfile`. Find the current address with:

```bash
ipconfig getifaddr en0
```

## Trusting the certificate on a phone

The phone must trust Caddy's root certificate once.

The certificate is created at:

```text
~/Library/Application Support/Caddy/pki/authorities/local/root.crt
```

Send it to the phone, install it, then enable full trust.

On iOS: Settings -> General -> VPN & Device Management, then Settings -> General -> About -> Certificate Trust Settings.

On Android: Settings -> Security -> Install a certificate -> CA certificate.

Use `pnpm proxy` for foreground development. If a background Caddy process is already running, stop it with:

```bash
caddy stop
```
