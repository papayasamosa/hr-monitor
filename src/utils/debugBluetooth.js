/**
 * Debug utilities for recording and replaying heart rate data
 * Allows testing without physical BLE devices
 */

class HRDebugRecorder {
  constructor() {
    this.isRecording = false;
    this.isPlaying = false;
    this.recordings = [];
    this.playbackInterval = null;
    this.playbackIndex = 0;
    this.startTime = null;
    this.deviceName = '';
    this.sessionType = null; // 'strength' | 'cardio' | null
    this.connectedDeviceName = ''; // Store currently connected device name
    this.playbackCallback = null;
    this.playbackDisconnectCallback = null;
    
    // UI integration callbacks
    this.uiCallbacks = null;
  }

  /**
   * Register UI callbacks for playback integration
   * @param {Object} callbacks - UI callback functions
   */
  registerUICallbacks(callbacks) {
    this.uiCallbacks = callbacks;
  }

  /**
   * Unregister UI callbacks
   */
  unregisterUICallbacks() {
    this.uiCallbacks = null;
  }

  /**
   * Set the currently connected device name
   * @param {string} deviceName - Name of the connected device
   */
  setConnectedDevice(deviceName) {
    this.connectedDeviceName = deviceName;
  }

  /**
   * Start recording heart rate data
   * @param {string} deviceName - Name of the connected device (optional, uses connected device if omitted)
   * @param {string|null} sessionType - Session-level metadata, e.g. 'strength' or 'cardio'
   */
  startRecording(deviceName, sessionType = null) {
    // Use provided name, or fall back to connected device name, or 'Unknown Device'
    const recordingDeviceName = deviceName || this.connectedDeviceName || 'Unknown Device';

    this.isRecording = true;
    this.recordings = [];
    this.startTime = Date.now();
    this.deviceName = recordingDeviceName;
    this.sessionType = sessionType;
    console.log('📹 Recording started for device:', recordingDeviceName, sessionType ? `(${sessionType})` : '');
  }

  /**
   * Record a heart rate reading
   * @param {Object} data - Heart rate data object
   */
  recordReading(data) {
    if (!this.isRecording) return;

    const reading = {
      timestamp: Date.now() - this.startTime,
      heartRate: data.heartRate,
      contactDetected: data.contactDetected,
      energyExpended: data.energyExpended,
      rrIntervals: data.rrIntervals
    };

    this.recordings.push(reading);
  }

  /**
   * Stop recording and return the recorded data
   * @returns {Object} Recorded session data
   */
  stopRecording() {
    if (!this.isRecording) {
      console.warn('⚠️ No recording in progress');
      return null;
    }

    this.isRecording = false;
    const duration = Date.now() - this.startTime;

    const sessionData = {
      version: '1.0',
      deviceName: this.deviceName,
      sessionType: this.sessionType,
      recordedAt: new Date().toISOString(),
      duration,
      readingsCount: this.recordings.length,
      readings: this.recordings
    };

    console.log('⏹️ Recording stopped. Duration:', Math.round(duration / 1000), 'seconds');
    console.log('📊 Total readings:', this.recordings.length);
    console.log('💾 Session data:', sessionData);

    return sessionData;
  }

