'use strict';

const SERVICE_NAME = 'AudioAppWS';

// ── State ─────────────────────────────────────────────────────────────────

let ws = null;

// ── Screen helpers ────────────────────────────────────────────────────────

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
        s.classList.toggle('active', s.id === id);
    });
}

function logMsg(type, text) {
    var log   = document.getElementById('log');
    var entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    entry.textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

// ── WebSocket ─────────────────────────────────────────────────────────────

function connectWS(host, port) {
    var url = 'ws://' + host + ':' + port;

    document.getElementById('found-addr').textContent = url;
    showScreen('screen-found');

    var socket;
    try {
        socket = new WebSocket(url);
    } catch (e) {
        onDiscoveryError('Bad WebSocket URL (' + url + '): ' + e.message);
        return;
    }

    var didOpen = false;

    socket.onopen = function () {
        didOpen = true;
        ws = socket;
        document.getElementById('conn-addr').textContent = url;
        document.getElementById('log').innerHTML = '';
        logMsg('sys', 'Connected to ' + url);
        showScreen('screen-connected');
        NsdDiscovery.stopDiscovery();
    };

    socket.onmessage = function (e) {
        logMsg('recv', e.data);
    };

    socket.onerror = function () {
        // onclose fires immediately after, handle there
    };

    socket.onclose = function () {
        ws = null;
        if (didOpen) {
            // Clean disconnect from a live session — service may come back, search again
            showScreen('screen-searching');
            NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError);
        } else {
            // Never connected — server is gone; stop hammering and let the user retry
            NsdDiscovery.stopDiscovery();
            onDiscoveryError('Service found but connection refused — server may have stopped');
        }
    };
}

function sendMessage() {
    var input = document.getElementById('msg-input');
    var text  = input.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(text);
    logMsg('sent', text);
    input.value = '';
    input.style.height = 'auto';
}

// ── NSD discovery callbacks ───────────────────────────────────────────────

function onDiscoveryEvent(event) {
    if (event.type === 'found') {
        connectWS(event.host, event.port);
    }
    // 'lost' events are handled implicitly via ws.onclose
}

function onDiscoveryError(err) {
    document.getElementById('error-detail').textContent = String(err);
    showScreen('screen-error');
}

// ── Input auto-resize & send ──────────────────────────────────────────────

document.addEventListener('deviceready', function () {

    NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError);

    // Send button
    document.getElementById('btn-send').addEventListener('click', sendMessage);

    // Disconnect button
    document.getElementById('btn-disconnect').addEventListener('click', function () {
        if (ws) ws.close();
    });

    // Retry button (error screen)
    document.getElementById('btn-retry').addEventListener('click', function () {
        showScreen('screen-searching');
        NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError);
    });

    // Auto-grow textarea; Enter = send, Shift+Enter = newline
    var input = document.getElementById('msg-input');
    input.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

}, false);
