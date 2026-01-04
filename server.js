const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store for ongoing conversions
const conversions = new Map();

// Downloads directory
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

// Clear all cached files on startup
function clearAllDownloads() {
    if (fs.existsSync(DOWNLOADS_DIR)) {
        fs.readdirSync(DOWNLOADS_DIR).forEach(dir => {
            const dirPath = path.join(DOWNLOADS_DIR, dir);
            try {
                fs.rmSync(dirPath, { recursive: true, force: true });
            } catch (e) {
                // Ignore errors
            }
        });
        console.log('🧹 Cleared all cached MP3 files on startup');
    }
}

// Create downloads directory and clear any existing files
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
} else {
    clearAllDownloads();
}

// Serve downloads
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Get video/playlist info
app.post('/api/info', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const info = await getVideoInfo(url);
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start conversion
app.post('/api/convert', async (req, res) => {
    const { url, totalTracks } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // clearPreviousConversions(); // Removed to allow concurrent users

    const conversionId = uuidv4();
    conversions.set(conversionId, {
        status: 'starting',
        progress: 0,
        files: [],
        error: null,
        createdAt: Date.now(),
        // Playlist tracking
        totalTracks: totalTracks || 1,
        completedTracks: 0,
        currentTrack: '',
        currentTrackProgress: 0,
        zipFile: null
    });

    startConversion(conversionId, url);

    res.json({ conversionId });
});

// Get conversion status
app.get('/api/status/:id', (req, res) => {
    const { id } = req.params;
    const conversion = conversions.get(id);

    if (!conversion) {
        return res.status(404).json({ error: 'Conversion not found' });
    }

    res.json(conversion);
});

// Download single file
app.get('/api/download/:id/:filename', (req, res) => {
    const { id, filename } = req.params;
    const filePath = path.join(DOWNLOADS_DIR, id, filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath);
});

// Download all files as ZIP
app.get('/api/download-zip/:id', async (req, res) => {
    const { id } = req.params;
    const conversion = conversions.get(id);

    if (!conversion) {
        return res.status(404).json({ error: 'Conversion not found' });
    }

    const outputDir = path.join(DOWNLOADS_DIR, id);
    const zipPath = path.join(outputDir, 'TuneGrab-Collection.zip');

    // Check if ZIP already exists
    if (conversion.zipFile && fs.existsSync(zipPath)) {
        return res.download(zipPath, 'TuneGrab-Collection.zip');
    }

    // Create ZIP file
    try {
        await createZipFile(outputDir, zipPath, conversion.files);
        conversion.zipFile = 'TuneGrab-Collection.zip';
        res.download(zipPath, 'TuneGrab-Collection.zip');
    } catch (error) {
        console.error('Failed to create ZIP:', error);
        res.status(500).json({ error: 'Failed to create ZIP file' });
    }
});

// Create ZIP file from MP3s
function createZipFile(sourceDir, zipPath, files) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 5 } });

        output.on('close', () => {
            console.log(`📦 Created ZIP file: ${archive.pointer()} bytes`);
            resolve();
        });

        archive.on('error', reject);
        archive.pipe(output);

        // Add each MP3 file
        files.forEach(file => {
            const filePath = path.join(sourceDir, file);
            if (fs.existsSync(filePath)) {
                archive.file(filePath, { name: file });
            }
        });

        archive.finalize();
    });
}

// Cleanup helper function
function cleanupConversion(id) {
    const dirPath = path.join(DOWNLOADS_DIR, id);

    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            console.log(`🗑️ Cleaned up conversion: ${id}`);
        }
        conversions.delete(id);
    } catch (err) {
        console.error(`Failed to cleanup ${id}:`, err);
    }
}

// Simple cleanup - delete files older than 5 minutes
setInterval(() => {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;

    for (const [id, conversion] of conversions.entries()) {
        const age = now - conversion.createdAt;
        if (age > maxAge) {
            console.log(`⏱️ 5 minute limit reached for ${id}, cleaning up...`);
            cleanupConversion(id);
        }
    }

    if (fs.existsSync(DOWNLOADS_DIR)) {
        fs.readdirSync(DOWNLOADS_DIR).forEach(dir => {
            if (!conversions.has(dir)) {
                const dirPath = path.join(DOWNLOADS_DIR, dir);
                try {
                    const stats = fs.statSync(dirPath);
                    if (stats.isDirectory()) {
                        const age = now - stats.mtimeMs;
                        if (age > maxAge) {
                            console.log(`🧹 Cleaning orphaned directory: ${dir}`);
                            fs.rmSync(dirPath, { recursive: true, force: true });
                        }
                    }
                } catch (e) { }
            }
        });
    }
}, 30 * 1000);

