import { basic_detect } from './basic_detect.js'
import { basic_gen } from './basic_gen.js'

const SERVICE_NAME = 'AudioAppWS'

// ── DOM ───────────────────────────────────────────────────────────────────

const canvas      = document.getElementById('input-canvas')
const ctx         = canvas.getContext('2d', { willReadFrequently: true })
const valueEl     = document.getElementById('value-display')
const indicatorEl = document.getElementById('indicator')
const deltaEl     = document.getElementById('delta-display')

// basic_detect writes its debug image into a secondary canvas (not displayed)
const outCanvas = document.createElement('canvas')

// ── Canvas dimensions (logical pixel space, scaled via CSS) ───────────────

const W = 400, H = 400
canvas.width  = W
canvas.height = H

// ── State ─────────────────────────────────────────────────────────────────

let ws          = null
let animFrameId = null
let marker      = null  // initialised after OpenCV is ready

// ── Screen helpers ────────────────────────────────────────────────────────

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.toggle('active', s.id === id)
    })
}

// ── Rotary: draw ──────────────────────────────────────────────────────────

// 300 px of horizontal drag = one full rotation
const DRAG_SENSITIVITY = (Math.PI * 2) / 300

let rotation  = 0
let lastTouchX = null

canvas.addEventListener('touchstart', e => {
    e.preventDefault()
    lastTouchX = e.touches[0].clientX
}, { passive: false })

canvas.addEventListener('touchmove', e => {
    e.preventDefault()
    const x = e.touches[0].clientX
    if (lastTouchX !== null) rotation += (x - lastTouchX) * DRAG_SENSITIVITY
    lastTouchX = x
}, { passive: false })

canvas.addEventListener('touchend',   () => { lastTouchX = null })
canvas.addEventListener('touchcancel', () => { lastTouchX = null })

function drawCanvas() {
    ctx.fillStyle = '#232323'
    ctx.fillRect(0, 0, W, H)

    // Dot orbiting at radius 70 from centre, angle = rotation
    ctx.save()
    ctx.translate(W / 2, H / 2)
    ctx.rotate(rotation)
    ctx.beginPath()
    ctx.arc(70, 0, 20, 0, Math.PI * 2)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()

    // ArUco marker: inner 200×200 region (skipping 56 px border), below centre
    const markerSize = 50
    ctx.drawImage(marker, 56, 56, 200, 200,
        W / 2 - markerSize / 2, H / 2 + 110, markerSize, markerSize)
}

// ── Rotary: detect ────────────────────────────────────────────────────────

function detectDotAngle(markers) {
    const m23 = markers.find(m => m.id === 23)
    if (!m23) return null

    // Infer wheel centre and radius from marker geometry
    const mw = m23.topRight.x - m23.topLeft.x
    const cx = m23.topLeft.x + mw / 2
    const cy = m23.topLeft.y - mw * 2.25
    const r  = 2.1 * mw

    const imgData = ctx.getImageData(cx - r, cy - r, r * 2, r * 2)
    const dot = detectDot(imgData)[0]
    if (!dot) return null

    const dotX = cx - r + dot.center.x
    const dotY = cy - r + dot.center.y

    // Angle of dot relative to canvas centre, mapped to [0, 360)
    let angle = Math.atan2(dotY - H / 2, dotX - W / 2)
    if (angle < 0) angle += Math.PI * 2
    return (angle / (Math.PI * 2)) * 360
}

function detectDot(imgData) {
    const smin = 1, smax = 2500

    const src = new cv.Mat(imgData.height, imgData.width, cv.CV_8UC4)
    src.data.set(imgData.data)

    const gray   = new cv.Mat()
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(4, 4))

    function findCircularContours(binary) {
        const circles   = []
        const contours  = new cv.MatVector()
        const hierarchy = new cv.Mat()
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

        for (let i = 0; i < contours.size(); i++) {
            const cnt  = contours.get(i)
            const area = cv.contourArea(cnt)
            if (area < smin || area > smax) { cnt.delete(); continue }

            const perimeter = cv.arcLength(cnt, true)
            if (perimeter === 0) { cnt.delete(); continue }

            const circularity = 4 * Math.PI * area / (perimeter * perimeter)
            if (circularity < 0.2) { cnt.delete(); continue }

            circles.push(cv.minEnclosingCircle(cnt))
            cnt.delete()
        }

        contours.delete()
        hierarchy.delete()
        return circles
    }

    const binary = new cv.Mat()
    cv.adaptiveThreshold(gray, binary, 255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2)
    cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel)

    const circles = findCircularContours(binary)

    binary.delete()
    kernel.delete()
    gray.delete()
    src.delete()

    return circles
}

