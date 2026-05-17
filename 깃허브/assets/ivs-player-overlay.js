(function() {
  'use strict';

  var IVS_URL_PATTERN = /live-video\.net/i;
  var realVideojs = null;
  var ivsPlayerReady = false;
  var ivsLoadFailed = false;

  function isIVSPlaybackUrl(url) {
    return typeof url === 'string' && IVS_URL_PATTERN.test(url);
  }

  function TimeRangesShim(ranges) {
    this._ranges = ranges || [];
  }
  TimeRangesShim.prototype.length = 0;
  Object.defineProperty(TimeRangesShim.prototype, 'length', {
    get: function() { return this._ranges.length; }
  });
  TimeRangesShim.prototype.start = function(i) {
    return this._ranges[i] ? this._ranges[i][0] : 0;
  };
  TimeRangesShim.prototype.end = function(i) {
    return this._ranges[i] ? this._ranges[i][1] : 0;
  };

  function IVSPlayerWrapper(videoElement, options) {
    this._el = videoElement;
    this._options = options || {};
    this._player = null;
    this._events = {};
    this._error = null;
    this._disposed = false;
    this._latencyInterval = null;
    this._sourceUrl = null;

    try {
      var PlayerModule = window.IVSPlayer;
      if (!PlayerModule || !PlayerModule.isPlayerSupported) {
        throw new Error('IVS Player SDK not available');
      }
      if (!PlayerModule.isPlayerSupported()) {
        throw new Error('IVS Player not supported in this browser');
      }

      this._player = PlayerModule.create();
      this._playerEvents = PlayerModule.PlayerEventType;
      this._playerStates = PlayerModule.PlayerState;

      this._player.attachHTMLVideoElement(this._el);
      this._player.setAutoplay(true);
      this._player.setMuted(true);
      this._player.setLiveLowLatencyEnabled(true);

      this._setupEvents();

      console.log('[IVS Player] Created successfully');
    } catch (e) {
      console.error('[IVS Player] Failed to create:', e);
      this._player = null;
      throw e;
    }
  }

  IVSPlayerWrapper.prototype._setupEvents = function() {
    var self = this;
    var player = this._player;
    var PE = this._playerEvents;
    var PS = this._playerStates;

    if (!player || !PE) return;

    player.addEventListener(PE.STATE_CHANGED, function(state) {
      if (state === PS.PLAYING) {
        self._emit('playing');
      } else if (state === PS.ENDED) {
        self._emit('ended');
      } else if (state === PS.IDLE) {
        self._emit('pause');
      }
    });

    player.addEventListener(PE.ERROR, function(err) {
      self._error = {
        code: (err && err.code) || 'UNKNOWN',
        message: (err && err.message) || 'IVS Player error'
      };
      console.error('[IVS Player] Error:', self._error);
      self._emit('error', err);
    });

    if (PE.QUALITY_CHANGED) {
      player.addEventListener(PE.QUALITY_CHANGED, function(quality) {
        console.log('[IVS Player] Quality changed:', quality);
      });
    }

    this._latencyInterval = setInterval(function() {
      if (!self._player || self._disposed) return;
      try {
        var latency = self._player.getLiveLatency();
        if (latency > 8) {
          self._player.seekTo(self._player.getPosition());
        }
      } catch (e) {}
    }, 3000);
  };

  IVSPlayerWrapper.prototype._emit = function(event, data) {
    var callbacks = this._events[event];
    if (callbacks) {
      for (var i = 0; i < callbacks.length; i++) {
        try { callbacks[i](data); } catch (e) {}
      }
    }
  };

  IVSPlayerWrapper.prototype.src = function(source) {
    if (!this._player) return;
    var url = typeof source === 'string' ? source : (source && source.src);
    if (!url) return;
    this._sourceUrl = url;
    try {
      this._player.load(url);
      this._player.play();
      console.log('[IVS Player] Loading source:', url);
    } catch (e) {
      console.error('[IVS Player] Failed to load source:', e);
      this._error = { code: 'LOAD_ERROR', message: e.message };
      this._emit('error', e);
    }
  };

  IVSPlayerWrapper.prototype.on = function(event, callback) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(callback);
    return this;
  };

  IVSPlayerWrapper.prototype.off = function(event, callback) {
    if (!this._events[event]) return this;
    if (!callback) {
      delete this._events[event];
    } else {
      this._events[event] = this._events[event].filter(function(cb) {
        return cb !== callback;
      });
    }
    return this;
  };

  IVSPlayerWrapper.prototype.tech = function() {
    return { el: this._el };
  };

  IVSPlayerWrapper.prototype.seekable = function() {
    if (!this._player) return new TimeRangesShim([]);
    try {
      var pos = this._player.getPosition();
      var dur = this._player.getDuration();
      if (dur === Infinity || dur > 86400) {
        return new TimeRangesShim([[0, pos + 1]]);
      }
      return new TimeRangesShim([[0, dur]]);
    } catch (e) {
      return new TimeRangesShim([]);
    }
  };

  IVSPlayerWrapper.prototype.currentTime = function(val) {
    if (!this._player) return 0;
    if (typeof val === 'number') {
      try { this._player.seekTo(val); } catch (e) {}
      return val;
    }
    try { return this._player.getPosition(); } catch (e) { return 0; }
  };

  IVSPlayerWrapper.prototype.playbackRate = function(val) {
    if (!this._player) return 1;
    if (typeof val === 'number') {
      try { this._player.setPlaybackRate(val); } catch (e) {}
      return val;
    }
    try { return this._player.getPlaybackRate(); } catch (e) { return 1; }
  };

  IVSPlayerWrapper.prototype.muted = function(val) {
    if (!this._player) return true;
    if (typeof val === 'boolean') {
      try { this._player.setMuted(val); } catch (e) {}
      return val;
    }
    try { return this._player.isMuted(); } catch (e) { return true; }
  };

  IVSPlayerWrapper.prototype.error = function() {
    return this._error;
  };

  IVSPlayerWrapper.prototype.play = function() {
    if (this._player) {
      try { return this._player.play(); } catch (e) {}
    }
    return Promise.resolve();
  };

  IVSPlayerWrapper.prototype.pause = function() {
    if (this._player) {
      try { this._player.pause(); } catch (e) {}
    }
  };

  IVSPlayerWrapper.prototype.dispose = function() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._latencyInterval) {
      clearInterval(this._latencyInterval);
      this._latencyInterval = null;
    }
    if (this._player) {
      try { this._player.pause(); } catch (e) {}
      try { this._player.delete(); } catch (e) {}
      this._player = null;
    }
    this._events = {};
    console.log('[IVS Player] Disposed');
  };

  IVSPlayerWrapper.prototype.isDisposed = function() {
    return this._disposed;
  };

  function patchVideojs() {
    if (typeof window.videojs !== 'function') return;
    if (window.videojs.__ivs_patched) return;

    realVideojs = window.videojs;

    var proxy = function(element, options, readyCallback) {
      if (ivsLoadFailed || !window.IVSPlayer) {
        console.log('[IVS Overlay] IVS Player not available, using Video.js');
        return realVideojs.call(this, element, options, readyCallback);
      }

      try {
        var wrapper = new IVSPlayerWrapper(element, options);
        console.log('[IVS Overlay] Using IVS Player SDK for playback');
        if (typeof readyCallback === 'function') {
          setTimeout(readyCallback, 0);
        }
        return wrapper;
      } catch (e) {
        console.warn('[IVS Overlay] IVS Player creation failed, falling back to Video.js:', e);
        return realVideojs.call(this, element, options, readyCallback);
      }
    };

    var prop;
    for (prop in realVideojs) {
      if (realVideojs.hasOwnProperty(prop)) {
        proxy[prop] = realVideojs[prop];
      }
    }
    proxy.__ivs_patched = true;
    proxy.__realVideojs = realVideojs;

    window.videojs = proxy;
    console.log('[IVS Overlay] Video.js proxy installed (IVS Player primary, Video.js fallback)');
  }

  function waitForVideojs() {
    if (window.videojs) {
      patchVideojs();
      return;
    }

    var attempts = 0;
    var maxAttempts = 100;
    var interval = setInterval(function() {
      attempts++;
      if (window.videojs) {
        clearInterval(interval);
        patchVideojs();
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        console.warn('[IVS Overlay] Video.js not detected after timeout');
      }
    }, 200);
  }

  function loadIVSPlayerSDK() {
    var script = document.createElement('script');
    script.src = 'https://player.live-video.net/1.31.0/amazon-ivs-player.min.js';
    script.async = true;
    script.onload = function() {
      ivsPlayerReady = true;
      console.log('[IVS Overlay] IVS Player SDK loaded');
      waitForVideojs();
    };
    script.onerror = function() {
      ivsLoadFailed = true;
      console.warn('[IVS Overlay] Failed to load IVS Player SDK — Video.js will be used');
      waitForVideojs();
    };
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadIVSPlayerSDK);
  } else {
    loadIVSPlayerSDK();
  }
})();
