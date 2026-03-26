/**
 * Playwright test: video playback + seeking for chunked KV responses
 */
import { chromium } from 'playwright';

const VIDEO_URL = 'https://cdn.erfi.dev/videos/big_buck_bunny_1080p.mov?imwidth=1280';

async function main() {
  console.log('Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Collect network details
  const networkLog = [];

  page.on('requestfinished', async (req) => {
    if (!req.url().includes('big_buck_bunny')) return;
    const res = await req.response();
    if (!res) return;

    const entry = {
      method: req.method(),
      rangeHeader: req.headers()['range'] || 'none',
      status: res.status(),
      contentLength: res.headers()['content-length'] || 'missing',
      contentRange: res.headers()['content-range'] || 'none',
      cacheSource: res.headers()['x-cache-source'] || 'none',
    };

    // Try to get actual body size
    try {
      const body = await res.body();
      entry.actualBodySize = body.length;
    } catch (e) {
      entry.actualBodySize = 'error: ' + e.message;
    }

    networkLog.push(entry);
    console.log(
      `  NET: ${entry.status} range=${entry.rangeHeader} content-length=${entry.contentLength} body=${entry.actualBodySize} content-range=${entry.contentRange}`
    );
  });

  page.on('requestfailed', (req) => {
    if (!req.url().includes('big_buck_bunny')) return;
    console.log(`  NET FAIL: ${req.method()} ${req.failure()?.errorText}`);
  });

  // Console log forwarding
  page.on('console', (msg) => {
    if (msg.text().includes('VIDEO_')) {
      console.log(`  BROWSER: ${msg.text()}`);
    }
  });

  console.log(`\nLoading: ${VIDEO_URL}\n`);
  await page.setContent(`
    <!DOCTYPE html>
    <html><body>
      <video id="v" controls preload="auto" style="width:100%">
        <source src="${VIDEO_URL}" type="video/mp4">
      </video>
      <script>
        const v = document.getElementById('v');
        v.addEventListener('loadedmetadata', () => console.log('VIDEO_META: duration=' + v.duration));
        v.addEventListener('canplay', () => console.log('VIDEO_CANPLAY: time=' + v.currentTime + ' readyState=' + v.readyState));
        v.addEventListener('playing', () => console.log('VIDEO_PLAYING: time=' + v.currentTime));
        v.addEventListener('seeked', () => console.log('VIDEO_SEEKED: time=' + v.currentTime + ' readyState=' + v.readyState));
        v.addEventListener('error', () => {
          const e = v.error;
          console.log('VIDEO_ERROR: code=' + e?.code + ' msg=' + e?.message);
        });
        v.addEventListener('waiting', () => console.log('VIDEO_WAITING: time=' + v.currentTime));
        v.addEventListener('stalled', () => console.log('VIDEO_STALLED: time=' + v.currentTime));
        v.addEventListener('progress', () => {
          const buf = v.buffered;
          if (buf.length > 0) {
            console.log('VIDEO_PROGRESS: buffered=' + buf.start(0).toFixed(1) + '-' + buf.end(buf.length-1).toFixed(1) + ' / ' + v.duration.toFixed(1));
          }
        });
      </script>
    </body></html>
  `);

  // Wait for metadata
  console.log('Waiting for metadata...');
  await page.waitForFunction(
    () => {
      const v = document.getElementById('v');
      return v && v.readyState >= 1;
    },
    { timeout: 60000 }
  );

  const duration = await page.evaluate(() => document.getElementById('v').duration);
  console.log(`\nDuration: ${duration}s\n`);

  // Play for 5 seconds
  console.log('--- Playing for 5s ---');
  await page.evaluate(() => document.getElementById('v').play());
  await page.waitForTimeout(5000);

  let state = await page.evaluate(() => {
    const v = document.getElementById('v');
    return {
      time: v.currentTime,
      error: v.error?.message,
      readyState: v.readyState,
      paused: v.paused,
    };
  });
  console.log(
    `After play: time=${state.time.toFixed(1)}s error=${state.error} readyState=${state.readyState} paused=${state.paused}\n`
  );

  // Seek to 30 seconds (not too far, to avoid needing many chunks)
  console.log('--- Seeking to 30s ---');
  await page.evaluate(() => {
    document.getElementById('v').currentTime = 30;
  });
  await page.waitForTimeout(5000);

  state = await page.evaluate(() => {
    const v = document.getElementById('v');
    return {
      time: v.currentTime,
      error: v.error?.message,
      readyState: v.readyState,
      seeking: v.seeking,
      paused: v.paused,
    };
  });
  console.log(
    `After seek 30s: time=${state.time.toFixed(1)}s error=${state.error} readyState=${state.readyState} seeking=${state.seeking}\n`
  );

  // Seek to middle
  console.log('--- Seeking to 298s (middle) ---');
  await page.evaluate(() => {
    document.getElementById('v').currentTime = 298;
  });
  await page.waitForTimeout(8000);

  state = await page.evaluate(() => {
    const v = document.getElementById('v');
    return {
      time: v.currentTime,
      error: v.error?.message,
      readyState: v.readyState,
      seeking: v.seeking,
      paused: v.paused,
    };
  });
  console.log(
    `After seek 298s: time=${state.time.toFixed(1)}s error=${state.error} readyState=${state.readyState} seeking=${state.seeking}\n`
  );

  // Seek near end
  console.log('--- Seeking to 580s (near end) ---');
  await page.evaluate(() => {
    document.getElementById('v').currentTime = 580;
  });
  await page.waitForTimeout(5000);

  state = await page.evaluate(() => {
    const v = document.getElementById('v');
    return {
      time: v.currentTime,
      error: v.error?.message,
      readyState: v.readyState,
      seeking: v.seeking,
      paused: v.paused,
    };
  });
  console.log(
    `After seek 580s: time=${state.time.toFixed(1)}s error=${state.error} readyState=${state.readyState} seeking=${state.seeking}\n`
  );

  // Final summary
  console.log('=== NETWORK SUMMARY ===');
  for (const e of networkLog) {
    console.log(
      `  ${e.status} range=${e.rangeHeader} CL=${e.contentLength} body=${e.actualBodySize} CR=${e.contentRange}`
    );
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
