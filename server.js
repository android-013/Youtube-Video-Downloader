const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DEMO_MODE = process.env.DEMO_MODE === '1' || process.argv.includes('--demo');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

const jobs = new Map();
const subscribers = new Map();

function id() {
  return crypto.randomBytes(8).toString('hex');
}

function safeError(error) {
  return error?.message || String(error || 'Unknown error');
}

function compactError(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value
    .replace(/\r/g, '')
    .split('\n')
    .filter(line => line.trim())
    .slice(-18)
    .join('\n')
    .slice(0, 5000);
}

function newestFileSince(startedAtIso) {
  const started = new Date(startedAtIso).getTime() - 3000;
  try {
    return fs.readdirSync(DOWNLOADS_DIR)
      .map(name => {
        const filePath = path.join(DOWNLOADS_DIR, name);
        const stat = fs.statSync(filePath);
        return stat.isFile() ? { filePath, mtime: stat.mtimeMs } : null;
      })
      .filter(Boolean)
      .filter(file => file.mtime >= started)
      .sort((a, b) => b.mtime - a.mtime)[0]?.filePath || '';
  } catch {
    return '';
  }
}

function writeEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitJob(job) {
  const clean = serializeJob(job);
  const set = subscribers.get(job.id);
  if (!set) return;
  for (const res of set) {
    writeEvent(res, clean);
  }
}

function serializeJob(job) {
  return {
    id: job.id,
    url: job.url,
    title: job.title,
    thumbnail: job.thumbnail,
    container: job.container,
    quality: job.quality,
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    eta: job.eta,
    message: job.message,
    error: job.error,
    fileName: job.filePath ? path.basename(job.filePath) : null,
    hasFile: Boolean(job.filePath && fs.existsSync(job.filePath)),
    createdAt: job.createdAt
  };
}

function checkCommand(command, prefixArgs = []) {
  if (!command) return null;
  const result = spawnSync(command, [...prefixArgs, '--version'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });

  if (result.status === 0) {
    return {
      command,
      prefixArgs,
      version: (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0]
    };
  }

  return null;
}

function getYtDlp() {
  if (DEMO_MODE) {
    return { command: 'demo-mode', prefixArgs: [], version: 'demo-mode' };
  }

  const candidates = [
    { command: process.env.YTDLP_PATH, prefixArgs: [] },
    { command: 'yt-dlp', prefixArgs: [] },
    { command: 'yt-dlp.exe', prefixArgs: [] },
    { command: 'python', prefixArgs: ['-m', 'yt_dlp'] },
    { command: 'python3', prefixArgs: ['-m', 'yt_dlp'] },
    { command: 'py', prefixArgs: ['-m', 'yt_dlp'] }
  ];

  for (const candidate of candidates) {
    const found = checkCommand(candidate.command, candidate.prefixArgs);
    if (found) return found;
  }

  return null;
}

function hasFfmpeg() {
  const result = spawnSync('ffmpeg', ['-version'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true
  });
  return result.status === 0;
}

function runYtDlp(args, options = {}) {
  const binary = getYtDlp();
  if (!binary) {
    throw new Error('yt-dlp was not found. Install it with: pip install -U yt-dlp');
  }
  return spawn(binary.command, [...binary.prefixArgs, ...args], {
    cwd: __dirname,
    windowsHide: true,
    ...options
  });
}

