import { useState, useRef, useCallback, useEffect } from 'react';

type AudioRecorderResult = {
  isRecording: boolean;
  isPaused: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<Blob>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  error: string | null;
};

export const useAudioRecorder = (): AudioRecorderResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('');
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    setError(null);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      console.warn("Recording is already in progress.");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError("Audio recording is not supported in this browser.");
        return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      
      const MimeTypes = [
          'audio/mpeg',
          'audio/ogg; codecs=opus',
          'audio/webm; codecs=opus',
          'audio/ogg',
          'audio/webm',
      ];
      const supportedMimeType = MimeTypes.find(type => MediaRecorder.isTypeSupported(type));

      if (!supportedMimeType) {
          console.warn("None of the preferred MIME types are supported. Using browser default.");
      }
      
      const options = supportedMimeType ? { mimeType: supportedMimeType } : undefined;
      mimeTypeRef.current = options?.mimeType || 'audio/ogg';

      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.addEventListener("dataavailable", (event: BlobEvent) => {
        audioChunksRef.current.push(event.data);
      });

      mediaRecorder.start();
      setIsRecording(true);
      setIsPaused(false);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      if (err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          setError("Microphone permission denied. Please allow microphone access in your browser settings.");
      } else {
          setError("Could not access the microphone. Please ensure it is connected and enabled.");
      }
      setIsRecording(false);
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  }, []);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            const recorder = mediaRecorderRef.current;

            const cleanupAndSetState = () => {
                streamRef.current?.getTracks().forEach(track => track.stop());
                streamRef.current = null;
                mediaRecorderRef.current = null;
                setIsRecording(false);
                setIsPaused(false);
            };
            
            recorder.addEventListener("stop", () => {
                const newAudioBlob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
                cleanupAndSetState();
                resolve(newAudioBlob);
            }, { once: true });

            recorder.addEventListener("error", (event) => {
                console.error("MediaRecorder error:", event);
                cleanupAndSetState();
                reject(new Error("An error occurred during recording."));
            }, { once: true });

            recorder.stop();
        } else {
            resolve(new Blob([], { type: mimeTypeRef.current }));
        }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  return { isRecording, isPaused, startRecording, stopRecording, pauseRecording, resumeRecording, error };
};
