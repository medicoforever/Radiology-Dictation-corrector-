import React, { useState, useRef, useEffect } from 'react';
import Spinner from './ui/Spinner';

interface CameraCaptureProps {
  onCapture: (imageFile: File) => void;
  onClose: () => void;
}

const CameraCapture: React.FC<CameraCaptureProps> = ({ onCapture, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Camera API is not supported in this browser.");
        }
        activeStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: "environment" } // Prefer rear camera
        });
        setStream(activeStream);
        if (videoRef.current) {
          videoRef.current.srcObject = activeStream;
        }
        setIsLoading(false);
      } catch (err) {
        console.error("Error accessing camera:", err);
        // Try again without facingMode if the first attempt fails
        try {
            activeStream = await navigator.mediaDevices.getUserMedia({ video: true });
            setStream(activeStream);
            if (videoRef.current) {
                videoRef.current.srcObject = activeStream;
            }
            setIsLoading(false);
        } catch (fallbackErr) {
            console.error("Fallback camera access error:", fallbackErr);
            if (fallbackErr instanceof Error) {
                setError(`Could not access camera: ${fallbackErr.message}`);
            } else {
                setError("An unknown error occurred while trying to access the camera.");
            }
            setIsLoading(false);
        }
      }
    };

    startCamera();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleCapture = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
        setCapturedImage(canvas.toDataURL('image/jpeg'));
      }
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  const handleAccept = () => {
    if (canvasRef.current) {
      canvasRef.current.toBlob(blob => {
        if (blob) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const imageFile = new File([blob], `capture-${timestamp}.jpg`, { type: 'image/jpeg' });
          onCapture(imageFile);
          // Allow capturing another photo
          handleRetake();
        }
      }, 'image/jpeg');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex flex-col items-center justify-center z-50 p-4">
      <div className="relative w-full max-w-2xl bg-slate-800 rounded-lg overflow-hidden shadow-xl">
        {isLoading && <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50"><Spinner /></div>}
        {error && <div className="p-8 text-center text-red-400">{error}</div>}
        
        {!error && (
            <>
                <div className="relative aspect-video">
                    <video ref={videoRef} autoPlay playsInline className={`w-full h-full object-contain ${capturedImage ? 'hidden' : 'block'}`}></video>
                    {capturedImage && <img src={capturedImage} alt="Captured preview" className="w-full h-full object-contain" />}
                    <canvas ref={canvasRef} className="hidden"></canvas>
                </div>
                
                <div className="bg-slate-900 p-4 flex justify-center items-center gap-6">
                    {capturedImage ? (
                        <>
                            <button onClick={handleRetake} className="text-white font-semibold py-2 px-6 rounded-lg bg-slate-600 hover:bg-slate-500 transition-colors">Retake</button>
                            <button onClick={handleAccept} className="text-white font-bold py-2 px-6 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors">Accept & Add</button>
                        </>
                    ) : (
                        <button onClick={handleCapture} disabled={isLoading} className="w-16 h-16 rounded-full bg-white flex items-center justify-center border-4 border-slate-400 hover:border-white transition disabled:opacity-50" aria-label="Capture photo">
                            <div className="w-12 h-12 rounded-full bg-white ring-2 ring-slate-800"></div>
                        </button>
                    )}
                </div>
            </>
        )}
      </div>
      <button onClick={onClose} className="mt-4 font-bold py-2 px-6 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50">
        Done
      </button>
    </div>
  );
};

export default CameraCapture;