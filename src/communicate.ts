import {
  connectId,
  dateToString,
  escape,
  mkssml,
  removeIncompatibleCharacters,
  splitTextByByteLength,
  ssmlHeadersPlusData,
  unescape
} from './utils';
import {
  NoAudioReceived,
  UnexpectedResponse,
  UnknownResponse,
  WebSocketError
} from "./exceptions";
import { TTSConfig } from './tts_config';
import { DEFAULT_VOICE, WSS_URL, SEC_MS_GEC_VERSION, WSS_HEADERS } from './constants';
import { DRM } from './drm';

// Buffer handling utilities
const BufferUtils = {
  from: (input: string | ArrayBuffer | Uint8Array): Uint8Array => {
    if (typeof input === 'string') {
      return new TextEncoder().encode(input);
    } else if (input instanceof ArrayBuffer) {
      return new Uint8Array(input);
    } else if (input instanceof Uint8Array) {
      return input;
    }
    throw new Error('Unsupported input type for BufferUtils.from');
  },

  concat: (arrays: Uint8Array[]): Uint8Array => {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  },

  isBuffer: (obj: any): obj is Uint8Array => {
    return obj instanceof Uint8Array;
  },

  toString: (buffer: Uint8Array, encoding?: string): string => {
    return new TextDecoder(encoding || 'utf-8').decode(buffer);
  }
};

// Parse headers and data from text message
function getHeadersAndDataFromText(message: Uint8Array): [{ [key: string]: string }, Uint8Array] {
  const messageString = BufferUtils.toString(message);
  const headerEndIndex = messageString.indexOf('\r\n\r\n');

  const headers: { [key: string]: string } = {};
  if (headerEndIndex !== -1) {
    const headerString = messageString.substring(0, headerEndIndex);
    const headerLines = headerString.split('\r\n');
    for (const line of headerLines) {
      const [key, value] = line.split(':', 2);
      if (key && value) {
        headers[key] = value.trim();
      }
    }
  }

  const headerByteLength = new TextEncoder().encode(messageString.substring(0, headerEndIndex + 4)).length;
  return [headers, message.slice(headerByteLength)];
}

// Parse headers and data from binary message
function getHeadersAndDataFromBinary(message: Uint8Array): [{ [key: string]: string }, Uint8Array] {
  if (message.length < 2) {
    throw new Error('Message too short to contain header length');
  }

  const headerLength = (message[0] << 8) | message[1]; // Read big-endian uint16
  const headers: { [key: string]: string } = {};

  if (headerLength > 0 && headerLength + 2 <= message.length) {
    const headerBytes = message.slice(2, headerLength + 2);
    const headerString = BufferUtils.toString(headerBytes);
    const headerLines = headerString.split('\r\n');
    for (const line of headerLines) {
      const [key, value] = line.split(':', 2);
      if (key && value) {
        headers[key] = value.trim();
      }
    }
  }

  return [headers, message.slice(headerLength + 2)];
}

// State interface
interface CommunicateState {
  partialText: Uint8Array;
  offsetCompensation: number;
  lastDurationOffset: number;
  streamWasCalled: boolean;
}

// TTS chunk type
interface TTSChunk {
  type: "audio" | "WordBoundary";
  data?: Uint8Array;
  duration?: number;
  offset?: number;
  text?: string;
}

/**
 * Configuration options for the Communicate class.
 */
export interface CommunicateOptions {
  /** Voice to use for synthesis (e.g., "en-US-EmmaMultilingualNeural") */
  voice?: string;
  /** Speech rate adjustment (e.g., "+20%", "-10%") */
  rate?: string;
  /** Volume level adjustment (e.g., "+50%", "-25%") */
  volume?: string;
  /** Pitch adjustment in Hz (e.g., "+5Hz", "-10Hz") */
  pitch?: string;
  /** WebSocket connection timeout in milliseconds */
  connectionTimeout?: number;
}

