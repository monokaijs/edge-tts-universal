# react-native-edge-tts

React Native text-to-speech library using Microsoft Edge's online TTS service. Works **WITHOUT** needing Microsoft Edge, Windows, or an API key.

## Features

- 🎯 **React Native Focused** - Optimized for React Native applications
- 🔊 **High Quality Voices** - Access to Microsoft Edge's neural TTS voices
- 📝 **Word Boundaries** - Get timing information for each word (useful for subtitles/karaoke)
- 🌍 **Multiple Languages** - Support for 400+ voices across 100+ languages
- 📱 **No Native Dependencies** - Pure JavaScript implementation

## Installation

```bash
npm install react-native-edge-tts
# or
yarn add react-native-edge-tts
```

## Quick Start

### Simple Usage

```typescript
import { EdgeTTS } from 'react-native-edge-tts';

// Create TTS instance
const tts = new EdgeTTS('Hello, world!', 'en-US-EmmaMultilingualNeural');

// Synthesize speech
const result = await tts.synthesize();

// result.audio is a Blob containing MP3 audio
// result.subtitle contains word timing information
```

### With Custom Options

```typescript
import { EdgeTTS } from 'react-native-edge-tts';

const tts = new EdgeTTS('Hello, world!', 'en-US-EmmaMultilingualNeural', {
  rate: '+20%',    // Speaking rate
  volume: '+10%',  // Volume adjustment
  pitch: '+5Hz',   // Pitch adjustment
});

const result = await tts.synthesize();
```

### Streaming API

For more control, use the `Communicate` class directly:

```typescript
import { Communicate } from 'react-native-edge-tts';

const communicate = new Communicate('Hello, world!', {
  voice: 'en-US-EmmaMultilingualNeural',
  rate: '+10%',
});

for await (const chunk of communicate.stream()) {
  if (chunk.type === 'audio' && chunk.data) {
    // Handle audio data (Uint8Array)
  } else if (chunk.type === 'WordBoundary') {
    // Handle word timing
    console.log(`Word: ${chunk.text}, Offset: ${chunk.offset}`);
  }
}
```

### List Available Voices

```typescript
import { listVoices, VoicesManager } from 'react-native-edge-tts';

// Simple list
const voices = await listVoices();
console.log(voices);

// With filtering
const manager = await VoicesManager.create();
const englishVoices = manager.find({ Language: 'en' });
```

### Generate Subtitles

```typescript
import { EdgeTTS, createVTT, createSRT } from 'react-native-edge-tts';

const tts = new EdgeTTS('Hello, this is a test.', 'en-US-EmmaMultilingualNeural');
const result = await tts.synthesize();

// Create VTT subtitles
const vtt = createVTT(result.subtitle);

// Create SRT subtitles
const srt = createSRT(result.subtitle);
```

## Playing Audio in React Native

Since React Native doesn't have native audio playback, you'll need a library like `expo-av` or `react-native-sound`:

```typescript
import { EdgeTTS } from 'react-native-edge-tts';
import { Audio } from 'expo-av';

async function speakText(text: string) {
  const tts = new EdgeTTS(text, 'en-US-EmmaMultilingualNeural');
  const result = await tts.synthesize();
  
  // Convert Blob to base64
  const arrayBuffer = await result.audio.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  
  // Play with expo-av
  const { sound } = await Audio.Sound.createAsync({
    uri: `data:audio/mpeg;base64,${base64}`,
  });
  
  await sound.playAsync();
}
```

## API Reference

### EdgeTTS

Simple API for text-to-speech synthesis.

```typescript
new EdgeTTS(text: string, voice?: string, options?: ProsodyOptions)
```

### Communicate

Streaming API for more control over the synthesis process.

```typescript
new Communicate(text: string, options?: CommunicateOptions)
```

### listVoices

Fetches available voices from Microsoft Edge TTS service.

```typescript
await listVoices(): Promise<Voice[]>
```

### VoicesManager

Utility class for filtering and finding voices.

```typescript
const manager = await VoicesManager.create();
manager.find({ Language: 'en', Gender: 'Female' });
```

## Popular Voices

| Voice Name | Language | Gender |
|------------|----------|--------|
| en-US-EmmaMultilingualNeural | English (US) | Female |
| en-US-AvaMultilingualNeural | English (US) | Female |
| en-US-AndrewMultilingualNeural | English (US) | Male |
| en-GB-SoniaNeural | English (UK) | Female |
| ja-JP-NanamiNeural | Japanese | Female |
| ko-KR-SunHiNeural | Korean | Female |
| zh-CN-XiaoxiaoNeural | Chinese (Mandarin) | Female |

## License

AGPL-3.0 - See [LICENSE](LICENSE) for details.

## Credits

Based on [edge-tts-universal](https://github.com/travisvn/edge-tts-universal) by Travis.
