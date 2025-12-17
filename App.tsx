
import React, { useState, useCallback, useEffect } from 'react';
import AudioRecorder from './components/AudioRecorder';
import ResultsDisplay from './components/ResultsDisplay';
import { AppStatus, IdentifiedError } from './types';
import { processMedia, createChat, blobToBase64, base64ToBlob, createChatFromText, identifyPotentialErrors } from './services/geminiService';
import Spinner from './components/ui/Spinner';
import { Chat } from '@google/genai';
// FIX: Changed import to a named import based on the error message.
import { BatchProcessor } from './components/BatchProcessor';
import LiveDictation from './components/LiveDictation';
import WaveformIcon from './components/icons/WaveformIcon';
import SunIcon from './components/icons/SunIcon';
import MoonIcon from './components/icons/MoonIcon';
import KeyIcon from './components/icons/KeyIcon';
import CustomPromptInput from './components/ui/CustomPromptInput';
import ApiKeyModal from './components/ApiKeyModal';

interface ChatMessage {
  author: 'You' | 'AI';
  text: string;
}

const SINGLE_MODE_STORAGE_KEY = 'radiologyDictationSingleMode';
const ERROR_CHECK_ENABLED_KEY = 'radiologyErrorCheckEnabled';

const getCleanMimeType = (blob: Blob): string => {
    let mimeType = blob.type;
    if (!mimeType) {
        // Fallback for files without a MIME type, maintaining original behavior.
        return 'audio/ogg';
    }
    // Handle WebM variations. It can be audio/webm or video/webm for audio-only files.
    // Also, strip codec information which might not be supported by the API.
    if (mimeType.startsWith('audio/webm') || mimeType.startsWith('video/webm')) {
        return 'audio/webm';
    }
    // For other types, just strip potential codec/parameter info
    return mimeType.split(';')[0];
};

