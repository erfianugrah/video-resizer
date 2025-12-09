# Audio Mode (M4A)

Audio mode extracts AAC audio as an M4A file from a video source. Use it for podcasts, voiceover exports, or lightweight audio playback when video isn’t needed.

## Quick start

```
https://cdn.example.com/videos/sample.mp4?mode=audio
https://cdn.example.com/videos/sample.mp4?mode=audio&time=30s&duration=120s&filename=sample-audio.m4a
https://cdn.example.com/videos/sample.mp4?format=m4a            # auto-switches to audio mode
```

## Supported parameters

| Param     | Type    | Required | Default | Notes                                   |
|-----------|---------|----------|---------|-----------------------------------------|
| `mode`    | string  | Yes      | -       | Must be `audio` (auto-set when `format=m4a`) |
| `format`  | string  | Optional | `m4a`   | Only `m4a` is accepted                  |
| `time`    | string  | Optional | `0s`    | Start position, 0–10m (e.g. `5s`, `2m`) |
| `duration`| string  | Optional | full    | Output length, 1–300s (e.g. `45s`, `5m`)|
| `filename`| string  | Optional | derived | Lowercase, <=120 chars, safe chars only |

Not supported in audio mode: `width`, `height`, `fit`, `quality`, `compression`, playback params (`loop`, `autoplay`, `muted`, `preload`).

## Behavior

- Output: AAC audio in an M4A container.
- Headers: `Content-Type: audio/mp4`, `Content-Disposition: inline; filename="..."` when `filename` is provided.
- Caching: KV keys and CDN-CGI URLs include `mode=audio`, so audio variants don’t collide with video/frame/spritesheet.
- Time/duration limits: `time` 0–10 minutes; `duration` 1–300 seconds. If `duration` is omitted, the full source length is used (up to platform limits).

## Examples

- First 2 minutes of a clip, custom filename  
  `...?mode=audio&time=0s&duration=120s&filename=intro.m4a`

- Podcast-style extraction with start offset  
  `...?format=m4a&time=45s&duration=5m&filename=episode-clip.m4a`

## Tips

- If you only pass `format=m4a`, the service will automatically set `mode=audio`.
- Use `--range 0-1023` with `curl` to validate headers without downloading the full file:
  `curl -I --range 0-1023 "https://cdn.example.com/videos/sample.mp4?mode=audio"`
