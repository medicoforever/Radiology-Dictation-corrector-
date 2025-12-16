
import React, { useState, useRef, useEffect } from 'react';
import SendIcon from './icons/SendIcon';
import Spinner from './ui/Spinner';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import MicIcon from './icons/MicIcon';
import TrashIcon from './icons/TrashIcon';

interface ChatMessage {
  author: 'You' | 'AI';
  text: string;
}

interface ChatInterfaceProps {
  history: ChatMessage[];
  isChatting: boolean;
  onSendMessage: (message: string | Blob) => void;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ history, isChatting, onSendMessage }) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<null | HTMLDivElement>(null);
  const { isRecording, startRecording, stopRecording, error: recorderError } = useAudioRecorder();
  const [recordingTime, setRecordingTime] = useState(0);
  const timerRef = useRef<number | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }

  useEffect(scrollToBottom, [history]);
  
  useEffect(() => {
    if (isRecording) {
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prevTime => prevTime + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecordingTime(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording]);


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isChatting) {
      onSendMessage(input.trim());
      setInput('');
    }
  };
  
  const handleStartRecording = async () => {
    if (isChatting) return;
    await startRecording();
  };
  
  const handleSendAudio = async () => {
    const audioBlob = await stopRecording();
    if (audioBlob && audioBlob.size > 0) {
      onSendMessage(audioBlob);
    }
  };
  
  const handleCancelRecording = async () => {
    await stopRecording(); // This stops and cleans up the stream
  };
  
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const isAwaitingResponse = isChatting && history.length > 0 && history[history.length - 1]?.author === 'You';

  return (
    <div className="mt-8 border-t dark:border-slate-700 pt-6">
      <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-4">Follow-up Chat</h3>
      {recorderError && <p className="text-red-500 mb-2 text-sm">{recorderError}</p>}
      <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg p-4 h-72 overflow-y-auto flex flex-col gap-4">
        {history.map((msg, index) => (
          <div key={index} className={`flex w-full ${msg.author === 'You' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-lg shadow-sm ${msg.author === 'You' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'}`}>
              <p className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</p>
            </div>
          </div>
        ))}
        {isAwaitingResponse && (
           <div className="flex justify-start">
             <div className="bg-slate-200 text-slate-800 p-3 rounded-lg shadow-sm dark:bg-slate-700 dark:text-slate-200">
                <div className="flex items-center justify-center gap-2">
                    <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-2 h-2 bg-slate-500 rounded-full animate-bounce"></div>
                </div>
             </div>
           </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="mt-4 flex gap-2 items-center">
        {isRecording ? (
            <div className="flex-grow flex items-center justify-between p-3 border rounded-lg bg-slate-100 dark:bg-slate-700 dark:border-slate-600">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                    <span className="font-mono text-sm text-slate-700 dark:text-slate-300">{formatTime(recordingTime)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleCancelRecording}
                        className="p-2 text-slate-500 hover:text-slate-700 rounded-full hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-600 transition-colors"
                        aria-label="Cancel recording"
                    >
                        <TrashIcon className="w-6 h-6" />
                    </button>
                    <button
                        type="button"
                        onClick={handleSendAudio}
                        className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center w-10 h-10 flex-shrink-0 transition-colors"
                        aria-label="Send audio message"
                    >
                        <SendIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>
        ) : (
            <>
                <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask a follow-up question..."
                    aria-label="Chat input"
                    className="flex-grow p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow dark:bg-slate-700 dark:border-slate-600 dark:text-white dark:placeholder-slate-400"
                    disabled={isChatting}
                />
                {input.trim() === '' ? (
                     <button 
                        type="button"
                        onClick={handleStartRecording}
                        disabled={isChatting} 
                        className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center w-12 h-12 flex-shrink-0 transition-colors"
                        aria-label="Record audio message"
                    >
                        <MicIcon className="w-6 h-6" />
                    </button>
                ) : (
                    <button 
                        type="submit" 
                        disabled={isChatting || !input.trim()} 
                        className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center w-12 h-12 flex-shrink-0 transition-colors"
                        aria-label="Send chat message"
                    >
                        {isChatting ? <Spinner className="h-6 w-6 text-white" /> : <SendIcon />}
                    </button>
                )}
            </>
        )}
      </form>
    </div>
  );
};

export default ChatInterface;