function runYtDlpJson(args) {
  return new Promise((resolve, reject) => {
    const child = runYtDlp(args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 100 * 1024 * 1024) {
        child.kill('SIGTERM');
        reject(new Error('yt-dlp output was too large. Try a smaller playlist or search.'));
      }
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Could not parse yt-dlp JSON: ${safeError(error)}\n${stdout.slice(0, 800)}`));
      }
    });
  });
}

function isProbablyUrl(query) {
  try {
    const url = new URL(query);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function looksLikeCollectionUrl(query) {
  if (!isProbablyUrl(query)) return false;
  const lower = query.toLowerCase();
  return lower.includes('/playlist') ||
    lower.includes('/channel/') ||
    lower.includes('/c/') ||
    lower.includes('/user/') ||
    lower.includes('/@') ||
    (lower.includes('list=') && !lower.includes('watch?v='));
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return 'Live';
  const value = Number(seconds);
  if (!Number.isFinite(value)) return 'Live';
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = Math.floor(value % 60);
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function bestThumbnail(item = {}) {
  if (item.thumbnail) return item.thumbnail;
  if (Array.isArray(item.thumbnails) && item.thumbnails.length) {
    return item.thumbnails[item.thumbnails.length - 1]?.url || item.thumbnails[0]?.url || '';
  }
  if (item.id) return `https://i.ytimg.com/vi/${item.id}/hqdefault.jpg`;
  return '';
}

function videoUrl(item = {}) {
  if (item.webpage_url) return item.webpage_url;
  if (item.url && String(item.url).startsWith('http')) return item.url;
  if (item.id) return `https://www.youtube.com/watch?v=${item.id}`;
  return item.url || '';
}

function normalizeVideo(item = {}) {
  return {
    id: item.id || '',
    title: item.title || 'Untitled video',
    author: item.uploader || item.channel || item.creator || 'Unknown',
    duration: formatDuration(item.duration),
    durationSeconds: item.duration || null,
    thumbnail: bestThumbnail(item),
    url: videoUrl(item)
  };
}

function buildSingleOptions(info = {}) {
  const heights = new Set();
  for (const f of info.formats || []) {
    if (f.vcodec && f.vcodec !== 'none' && f.height) {
      heights.add(Number(f.height));
    }
  }
  const sortedHeights = [...heights]
    .filter(Boolean)
    .sort((a, b) => b - a)
    .filter(h => [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144].includes(h));

  const options = [{ label: 'Highest MP4', container: 'mp4', quality: 'highest' }];
  for (const h of sortedHeights) {
    options.push({ label: `${h}p MP4`, container: 'mp4', quality: String(h) });
  }
  options.push({ label: 'Audio MP3', container: 'mp3', quality: 'audio' });
  options.push({ label: 'Highest WebM', container: 'webm', quality: 'highest' });
  return options;
}

function demoResolve(query) {
  const sample = [
    {
      id: 'demo1',
      title: 'First Steps - Blender 2.80 Fundamentals',
      author: 'Blender',
      duration: '0:59',
      durationSeconds: 59,
      thumbnail: 'https://i.ytimg.com/vi/1jHUY3qoBu8/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=1jHUY3qoBu8'
    },
    {
      id: 'demo2',
      title: 'Viewport Navigation - Blender 2.80 Fundamentals',
      author: 'Blender',
      duration: '3:42',
      durationSeconds: 222,
      thumbnail: 'https://i.ytimg.com/vi/ILqOWe3zAbk/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=ILqOWe3zAbk'
    },
    {
      id: 'demo3',
      title: 'Interface Overview - Blender 2.80 Fundamentals',
      author: 'Blender',
      duration: '11:13',
      durationSeconds: 673,
      thumbnail: 'https://i.ytimg.com/vi/yEfYwF0A2UQ/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=yEfYwF0A2UQ'
    },
    {
      id: 'demo4',
      title: 'Select & Transform - Blender 2.80 Fundamentals',
      author: 'Blender',
      duration: '11:06',
      durationSeconds: 666,
      thumbnail: 'https://i.ytimg.com/vi/SV6wEcH4lVs/hqdefault.jpg',
      url: 'https://www.youtube.com/watch?v=SV6wEcH4lVs'
    }
  ];

  if (isProbablyUrl(query) && !looksLikeCollectionUrl(query)) {
    return {
      type: 'single',
      title: sample[0].title,
      video: sample[0],
      options: [
        { label: '1080p MP4', container: 'mp4', quality: '1080' },
        { label: '720p MP4', container: 'mp4', quality: '720' },
        { label: 'Audio MP3', container: 'mp3', quality: 'audio' },
        { label: 'Highest WebM', container: 'webm', quality: 'highest' }
      ]
    };
  }

  return {
    type: 'multiple',
    title: isProbablyUrl(query) ? 'Playlist: Blender Fundamentals 2.8' : `Search: ${query}`,
    videos: sample,
    containers: ['mp4', 'webm', 'mp3'],
    qualities: ['highest', '1080', '720', '480', '360']
  };
}

function downloadArgs(container, quality, ffmpegAvailable) {
  const q = String(quality || 'highest');
  const c = String(container || 'mp4').toLowerCase();

  // MP3 extraction and true 1080p+ video/audio merging require FFmpeg.
  // Without FFmpeg, fall back to a progressive single-file video format instead of failing.
  if (c === 'mp3') {
    if (!ffmpegAvailable) {
      return {
        error: 'MP3 conversion requires FFmpeg. Install FFmpeg and restart the server, or choose MP4/WebM instead.'
      };
    }
    return { args: ['-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--add-metadata'] };
  }

  if (!ffmpegAvailable) {
    if (c === 'webm') {
      if (q !== 'highest' && /^\d+$/.test(q)) {
        return { args: ['-f', `b[height<=${q}][ext=webm]/b[height<=${q}]/best[height<=${q}]`], warning: 'FFmpeg not detected; using best single-file WebM fallback.' };
      }
      return { args: ['-f', 'b[ext=webm]/best[ext=webm]/b/best'], warning: 'FFmpeg not detected; using best single-file WebM fallback.' };
    }

    if (q !== 'highest' && /^\d+$/.test(q)) {
      return { args: ['-f', `b[height<=${q}][ext=mp4]/b[height<=${q}]/best[height<=${q}]`], warning: 'FFmpeg not detected; using best single-file MP4 fallback.' };
    }
    return { args: ['-f', 'b[ext=mp4]/best[ext=mp4]/b/best'], warning: 'FFmpeg not detected; using best single-file MP4 fallback.' };
  }

  if (c === 'webm') {
    if (q !== 'highest' && /^\d+$/.test(q)) {
      return { args: ['-f', `bv*[height<=${q}][ext=webm]+ba[ext=webm]/b[height<=${q}][ext=webm]/best[height<=${q}]`, '--merge-output-format', 'webm'] };
    }
    return { args: ['-f', 'bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/best', '--merge-output-format', 'webm'] };
  }

  if (q !== 'highest' && /^\d+$/.test(q)) {
    return { args: ['-f', `bv*[height<=${q}][ext=mp4]+ba[ext=m4a]/b[height<=${q}][ext=mp4]/best[height<=${q}]`, '--merge-output-format', 'mp4'] };
  }

  return { args: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/best[ext=mp4]/best', '--merge-output-format', 'mp4'] };
}

function optionalCookieArgs() {
  const args = [];
  if (process.env.YTDLP_COOKIES_FILE) {
    args.push('--cookies', process.env.YTDLP_COOKIES_FILE);
  }
  if (process.env.YTDLP_COOKIES_FROM_BROWSER) {
    args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  }
  return args;
}

function parseProgress(line, job) {
  const percentMatch = line.match(/\[download\]\s+([\d.]+)%/i) || line.match(/download:\s*([\d.]+)%/i);
  if (percentMatch) {
    job.progress = Math.min(100, Math.max(0, Number(percentMatch[1])));
    job.status = 'started';
  }

  const speedMatch = line.match(/at\s+([^\s]+\/s)/i);
  if (speedMatch) job.speed = speedMatch[1];

  const etaMatch = line.match(/ETA\s+([^\s]+)/i);
  if (etaMatch) job.eta = etaMatch[1];

  if (/\[Merger\]|\[ExtractAudio\]|\[EmbedThumbnail\]|\[Metadata\]/i.test(line)) {
    job.message = line.replace(/^\[[^\]]+\]\s*/, '').trim();
  }

  const printedPath = line.trim();
  if (printedPath && path.isAbsolute(printedPath) && printedPath.startsWith(DOWNLOADS_DIR) && fs.existsSync(printedPath)) {
    job.filePath = printedPath;
  }
}

function simulateDownload(job) {
  job.status = 'started';
  job.message = 'Demo download running';
  emitJob(job);

  const timer = setInterval(() => {
    if (job.status === 'canceled') {
      clearInterval(timer);
      emitJob(job);
      return;
    }
    job.progress = Math.min(100, job.progress + Math.round(7 + Math.random() * 18));
    job.speed = 'demo';
    job.eta = job.progress >= 100 ? '0s' : `${Math.max(1, Math.round((100 - job.progress) / 20))}s`;
    if (job.progress >= 100) {
      const fileName = `${job.title.replace(/[^\w\-. ]+/g, '').slice(0, 80) || job.id}.${job.container === 'mp3' ? 'mp3' : job.container}`;
      const filePath = path.join(DOWNLOADS_DIR, fileName);
      fs.writeFileSync(filePath, 'Demo mode placeholder file. Disable DEMO_MODE and install yt-dlp to download real media.\n');
      job.filePath = filePath;
      job.status = 'completed';
      job.message = 'Completed';
      clearInterval(timer);
    }
    emitJob(job);
  }, 650);
}

function startDownload(job) {
  if (DEMO_MODE) {
    simulateDownload(job);
    return;
  }

  const ffmpegAvailable = hasFfmpeg();
  const downloadSpec = downloadArgs(job.container, job.quality, ffmpegAvailable);
  if (downloadSpec.error) {
    job.status = 'failed';
    job.error = downloadSpec.error;
    job.message = downloadSpec.error;
    emitJob(job);
    return;
  }

  const outputTemplate = path.join(DOWNLOADS_DIR, '%(title).180B [%(id)s].%(ext)s');
  const args = [
    ...optionalCookieArgs(),
    '--no-playlist',
    '--newline',
    '--progress',
    '--restrict-filenames',
    '--windows-filenames',
    '--print',
    'after_move:filepath',
    '-o',
    outputTemplate,
    ...downloadSpec.args,
    job.url
  ];

  job.status = 'started';
  job.message = downloadSpec.warning || 'Starting yt-dlp';
  emitJob(job);

  let stderr = '';
  let child;
  try {
    child = runYtDlp(args);
  } catch (error) {
    job.status = 'failed';
    job.error = safeError(error);
    job.message = 'Failed to start yt-dlp';
    emitJob(job);
    return;
  }
  job.child = child;

  child.stdout.on('data', chunk => {
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) parseProgress(line, job);
    emitJob(job);
  });

  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
    const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      if (/error/i.test(line)) job.message = line;
      parseProgress(line, job);
    }
    emitJob(job);
  });

  child.on('error', error => {
    job.status = 'failed';
    job.error = safeError(error);
    job.message = 'Failed to start yt-dlp';
    emitJob(job);
  });

  child.on('close', code => {
    job.child = null;
    if (job.status === 'canceled') {
      job.message = 'Canceled';
      emitJob(job);
      return;
    }
    if (code === 0) {
      if (!job.filePath || !fs.existsSync(job.filePath)) {
        job.filePath = newestFileSince(job.createdAt);
      }
      job.status = 'completed';
      job.progress = 100;
      job.message = 'Completed';
    } else {
      job.status = 'failed';
      job.error = compactError(stderr) || `yt-dlp exited with code ${code}`;
      job.message = 'Download failed';
    }
    emitJob(job);
  });
}

