/**
 * TTS Utilities - Voice selection and text processing for natural speech
 */

// Clean markdown formatting from text for natural TTS
export function renderAnswerForSpeech(markdown: string): string {
  let text = markdown;
  
  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`[^`]+`/g, '');
  
  // Remove headers (# ## ### etc.)
  text = text.replace(/^#{1,6}\s+/gm, '');
  
  // Remove bold/italic markers
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/___([^_]+)___/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  
  // Convert bullet points to natural speech
  text = text.replace(/^\s*[-*•]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');
  
  // Remove square bracket citations like [Source 3, Source 27]
  text = text.replace(/\[Source \d+(?:,\s*Source \d+)*\]/gi, '');
  text = text.replace(/\[[\d,\s]+\]/g, '');
  
  // Remove markdown links but keep text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');
  
  // Clean up colons at end of lines (often headers)
  text = text.replace(/:s*$/gm, '.');
  
  // Normalize whitespace
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/\s{2,}/g, ' ');
  
  // Clean up punctuation that sounds awkward
  text = text.replace(/\(\s*\)/g, '');
  text = text.replace(/\[\s*\]/g, '');
  
  return text.trim();
}

// Select the best available voice for natural speech
export function selectBestVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) {
    return null;
  }
  
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  
  // Priority list of voice name patterns (natural, human-like voices first)
  const preferredPatterns = [
    /google.*uk.*english.*female/i,   // Google UK English Female - very natural
    /google.*us.*english.*female/i,   // Google US English Female
    /google.*us.*english/i,
    /google.*english/i,
    /microsoft.*aria.*online/i,       // Microsoft Aria Online - neural, natural
    /microsoft.*jenny.*online/i,      // Microsoft Jenny - conversational
    /microsoft.*guy.*online/i,        // Microsoft Guy - natural male
    /microsoft.*aria/i,
    /microsoft.*jenny/i,
    /microsoft.*guy/i,
    /microsoft.*zira/i,
    /neural/i,
    /natural/i,
    /premium/i,
    /enhanced/i,
    /samantha/i,        // macOS high quality voice
    /karen/i,           // Australian English, good quality
    /daniel/i,          // British English
    /moira/i,           // Irish English - distinctive
    /fiona/i,           // Scottish English
    /tessa/i,           // South African English
  ];
  
  // Filter to English voices only
  const englishVoices = voices.filter(v => 
    v.lang.startsWith('en') || v.lang.startsWith('EN')
  );
  
  // Try each preferred pattern in order
  for (const pattern of preferredPatterns) {
    const match = englishVoices.find(v => pattern.test(v.name));
    if (match) {
      console.log(`[TTS] Selected voice: "${match.name}" (${match.lang})`);
      return match;
    }
  }
  
  // Fallback: prefer non-local voices (often higher quality)
  const remoteVoice = englishVoices.find(v => !v.localService);
  if (remoteVoice) {
    console.log(`[TTS] Using remote voice: "${remoteVoice.name}" (${remoteVoice.lang})`);
    return remoteVoice;
  }
  
  // Last resort: first English voice
  if (englishVoices.length > 0) {
    console.log(`[TTS] Fallback voice: "${englishVoices[0].name}" (${englishVoices[0].lang})`);
    return englishVoices[0];
  }
  
  // Absolute fallback
  console.log(`[TTS] Using default voice: "${voices[0]?.name}"`);
  return voices[0] || null;
}

// Create and configure an utterance with optimal settings
export function createUtterance(
  text: string, 
  voice: SpeechSynthesisVoice | null,
  options?: {
    rate?: number;
    pitch?: number;
    volume?: number;
  }
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  
  if (voice) {
    utterance.voice = voice;
  }
  
  // Natural delivery settings — slightly slower with warm pitch
  utterance.rate = options?.rate ?? 0.92;   // Slightly slower for natural feel
  utterance.pitch = options?.pitch ?? 1.02; // Very slightly elevated for warmth
  utterance.volume = options?.volume ?? 1.0;
  
  return utterance;
}

// Split long text into sentences for more natural pauses
export function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  // Combine very short fragments with previous sentence
  const result: string[] = [];
  let current = '';
  
  for (const sentence of sentences) {
    if (sentence.length < 20 && current) {
      current += ' ' + sentence;
    } else {
      if (current) result.push(current.trim());
      current = sentence;
    }
  }
  
  if (current) result.push(current.trim());
  
  return result.filter(s => s.length > 0);
}
