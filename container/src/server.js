/**
 * FFmpeg Container HTTP Server
 *
 * Accepts video transformation requests, fetches the source video,
 * runs ffmpeg to resize/transcode, and streams the output back.
 *
 * Endpoints:
 *   POST /transform  — Transform a video via ffmpeg
 *   GET  /health     — Health check with ffmpeg version and disk info
 */
import { createServer } from 'node:http';
import { pipeline } from 'node:stream/promises';
import {
  createWriteStream,
  createReadStream,
  statSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { execSync } from 'node:child_process';

const PORT = 8080;
const TRANSCODE_DIR = '/tmp/transcode';
const SOURCE_CACHE_DIR = '/tmp/source-cache';
const MAX_CONCURRENT_JOBS = 4; // standard-4 has 4 vCPUs — one ffmpeg per core
const MAX_SOURCE_CACHE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB max source cache

// Simple concurrency limiter
let activeJobs = 0;
const jobQueue = [];

function acquireJob() {
  return new Promise((resolve) => {
    if (activeJobs < MAX_CONCURRENT_JOBS) {
      activeJobs++;
      resolve();
    } else {
      jobQueue.push(resolve);
    }
  });
}

function releaseJob() {
  activeJobs--;
  if (jobQueue.length > 0) {
    activeJobs++;
    const next = jobQueue.shift();
    next();
  }
}

// Ensure directories exist
if (!existsSync(TRANSCODE_DIR)) mkdirSync(TRANSCODE_DIR, { recursive: true });
if (!existsSync(SOURCE_CACHE_DIR)) mkdirSync(SOURCE_CACHE_DIR, { recursive: true });

/**
 * Source file cache — avoids re-downloading the same 691 MB source
 * for every resize variant. Keyed by URL hash.
 */
import { createHash } from 'node:crypto';

// Track in-flight downloads so concurrent requests for the same source wait
const sourceDownloads = new Map(); // hash -> Promise<string>

async function getOrDownloadSource(sourceUrl) {
  const hash = createHash('sha256').update(sourceUrl).digest('hex').substring(0, 16);
  const cachedPath = `${SOURCE_CACHE_DIR}/${hash}.bin`;

  // Already on disk?
  if (existsSync(cachedPath)) {
    try {
      const stat = statSync(cachedPath);
      if (stat.size > 0) {
        console.log(`[source-cache] HIT ${hash} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        return cachedPath;
      }
    } catch {}
  }

  // In-flight download by another job?
  if (sourceDownloads.has(hash)) {
    console.log(`[source-cache] WAITING for in-flight download ${hash}`);
    return sourceDownloads.get(hash);
  }

  // Download
  console.log(`[source-cache] MISS ${hash}, downloading...`);
  const downloadPromise = (async () => {
    const dlStart = Date.now();
    await downloadFile(sourceUrl, cachedPath);
    const stat = statSync(cachedPath);
    console.log(
      `[source-cache] Downloaded ${hash} (${(stat.size / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - dlStart}ms`
    );
    sourceDownloads.delete(hash);
    return cachedPath;
  })();

  sourceDownloads.set(hash, downloadPromise);
  return downloadPromise;
}

/**
 * Quality → CRF mapping for libx264
 */
const QUALITY_CRF = {
  low: 28,
  medium: 23,
  high: 18,
};

/**
 * Fit mode → ffmpeg filter mapping
 */
function buildScaleFilter(width, height, fit) {
  if (!width && !height) return null;

  const w = width || -2;
  const h = height || -2;

  switch (fit) {
    case 'cover':
      return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${width || 'iw'}:${height || 'ih'}`;
    case 'scale-down':
      // Only scale down, never up
      return `scale='min(${w},iw)':'min(${h},ih)':force_original_aspect_ratio=decrease`;
    case 'contain':
    default:
      return `scale=${w}:${h}:force_original_aspect_ratio=decrease`;
  }
}

/**
 * Download a file from a URL to a local path
 */
async function downloadFile(url, destPath) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to fetch source: ${response.status} ${response.statusText}`);
  }

  const fileStream = createWriteStream(destPath);
  // Convert web ReadableStream to Node.js writable
  const reader = response.body.getReader();
  const writable = new Writable({
    write(chunk, encoding, callback) {
      fileStream.write(chunk, callback);
    },
    final(callback) {
      fileStream.end(callback);
    },
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const canContinue = writable.write(value);
      if (!canContinue) {
        await new Promise((resolve) => writable.once('drain', resolve));
      }
    }
    writable.end();
    await new Promise((resolve, reject) => {
      writable.on('finish', resolve);
      writable.on('error', reject);
    });
  } catch (err) {
    writable.destroy(err);
    throw err;
  }
}

/**
 * Run ffmpeg and return a promise that resolves on completion
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stderr });
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`ffmpeg spawn error: ${err.message}`));
    });
  });
}

/**
 * Clean up a job's temp directory
 */
function cleanupJob(jobDir) {
  try {
    rmSync(jobDir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to cleanup ${jobDir}: ${err.message}`);
  }
}

/**
 * Handle a transform request
 */
async function handleTransform(req, res) {
  // Concurrency control — queue excess requests instead of rejecting
  console.log(`[queue] Waiting for slot (active=${activeJobs}, queued=${jobQueue.length})`);
  await acquireJob();
  console.log(`[queue] Acquired slot (active=${activeJobs})`);

  try {
    await handleTransformInner(req, res);
  } finally {
    releaseJob();
    console.log(`[queue] Released slot (active=${activeJobs}, queued=${jobQueue.length})`);
  }
}

async function handleTransformInner(req, res) {
  // Parse body
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  let params;
  try {
    params = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  const { sourceUrl, width, height, mode, quality, fit, duration, time, format } = params;

  if (!sourceUrl) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'sourceUrl is required' }));
    return;
  }

  const jobId = randomUUID();
  const jobDir = `${TRANSCODE_DIR}/${jobId}`;
  mkdirSync(jobDir, { recursive: true });

  const outputPath = `${jobDir}/output.mp4`;

  try {
    // 1. Get source video (cached on disk or download)
    const inputPath = await getOrDownloadSource(sourceUrl);
    const inputStat = statSync(inputPath);
    console.log(`[${jobId}] Source ready: ${(inputStat.size / 1024 / 1024).toFixed(1)} MB`);

    // 2. Build ffmpeg arguments
    // Divide CPUs across active jobs — fewer concurrent jobs = more threads each
    const threadsPerJob = Math.max(1, Math.floor(4 / Math.max(1, activeJobs)));
    const ffmpegArgs = ['-y', '-threads', String(threadsPerJob), '-i', inputPath];

    // Time offset (seek)
    if (time) {
      ffmpegArgs.push('-ss', time);
    }

    // Duration limit
    if (duration) {
      ffmpegArgs.push('-t', duration);
    }

    // Video filters
    const scaleFilter = buildScaleFilter(width, height, fit || 'contain');
    if (scaleFilter) {
      ffmpegArgs.push('-vf', scaleFilter);
    }

    // Video codec settings
    // Use 'fast' preset for better throughput on first request — CRF
    // controls quality independently of preset (preset only affects speed/size tradeoff)
    const crf = QUALITY_CRF[quality] || QUALITY_CRF.medium;
    ffmpegArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf));

    // Audio codec
    if (mode === 'audio') {
      ffmpegArgs.push('-vn'); // No video
    }
    ffmpegArgs.push(
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2' // Downmix to stereo for web playback
    );

    // MP4 faststart for web playback
    ffmpegArgs.push('-movflags', '+faststart');

    // Output
    ffmpegArgs.push(outputPath);

    console.log(`[${jobId}] Running ffmpeg with CRF ${crf}, scale: ${scaleFilter || 'none'}`);

    // 3. Run ffmpeg
    const ffStart = Date.now();
    await runFFmpeg(ffmpegArgs);
    const ffDuration = Date.now() - ffStart;

    const outputStat = statSync(outputPath);
    console.log(
      `[${jobId}] FFmpeg complete: ${(outputStat.size / 1024 / 1024).toFixed(1)} MB output in ${ffDuration}ms ` +
        `(ratio: ${((outputStat.size / inputStat.size) * 100).toFixed(1)}%)`
    );

    // 4. Stream the output back
    const contentType = mode === 'audio' ? 'audio/mp4' : 'video/mp4';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(outputStat.size),
      'X-FFmpeg-Duration-Ms': String(ffDuration),
      'X-FFmpeg-Input-Size': String(inputStat.size),
      'X-FFmpeg-Output-Size': String(outputStat.size),
      'X-FFmpeg-CRF': String(crf),
      'X-Job-Id': jobId,
    });

    const readStream = createReadStream(outputPath);
    await pipeline(readStream, res);

    console.log(`[${jobId}] Response streamed successfully`);
  } catch (err) {
    console.error(`[${jobId}] Transform error: ${err.message}`);

    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err.message,
          jobId,
        })
      );
    }
  } finally {
    // Always clean up
    cleanupJob(jobDir);
  }
}

/**
 * Handle health check
 */
function handleHealth(req, res) {
  let ffmpegVersion = 'unknown';
  try {
    ffmpegVersion = execSync('ffmpeg -version', { encoding: 'utf-8' }).split('\n')[0];
  } catch {
    /* ignore */
  }

  let diskInfo = {};
  try {
    const dfOutput = execSync('df -h /tmp', { encoding: 'utf-8' });
    const lines = dfOutput.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      diskInfo = {
        total: parts[1],
        used: parts[2],
        available: parts[3],
        usePercent: parts[4],
      };
    }
  } catch {
    /* ignore */
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      ffmpegVersion,
      disk: diskInfo,
      uptime: process.uptime(),
    })
  );
}

/**
 * Main request router
 */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === 'POST' && url.pathname === '/transform') {
      await handleTransform(req, res);
    } else if (req.method === 'GET' && url.pathname === '/health') {
      handleHealth(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    console.error(`Unhandled error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
});

server.listen(PORT, () => {
  console.log(`FFmpeg container server listening on port ${PORT}`);
});
