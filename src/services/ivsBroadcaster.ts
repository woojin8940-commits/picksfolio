// Amazon IVS Web Broadcast SDK wrapper.
// Lets the broadcaster push a MediaStream directly to an AWS IVS channel
// from the browser, so streamers no longer need OBS to go live. Runs in
// parallel with the existing WebRTC peer path — IVS provides the HLS
// playback fallback and absorbs scale beyond peer capacity.

export interface IVSConfig {
  ingestServer: string;
  streamKey: string;
  playbackUrl: string;
  rtmpUrl: string;
}

interface StreamQuality {
  width: number;
  height: number;
  frameRate: number;
  bitrate: number;
  keyframeIntervalSec?: number;
}

const VIDEO_SLOT = 'broadcaster-video';
const AUDIO_SLOT = 'broadcaster-audio';

export class IVSBroadcaster {
  private client: any = null;
  private sdk: any = null;
  private started = false;

  async init(quality: StreamQuality): Promise<void> {
    const mod: any = await import('amazon-ivs-web-broadcast');
    const IVSBroadcastClient = mod.default ?? mod;
    this.sdk = IVSBroadcastClient;

    if (!IVSBroadcastClient.isSupported()) {
      throw new Error('IVS Web Broadcast SDK is not supported in this browser.');
    }

    this.client = IVSBroadcastClient.create({
      streamConfig: {
        maxResolution: { width: quality.width, height: quality.height },
        maxFramerate: quality.frameRate,
        maxBitrate: Math.round(quality.bitrate / 1000), // kbps
        // 2-second GOP keeps viewer latency down and matches IVS LOW latency
        // channels. Passed as a hint — SDK silently ignores unknown fields on
        // versions that don't support it.
        ...(quality.keyframeIntervalSec
          ? { keyframeInterval: quality.keyframeIntervalSec }
          : {}),
      },
    });
  }

  async start(stream: MediaStream, ingestServer: string, streamKey: string): Promise<void> {
    if (!this.client) throw new Error('IVSBroadcaster not initialized');

    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (videoTrack) {
      const videoOnly = new MediaStream([videoTrack]);
      await this.client.addVideoInputDevice(videoOnly, VIDEO_SLOT, { index: 0 });
    }
    if (audioTrack) {
      const audioOnly = new MediaStream([audioTrack]);
      await this.client.addAudioInputDevice(audioOnly, AUDIO_SLOT);
    }

    const endpoint = ingestServer.replace(/^rtmps?:\/\//, '').replace(/\/$/, '');
    await this.client.startBroadcast(streamKey, endpoint);
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.started) await this.client.stopBroadcast();
    } catch (err) {
      console.warn('[IVS] stopBroadcast failed:', err);
    }
    try {
      this.client.delete();
    } catch (err) {
      console.warn('[IVS] delete failed:', err);
    }
    this.client = null;
    this.started = false;
  }

  isActive(): boolean {
    return this.started;
  }

  onError(handler: (err: unknown) => void): void {
    if (!this.client || !this.sdk) return;
    const ev = this.sdk.BroadcastClientEvents;
    if (ev?.ERROR) this.client.on(ev.ERROR, handler);
  }

  onConnectionStateChange(handler: (state: string) => void): void {
    if (!this.client || !this.sdk) return;
    const ev = this.sdk.BroadcastClientEvents;
    if (ev?.CONNECTION_STATE_CHANGE) this.client.on(ev.CONNECTION_STATE_CHANGE, handler);
  }
}
