const express = require('express');
const axios = require('axios');
const tmi = require('tmi.js');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, 'config.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configuration State
let config = {
    message: "my username realleonw",
    twitchUsername: "",
    twitchToken: "", // oauth:xxxxxxxx
    isRunning: false
};

// Load Config from File
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const savedConfig = JSON.parse(data);
            // Merge saved config with default config (preserve defaults if missing)
            config = { ...config, ...savedConfig };
            // Force isRunning to false on restart to avoid auto-start without explicit user action or to prevent issues
            config.isRunning = false; 
            console.log('Configuration loaded from config.json');
        }
    } catch (err) {
        console.error('Error loading config:', err);
    }
}

// Save Config to File
function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        console.log('Configuration saved to config.json');
    } catch (err) {
        console.error('Error saving config:', err);
    }
}

// Load config immediately
loadConfig();

// Runtime State
let intervalId = null;
let tmiClient = null;
let logs = [];
let lastStreams = [];

function addLog(type, message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${type.toUpperCase()}] ${message}`); // Print to console
    logs.unshift({ timestamp, type, message });
    if (logs.length > 100) logs.pop();
}

// Twitch Client Management
async function initTwitchClient() {
    if (tmiClient) {
        try {
            await tmiClient.disconnect();
        } catch (e) {
            // Ignore disconnect errors
        }
    }

    if (!config.twitchUsername || !config.twitchToken) {
        addLog('error', 'Missing Twitch Credentials');
        return false;
    }

    tmiClient = new tmi.Client({
        options: { debug: true },
        identity: {
            username: config.twitchUsername,
            password: config.twitchToken.startsWith('oauth:') ? config.twitchToken : `oauth:${config.twitchToken}`
        },
        channels: [] // We will join dynamically or just send to channels
    });

    try {
        await tmiClient.connect();
        addLog('info', 'Connected to Twitch IRC');
        return true;
    } catch (err) {
        addLog('error', `Failed to connect to Twitch: ${err.message}`);
        return false;
    }
}

// Core Logic
async function fetchStreams() {
    if (!config.isRunning) return;

    // addLog('info', 'Fetching streams...'); // Too noisy for 15s interval
    try {
        const response = await axios.get('https://plsdonatestreams.com/api/streams?provider=twitch&sort_by=viewer_count_desc&page=1&limit=12', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        
        if (response.data && response.data.streams) {
            lastStreams = response.data.streams;
            // Silent update unless error
        }
    } catch (err) {
        addLog('error', `Error fetching streams: ${err.message}`);
    }
}

async function sendToAllStreams() {
    if (!config.isRunning) {
        addLog('warning', 'Bot is not running. Please start it first.');
        return;
    }

    if (lastStreams.length === 0) {
        addLog('warning', 'No streams found yet to send messages to.');
        return;
    }

    const streamers = lastStreams.map(s => s.user_name || s.username);
    addLog('system', `Starting broadcast to ${streamers.length} channels...`);

    if (tmiClient && tmiClient.readyState() === 'OPEN') {
        for (const streamer of streamers) {
            try {
                // Rate limiting: wait 1 second between messages
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                await tmiClient.join(streamer);
                await tmiClient.say(streamer, config.message);
                addLog('info', `Sent message to ${streamer}`);
            } catch (err) {
                addLog('error', `Failed to send to ${streamer}: ${err.message}`);
            }
        }
        addLog('success', 'Broadcast completed.');
    } else {
        addLog('warning', 'Twitch client not connected, skipping messages.');
    }
}

function startScheduler() {
    if (intervalId) clearInterval(intervalId);
    if (!config.isRunning) return;

    // Run immediately
    fetchStreams();
    
    // Schedule fetch every 15 seconds
    intervalId = setInterval(fetchStreams, 15000);
    addLog('system', `Scheduler started. Auto-fetching streams every 15s.`);
}

function stopScheduler() {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
    config.isRunning = false;
    addLog('system', 'Scheduler stopped.');
}

// API Routes
app.get('/api/status', (req, res) => {
    res.json({
        config: { ...config, twitchToken: config.twitchToken ? '******' : '' }, // Hide token
        logs,
        lastStreams,
        isClientConnected: tmiClient && tmiClient.readyState() === 'OPEN'
    });
});

app.post('/api/config', async (req, res) => {
    const { message, twitchUsername, twitchToken } = req.body;
    
    let credentialsChanged = false;
    if (message) config.message = message;
    if (twitchUsername && twitchUsername !== config.twitchUsername) {
        config.twitchUsername = twitchUsername;
        credentialsChanged = true;
    }
    if (twitchToken && twitchToken !== '******') {
        config.twitchToken = twitchToken;
        credentialsChanged = true;
    }

    if (credentialsChanged && config.isRunning) {
        // Reconnect if running
        await initTwitchClient();
    }
    
    // If interval changed and running, restart scheduler
    if (config.isRunning) {
        startScheduler();
    }

    saveConfig(); // Save to file
    addLog('system', 'Configuration updated');
    res.json({ success: true });
});

app.post('/api/send-now', async (req, res) => {
    sendToAllStreams();
    res.json({ success: true, message: "Broadcast initiated" });
});

app.post('/api/start', async (req, res) => {
    if (config.isRunning) return res.json({ success: true, message: 'Already running' });
    
    config.isRunning = true;
    
    // Initialize Twitch if needed
    if (!tmiClient || tmiClient.readyState() !== 'OPEN') {
        const connected = await initTwitchClient();
        if (!connected) {
            config.isRunning = false;
            return res.status(400).json({ success: false, message: 'Failed to connect to Twitch' });
        }
    }

    startScheduler();
    res.json({ success: true });
});

app.post('/api/stop', (req, res) => {
    stopScheduler();
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
