const API_URL = '/api';

const twitchUsernameInput = document.getElementById('twitchUsername');
const twitchTokenInput = document.getElementById('twitchToken');
const messageInput = document.getElementById('message');
const statusIndicator = document.getElementById('status-indicator');
const saveBtn = document.getElementById('saveBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sendNowBtn = document.getElementById('sendNowBtn');
const logsContainer = document.getElementById('logs');
const streamsList = document.getElementById('streamsList');

async function fetchStatus() {
    try {
        const res = await fetch(`${API_URL}/status`);
        const data = await res.json();
        updateUI(data);
    } catch (err) {
        console.error('Failed to fetch status', err);
    }
}

function updateUI(data) {
    // Update inputs only if not focused (to avoid overwriting user typing)
    if (document.activeElement !== twitchUsernameInput) twitchUsernameInput.value = data.config.twitchUsername;
    // Don't overwrite token input for security/UX unless empty
    if (!twitchTokenInput.value && data.config.twitchToken) twitchTokenInput.value = data.config.twitchToken;
    
    if (document.activeElement !== messageInput) messageInput.value = data.config.message;

    // Status
    if (data.config.isRunning) {
        statusIndicator.textContent = 'Running';
        statusIndicator.className = 'status running';
        startBtn.disabled = true;
        stopBtn.disabled = false;
        saveBtn.disabled = true; 
        sendNowBtn.disabled = false; // Enable send button when running
        twitchUsernameInput.disabled = true;
        twitchTokenInput.disabled = true;
        messageInput.disabled = true;
    } else {
        statusIndicator.textContent = 'Stopped';
        statusIndicator.className = 'status stopped';
        startBtn.disabled = false;
        stopBtn.disabled = true;
        saveBtn.disabled = false;
        sendNowBtn.disabled = true; // Disable send button when stopped
        twitchUsernameInput.disabled = false;
        twitchTokenInput.disabled = false;
        messageInput.disabled = false;
    }

    // Logs
    logsContainer.innerHTML = data.logs.map(log => {
        let className = 'log-entry';
        if (log.type === 'error') className += ' log-error';
        if (log.type === 'warning') className += ' log-warning';
        if (log.type === 'info') className += ' log-info';
        return `<div class="${className}">[${log.timestamp}] ${log.message}</div>`;
    }).join('');

    // Streams
    streamsList.innerHTML = data.lastStreams.map(stream => {
        const streamUrl = stream.url || `https://twitch.tv/${stream.user_name}`;
        return `
        <a href="${streamUrl}" target="_blank" class="stream-card-link">
            <div class="stream-card">
                <img src="${stream.thumbnail_url?.replace('{width}', '320').replace('{height}', '180') || 'https://via.placeholder.com/320x180'}" alt="${stream.user_name}">
                <div class="stream-info">
                    <div class="stream-name">${stream.user_name}</div>
                    <div class="viewer-count">👁️ ${stream.viewer_count}</div>
                    <div class="viewer-count">${stream.title}</div>
                </div>
            </div>
        </a>
    `;
    }).join('');
}

saveBtn.addEventListener('click', async () => {
    const config = {
        message: messageInput.value,
        twitchUsername: twitchUsernameInput.value,
        twitchToken: twitchTokenInput.value
    };

    try {
        const res = await fetch(`${API_URL}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        const data = await res.json();
        if (data.success) {
            alert('Configuration saved!');
            fetchStatus();
        }
    } catch (err) {
        console.error('Error saving config:', err);
    }
});

startBtn.addEventListener('click', async () => {
    await fetch(`${API_URL}/start`, { method: 'POST' });
    fetchStatus();
});

stopBtn.addEventListener('click', async () => {
    await fetch(`${API_URL}/stop`, { method: 'POST' });
    fetchStatus();
});

sendNowBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to send the message to all currently visible streams?')) {
        try {
            const res = await fetch(`${API_URL}/send-now`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                // Feedback handled by logs
            }
        } catch (err) {
            console.error('Error sending now:', err);
        }
    }
});

// Poll status every 2 seconds
fetchStatus();
setInterval(fetchStatus, 2000);