  /**
   * Download the current recording as a JSON file
   */
  downloadRecording() {
    const sessionData = this.isRecording ? this.stopRecording() : null;

    if (!sessionData && this.recordings.length === 0) {
      console.error('❌ No recording data available');
      return;
    }

    const data = sessionData || {
      version: '1.0',
      deviceName: this.deviceName,
      sessionType: this.sessionType,
      recordedAt: new Date().toISOString(),
      duration: this.recordings.at(-1)?.timestamp || 0,
      readingsCount: this.recordings.length,
      readings: this.recordings
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hr-recording-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('💾 Recording downloaded');
  }

  /**
   * Load a recording from a file
   * @returns {Promise} Promise that resolves when file is selected
   */
  loadRecording() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';

      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) {
          reject(new Error('No file selected'));
          return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target.result);
            if (!data.readings || !Array.isArray(data.readings)) {
              throw new Error('Invalid recording format');
            }
            console.log('📂 Recording loaded:', data.deviceName);
            console.log('📊 Readings:', data.readingsCount);
            resolve(data);
          } catch (error) {
            reject(new Error('Failed to parse recording: ' + error.message));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      };

      input.click();
    });
  }

  /**
   * Start playback of a recording
   * @param {Object} sessionData - Recording data to play back
   * @param {Function} callback - Callback function for each reading
   * @param {Function} disconnectCallback - Callback when playback ends
   */
  startPlayback(sessionData, callback, disconnectCallback) {
    if (this.isPlaying) {
      console.warn('⚠️ Playback already in progress');
      return;
    }

    if (!sessionData || !sessionData.readings || sessionData.readings.length === 0) {
      console.error('❌ No recordings to play back');
      return;
    }

    this.isPlaying = true;
    this.playbackIndex = 0;
    this.playbackCallback = callback;
    this.playbackDisconnectCallback = disconnectCallback;
    const readings = sessionData.readings;

    console.log('▶️ Starting playback:', sessionData.deviceName);
    console.log('📊 Total readings:', readings.length);

    // Play first reading immediately
    if (this.playbackCallback) {
      this.playbackCallback(readings[0]);
    }
    this.playbackIndex = 1;

    // Schedule remaining readings based on timestamps
    const scheduleNext = () => {
      if (!this.isPlaying || this.playbackIndex >= readings.length) {
        this.stopPlayback();
        return;
      }

      const currentReading = readings[this.playbackIndex];
      const previousReading = readings[this.playbackIndex - 1];
      const delay = currentReading.timestamp - previousReading.timestamp;

      this.playbackInterval = setTimeout(() => {
        // Double-check we're still playing and within bounds
        if (!this.isPlaying || this.playbackIndex >= readings.length) {
          this.stopPlayback();
          return;
        }

        if (this.playbackCallback) {
          this.playbackCallback(currentReading);
        }

        this.playbackIndex++;
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  /**
   * Stop playback
   */
  stopPlayback() {
    if (!this.isPlaying) return;

    if (this.playbackInterval) {
      clearTimeout(this.playbackInterval);
      this.playbackInterval = null;
    }

    this.isPlaying = false;
    console.log('⏹️ Playback stopped');

    // Call disconnect callback
    if (this.playbackDisconnectCallback) {
      this.playbackDisconnectCallback();
    }
  }

  /**
   * Get current recording/playback status
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      isPlaying: this.isPlaying,
      recordingsCount: this.recordings.length,
      playbackIndex: this.playbackIndex
    };
  }
}

// Create singleton instance
const debugRecorder = new HRDebugRecorder();

// Expose to window for console access
if (typeof window !== 'undefined') {
  window.hrDebug = {
    // Recording API
    startRecording: (deviceName, sessionType) => debugRecorder.startRecording(deviceName, sessionType),
    stopRecording: () => debugRecorder.stopRecording(),
    downloadRecording: () => debugRecorder.downloadRecording(),
    
    // Playback API
    loadRecording: () => debugRecorder.loadRecording(),
    loadAndPlay: async () => {
      try {
        const sessionData = await debugRecorder.loadRecording();
        
        // Call UI callbacks if registered
        if (debugRecorder.uiCallbacks && debugRecorder.uiCallbacks.onStart) {
          await debugRecorder.uiCallbacks.onStart(sessionData);
        }
        
        // Start playback with UI callbacks
        debugRecorder.startPlayback(
          sessionData,
          debugRecorder.uiCallbacks ? debugRecorder.uiCallbacks.onReading : null,
          debugRecorder.uiCallbacks ? debugRecorder.uiCallbacks.onComplete : null
        );
      } catch (error) {
        console.error('❌ Failed to load recording:', error.message);
        if (debugRecorder.uiCallbacks && debugRecorder.uiCallbacks.onError) {
          debugRecorder.uiCallbacks.onError(error);
        }
      }
    },
    play: async (sessionData) => {
      try {
        // Call UI callbacks if registered
        if (debugRecorder.uiCallbacks && debugRecorder.uiCallbacks.onStart) {
          await debugRecorder.uiCallbacks.onStart(sessionData);
        }
        
        // Start playback with UI callbacks
        debugRecorder.startPlayback(
          sessionData,
          debugRecorder.uiCallbacks ? debugRecorder.uiCallbacks.onReading : null,
          debugRecorder.uiCallbacks ? debugRecorder.uiCallbacks.onComplete : null
        );
      } catch (error) {
        console.error('❌ Failed to start playback:', error.message);
        if (debugRecorder.uiCallbacks && debugRecorder.uiCallbacks.onError) {
          debugRecorder.uiCallbacks.onError(error);
        }
      }
    },
    stopPlayback: () => {
      if (debugRecorder.uiCallbacks && debugRecorder.uiCallbacks.onStop) {
        debugRecorder.uiCallbacks.onStop();
      }
      debugRecorder.stopPlayback();
    },
    
    // Status
    status: () => debugRecorder.getStatus(),
    
    // Internal - used by component
    setConnectedDevice: (deviceName) => debugRecorder.setConnectedDevice(deviceName)
  };

  console.log('🔧 HR Debug utilities loaded. Use window.hrDebug for recording/playback.');
}

export default debugRecorder;
