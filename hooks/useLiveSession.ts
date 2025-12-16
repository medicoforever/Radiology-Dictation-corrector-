
import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality, Session, LiveServerMessage } from '@google/genai';
import { LIVE_GEMINI_PROMPT } from '../constants';

// Helper to check for webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

const MODEL_NAME = 'gemini-2.5-flash-live-preview';
const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

// --- Audio Encoding ---
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): { data: string, mimeType: string } {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: `audio/pcm;rate=${SAMPLE_RATE}`,
  };
}

function createWavBlob(pcmData: Float32Array, sampleRate: number): Blob {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcmData.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeString(view: DataView, offset: number, string: string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    // fmt subchunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    // data subchunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // write the PCM data
    let offset = 44;
    for (let i = 0; i < pcmData.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, pcmData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
}

export const useLiveSession = () => {
    const [status, setStatus] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [isPaused, setIsPaused] = useState(false);

    const clientRef = useRef<GoogleGenAI | null>(null);
    const sessionPromiseRef = useRef<Promise<Session> | null>(null);
    
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    
    const bufferRef = useRef('');
    const lastMessageTimeRef = useRef<number | null>(null);
    const capturedAudioChunksRef = useRef<Float32Array[]>([]);

    const isSessionActiveForCallback = useRef(false);
    useEffect(() => {
        isSessionActiveForCallback.current = isSessionActive;
    }, [isSessionActive]);

    const isPausedForCallback = useRef(false);
    useEffect(() => {
        isPausedForCallback.current = isPaused;
    }, [isPaused]);
    
    const stopAudio = useCallback(() => {
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        
        scriptProcessorNodeRef.current?.disconnect();
        scriptProcessorNodeRef.current = null;
        
        sourceNodeRef.current?.disconnect();
        sourceNodeRef.current = null;
        
        inputAudioContextRef.current?.close().catch(console.error);
        inputAudioContextRef.current = null;
    }, []);

    const cleanUpSession = useCallback(() => {
        setIsSessionActive(false);
        setIsPaused(false);
        stopAudio();
        sessionPromiseRef.current?.then(session => session.close()).catch(() => {});
        sessionPromiseRef.current = null;
        bufferRef.current = '';
        lastMessageTimeRef.current = null;
        capturedAudioChunksRef.current = [];
    }, [stopAudio]);

    const pauseSession = useCallback(() => {
        if (isSessionActiveForCallback.current) {
            setIsPaused(true);
            setStatus('Live session paused...');
        }
    }, []);

    const resumeSession = useCallback(() => {
        if (isSessionActiveForCallback.current) {
            setIsPaused(false);
            setStatus('Live session resumed. Listening...');
        }
    }, []);
    
    const startSession = useCallback(async (onTranscriptUpdate: (lines: string[]) => void, customPrompt?: string) => {
        if (isSessionActiveForCallback.current) return;
        
        const apiKey = localStorage.getItem('gemini_api_key');
        if (!apiKey) {
            setError('Missing API Key. Please add it in settings.');
            return;
        }

        setError('');
        setStatus('Connecting...');
        bufferRef.current = '';
        capturedAudioChunksRef.current = [];
        lastMessageTimeRef.current = null;
        onTranscriptUpdate([]);
        setIsPaused(false);

        try {
            // 1. Start Audio
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
            inputAudioContextRef.current = audioContext;
            sourceNodeRef.current = audioContext.createMediaStreamSource(stream);

            // 2. Connect to Gemini
            clientRef.current = new GoogleGenAI({ apiKey: apiKey });
            
            let systemInstruction = LIVE_GEMINI_PROMPT;
            if (customPrompt) {
                systemInstruction += `\n\nCustom Instructions:\n${customPrompt}`;
            }

            const sessionPromise = clientRef.current.live.connect({
                model: MODEL_NAME,
                config: {
                    responseModalities: [Modality.TEXT],
                    systemInstruction: systemInstruction,
                },
                callbacks: {
                    onopen: () => {
                        setStatus('Connection opened. Listening...');
                        setIsSessionActive(true);
                    },
                    onclose: (e: CloseEvent) => {
                        if (isSessionActiveForCallback.current) {
                            setStatus(`Connection closed: ${e.reason}`);
                            cleanUpSession();
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('Live session error:', e);
                        setError(`Error: ${e.message}`);
                        cleanUpSession();
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         const now = Date.now();
                         const timeSinceLastMessage = lastMessageTimeRef.current ? now - lastMessageTimeRef.current : 0;
                         lastMessageTimeRef.current = now;
                        
                         const modelTurn = message.serverContent?.modelTurn;
                         if (modelTurn?.parts) {
                            const responseText = modelTurn.parts
                                .map(part => part.text)
                                .filter(Boolean)
                                .join('');
                            
                            if (responseText) {
                                let separator = '';
                                // Heuristic: Add a space if there's a significant pause between chunks (e.g., user paused speaking).
                                if (timeSinceLastMessage > 300 && bufferRef.current.length > 0 && !/\s$/.test(bufferRef.current) && !/^\s/.test(responseText)) {
                                    separator = ' ';
                                }
                                bufferRef.current += separator + responseText;

                                const formattedText = bufferRef.current
                                    .replace(/\\n/g, '\n') // Handle escaped newlines
                                    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split mingled words (camelCase)
                                    .replace(/(\.|\?|!|,)(\S)/g, '$1 $2') // Ensure space after punctuation
                                    .replace(/([a-zA-Z])(\d)/g, '$1 $2'); // Ensure space between letter and number
                                bufferRef.current = formattedText;
                                
                                const lines = bufferRef.current.split('\n');
                                const capitalizedLines = lines.map(line =>
                                    line ? line.charAt(0).toUpperCase() + line.slice(1) : ''
                                );
                                onTranscriptUpdate(capitalizedLines);
                            }
                         }
                    }
                }
            });
            
            sessionPromiseRef.current = sessionPromise;

            // Handle promise rejection for connection errors
            sessionPromise.catch(err => {
                // Check if session is already active. If not, this is a connection error.
                if (!isSessionActiveForCallback.current) {
                    const message = err instanceof Error ? err.message : 'Unknown connection error';
                    setError(`Failed to start session: ${message}`);
                    setStatus('Session failed to start.');
                    cleanUpSession();
                }
            });

            // 3. Set up Audio Processor
            if (!inputAudioContextRef.current || !sourceNodeRef.current) {
                throw new Error("Audio context not initialized after starting audio.");
            }
            
            const scriptProcessorNode = inputAudioContextRef.current.createScriptProcessor(BUFFER_SIZE, 1, 1);
            scriptProcessorNodeRef.current = scriptProcessorNode;

            scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
                const pcmData = audioProcessingEvent.inputBuffer.getChannelData(0);
                capturedAudioChunksRef.current.push(pcmData.slice());
                // Use the promise to send data, ensuring session is active.
                sessionPromise.then((session) => {
                    if (isSessionActiveForCallback.current && !isPausedForCallback.current) {
                        session.sendRealtimeInput({ media: createBlob(pcmData) });
                    }
                }).catch(() => {
                    // This catch prevents unhandled promise rejections if the session fails
                    // while the audio processor is still running.
                });
            };
            
            sourceNodeRef.current.connect(scriptProcessorNode);
            scriptProcessorNode.connect(inputAudioContextRef.current.destination);

        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            setError(`Failed to start session: ${message}`);
            setStatus('Session failed to start.');
            cleanUpSession();
        }
    }, [cleanUpSession]);
    
    const stopSession = useCallback(() => {
        if (!isSessionActiveForCallback.current) {
            return { transcript: '', audioBlob: null };
        }
        setStatus('Session stopped.');
        
        const finalTranscript = bufferRef.current.trim();
        
        let finalAudioBlob: Blob | null = null;
        if (capturedAudioChunksRef.current.length > 0) {
            const totalLength = capturedAudioChunksRef.current.reduce((acc, val) => acc + val.length, 0);
            const concatenated = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of capturedAudioChunksRef.current) {
                concatenated.set(chunk, offset);
                offset += chunk.length;
            }
            finalAudioBlob = createWavBlob(concatenated, SAMPLE_RATE);
        }

        cleanUpSession();

        return { transcript: finalTranscript, audioBlob: finalAudioBlob };
    }, [cleanUpSession]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (isSessionActiveForCallback.current) {
                cleanUpSession();
            }
        };
    }, [cleanUpSession]);

    return {
        status,
        error,
        isSessionActive,
        isPaused,
        startSession,
        stopSession,
        pauseSession,
        resumeSession,
    };
};