// ── Rotary: encoder ───────────────────────────────────────────────────────

// Parameters tuned for a noiseless canvas source.
// For a real camera feed, raise DEADBAND (~1.5°) and lower ALPHA (~0.15).
const ALPHA     = 0.5   // EMA smoothing — higher = more responsive, less lag
const DEADBAND  = 0.05  // Near-zero: no camera noise to filter here
const MAX_DELTA = 25.0  // Implausible-jump guard (degrees per frame)
const STEP_SIZE = 5.0   // Degrees per encoder "click"

let prevSmooth  = null
let accumulator = 0.0

function processAngle(rawDeg) {
    if (prevSmooth === null) {
        prevSmooth = rawDeg
        return 0
    }

    const smooth = ALPHA * rawDeg + (1 - ALPHA) * prevSmooth

    // Wraparound-safe delta: maps result to [-180, +180]
    const delta = ((smooth - prevSmooth + 180) % 360 + 360) % 360 - 180
    prevSmooth  = smooth

    if (Math.abs(delta) > MAX_DELTA) return 0  // implausible jump, discard
    if (Math.abs(delta) < DEADBAND)  return 0  // noise, discard

    accumulator += delta
    const steps  = Math.trunc(accumulator / STEP_SIZE)
    accumulator -= steps * STEP_SIZE
    return steps
}

// ── Display ───────────────────────────────────────────────────────────────

let deltaFadeTimer = null

function showDelta(steps) {
    indicatorEl.classList.remove('pulse')
    void indicatorEl.offsetWidth  // force reflow to restart animation
    indicatorEl.classList.add('pulse')

    deltaEl.textContent = steps > 0 ? `+${steps}` : `${steps}`
    deltaEl.classList.add('show')
    clearTimeout(deltaFadeTimer)
    deltaFadeTimer = setTimeout(() => deltaEl.classList.remove('show'), 600)
}

function updateValue(value) {
    valueEl.textContent = value
}

// ── Animation loop ────────────────────────────────────────────────────────

function animate() {
    animFrameId = requestAnimationFrame(animate)
    drawCanvas()

    const markers = basic_detect(canvas, outCanvas)
    const rawDeg  = detectDotAngle(markers)
    if (rawDeg === null) return

    const steps = processAngle(rawDeg)
    if (steps === 0) return

    showDelta(steps)

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ delta: steps }))
    }
}

function startRotary() {
    rotation    = 0
    prevSmooth  = null
    accumulator = 0.0
    if (animFrameId) cancelAnimationFrame(animFrameId)
    animate()
}

function stopRotary() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId)
        animFrameId = null
    }
}

// ── WebSocket ─────────────────────────────────────────────────────────────

function connectWS(host, port) {
    const url = 'ws://' + host + ':' + port

    document.getElementById('found-addr').textContent = url
    showScreen('screen-found')

    let socket
    try {
        socket = new WebSocket(url)
    } catch (e) {
        onDiscoveryError('Bad WebSocket URL (' + url + '): ' + e.message)
        return
    }

    let didOpen = false

    socket.onopen = async () => {
        didOpen = true
        ws = socket
        valueEl.textContent = '0'
        showScreen('screen-connected')
        NsdDiscovery.stopDiscovery()
        // Ensure OpenCV and marker are ready before starting the loop
        if (!marker) await window.cvReady
        startRotary()
    }

    socket.onmessage = e => {
        try {
            const msg = JSON.parse(e.data)
            if (typeof msg.value === 'number') updateValue(msg.value)
        } catch (_) { /* ignore non-JSON messages */ }
    }

    socket.onerror = () => { /* onclose fires immediately after */ }

    socket.onclose = () => {
        ws = null
        stopRotary()
        if (didOpen) {
            showScreen('screen-searching')
            NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError)
        } else {
            NsdDiscovery.stopDiscovery()
            onDiscoveryError('Service found but connection refused — server may have stopped')
        }
    }
}

// ── NSD discovery callbacks ───────────────────────────────────────────────

function onDiscoveryEvent(event) {
    if (event.type === 'found') connectWS(event.host, event.port)
    // 'lost' events handled implicitly via ws.onclose
}

function onDiscoveryError(err) {
    document.getElementById('error-detail').textContent = String(err)
    showScreen('screen-error')
}

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('deviceready', () => {
    // Start discovery immediately; OpenCV can load in parallel
    NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError)

    document.getElementById('btn-retry').addEventListener('click', () => {
        showScreen('screen-searching')
        NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError)
    })

    // Eagerly initialise the marker so it's ready when connection succeeds
    window.cvReady.then(() => { marker = basic_gen(23) })
}, false)
