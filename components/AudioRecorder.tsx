
import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { AppStatus } from '../types';
import MicIcon from './icons/MicIcon';
import StopIcon from './icons/StopIcon';
import UploadIcon from './icons/UploadIcon';
import PhotoIcon from './icons/PhotoIcon';
import CloseIcon from './icons/CloseIcon';
import TrashIcon from './icons/TrashIcon';
import CameraIcon from './icons/CameraIcon';
import CameraCapture from './CameraCapture';

interface AudioRecorderProps {
  status: AppStatus;
  setStatus: (status: AppStatus) => void;
  onProcess: (audio: Blob | null, images: Blob[]) => void;
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({ status, setStatus, onProcess }) => {
  const { isRecording, startRecording, stopRecording, error } = useAudioRecorder();
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [stagedImages, setStagedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [isUnzipping, setIsUnzipping] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);

  useEffect(() => {
    // Create preview URLs for staged images
    const newPreviews = stagedImages.map(file => URL.createObjectURL(file));
    setImagePreviews(newPreviews);

    // Cleanup function to revoke URLs
    return () => {
      newPreviews.forEach(url => URL.revokeObjectURL(url));
    };
  }, [stagedImages]);

  const handleStart = async () => {
    await startRecording();
    setStatus(AppStatus.Recording);
  };

  const handleStop = async () => {
    const newAudioBlob = await stopRecording();
    if (newAudioBlob && newAudioBlob.size > 0) {
      setAudioBlob(newAudioBlob);
      const timestamp = new Date().toLocaleTimeString().replace(/:\d{2}\s/,' ');
      setAudioName(`Recording @ ${timestamp}`);
    }
    setStatus(AppStatus.Idle);
  };
  
  const handleAudioFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAudioBlob(file);
      setAudioName(file.name);
    }
    if (event.target) {
      event.target.value = "";
    }
  };
  
  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      const files: File[] = Array.from(event.target.files);
      const imageFiles: File[] = [];
      let zipFound = false;

      for (const file of files) {
        if (file.type === 'application/zip' || file.name.toLowerCase().endsWith('.zip')) {
          zipFound = true;
          setIsUnzipping(true);
          try {
            const zip = await JSZip.loadAsync(file);
            const imagePromises: Promise<File>[] = [];

            zip.forEach((relativePath, zipEntry) => {
              const isImage = /\.(jpe?g|png|gif|bmp)$/i.test(zipEntry.name);
              if (!zipEntry.dir && isImage) {
                const promise = zipEntry.async('blob').then(blob => {
                  return new File([blob], zipEntry.name, { type: blob.type });
                });
                imagePromises.push(promise);
              }
            });

            const extractedImages = await Promise.all(imagePromises);
            imageFiles.push(...extractedImages);
          } catch (e) {
            console.error("Error processing zip file:", e);
            // Optionally show an error to the user here
          } finally {
            setIsUnzipping(false);
          }
        } else if (file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        setStagedImages(prev => [...prev, ...imageFiles]);
      }
    }
    if (event.target) {
      event.target.value = "";
    }
  };
  
  const handleCaptureImage = (imageFile: File) => {
    setStagedImages(prev => [...prev, imageFile]);
  };

  const handleRemoveImage = (indexToRemove: number) => {
    setStagedImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };
  
  const handleClearAudio = () => {
    setAudioBlob(null);
    setAudioName(null);
  };
  
  const handleProcessMedia = () => {
    if (audioBlob || stagedImages.length > 0) {
      onProcess(audioBlob, stagedImages);
    }
  };

  const triggerAudioSelect = () => audioInputRef.current?.click();
  const triggerImageSelect = () => imageInputRef.current?.click();
  const triggerCamera = () => setIsCameraOpen(true);
  
  const hasMedia = audioBlob || stagedImages.length > 0;

  return (
    <div className="flex flex-col items-center justify-center p-4">
      {isCameraOpen && (
        <CameraCapture 
          onCapture={handleCaptureImage}
          onClose={() => setIsCameraOpen(false)}
        />
      )}
      <input type="file" ref={audioInputRef} onChange={handleAudioFileSelect} className="hidden" accept="audio/*" aria-hidden="true" />
      <input type="file" ref={imageInputRef} onChange={handleImageSelect} className="hidden" accept="image/*,.zip" multiple aria-hidden="true" />

      {isRecording && (
         <div className="text-center mb-6 animate-fade-in">
             <div className="relative w-24 h-24 mx-auto mb-4">
                <div className="absolute inset-0 rounded-full bg-red-500 animate-ping"></div>
                <div className="relative w-24 h-24 rounded-full bg-white dark:bg-slate-700 shadow-lg flex items-center justify-center">
                    <div className="w-10 h-10 bg-red-500 animate-pulse rounded-full"></div>
                </div>
            </div>
            <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200">Recording...</h2>
            <button onClick={handleStop} className="mt-4 flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-3 px-8 rounded-full hover:bg-red-700 focus:outline-none focus:ring-4 focus:ring-red-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg">
                <StopIcon className="w-6 h-6"/>
                Stop Recording
            </button>
            {error && <p className="text-red-500 mt-4">{error}</p>}
         </div>
      )}

      {!isRecording && (
        <>
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* Image Staging Area */}
                <div className="flex flex-col">
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">1. Add Images (Optional)</h3>
                    <div className="flex-grow p-2 border-2 border-dashed rounded-lg bg-slate-50 dark:bg-slate-900/50 min-h-[150px] flex flex-col">
                        {stagedImages.length === 0 && !isUnzipping ? (
                            <div className="flex-grow flex items-center justify-center gap-4">
                                <button onClick={triggerImageSelect} className="flex flex-col items-center gap-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors">
                                    <PhotoIcon className="w-10 h-10"/>
                                    <span className="font-semibold">Add Files</span>
                                    <span className="text-xs font-normal">(images or .zip)</span>
                                </button>
                                <div className="h-12 w-px bg-slate-300 dark:bg-slate-600"></div>
                                <button onClick={triggerCamera} className="flex flex-col items-center gap-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors">
                                    <CameraIcon className="w-10 h-10" />
                                    <span className="font-semibold">Use Camera</span>
                                </button>
                            </div>
                        ) : isUnzipping ? (
                            <div className="flex-grow flex items-center justify-center text-slate-500 dark:text-slate-400">
                                Unzipping images...
                            </div>
                        ) : (
                            <>
                               <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 flex-grow">
                                    {imagePreviews.map((preview, index) => (
                                        <div key={index} className="relative group aspect-square">
                                            <img src={preview} alt={`preview ${stagedImages[index].name}`} className="w-full h-full object-cover rounded-md" />
                                            <button onClick={() => handleRemoveImage(index)} className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black" aria-label="Remove image">
                                                <CloseIcon className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <div className="flex justify-between items-center mt-2 flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                        <button onClick={triggerImageSelect} className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">Add Files...</button>
                                        <span className="text-slate-300 dark:text-slate-600">|</span>
                                        <button onClick={triggerCamera} className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">Camera...</button>
                                    </div>
                                    <button onClick={() => setStagedImages([])} className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400 flex items-center gap-1">
                                        <TrashIcon className="w-4 h-4"/> Clear All
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
                {/* Audio Staging Area */}
                <div className="flex flex-col">
                    <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">2. Add Audio (Optional)</h3>
                     <div className="flex-grow p-2 border-2 border-dashed rounded-lg bg-slate-50 dark:bg-slate-900/50 min-h-[150px] flex flex-col justify-center items-center">
                        {audioBlob ? (
                            <div className="text-center p-2 bg-green-50 dark:bg-green-900/20 rounded-lg w-full">
                                <p className="font-semibold text-green-800 dark:text-green-300">Audio Added</p>
                                <p className="text-sm text-slate-600 dark:text-slate-400 truncate my-1" title={audioName || ''}>{audioName}</p>
                                <button onClick={handleClearAudio} className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400 flex items-center gap-1 mx-auto">
                                    <TrashIcon className="w-4 h-4" /> Remove Audio
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-4">
                                <button onClick={handleStart} className="flex flex-col items-center gap-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors">
                                    <MicIcon className="w-10 h-10"/>
                                    <span className="font-semibold">Record</span>
                                </button>
                                <div className="h-12 w-px bg-slate-300 dark:bg-slate-600"></div>
                                <button onClick={triggerAudioSelect} className="flex flex-col items-center gap-2 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors">
                                    <UploadIcon className="w-10 h-10"/>
                                    <span className="font-semibold">Upload</span>
                                </button>
                            </div>
                        )}
                     </div>
                </div>
            </div>
            
            {error && <p className="text-red-500 mb-4">{error}</p>}
            
            <div className="mt-4 border-t w-full pt-6 flex flex-col items-center">
                 <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-2">3. Process Media</h3>
                 <p className="text-slate-500 dark:text-slate-400 mb-4 text-center">
                    Click the button below to process the staged media.
                 </p>
                 <button
                    onClick={handleProcessMedia}
                    disabled={!hasMedia}
                    className="flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-8 rounded-full hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg disabled:bg-slate-400 disabled:cursor-not-allowed disabled:scale-100 dark:disabled:bg-slate-600"
                    aria-label="Process staged media"
                >
                    Process Media
                </button>
            </div>
        </>
      )}
    </div>
  );
};

export default AudioRecorder;
