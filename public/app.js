// TuneGrab - YouTube to MP3 Converter
// Frontend JavaScript Application

const API_BASE = '';

// DOM Elements
const urlInput = document.getElementById('urlInput');
const clearBtn = document.getElementById('clearBtn');
const convertBtn = document.getElementById('convertBtn');
const previewSection = document.getElementById('previewSection');
const previewType = document.getElementById('previewType');
const previewContent = document.getElementById('previewContent');
const choiceSection = document.getElementById('choiceSection');
const choiceVideoTitle = document.getElementById('choiceVideoTitle');
const choicePlaylistInfo = document.getElementById('choicePlaylistInfo');
const choiceSingleBtn = document.getElementById('choiceSingleBtn');
const choicePlaylistBtn = document.getElementById('choicePlaylistBtn');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressTitle = document.getElementById('progressTitle');
const progressSubtitle = document.getElementById('progressSubtitle');
const currentFile = document.getElementById('currentFile');
const resultsSection = document.getElementById('resultsSection');
const resultsCount = document.getElementById('resultsCount');
const filesList = document.getElementById('filesList');
const newConversionBtn = document.getElementById('newConversionBtn');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const retryBtn = document.getElementById('retryBtn');

// State
let currentConversionId = null;
let statusPollInterval = null;
let videoInfo = null;
let originalUrl = null;
let isPlaylist = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
});

function setupEventListeners() {
    urlInput.addEventListener('input', handleInputChange);
    urlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleConvert();
    });
    clearBtn.addEventListener('click', handleClear);
    convertBtn.addEventListener('click', handleConvert);
    newConversionBtn.addEventListener('click', handleNewConversion);
    retryBtn.addEventListener('click', handleRetry);
    choiceSingleBtn.addEventListener('click', () => handleChoiceSelected('single'));
    choicePlaylistBtn.addEventListener('click', () => handleChoiceSelected('playlist'));
}

function handleInputChange() {
    const hasValue = urlInput.value.trim().length > 0;
    clearBtn.style.display = hasValue ? 'flex' : 'none';

    if (!hasValue) {
        hideSection(previewSection);
        hideSection(choiceSection);
        videoInfo = null;
    }
}

function handleClear() {
    urlInput.value = '';
    clearBtn.style.display = 'none';
    hideSection(previewSection);
    hideSection(choiceSection);
    videoInfo = null;
    urlInput.focus();
}

// Parse YouTube URL to extract video ID and playlist ID
function parseYouTubeUrl(url) {
    const result = { videoId: null, playlistId: null, isRadioMix: false };

    try {
        const urlObj = new URL(url);

        if (urlObj.hostname.includes('youtu.be')) {
            result.videoId = urlObj.pathname.slice(1);
        } else if (urlObj.pathname.includes('/shorts/')) {
            result.videoId = urlObj.pathname.split('/shorts/')[1];
        } else {
            result.videoId = urlObj.searchParams.get('v');
        }

        result.playlistId = urlObj.searchParams.get('list');

        if (result.playlistId && result.playlistId.startsWith('RD')) {
            result.isRadioMix = true;
        }
    } catch (e) {
        console.error('Failed to parse URL:', e);
    }

    return result;
}

function buildVideoOnlyUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

function buildPlaylistUrl(playlistId) {
    return `https://www.youtube.com/playlist?list=${playlistId}`;
}

async function handleConvert() {
    const url = urlInput.value.trim();
    originalUrl = url;

    if (!url) {
        showError('Please enter a YouTube URL');
        urlInput.focus();
        return;
    }

    if (!isValidYouTubeUrl(url)) {
        showError('Please enter a valid YouTube video or playlist URL');
        return;
    }

    const parsed = parseYouTubeUrl(url);

    convertBtn.disabled = true;
    convertBtn.classList.add('loading');

    try {
        if (parsed.videoId && parsed.playlistId && !parsed.isRadioMix) {
            const [videoInfoResult, playlistInfoResult] = await Promise.all([
                fetchVideoInfo(buildVideoOnlyUrl(parsed.videoId)),
                fetchPlaylistCount(buildPlaylistUrl(parsed.playlistId))
            ]);

            choiceVideoTitle.textContent = videoInfoResult.title || 'Current video';
            choicePlaylistInfo.textContent = `${playlistInfoResult.count || 'Multiple'} videos`;

            videoInfo = {
                single: videoInfoResult,
                playlist: playlistInfoResult,
                parsed: parsed
            };

            showSection(choiceSection);

        } else if (parsed.isRadioMix && parsed.videoId) {
            const singleUrl = buildVideoOnlyUrl(parsed.videoId);
            const info = await fetchVideoInfo(singleUrl);
            videoInfo = info;
            isPlaylist = false;
            showPreview(info);
            await startConversionProcess(singleUrl, 1);

        } else {
            const info = await fetchVideoInfo(url);
            videoInfo = info;
            isPlaylist = info.type === 'playlist';
            showPreview(info);
            await startConversionProcess(url, info.count || 1);
        }

    } catch (error) {
        showError(error.message || 'Failed to process the video');
    } finally {
        convertBtn.disabled = false;
        convertBtn.classList.remove('loading');
    }
}