/**
 * Communicate class for React Native text-to-speech synthesis.
 * Uses WebSocket to stream audio data from Microsoft Edge's TTS service.
 * 
 * @example
 * ```typescript
 * const communicate = new Communicate('Hello, world!', {
 *   voice: 'en-US-EmmaMultilingualNeural',
 * });
 * 
 * for await (const chunk of communicate.stream()) {
 *   if (chunk.type === 'audio' && chunk.data) {
 *     // Handle audio data
 *   }
 * }
 * ```
 */
export class Communicate {
  private readonly ttsConfig: TTSConfig;
  private readonly texts: Generator<Uint8Array>;

  private state: CommunicateState = {
    partialText: BufferUtils.from(''),
    offsetCompensation: 0,
    lastDurationOffset: 0,
    streamWasCalled: false,
  };

  /**
   * Creates a new Communicate instance for text-to-speech synthesis.
   * 
   * @param text - The text to synthesize
   * @param options - Configuration options for synthesis
   */
  constructor(text: string, options: CommunicateOptions = {}) {
    this.ttsConfig = new TTSConfig({
      voice: options.voice || DEFAULT_VOICE,
      rate: options.rate,
      volume: options.volume,
      pitch: options.pitch,
    });

    if (typeof text !== 'string') {
      throw new TypeError('text must be a string');
    }

    // Create a generator that yields Uint8Array chunks
    const processedText = escape(removeIncompatibleCharacters(text));
    const maxSize = 4096;

    this.texts = (function* () {
      for (const chunk of splitTextByByteLength(processedText, maxSize)) {
        yield new TextEncoder().encode(chunk);
      }
    })();
  }

  private parseMetadata(data: Uint8Array): TTSChunk {
    const metadata = JSON.parse(BufferUtils.toString(data));
    for (const metaObj of metadata['Metadata']) {
      const metaType = metaObj['Type'];
      if (metaType === 'WordBoundary') {
        const currentOffset = metaObj['Data']['Offset'] + this.state.offsetCompensation;
        const currentDuration = metaObj['Data']['Duration'];
        return {
          type: metaType,
          offset: currentOffset,
          duration: currentDuration,
          text: unescape(metaObj['Data']['text']['Text']),
        };
      }
      if (metaType === 'SessionEnd') {
        continue;
      }
      throw new UnknownResponse(`Unknown metadata type: ${metaType}`);
    }
    throw new UnexpectedResponse('No WordBoundary metadata found');
  }

  private createWebSocket(url: string): WebSocket {
    // React Native: supports headers in the 3rd argument
    const RNWebSocket = WebSocket as any;
    return new RNWebSocket(url, null, {
      headers: WSS_HEADERS,
    });
  }

  private async * _stream(): AsyncGenerator<TTSChunk, void, unknown> {
    const url = `${WSS_URL}&Sec-MS-GEC=${await DRM.generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectId()}`;

    const websocket = this.createWebSocket(url);
    const messageQueue: (TTSChunk | Error | 'close')[] = [];
    let resolveMessage: (() => void) | null = null;

    // Handle WebSocket messages
    const handleMessage = (message: any) => {
      const data = message.data || message;
      const binary = data instanceof ArrayBuffer || data instanceof Uint8Array;

      if (!binary && typeof data === 'string') {
        // Text message
        const [headers, parsedData] = getHeadersAndDataFromText(BufferUtils.from(data));

        const path = headers['Path'];
        if (path === 'audio.metadata') {
          try {
            const parsedMetadata = this.parseMetadata(parsedData);
            this.state.lastDurationOffset = parsedMetadata.offset! + parsedMetadata.duration!;
            messageQueue.push(parsedMetadata);
          } catch (e) {
            messageQueue.push(e as Error);
          }
        } else if (path === 'turn.end') {
          this.state.offsetCompensation = this.state.lastDurationOffset;
          websocket.close();
        } else if (path !== 'response' && path !== 'turn.start') {
          messageQueue.push(new UnknownResponse(`Unknown path received: ${path}`));
        }
      } else {
        // Binary message
        let bufferData: Uint8Array;

        if (data instanceof ArrayBuffer) {
          bufferData = BufferUtils.from(data);
        } else if (data instanceof Uint8Array) {
          bufferData = data;
        } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
          // Handle Blob - process async
          data.arrayBuffer().then(arrayBuffer => {
            const blobBufferData = new Uint8Array(arrayBuffer);
            processBinaryData(blobBufferData);
          }).catch(error => {
            messageQueue.push(new UnexpectedResponse(`Failed to process Blob data: ${error.message}`));
            if (resolveMessage) resolveMessage();
          });
          return;
        } else {
          messageQueue.push(new UnexpectedResponse(`Unknown binary data type: ${typeof data} ${data.constructor?.name}`));
          return;
        }

        processBinaryData(bufferData);
      }

      if (resolveMessage) resolveMessage();
    };