// Get video info using yt-dlp
function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const args = ['--dump-json', '--flat-playlist', '--no-warnings', url];
        const process = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => { stdout += data.toString(); });
        process.stderr.on('data', (data) => { stderr += data.toString(); });

        process.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr || 'Failed to get video info'));
                return;
            }
            try {
                const lines = stdout.trim().split('\n');
                const items = lines.map(line => JSON.parse(line));

                if (items.length === 1) {
                    const video = items[0];
                    resolve({
                        type: 'video',
                        title: video.title,
                        thumbnail: video.thumbnail,
                        duration: video.duration,
                        channel: video.channel || video.uploader,
                        url: url
                    });
                } else {
                    resolve({
                        type: 'playlist',
                        title: items[0].playlist_title || 'Playlist',
                        count: items.length,
                        videos: items.map(v => ({
                            title: v.title,
                            thumbnail: v.thumbnail,
                            duration: v.duration,
                            url: v.url || v.webpage_url
                        })),
                        url: url
                    });
                }
            } catch (e) {
                reject(new Error('Failed to parse video info'));
            }
        });
    });
}

// Start conversion process with better playlist tracking
async function startConversion(conversionId, url) {
    const outputDir = path.join(DOWNLOADS_DIR, conversionId);
    fs.mkdirSync(outputDir, { recursive: true });

    const conversion = conversions.get(conversionId);
    conversion.status = 'converting';

    const args = [
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', '0',
        '-o', path.join(outputDir, '%(title)s.%(ext)s'),
        '--no-playlist-reverse',
        '--newline',
        '--progress',
        // Parallel/faster download options
        '--concurrent-fragments', '4',  // Download 4 fragments simultaneously
        '--retries', '3',
        '--fragment-retries', '3',
        '--buffer-size', '16K',
        url
    ];

    const process = spawn('yt-dlp', args);
    let currentFile = '';
    let downloadingIndex = 0;

    process.stdout.on('data', (data) => {
        const output = data.toString();

        // Check for "Downloading item X of Y"
        const playlistMatch = output.match(/Downloading item (\d+) of (\d+)/i);
        if (playlistMatch) {
            downloadingIndex = parseInt(playlistMatch[1]);
            const total = parseInt(playlistMatch[2]);
            conversion.totalTracks = total;
            conversion.completedTracks = downloadingIndex - 1;
        }

        // Track download/extraction by video title or filename
        const downloadMatch = output.match(/\[download\] Destination: (.+)/);
        if (downloadMatch) {
            currentFile = path.basename(downloadMatch[1]);
            conversion.currentTrack = currentFile.replace(/\.[^.]+$/, '');
        }

        // Parse current file progress
        const progressMatch = output.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
            conversion.currentTrackProgress = parseFloat(progressMatch[1]);

            // Calculate overall progress for playlists - show REAL percentage based on completed tracks
            if (conversion.totalTracks > 1) {
                // Real percentage: completed tracks / total tracks
                // Add a small portion for current track progress within its "slot"
                const completedPercent = (conversion.completedTracks / conversion.totalTracks) * 100;
                const currentTrackContribution = (conversion.currentTrackProgress / 100) * (100 / conversion.totalTracks);
                conversion.progress = Math.min(99, completedPercent + currentTrackContribution);
            } else {
                conversion.progress = conversion.currentTrackProgress;
            }
        }

        // Check for completed file
        if (output.includes('[ExtractAudio]') && output.includes('Destination:')) {
            const match = output.match(/Destination: (.+)/);
            if (match) {
                const filename = path.basename(match[1].trim());
                if (filename.endsWith('.mp3') && !conversion.files.includes(filename)) {
                    conversion.files.push(filename);
                    conversion.completedTracks = conversion.files.length;
                }
            }
        }

        conversion.currentFile = currentFile;
    });

    process.stderr.on('data', (data) => {
        console.error('yt-dlp stderr:', data.toString());
    });

    process.on('close', async (code) => {
        if (code === 0) {
            const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.mp3'));
            conversion.files = files;
            conversion.status = 'completed';
            conversion.progress = 100;
            conversion.completedTracks = files.length;
            conversion.totalTracks = files.length;

            // Auto-create ZIP file for playlists (more than 1 file)
            if (files.length > 1) {
                try {
                    const zipPath = path.join(outputDir, 'TuneGrab-Collection.zip');
                    await createZipFile(outputDir, zipPath, files);
                    conversion.zipFile = 'TuneGrab-Collection.zip';
                    conversion.zipReady = true;
                    console.log(`📦 Auto-created ZIP for playlist: ${files.length} files`);
                } catch (err) {
                    console.error('Failed to auto-create ZIP:', err);
                }
            }
        } else {
            conversion.status = 'error';
            conversion.error = 'Conversion failed';
        }
    });
}

app.listen(PORT, () => {
    console.log(`🎵 YouTube to MP3 Converter running at http://localhost:${PORT}`);
});