app.get('/api/health', (req, res) => {
  const binary = getYtDlp();
  const ffmpeg = hasFfmpeg();
  res.json({
    ok: Boolean(binary),
    demoMode: DEMO_MODE,
    ytDlp: binary ? {
      command: binary.command,
      prefixArgs: binary.prefixArgs,
      version: binary.version
    } : null,
    ffmpeg,
    note: !ffmpeg
      ? 'FFmpeg is not detected. MP4/WebM will use a single-file fallback. MP3 and high-quality merged video require FFmpeg.'
      : 'FFmpeg detected. MP3 conversion and high-quality video merging are available.',
    downloadsDir: DOWNLOADS_DIR
  });
});

app.post('/api/resolve', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Paste a video URL, playlist/channel URL, or search keywords.' });
    return;
  }

  try {
    if (DEMO_MODE) {
      res.json(demoResolve(query));
      return;
    }

    if (looksLikeCollectionUrl(query) || !isProbablyUrl(query)) {
      const target = isProbablyUrl(query) ? query : `ytsearch12:${query}`;
      const info = await runYtDlpJson([
        ...optionalCookieArgs(),
        '--flat-playlist',
        '--dump-single-json',
        '--playlist-end',
        '50',
        target
      ]);

      const entries = Array.isArray(info.entries) ? info.entries : [];
      res.json({
        type: 'multiple',
        title: info.title || (isProbablyUrl(query) ? 'Video collection' : `Search: ${query}`),
        videos: entries.map(normalizeVideo).filter(v => v.url),
        containers: ['mp4', 'webm', 'mp3'],
        qualities: ['highest', '1080', '720', '480', '360']
      });
      return;
    }

    const info = await runYtDlpJson([
      ...optionalCookieArgs(),
      '--no-playlist',
      '--dump-single-json',
      query
    ]);
    const video = normalizeVideo(info);
    res.json({
      type: 'single',
      title: video.title,
      video,
      options: buildSingleOptions(info)
    });
  } catch (error) {
    res.status(500).json({ error: safeError(error) });
  }
});