async function handleChoiceSelected(choice) {
    hideSection(choiceSection);

    let urlToConvert;
    let infoToShow;
    let totalTracks = 1;

    if (choice === 'single') {
        urlToConvert = buildVideoOnlyUrl(videoInfo.parsed.videoId);
        infoToShow = videoInfo.single;
        isPlaylist = false;
        totalTracks = 1;
    } else {
        urlToConvert = buildPlaylistUrl(videoInfo.parsed.playlistId);
        infoToShow = videoInfo.playlist;
        isPlaylist = true;
        totalTracks = videoInfo.playlist.count || 1;
    }

    showPreview(infoToShow);

    try {
        await startConversionProcess(urlToConvert, totalTracks);
    } catch (error) {
        showError(error.message || 'Failed to start conversion');
    }
}

async function startConversionProcess(url, totalTracks = 1) {
    const response = await fetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, totalTracks })
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start conversion');
    }

    const { conversionId } = await response.json();
    currentConversionId = conversionId;

    hideSection(previewSection);
    showSection(progressSection);
    updateProgress(0, 0, totalTracks);

    pollConversionStatus(conversionId);
}

function isValidYouTubeUrl(url) {
    const patterns = [
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/playlist\?list=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

async function fetchVideoInfo(url) {
    const response = await fetch(`${API_BASE}/api/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to fetch video info');
    }

    return response.json();
}

async function fetchPlaylistCount(url) {
    try {
        const response = await fetch(`${API_BASE}/api/info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        if (!response.ok) {
            return { type: 'playlist', count: 'Multiple', title: 'Playlist' };
        }

        return response.json();
    } catch {
        return { type: 'playlist', count: 'Multiple', title: 'Playlist' };
    }
}

function showPreview(info) {
    previewType.textContent = info.type === 'playlist' ? 'Playlist' : 'Video';

    if (info.type === 'playlist') {
        previewContent.innerHTML = `
            <div class="playlist-info">
                <div class="playlist-count">${info.count || '?'}</div>
                <div class="playlist-label">videos in playlist</div>
            </div>
            <div class="preview-item">
                <div class="preview-info" style="text-align: center;">
                    <div class="preview-item-title">${escapeHtml(info.title)}</div>
                </div>
            </div>
        `;
    } else {
        const duration = formatDuration(info.duration);
        previewContent.innerHTML = `
            <div class="preview-item">
                ${info.thumbnail ? `<img src="${info.thumbnail}" alt="${escapeHtml(info.title)}" class="preview-thumbnail" onerror="this.style.display='none'">` : ''}
                <div class="preview-info">
                    <div class="preview-item-title">${escapeHtml(info.title)}</div>
                    <div class="preview-meta">
                        ${info.channel ? `<span>${escapeHtml(info.channel)}</span>` : ''}
                        ${duration ? `<span>${duration}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }

    showSection(previewSection);
}

function pollConversionStatus(conversionId) {
    if (statusPollInterval) {
        clearInterval(statusPollInterval);
    }

    statusPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE}/api/status/${conversionId}`);
            const status = await response.json();

            // Update progress with playlist info
            updateProgress(
                status.progress,
                status.completedTracks || 0,
                status.totalTracks || 1,
                status.currentTrack
            );

            if (status.status === 'completed') {
                clearInterval(statusPollInterval);
                showResults(conversionId, status.files, status.totalTracks > 1, status.zipReady);
            } else if (status.status === 'error') {
                clearInterval(statusPollInterval);
                showError(status.error || 'Conversion failed');
            }
        } catch (error) {
            console.error('Status poll error:', error);
        }
    }, 1000);
}

function updateProgress(percent, completed = 0, total = 1, currentTrack = '') {
    // For playlists, calculate REAL percentage based on completed tracks
    let displayPercent = percent;
    if (total > 1) {
        // Real percentage: completed / total * 100
        const realPercent = (completed / total) * 100;
        // Add a small portion for current track progress
        displayPercent = Math.min(99, realPercent + (percent - Math.floor(realPercent)) / total);
        // Use the server's calculated progress which now shows real percentage
        displayPercent = percent;
    }

    const beforeStyle = document.createElement('style');
    beforeStyle.id = 'progress-style';
    const existingStyle = document.getElementById('progress-style');
    if (existingStyle) existingStyle.remove();
    beforeStyle.textContent = `#progressBar::before { transform: scaleX(${displayPercent / 100}); }`;
    document.head.appendChild(beforeStyle);

    progressPercent.textContent = `${Math.round(displayPercent)}%`;

    // Update progress subtitle for playlists with detailed info
    if (total > 1) {
        const currentNum = Math.min(completed + 1, total);
        const realPercentDone = Math.round((completed / total) * 100);
        progressSubtitle.textContent = `Track ${currentNum} of ${total} (${realPercentDone}% complete)`;
        progressTitle.textContent = `GRABBING PLAYLIST...`;
    } else {
        progressSubtitle.textContent = 'Snatching your tunes';
        progressTitle.textContent = 'GRABBING...';
    }

    if (currentTrack) {
        currentFile.textContent = `Converting: ${currentTrack}`;
    }
}

function showResults(conversionId, files, showZip = false, zipReady = false) {
    hideSection(progressSection);

    const count = files.length;
    resultsCount.textContent = `${count} file${count !== 1 ? 's' : ''} ready for download`;

    let html = '';

    // Show prominent ZIP download for playlists
    if (showZip && count > 1) {
        html += `
            <div class="zip-download-container">
                <div class="zip-ready-badge">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
                    </svg>
                    PLAYLIST READY
                </div>
                <p class="zip-info">${count} tracks packaged and ready to download</p>
                <a href="${API_BASE}/api/download-zip/${conversionId}" class="download-all-btn zip-prominent" download>
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <polyline points="7 10 12 15 17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    DOWNLOAD ZIP (${count} TRACKS)
                </a>
            </div>
            <details class="individual-files-container">
                <summary class="individual-files-header">Or download individually</summary>
                <div class="individual-files-list">
        `;

        html += files.map(file => `
            <div class="file-item">
                <div class="file-icon">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 18V6l12 6-12 6z" fill="currentColor"/>
                    </svg>
                </div>
                <span class="file-name" title="${escapeHtml(file)}">${escapeHtml(file)}</span>
                <a href="${API_BASE}/api/download/${conversionId}/${encodeURIComponent(file)}" class="download-btn" download>
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 5v14M19 12l-7 7-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Download
                </a>
            </div>
        `).join('');

        html += `
                </div>
            </details>
        `;
    } else {
        // Single file - show normal download
        html += files.map(file => `
            <div class="file-item">
                <div class="file-icon">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 18V6l12 6-12 6z" fill="currentColor"/>
                    </svg>
                </div>
                <span class="file-name" title="${escapeHtml(file)}">${escapeHtml(file)}</span>
                <a href="${API_BASE}/api/download/${conversionId}/${encodeURIComponent(file)}" class="download-btn" download>
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 5v14M19 12l-7 7-7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    Download
                </a>
            </div>
        `).join('');
    }

    filesList.innerHTML = html;

    showSection(resultsSection);
}

function showError(message) {
    hideSection(progressSection);
    hideSection(previewSection);
    hideSection(choiceSection);
    errorMessage.textContent = message;
    showSection(errorSection);

    if (statusPollInterval) {
        clearInterval(statusPollInterval);
    }
}

function handleNewConversion() {
    resetUI();
    urlInput.value = '';
    urlInput.focus();
}

function handleRetry() {
    hideSection(errorSection);
    if (urlInput.value.trim()) {
        handleConvert();
    } else {
        urlInput.focus();
    }
}

function resetUI() {
    hideSection(previewSection);
    hideSection(choiceSection);
    hideSection(progressSection);
    hideSection(resultsSection);
    hideSection(errorSection);
    clearBtn.style.display = 'none';
    videoInfo = null;
    currentConversionId = null;
    originalUrl = null;
    isPlaylist = false;

    const existingStyle = document.getElementById('progress-style');
    if (existingStyle) existingStyle.remove();
}

function showSection(section) {
    section.style.display = 'block';
}

function hideSection(section) {
    section.style.display = 'none';
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
