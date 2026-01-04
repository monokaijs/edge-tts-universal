/**
 * React Native entry point for react-native-edge-tts.
 * 
 * This module provides text-to-speech functionality using Microsoft Edge's TTS service,
 * optimized for React Native applications.
 * 
 * Key features:
 * - React Native optimized implementation
 * - WebSocket support with custom headers
 * - Word boundary events for subtitles
 * - Multiple voice support
 * 
 * @example
 * ```typescript
 * import { EdgeTTS, listVoices } from 'react-native-edge-tts';
 * 
 * // Simple TTS
 * const tts = new EdgeTTS('Hello, world!', 'en-US-EmmaMultilingualNeural');
 * const result = await tts.synthesize();
 * 
 * // Get available voices
 * const voices = await listVoices();
 * ```
 * 
 * @module ReactNativeEdgeTTS
 */

export {
  Communicate,
  CommunicateOptions
} from './communicate';

export {
  VoicesManager,
  listVoices,
  FetchError
} from './voices';

export { DRM } from './drm';

// Simple API
export {
  EdgeTTS,
  ProsodyOptions,
  WordBoundary,
  SynthesisResult,
  createVTT,
  createSRT
} from './simple';

// Utility for creating subtitles
export { SubMaker } from './submaker';

// Common types and exceptions
export * from './exceptions';
export * from './types';