app.post('/api/download', (req, res) => {
  const url = String(req.body?.url || '').trim();
  const title = String(req.body?.title || 'Untitled video').trim();
  const thumbnail = String(req.body?.thumbnail || '').trim();
  const container = String(req.body?.container || 'mp4').toLowerCase();
  const quality = String(req.body?.quality || 'highest').toLowerCase();

  if (!url || (!DEMO_MODE && !isProbablyUrl(url))) {
    res.status(400).json({ error: 'A valid video URL is required.' });
    return;
  }
  if (!['mp4', 'webm', 'mp3'].includes(container)) {
    res.status(400).json({ error: 'Unsupported container. Use mp4, webm, or mp3.' });
    return;
  }

  const job = {
    id: id(),
    url,
    title,
    thumbnail,
    container,
    quality,
    status: 'queued',
    progress: 0,
    speed: '',
    eta: '',
    message: 'Queued',
    error: '',
    filePath: '',
    child: null,
    createdAt: new Date().toISOString()
  };

  jobs.set(job.id, job);
  res.status(202).json(serializeJob(job));
  setImmediate(() => startDownload(job));
});

app.get('/api/jobs', (req, res) => {
  res.json([...jobs.values()].map(serializeJob));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json(serializeJob(job));
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  let set = subscribers.get(job.id);
  if (!set) {
    set = new Set();
    subscribers.set(job.id, set);
  }
  set.add(res);
  writeEvent(res, serializeJob(job));

  req.on('close', () => {
    set.delete(res);
    if (!set.size) subscribers.delete(job.id);
  });
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (['completed', 'failed', 'canceled'].includes(job.status)) {
    res.json(serializeJob(job));
    return;
  }
  job.status = 'canceled';
  job.message = 'Canceled';
  if (job.child) {
    try { job.child.kill('SIGTERM'); } catch {}
  }
  emitJob(job);
  res.json(serializeJob(job));
});