    const processBinaryData = (bufferData: Uint8Array) => {
      if (bufferData.length < 2) {
        messageQueue.push(new UnexpectedResponse('We received a binary message, but it is missing the header length.'));
      } else {
        const [headers, audioData] = getHeadersAndDataFromBinary(bufferData);

        if (headers['Path'] !== 'audio') {
          messageQueue.push(new UnexpectedResponse('Received binary message, but the path is not audio.'));
        } else {
          const contentType = headers['Content-Type'];
          if (contentType !== 'audio/mpeg') {
            if (audioData.length > 0) {
              messageQueue.push(new UnexpectedResponse('Received binary message, but with an unexpected Content-Type.'));
            }
          } else if (audioData.length === 0) {
            messageQueue.push(new UnexpectedResponse('Received binary message, but it is missing the audio data.'));
          } else {
            messageQueue.push({ type: 'audio', data: audioData });
          }
        }
      }
    };

    // Set up WebSocket event handlers
    websocket.onmessage = handleMessage;
    websocket.onerror = (error: any) => {
      messageQueue.push(new WebSocketError(error.message || 'WebSocket error'));
      if (resolveMessage) resolveMessage();
    };
    websocket.onclose = () => {
      messageQueue.push('close');
      if (resolveMessage) resolveMessage();
    };

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => resolve();
      const onError = (error: any) => reject(error);

      websocket.onopen = onOpen;
      websocket.onerror = onError;
    });

    // Send configuration
    websocket.send(
      `X-Timestamp:${dateToString()}\r\n`
      + 'Content-Type:application/json; charset=utf-8\r\n'
      + 'Path:speech.config\r\n\r\n'
      + '{"context":{"synthesis":{"audio":{"metadataoptions":{'
      + '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},'
      + '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"'
      + '}}}}\r\n'
    );

    // Send SSML
    websocket.send(
      ssmlHeadersPlusData(
        connectId(),
        dateToString(),
        mkssml(this.ttsConfig, BufferUtils.toString(this.state.partialText)),
      )
    );

    // Process messages
    let audioWasReceived = false;
    while (true) {
      if (messageQueue.length > 0) {
        const message = messageQueue.shift()!;
        if (message === 'close') {
          if (!audioWasReceived) {
            throw new NoAudioReceived('No audio was received.');
          }
          break;
        } else if (message instanceof Error) {
          throw message;
        } else {
          if (message.type === 'audio') audioWasReceived = true;
          yield message;
        }
      } else {
        // Wait for messages
        await new Promise<void>(resolve => {
          resolveMessage = resolve;
          setTimeout(resolve, 50);
        });
      }
    }
  }

  /**
   * Streams text-to-speech synthesis results.
   * 
   * @yields TTSChunk - Audio data or word boundary information
   * @throws {Error} If called more than once
   * @throws {NoAudioReceived} If no audio data is received
   * @throws {WebSocketError} If WebSocket connection fails
   */
  async * stream(): AsyncGenerator<TTSChunk, void, unknown> {
    if (this.state.streamWasCalled) {
      throw new Error('stream can only be called once.');
    }
    this.state.streamWasCalled = true;

    for (const partialText of this.texts) {
      this.state.partialText = partialText;
      for await (const message of this._stream()) {
        yield message;
      }
    }
  }
}