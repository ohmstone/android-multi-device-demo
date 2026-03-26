import { basic_detect } from './basic_detect.js'
import { basic_gen } from './basic_gen.js'

const SERVICE_NAME = 'AudioAppWS'

// ── Geometry constants (warp target matches test_app) ─────────────────────

const WARP_W = 500, WARP_H = 500
const MW           = 50
const CENTER_WHEEL = { x: 250, y: 425 - MW * 2.25 }
const RAD_WHEEL    = 2.1 * MW
const SEARCH_R     = RAD_WHEEL * 1.15  // search area extends ~15% beyond the expected orbit
const DST_PTS      = [225, 425, 275, 425, 275, 475, 225, 475]

// ── DOM ───────────────────────────────────────────────────────────────────

const video        = document.getElementById('video')
const feedCanvas   = document.getElementById('feed-canvas')   // hidden — raw camera frame
const rawCanvas    = document.getElementById('raw-canvas')    // camera feed + marker outlines
const warpCanvas   = document.getElementById('warp-canvas')   // perspective-corrected view
const dotCanvas    = document.getElementById('input-canvas')  // dot angle visualisation

const valueEl      = document.getElementById('value-display')
const indicatorEl  = document.getElementById('indicator')
const deltaEl      = document.getElementById('delta-display')
const statusEl     = document.getElementById('status')
const mirrorBtn    = document.getElementById('mirror-btn')
const calibrateBtn = document.getElementById('calibrate-btn')
const focusBtn     = document.getElementById('focus-btn')
const focusRow     = document.getElementById('focus-row')
const focusSlider  = document.getElementById('focus-slider')
const focusLabel   = document.getElementById('focus-label')

const feedCtx = feedCanvas.getContext('2d', { willReadFrequently: true })
const dotCtx  = dotCanvas.getContext('2d',  { willReadFrequently: true })
const warpCtx = warpCanvas.getContext('2d', { willReadFrequently: true })

// ── Canvas setup ──────────────────────────────────────────────────────────

const DOT_W = 400, DOT_H = 400
dotCanvas.width   = DOT_W
dotCanvas.height  = DOT_H
warpCanvas.width  = WARP_W
warpCanvas.height = WARP_H

// ── Camera state ──────────────────────────────────────────────────────────

let mirrorMode        = false
let lockedH           = null   // cv.Mat — homography locked after first detection / calibration
let calibrationOffset = 0      // radians subtracted from raw angle
let videoTrack        = null
let focusLocked       = false

const CALIB_FRAMES  = 20
let calibrating     = false
let calibCandidates = []   // { H: cv.Mat, angle: number }

// Circular angle smoothing (sin/cos components)
const SMOOTH_N = 7
const sinBuf = [], cosBuf = []

function pushAngle(angle) {
    sinBuf.push(Math.sin(angle))
    cosBuf.push(Math.cos(angle))
    if (sinBuf.length > SMOOTH_N) { sinBuf.shift(); cosBuf.shift() }
}

function smoothedAngle() {
    const s = sinBuf.reduce((a, b) => a + b, 0) / sinBuf.length
    const c = cosBuf.reduce((a, b) => a + b, 0) / cosBuf.length
    const a = Math.atan2(s, c)
    return a < 0 ? a + Math.PI * 2 : a
}

// ── Encoder state ─────────────────────────────────────────────────────────

// Tuned for real camera input: lower alpha (smoother), higher deadband (less noise)
const ALPHA     = 0.3   // EMA smoothing
const DEADBAND  = 1.5   // degrees — filters camera noise
const MAX_DELTA = 25.0  // degrees/frame — implausible-jump guard
const STEP_SIZE = 5.0   // degrees per encoder "click"

let prevSmooth  = null
let accumulator = 0.0

// ── App state ─────────────────────────────────────────────────────────────

let ws          = null
let animFrameId = null
let marker      = null   // ArUco marker image drawn on dot canvas
let rotation    = 0      // radians — driven by camera-detected angle

// ── Screen helpers ────────────────────────────────────────────────────────

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.toggle('active', s.id === id)
    })
}

function setStatus(msg, detected = false) {
    statusEl.textContent = msg
    statusEl.classList.toggle('detected', detected)
}

// ── Dot canvas visualisation ──────────────────────────────────────────────

