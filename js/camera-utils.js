///
// camera helper functions
///

/**
 * Provides requestAnimationFrame in a cross-browser way.
 */
window.requestAnimFrame = (function() {
  return window.requestAnimationFrame ||
         window.webkitRequestAnimationFrame ||
         window.mozRequestAnimationFrame ||
         window.oRequestAnimationFrame ||
         window.msRequestAnimationFrame ||
         function(/* function FrameRequestCallback */ callback) {
           return window.setTimeout(callback, 1000/60);
         };
})();

/**
 * Provides cancelRequestAnimationFrame in a cross-browser way.
 */
window.cancelRequestAnimFrame = (function() {
  return window.cancelAnimationFrame ||
         window.webkitCancelRequestAnimationFrame ||
         window.mozCancelRequestAnimationFrame ||
         window.oCancelRequestAnimationFrame ||
         window.msCancelRequestAnimationFrame ||
         window.clearTimeout;
})();

/**
 * Request a camera stream with given constraints.
 * - constraints: MediaStreamConstraints (default: { video: true, audio: false })
 * Returns a Promise that resolves to a MediaStream or rejects with an Error.
 * Uses navigator.mediaDevices.getUserMedia when available, otherwise falls back to legacy prefixed APIs.
 */
window.getCameraStream = function(constraints = { video: true, audio: false }) {
  // Normalize constraints: if caller passed { deviceId: '...' } or { facingMode: 'user' }
  const normalized = { ...constraints };
  if (typeof normalized.video === 'object') {
    normalized.video = { ...normalized.video };
  } else if (normalized.video === true) {
    normalized.video = {};
  }

  // If caller provided deviceId or facingMode at top level, move into normalized.video
  if (constraints.deviceId && !normalized.video.deviceId) {
    normalized.video.deviceId = { exact: constraints.deviceId };
  }
  if (constraints.facingMode && !normalized.video.facingMode) {
    normalized.video.facingMode = constraints.facingMode;
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(normalized);
  }

  // Legacy fallback: wrap prefixed getUserMedia in a Promise
  const legacyGetUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  if (legacyGetUserMedia) {
    return new Promise(function(resolve, reject) {
      legacyGetUserMedia.call(navigator, normalized, resolve, reject);
    });
  }

  return Promise.reject(new Error('getUserMedia is not supported in this browser'));
};

// Convenience: request camera by deviceId
window.getCameraStreamById = function(deviceId, constraints = { video: true, audio: false }) {
  const merged = { ...constraints, deviceId: deviceId };
  return window.getCameraStream(merged);
};

// Attach a MediaStream to a video element safely (handles older browsers)
window.attachStreamToVideo = function(stream, videoElement) {
  if (!stream || !videoElement) return;
  try {
    videoElement.srcObject = stream;
  } catch (e) {
    videoElement.src = window.URL.createObjectURL(stream);
  }
};

/**
 * Stop a MediaStream (stops all tracks).
 */
window.stopCameraStream = function(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach(function(track) { track.stop(); });
  } catch (e) {
    // ignore
  }
};

export function getCameraStreamProxy(constraints) {
  return window.getCameraStream(constraints);
}

export function attachStreamToVideoProxy(stream, videoElement) {
  return window.attachStreamToVideo(stream, videoElement);
}

export function stopCameraStreamProxy(stream) {
  return window.stopCameraStream(stream);
}
