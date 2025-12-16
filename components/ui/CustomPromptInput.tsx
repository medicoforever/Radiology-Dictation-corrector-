import React, { useState } from 'react';
import ChevronDownIcon from '../icons/ChevronDownIcon';
import SparklesIcon from '../icons/SparklesIcon';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { transcribeAudioForPrompt } from '../../services/geminiService';
import MicIcon from '../icons/MicIcon';
import StopIcon from '../icons/StopIcon';
import Spinner from './Spinner';
import TemplateSelectionModal from './TemplateSelectionModal';
import { REPORT_TEMPLATES, ReportTemplate } from '../../constants';

const CustomPromptInput: React.FC<{
  prompt: string;
  onPromptChange: (prompt: string) => void;
  className?: string;
}> = ({ prompt, onPromptChange, className }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isRecording, startRecording, stopRecording, error: recorderError } = useAudioRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  const handleMicClick = async () => {
    setTranscriptionError(null);
    if (isRecording) {
      // Stop recording and transcribe
      setIsTranscribing(true);
      try {
        const audioBlob = await stopRecording();
        if (audioBlob && audioBlob.size > 0) {
          const transcript = await transcribeAudioForPrompt(audioBlob);
          // Append the new transcript to the existing prompt
          const newPrompt = prompt ? `${prompt} ${transcript}` : transcript;
          onPromptChange(newPrompt);
        }
      } catch (err) {
        setTranscriptionError(err instanceof Error ? err.message : 'An unknown error occurred during transcription.');
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Start recording
      await startRecording();
    }
  };

  const handleSelectTemplate = (template: ReportTemplate) => {
    onPromptChange(`Use the normal ${template.name} report template. Integrate my dictation and generate a new impression.`);
    setIsModalOpen(false);
  };

  return (
    <div className={`w-full ${className}`}>
      <TemplateSelectionModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        templates={REPORT_TEMPLATES}
        onSelectTemplate={handleSelectTemplate}
      />
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-2 rounded-md bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
        aria-expanded={isOpen}
        aria-controls="custom-prompt-container"
      >
        <div className="flex items-center gap-2">
            <SparklesIcon className="w-5 h-5 text-yellow-500" />
            <span className="font-semibold text-slate-700 dark:text-slate-200">Custom Instructions</span>
        </div>
        <ChevronDownIcon className={`w-6 h-6 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
        <div id="custom-prompt-container" className="mt-2">
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value)}
              placeholder="e.g., 'Always use metric units.' or 'Format findings for a chest CT report.'"
              className="w-full p-2 pr-12 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600 dark:placeholder-slate-400"
              rows={3}
              aria-label="Custom instructions for the AI model"
            />
            <button
              onClick={handleMicClick}
              disabled={isTranscribing}
              className={`absolute bottom-2 right-2 p-1.5 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
              aria-label={isRecording ? 'Stop dictating' : 'Dictate custom instructions'}
            >
              {isTranscribing ? (
                <Spinner className="w-5 h-5 text-white" />
              ) : isRecording ? (
                <StopIcon className="w-5 h-5" />
              ) : (
                <MicIcon className="w-5 h-5" />
              )}
            </button>
          </div>
          {(recorderError || transcriptionError) && (
            <p className="text-xs text-red-500 mt-1">
              {recorderError || transcriptionError}
            </p>
          )}
           <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                    Or, start with a normal report template:
                </p>
                <div className="flex flex-wrap gap-2">
                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="text-sm font-medium py-1.5 px-4 rounded-lg bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80"
                    >
                        Select Template...
                    </button>
                </div>
            </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
            These instructions customize the AI's response. Selecting a template will replace any text above.
          </p>
        </div>
      )}
    </div>
  );
};

export default CustomPromptInput;