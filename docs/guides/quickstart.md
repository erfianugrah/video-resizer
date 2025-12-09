# Video Resizer Quickstart Guide

*Last Updated: December 9, 2025*

## Prerequisites
- Cloudflare account with Workers (and R2 if you use the provided origins)
- Node.js v20+ and npm v9+
- Wrangler CLI v4.20+

## 1) Install
```bash
git clone <your-fork-url>
cd video-resizer
npm install
wrangler login
```

## 2) Configure Wrangler
Edit `wrangler.jsonc`:
- Set `account_id`.
- Replace `kv_namespaces[*].id` with your namespace IDs:
  - `VIDEO_CONFIGURATION_STORE` (config)
  - `VIDEO_TRANSFORMATIONS_CACHE` (content cache)
  - `VIDEO_CACHE_KEY_VERSIONS` (version metadata)
  - `PRESIGNED_URLS` (optional, for AWS presigned URL caching)
- Update `r2_buckets[*].bucket_name` to your bucket.
- Adjust `routes` for your domain.

`compatibility_date` is already set to `2025-03-10` with `nodejs_compat`.

## 3) Prepare worker config
Start from `config/worker-config.json` (or the comprehensive variant) and set:
- Origins (`origins.items[*].sources`) with your base URLs or R2 bindings.
- Derivatives/responsive breakpoints if you want different sizes.
- Cache policy (TTL, `storeIndefinitely`, versioning) if you diverge from defaults.

## 4) Upload config to KV
Set the token secret once per environment:
```bash
wrangler secret put CONFIG_API_TOKEN --env production
```
Upload the config file:
```bash
npm run config -- upload -c config/worker-config.json --env production -t <CONFIG_API_TOKEN>
```
Validate without writing:
```bash
npm run config -- validate -c config/worker-config.json
```

## 5) Build & deploy
```bash
npm run build:all          # typecheck worker + build debug UI
npm run deploy:dev         # workers.dev
npm run deploy:staging     # uses staging env from wrangler.jsonc
npm run deploy:prod        # production
```

## 6) Basic usage
- Video transform: `https://your-host/video.mp4?width=1280&height=720&mode=video`
- Frame grab: `...?mode=frame&time=2s&format=png`
- Spritesheet: `...?mode=spritesheet&columns=4&rows=3&interval=2s`
- Enable debug headers/UI: append `?debug` (requires `DEBUG_ENABLED` in config)

## Next steps
- Fine-tune origins and fallbacks in `config/worker-config*.json`.
- See [Configuration Guide](./configuration.md) for schema details.
- Check [Troubleshooting](./troubleshooting.md) for common setup issues.