app.post('/api/jobs/:id/restart', (req, res) => {
  const old = jobs.get(req.params.id);
  if (!old) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  const job = {
    ...old,
    id: id(),
    status: 'queued',
    progress: 0,
    speed: '',
    eta: '',
    message: 'Queued',
    error: '',
    filePath: '',
    child: null,
    createdAt: new Date().toISOString()
  };
  jobs.set(job.id, job);
  res.status(202).json(serializeJob(job));
  setImmediate(() => startDownload(job));
});

app.delete('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (job.child) {
    try { job.child.kill('SIGTERM'); } catch {}
  }
  jobs.delete(req.params.id);
  res.json({ ok: true });
});

app.get('/api/jobs/:id/file', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    res.status(404).json({ error: 'File not found for this job.' });
    return;
  }
  const resolved = path.resolve(job.filePath);
  if (!resolved.startsWith(path.resolve(DOWNLOADS_DIR))) {
    res.status(403).json({ error: 'Invalid file path.' });
    return;
  }
  res.download(resolved, path.basename(resolved));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  const binary = getYtDlp();
  console.log(`YouTube Downloader web app running at http://localhost:${PORT}`);
  console.log(binary ? `yt-dlp: ${binary.version}` : 'yt-dlp: not found. Install with: pip install -U yt-dlp');
  console.log(`Downloads folder: ${DOWNLOADS_DIR}`);
  if (DEMO_MODE) console.log('DEMO_MODE=1 is enabled. Downloads are simulated.');
});