function drawDotCanvas() {
    dotCtx.fillStyle = '#232323'
    dotCtx.fillRect(0, 0, DOT_W, DOT_H)

    dotCtx.save()
    dotCtx.translate(DOT_W / 2, DOT_H / 2)
    dotCtx.rotate(rotation)
    dotCtx.beginPath()
    dotCtx.arc(70, 0, 20, 0, Math.PI * 2)
    dotCtx.fillStyle = '#000'
    dotCtx.fill()
    dotCtx.restore()

    if (marker) {
        const markerSize = 50
        dotCtx.drawImage(marker, 56, 56, 200, 200,
            DOT_W / 2 - markerSize / 2, DOT_H / 2 + 110, markerSize, markerSize)
    }
}

// ── Camera: perspective warp + dot detection ──────────────────────────────

function angleDistToZero(a) {
    return Math.min(a, Math.PI * 2 - a)
}

function computeH(m23) {
    const srcPts = cv.matFromArray(4, 2, cv.CV_32F, [
        m23.topLeft.x,     m23.topLeft.y,
        m23.topRight.x,    m23.topRight.y,
        m23.bottomRight.x, m23.bottomRight.y,
        m23.bottomLeft.x,  m23.bottomLeft.y,
    ])
    const dstPts = cv.matFromArray(4, 2, cv.CV_32F, DST_PTS)
    const mask   = new cv.Mat()
    const H      = cv.findHomography(srcPts, dstPts, cv.RANSAC, 3, mask)
    srcPts.delete(); dstPts.delete(); mask.delete()
    return H
}

function finishCalibration() {
    calibrating = false
    const best = calibCandidates.reduce((a, b) =>
        angleDistToZero(a.angle) <= angleDistToZero(b.angle) ? a : b
    )
    lockedH           = best.H
    calibrationOffset = best.angle
    calibCandidates.filter(c => c !== best).forEach(c => c.H.delete())
    calibCandidates.length = 0
    sinBuf.length = 0; cosBuf.length = 0
    prevSmooth = null; accumulator = 0.0
    calibrateBtn.textContent = 'Calibrate'
    calibrateBtn.classList.add('locked')
}

function detectDot(imgData) {
    const smin = 300, smax = 2500
    const src    = new cv.Mat(imgData.height, imgData.width, cv.CV_8UC4)
    src.data.set(imgData.data)
    const gray   = new cv.Mat()
    const binary = new cv.Mat()
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(4, 4))
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.adaptiveThreshold(gray, binary, 255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2)
    cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel)

    const contours  = new cv.MatVector()
    const hierarchy = new cv.Mat()
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let best = null
    for (let i = 0; i < contours.size(); i++) {
        const cnt  = contours.get(i)
        const area = cv.contourArea(cnt)
        if (area < smin || area > smax) { cnt.delete(); continue }
        const perimeter = cv.arcLength(cnt, true)
        if (perimeter === 0) { cnt.delete(); continue }
        if (4 * Math.PI * area / (perimeter * perimeter) < 0.4) { cnt.delete(); continue }
        const circle = cv.minEnclosingCircle(cnt)
        if (!best || circle.radius > best.radius) best = circle
        cnt.delete()
    }

    src.delete(); gray.delete(); binary.delete(); kernel.delete()
    contours.delete(); hierarchy.delete()
    return best
}

function drawWarpOverlay(dot, x0, y0) {
    const cx = CENTER_WHEEL.x, cy = CENTER_WHEEL.y

    warpCtx.strokeStyle = '#888'
    warpCtx.lineWidth   = 2
    warpCtx.beginPath()
    warpCtx.arc(cx, cy, RAD_WHEEL, 0, Math.PI * 2)
    warpCtx.stroke()

    if (!dot) return

    const dotX = x0 + dot.center.x
    const dotY = y0 + dot.center.y

    warpCtx.strokeStyle = '#3AF'
    warpCtx.lineWidth   = 3
    warpCtx.beginPath()
    warpCtx.arc(dotX, dotY, dot.radius, 0, Math.PI * 2)
    warpCtx.stroke()

    warpCtx.strokeStyle = '#FFF'
    warpCtx.lineWidth   = 2
    warpCtx.beginPath()
    warpCtx.moveTo(cx, cy)
    warpCtx.lineTo(cx + RAD_WHEEL, cy)
    warpCtx.stroke()

    warpCtx.strokeStyle = '#FF0'
    warpCtx.lineWidth   = 2
    warpCtx.beginPath()
    warpCtx.moveTo(cx, cy)
    warpCtx.lineTo(dotX, dotY)
    warpCtx.stroke()
}