const App: React.FC = () => {
  const [mode, setMode] = useState<'single' | 'batch' | 'live'>('single');
  const [status, setStatus] = useState<AppStatus>(AppStatus.Idle);
  const [findings, setFindings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [imageBlobs, setImageBlobs] = useState<Blob[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState<boolean>(false);
  // CHANGED: Default model to gemini-3-flash-preview as requested
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [identifiedErrors, setIdentifiedErrors] = useState<IdentifiedError[]>([]);
  const [errorCheckStatus, setErrorCheckStatus] = useState<'idle' | 'checking' | 'complete'>('idle');
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
      return storedTheme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [isErrorCheckEnabled, setIsErrorCheckEnabled] = useState(() => {
    const saved = localStorage.getItem(ERROR_CHECK_ENABLED_KEY);
    return saved ? JSON.parse(saved) : false; // Default is OFF
  });

  // API Key Management State
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);

  useEffect(() => {
    const storedKey = localStorage.getItem('gemini_api_key');
    if (storedKey) {
        setHasApiKey(true);
    } else {
        setHasApiKey(false);
        setIsApiKeyModalOpen(true);
    }
  }, []);

  const handleApiKeySave = (key: string) => {
      setHasApiKey(true);
      setIsApiKeyModalOpen(false);
  };

  const openApiKeyModal = () => {
      setIsApiKeyModalOpen(true);
  }


  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);
  
  useEffect(() => {
    localStorage.setItem(ERROR_CHECK_ENABLED_KEY, JSON.stringify(isErrorCheckEnabled));
  }, [isErrorCheckEnabled]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  // Load state from localStorage on initial render
  useEffect(() => {
    try {
      const savedStateJSON = localStorage.getItem(SINGLE_MODE_STORAGE_KEY);
      if (savedStateJSON) {
        const savedState = JSON.parse(savedStateJSON);
        if (savedState.findings && savedState.findings.length > 0) {
          // Allow restoring state without audio blob (for live sessions or image-only)
          if (savedState.audio) {
            const blob = base64ToBlob(savedState.audio.data, savedState.audio.type);
            setAudioBlob(blob);
          } else {
            setAudioBlob(null);
          }

          if (savedState.images && Array.isArray(savedState.images)) {
              const loadedImages = savedState.images.map((img: any) => base64ToBlob(img.data, img.type));
              setImageBlobs(loadedImages);
          } else {
              setImageBlobs([]);
          }

          setFindings(savedState.findings);
          setChatHistory(savedState.chatHistory || []);
          setStatus(AppStatus.Success);
          
          setSelectedModel(savedState.selectedModel || 'gemini-3-flash-preview');
          setCustomPrompt(savedState.customPrompt || '');

          // Recreate chat session asynchronously
          if (hasApiKey) {
              let chatPromise;
              if (savedState.audio) {
                 const ab = base64ToBlob(savedState.audio.data, savedState.audio.type);
                 chatPromise = createChat(ab, savedState.findings, savedState.customPrompt);
              } else {
                 chatPromise = createChatFromText(savedState.findings, savedState.customPrompt);
              }
    
              chatPromise
                .then(setChat)
                .catch(err => console.error("Failed to recreate chat session from saved state:", err));
          }
        }
      }
    } catch (err) {
      console.error("Failed to load state from localStorage:", err);
      localStorage.removeItem(SINGLE_MODE_STORAGE_KEY);
    }
  }, [hasApiKey]);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    const saveState = async () => {
      // Only save when we have a successful result to resume from
      if (status === AppStatus.Success && findings.length > 0) {
        try {
          const stateToSave: any = {
            findings,
            chatHistory,
            selectedModel,
            customPrompt,
          };
          if (audioBlob) {
            stateToSave.audio = {
              data: await blobToBase64(audioBlob),
              type: getCleanMimeType(audioBlob),
            };
          }
          if (imageBlobs.length > 0) {
              stateToSave.images = await Promise.all(imageBlobs.map(async (blob) => ({
                  data: await blobToBase64(blob),
                  type: blob.type
              })));
          }
          localStorage.setItem(SINGLE_MODE_STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (err) {
          console.error("Failed to save state to localStorage:", err);
        }
      }
    };
    saveState();
  }, [status, findings, audioBlob, imageBlobs, chatHistory, selectedModel, customPrompt]);


  // useEffect to run error check in background
  useEffect(() => {
    const checkForErrors = async () => {
        // Only run when enabled, processing is successful and we have findings
        if (isErrorCheckEnabled && status === AppStatus.Success && findings.length > 0 && hasApiKey) {
            setErrorCheckStatus('checking');
            setIdentifiedErrors([]); // Clear previous errors
            try {
                const errors = await identifyPotentialErrors(findings, selectedModel);
                setIdentifiedErrors(errors);
            } catch (err) {
                console.error("Failed to check for errors:", err);
                // Don't show this error to the user, it's a background task.
            } finally {
                setErrorCheckStatus('complete');
            }
        } else {
            // Clear errors if disabled, status is not 'Success', or there are no findings
            setIdentifiedErrors([]);
            setErrorCheckStatus('idle');
        }
    };

    checkForErrors();
  }, [findings, status, selectedModel, isErrorCheckEnabled, hasApiKey]);


  const handleMediaProcessing = useCallback(async (audio: Blob | null, images: Blob[]) => {
    if ((!audio || audio.size === 0) && images.length === 0) {
      setError('Recording or upload failed. No media provided.');
      setStatus(AppStatus.Error);
      return;
    }
    setStatus(AppStatus.Processing);
    setError(null);
    setFindings([]);
    setAudioBlob(audio);
    setImageBlobs(images);

    try {
      // processMedia will handle model switching for images
      const processedText = await processMedia(audio, images, selectedModel, customPrompt);
      setFindings(processedText);

      let chatSession;
      if (audio) {
          chatSession = await createChat(audio, processedText, customPrompt);
      } else {
          // If no audio (only images), we start a chat from text for now.
          // Future enhancement: support creating chat with initial images.
          chatSession = await createChatFromText(processedText, customPrompt);
      }
      
      setChat(chatSession);
      const aiGreeting = "I have reviewed the media and the transcript. How can I help you further?";
      setChatHistory([{ author: 'AI', text: `${processedText.join('\n\n')}\n\n${aiGreeting}` }]);
      
      setStatus(AppStatus.Success);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred during processing.');
      setStatus(AppStatus.Error);
    }
  }, [selectedModel, customPrompt]);
  
  const handleLiveDictationComplete = useCallback(async (transcript: string, audioBlob: Blob | null) => {
    setStatus(AppStatus.Processing);
    setError(null);
    setFindings([]);
    setAudioBlob(audioBlob); // Set the captured audio blob from the live session
    setImageBlobs([]);

    try {
        const processedText = transcript.split('\n').filter(line => line.trim() !== '');
        setFindings(processedText);
        
        // Use the custom prompt from single mode for the follow-up chat
        const chatSession = await createChatFromText(processedText, customPrompt);
        setChat(chatSession);

        const aiGreeting = "I have reviewed the live transcript. How can I help you further?";
        setChatHistory([{ author: 'AI', text: `${processedText.join('\n\n')}\n\n${aiGreeting}` }]);

        setMode('single'); // Switch back to single mode to show ResultsDisplay
        setStatus(AppStatus.Success);

    } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred during live processing.');
        setStatus(AppStatus.Error);
        setMode('single');
    }
  }, [customPrompt]);

  const handleReprocess = useCallback(async () => {
    if (!audioBlob && imageBlobs.length === 0) {
      setError('No media available to reprocess.');
      setStatus(AppStatus.Error);
      return;
    }
    // This re-uses the main processing logic with the current `selectedModel` and `customPrompt`
    await handleMediaProcessing(audioBlob, imageBlobs);
  }, [audioBlob, imageBlobs, handleMediaProcessing]);

  const handleUpdateFinding = (index: number, newText: string) => {
    setFindings(prevFindings => {
      const updatedFindings = [...prevFindings];
      if (updatedFindings[index] !== undefined) {
        updatedFindings[index] = newText;
      }
      return updatedFindings;
    });
  };

  const handleContinueDictation = useCallback(async (newAudioBlob: Blob) => {
    if (!audioBlob) {
        // If we started with images only, we can't "continue" audio dictation in the same way 
        // because continueAudioDictation service might expect existing context aligned with audio.
        // However, we can still try to append.
        // For now, if there is no original audio blob, we treat this as new audio 
        // that is appended to the text context.
        // throw new Error('Original audio not found. Cannot continue dictation.');
    }

    try {
      // So we just process the new audio blob as media.
      const newFindings = await processMedia(newAudioBlob, [], selectedModel, customPrompt);
      const updatedFindings = [...findings, ...newFindings];
      setFindings(updatedFindings);

      let mergedBlob = newAudioBlob;
      if (audioBlob) {
          mergedBlob = new Blob([audioBlob, newAudioBlob], { type: getCleanMimeType(audioBlob) });
      }
      setAudioBlob(mergedBlob);
      
      const chatSession = await createChat(mergedBlob, updatedFindings, customPrompt);
      setChat(chatSession);

      const aiGreeting = "I have updated the transcript with your new dictation. How can I help you further?";
      setChatHistory([{ author: 'AI' as const, text: `${updatedFindings.join('\n\n')}\n\n${aiGreeting}` }]);

    } catch (err) {
      console.error("Error during dictation continuation:", err);
      throw err; // Propagate error to the UI component
    }
  }, [audioBlob, findings, selectedModel, customPrompt]);

  const handleSendMessage = async (message: string | Blob) => {
    if (!chat || isChatting) return;

    setIsChatting(true);
    const userMessageText = typeof message === 'string' ? message : '[Audio Message]';
    setChatHistory(prev => [...prev, { author: 'You', text: userMessageText }]);

    try {
      let response;
      if (typeof message === 'string') {
        response = await chat.sendMessage({ message });
      } else { // It's a Blob
        const base64Audio = await blobToBase64(message);
        const audioPart = {
          inlineData: {
            mimeType: getCleanMimeType(message),
            data: base64Audio,
          },
        };
        // Adding a text part to guide the model.
        const textPart = { text: "Please analyze this audio in the context of our conversation." };
        // The `message` property can be an array of parts for multipart messages.
        response = await chat.sendMessage({ message: [audioPart, textPart] });
      }
      const responseText = response.text;
      setChatHistory(prev => [...prev, { author: 'AI', text: responseText }]);
    } catch (err) {
      console.error("Chat error:", err);
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setChatHistory(prev => [...prev, { author: 'AI', text: `Sorry, I encountered an error: ${errorMessage}` }]);
    } finally {
      setIsChatting(false);
    }
  };

  const resetSingleMode = () => {
    setStatus(AppStatus.Idle);
    setFindings([]);
    setError(null);
    setAudioBlob(null);
    setImageBlobs([]);
    setChat(null);
    setChatHistory([]);
    setIsChatting(false);
    setMode('single');
    setCustomPrompt(''); // Reset custom prompt as well
    setIdentifiedErrors([]);
    setErrorCheckStatus('idle');
    // Clear saved state on reset
    try {
      localStorage.removeItem(SINGLE_MODE_STORAGE_KEY);
    } catch (error) {
      console.error("Failed to remove item from localStorage:", error);
    }
  };

  const handleDownload = () => {
    if (!audioBlob) return;
    try {
      const url = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      
      const extension = audioBlob.type === 'audio/mpeg' ? 'mp3' : audioBlob.type === 'audio/wav' ? 'wav' : (audioBlob.type.split('/')[1] || 'webm').split(';')[0];
      a.download = `radiology-dictation.${extension}`;
      
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
        console.error('Failed to download audio:', err)
    }
  };

  const renderSingleModeContent = () => {
    switch (status) {
      case AppStatus.Idle:
      case AppStatus.Recording:
        return (
          <>
            <div className="flex justify-end items-center gap-4 mb-4 -mt-4">
                 <button 
                    onClick={() => setMode('live')} 
                    className="flex items-center gap-1.5 text-sm font-semibold text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 transition-colors"
                >
                    <WaveformIcon className="w-4 h-4" />
                    Live Dictation
                </button>
                 <button 
                    onClick={() => setMode('batch')} 
                    className="text-sm font-semibold text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                >
                    Batch Processing &rarr;
                </button>
            </div>
             <CustomPromptInput
                prompt={customPrompt}
                onPromptChange={setCustomPrompt}
                className="mb-6"
            />
            <AudioRecorder
              status={status}
              setStatus={setStatus}
              onProcess={handleMediaProcessing}
            />
          </>
        );
      case AppStatus.Processing:
        return (
          <div className="text-center p-8">
            <Spinner />
            <p className="text-slate-600 dark:text-slate-300 mt-4 text-lg">
              Analyzing and correcting text...
            </p>
            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
              This may take a moment.
            </p>
            {audioBlob && (
                <div className="mt-6">
                    <button
                        onClick={handleDownload}
                        className="bg-slate-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50 transition-colors"
                    >
                        Download Audio
                    </button>
                </div>
            )}
          </div>
        );
      case AppStatus.Success:
        return (
          <ResultsDisplay 
            findings={findings} 
            onReset={resetSingleMode} 
            audioBlob={audioBlob}
            chatHistory={chatHistory}
            isChatting={isChatting}
            onSendMessage={handleSendMessage}
            onSwitchToBatch={() => setMode('batch')}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onReprocess={handleReprocess}
            onUpdateFinding={handleUpdateFinding}
            onAllFindingsUpdate={setFindings}
            onContinueDictation={handleContinueDictation}
            customPrompt={customPrompt}
            onCustomPromptChange={setCustomPrompt}
            identifiedErrors={identifiedErrors}
            errorCheckStatus={errorCheckStatus}
          />
        );
      case AppStatus.Error:
        return (
          <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30 rounded-lg">
            <h3 className="text-xl font-semibold text-red-700 dark:text-red-300">An Error Occurred</h3>
            <p className="text-red-600 dark:text-red-400 mt-2">{error}</p>
            <div className="mt-6 flex flex-col sm:flex-row justify-center items-center gap-4">
              <button
                onClick={resetSingleMode}
                className="bg-red-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50 transition-colors"
              >
                Try Again
              </button>
              {audioBlob && (
                <button
                  onClick={handleDownload}
                  className="bg-slate-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50 transition-colors"
                >
                  Download Audio
                </button>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderContent = () => {
    if (!hasApiKey) return null; // Wait for API key

    switch (mode) {
      case 'single':
        return renderSingleModeContent();
      case 'batch':
        return <BatchProcessor 
                    selectedModel={selectedModel} 
                    isErrorCheckEnabled={isErrorCheckEnabled}
                    onBack={() => {
                        resetSingleMode();
                        setMode('single');
                    }} 
                />;
      case 'live':
        return <LiveDictation onComplete={handleLiveDictationComplete} onBack={() => setMode('single')} />;
      default:
        return renderSingleModeContent();
    }
  }

  const getPageDescription = () => {
    if (mode === 'batch') return 'Manage and transcribe multiple dictations efficiently.';
    if (mode === 'live') return 'Dictate in real-time and get an instant, corrected transcript.';
    return 'Record your findings, and let AI provide a clean, corrected transcript.';
  };


  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4 font-sans transition-colors duration-300">
      
      <ApiKeyModal 
        isOpen={isApiKeyModalOpen} 
        onSave={handleApiKeySave} 
        canClose={hasApiKey} 
        onClose={() => setIsApiKeyModalOpen(false)}
      />

      <div className="w-full max-w-3xl mx-auto flex-grow flex flex-col justify-center">
        <header className="text-center mb-8 relative">
          <h1 className="text-4xl font-bold text-slate-800 dark:text-slate-100">Radiology Dictation Corrector</h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2">
            {getPageDescription()}
          </p>
          <div className="absolute top-0 right-0">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <MoonIcon className="w-6 h-6" /> : <SunIcon className="w-6 h-6" />}
            </button>
          </div>
            <div className="mt-4 flex flex-wrap justify-center items-center gap-x-6 gap-y-2">
                {status === AppStatus.Idle && mode === 'single' && (
                    <div className="flex items-center gap-2">
                        <label htmlFor="model-select" className="text-sm font-medium text-slate-700 dark:text-slate-300">AI Model:</label>
                        <select 
                            id="model-select"
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="bg-white border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 dark:bg-slate-700 dark:border-slate-600 dark:placeholder-slate-400 dark:text-white"
                        >
                            <option value="gemini-3-flash-preview">Gemini 3 Flash (Default)</option>
                            <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                            <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                            <option value="gemini-robotics-er-1.5-preview">Gemini Robotics ER 1.5 Preview</option>
                        </select>
                    </div>
                )}
                 <div className="flex items-center gap-2">
                    <label htmlFor="error-check-toggle" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Automatic Error Finding
                    </label>
                    <button
                        onClick={() => setIsErrorCheckEnabled(!isErrorCheckEnabled)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                        isErrorCheckEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600'
                        }`}
                        role="switch"
                        aria-checked={isErrorCheckEnabled}
                        id="error-check-toggle"
                    >
                        <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            isErrorCheckEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                        />
                    </button>
                </div>
            </div>
        </header>
        <main className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-4 sm:p-8 min-h-[300px]">
          {renderContent()}
        </main>
      </div>
      <footer className="w-full text-center mt-8 py-4 text-sm text-slate-500 dark:text-slate-500 border-t dark:border-slate-800 flex justify-center items-center gap-4">
          <p>Powered by Gemini AI</p>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <button 
            onClick={openApiKeyModal}
            className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          >
            <KeyIcon className="w-4 h-4" />
            Edit API Key
          </button>
      </footer>
    </div>
  );
};

export default App;
