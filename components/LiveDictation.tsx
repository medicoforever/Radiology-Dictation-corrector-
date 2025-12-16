
import React, { useState, useCallback } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import StopIcon from './icons/StopIcon';
import WaveformIcon from './icons/WaveformIcon';
import ResultsDisplay from './ResultsDisplay';
import CustomPromptInput from './ui/CustomPromptInput';

interface LiveDictationProps {
    onComplete: (transcript: string, audioBlob: Blob | null) => void;
    onBack: () => void;
}

const LiveDictation: React.FC<LiveDictationProps> = ({ onComplete, onBack }) => {
    const [findings, setFindings] = useState<string[]>([]);
    const [customPrompt, setCustomPrompt] = useState('');
    const {
        status,
        error,
        isSessionActive,
        startSession,
        stopSession,
        pauseSession,
        resumeSession,
    } = useLiveSession();

    const handleStart = useCallback(() => {
        startSession(setFindings, customPrompt);
    }, [startSession, customPrompt]);

    const handleStop = useCallback(() => {
        const { transcript, audioBlob } = stopSession();
        onComplete(transcript, audioBlob);
    }, [stopSession, onComplete]);

    const handleUpdateFinding = (index: number, newText: string) => {
        const newFindings = [...findings];
        if (newFindings[index] !== undefined) {
            newFindings[index] = newText;
        }
        setFindings(newFindings);
    };

    if (!isSessionActive) {
        // Inactive State - Prompt to start
        return (
            <div className="flex flex-col items-center justify-center p-4">
                <div className="relative mb-6">
                    <div className="relative w-24 h-24 rounded-full bg-white dark:bg-slate-700 shadow-lg flex items-center justify-center">
                        <WaveformIcon className="w-10 h-10 text-green-600 dark:text-green-400" />
                    </div>
                </div>
                <h2 className="text-2xl font-semibold text-slate-700 dark:text-slate-200 mb-2">
                    Live Dictation
                </h2>
                <p className="text-slate-500 dark:text-slate-400 mb-6 text-center">
                    Click the button below to start your real-time transcription session.
                </p>
                <div className="w-full max-w-md mb-6">
                   <CustomPromptInput prompt={customPrompt} onPromptChange={setCustomPrompt} />
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="bg-slate-200 text-slate-700 font-bold py-3 px-8 rounded-full hover:bg-slate-300 transition-colors dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                        &larr; Back
                    </button>
                    <button
                        onClick={handleStart}
                        className="flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 px-8 rounded-full hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-300 transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg"
                        aria-label="Start Live Session"
                    >
                        <WaveformIcon className="w-6 h-6" />
                        Start Session
                    </button>
                </div>
                <div className="mt-6 text-center text-sm min-h-[20px]">
                    {error ? <span className="text-red-500">{error}</span> : <span className="text-slate-500 dark:text-slate-400">{status}</span>}
                </div>
            </div>
        );
    }

    // Active State - Render ResultsDisplay in live mode
    return (
        <ResultsDisplay
            isLive={true}
            onStopLive={handleStop}
            liveStatus={status}
            liveError={error}
            findings={findings}
            onUpdateFinding={handleUpdateFinding}
            onAllFindingsUpdate={setFindings}
            onPauseLive={pauseSession}
            onResumeLive={resumeSession}
            customPrompt={customPrompt}
            onCustomPromptChange={setCustomPrompt}
            // Pass required props, disabling features that don't apply in live mode
            onReset={onBack}
            audioBlob={null}
            chatHistory={[]}
            isChatting={false}
            onSendMessage={() => {}}
            onSwitchToBatch={() => {}}
            selectedModel="gemini-2.5-flash"
            onModelChange={() => {}}
            onReprocess={() => {}}
            onContinueDictation={async () => {}}
            identifiedErrors={[]}
            errorCheckStatus={'idle'}
        />
    );
};

export default LiveDictation;