// Returns calibrated angle in radians [0, 2π], or null.
// Returns null during calibration — caller must not update anything while null.
function warpAndDetect(m23) {
    const H = calibrating
        ? computeH(m23)
        : (lockedH ?? (() => {
              lockedH = computeH(m23)
              calibrateBtn.classList.add('locked')
              return lockedH
          })())

    const imSrc = cv.imread(feedCanvas)
    const imDst = new cv.Mat(WARP_H, WARP_W, cv.CV_8UC4)
    cv.warpPerspective(imSrc, imDst, H, new cv.Size(WARP_W, WARP_H))
    cv.imshow(warpCanvas, imDst)
    imSrc.delete(); imDst.delete()

    const x0      = CENTER_WHEEL.x - SEARCH_R
    const y0      = CENTER_WHEEL.y - SEARCH_R
    const region  = SEARCH_R * 2
    const imgData = warpCtx.getImageData(x0, y0, region, region)
    const dot     = detectDot(imgData)

    drawWarpOverlay(dot, x0, y0)

    if (!dot) {
        if (calibrating) H.delete()
        return null
    }

    const dotX = x0 + dot.center.x
    const dotY = y0 + dot.center.y
    let raw = Math.atan2(dotY - CENTER_WHEEL.y, dotX - CENTER_WHEEL.x)
    raw = raw < 0 ? raw + Math.PI * 2 : raw

    if (calibrating) {
        calibCandidates.push({ H, angle: raw })
        calibrateBtn.textContent = `Calibrating ${calibCandidates.length}/${CALIB_FRAMES}`
        if (calibCandidates.length >= CALIB_FRAMES) finishCalibration()
        return null
    }

    pushAngle(raw)
    const smoothed = smoothedAngle()
    let calibrated = smoothed - calibrationOffset
    if (calibrated < 0)            calibrated += Math.PI * 2
    if (calibrated >= Math.PI * 2) calibrated -= Math.PI * 2
    return calibrated
}

// ── Encoder: process angle into steps ─────────────────────────────────────

function processAngle(rawDeg) {
    if (prevSmooth === null) {
        prevSmooth = rawDeg
        return 0
    }

    // Wraparound-safe EMA: nudge prevSmooth toward rawDeg along the short arc
    const diff   = ((rawDeg - prevSmooth + 180) % 360 + 360) % 360 - 180
    const smooth = ((prevSmooth + ALPHA * diff) % 360 + 360) % 360

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

function processFrame() {
    animFrameId = requestAnimationFrame(processFrame)

    if (video.readyState < 2) return

    const w = video.videoWidth, h = video.videoHeight
    if (w === 0 || h === 0) return

    if (feedCanvas.width !== w || feedCanvas.height !== h) {
        feedCanvas.width = w; feedCanvas.height = h
    }

    if (mirrorMode) {
        feedCtx.save()
        feedCtx.scale(-1, 1)
        feedCtx.drawImage(video, -w, 0, w, h)
        feedCtx.restore()
    } else {
        feedCtx.drawImage(video, 0, 0, w, h)
    }

    try {
        const markers = basic_detect(feedCanvas, rawCanvas)
        const m23     = markers.find(m => m.id === 23)

        if (markers.length === 0) {
            setStatus('Scanning...')
            drawDotCanvas()
            return
        }
        if (!m23) {
            setStatus(`Markers: ${markers.map(m => m.id).join(', ')} — need #23`, true)
            drawDotCanvas()
            return
        }

        const angleRad = warpAndDetect(m23)

        if (calibrating) {
            // Nothing else updates during calibration — dot canvas and encoder freeze
            return
        }

        if (angleRad === null) {
            setStatus('#23 found — dot not detected', true)
            drawDotCanvas()
            return
        }

        rotation = angleRad
        drawDotCanvas()

        const rawDeg = (angleRad / (Math.PI * 2)) * 360
        const steps  = processAngle(rawDeg)

        if (steps !== 0) {
            showDelta(steps)
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ delta: steps }))
            }
        }

        setStatus(`#23 | ${angleRad.toFixed(2)} rad | steps: ${steps}`, true)
    } catch (e) {
        setStatus('Error: ' + e.message)
    }
}

function startProcessing() {
    prevSmooth  = null
    accumulator = 0.0
    if (animFrameId) cancelAnimationFrame(animFrameId)
    processFrame()
}

function stopProcessing() {
    if (animFrameId) {
        cancelAnimationFrame(animFrameId)
        animFrameId = null
    }
}

// ── Focus controls ────────────────────────────────────────────────────────

async function setFocusMode(manual) {
    if (!videoTrack) return
    focusLocked = manual
    focusBtn.textContent = manual ? 'Focus: Locked' : 'Focus: Auto'
    focusBtn.classList.toggle('locked', manual)
    if (manual) {
        const dist = videoTrack.getSettings().focusDistance
        if (dist !== undefined) {
            focusSlider.value      = dist
            focusLabel.textContent = `Focus ${dist.toFixed(2)}m`
        }
        focusRow.style.display = ''
    } else {
        focusRow.style.display = 'none'
    }
    try {
        const constraint = { focusMode: manual ? 'manual' : 'continuous' }
        if (manual) {
            const dist = videoTrack.getSettings().focusDistance
            if (dist !== undefined) constraint.focusDistance = dist
        }
        await videoTrack.applyConstraints(constraint)
    } catch (e) {
        try {
            await videoTrack.applyConstraints({ advanced: [{ focusMode: manual ? 'manual' : 'continuous' }] })
        } catch (e2) {
            setStatus(`Focus error: ${e2.message || e.message}`)
            focusLocked = !manual
            focusBtn.textContent = !manual ? 'Focus: Locked' : 'Focus: Auto'
            focusBtn.classList.toggle('locked', !manual)
        }
    }
}

function initFocusButton() {
    const capabilities = videoTrack.getCapabilities()
    const modes = capabilities.focusMode ?? []
    if (!modes.includes('manual')) return
    focusBtn.style.display = ''

    const distCap = capabilities.focusDistance
    if (distCap) {
        focusSlider.min  = distCap.min
        focusSlider.max  = distCap.max
        focusSlider.step = distCap.step ?? 'any'
        focusSlider.addEventListener('input', async () => {
            const dist = parseFloat(focusSlider.value)
            focusLabel.textContent = `Focus ${dist.toFixed(2)}m`
            try {
                await videoTrack.applyConstraints({ focusMode: 'manual', focusDistance: dist })
            } catch {
                await videoTrack.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: dist }] })
            }
        })
    }

    focusBtn.addEventListener('click', () => setFocusMode(!focusLocked))
}

// ── Mirror button ─────────────────────────────────────────────────────────

mirrorBtn.addEventListener('click', () => {
    mirrorMode = !mirrorMode
    mirrorBtn.textContent = `Mirror: ${mirrorMode ? 'ON' : 'OFF'}`
    mirrorBtn.classList.toggle('active', mirrorMode)
})

// ── Calibrate button ──────────────────────────────────────────────────────

calibrateBtn.addEventListener('click', () => {
    if (calibrating) return
    calibCandidates.forEach(c => c.H.delete())
    calibCandidates.length = 0
    if (lockedH) { lockedH.delete(); lockedH = null }
    sinBuf.length = 0; cosBuf.length = 0
    calibrating = true
    calibrateBtn.textContent = `Calibrating 0/${CALIB_FRAMES}`
    calibrateBtn.classList.remove('locked')
})

// ── Camera initialisation ─────────────────────────────────────────────────

async function openCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
        })
        videoTrack = stream.getVideoTracks()[0]
        video.srcObject = stream
        await video.play()
        initFocusButton()
    } catch (e) {
        setStatus('Camera error: ' + e.message)
    }
}

function startCamera() {
    const permissions = cordova.plugins.permissions
    permissions.checkPermission(permissions.CAMERA, status => {
        if (status.hasPermission) {
            openCamera()
        } else {
            permissions.requestPermission(permissions.CAMERA,
                s => s.hasPermission ? openCamera() : setStatus('Camera permission denied.'),
                ()  => setStatus('Camera permission error.')
            )
        }
    }, () => setStatus('Camera permission check failed.'))
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
        await window.cvReady
        startProcessing()
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
        stopProcessing()
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
    NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError)

    document.getElementById('btn-retry').addEventListener('click', () => {
        showScreen('screen-searching')
        NsdDiscovery.startDiscovery(SERVICE_NAME, onDiscoveryEvent, onDiscoveryError)
    })

    // Camera starts immediately so it is ready when connection succeeds
    startCamera()

    // Eagerly generate the ArUco marker image for the dot canvas
    window.cvReady.then(() => { marker = basic_gen(23) })
}, false)
