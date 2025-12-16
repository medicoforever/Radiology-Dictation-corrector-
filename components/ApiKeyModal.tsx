
import React, { useState, useEffect } from 'react';

interface ApiKeyModalProps {
  onSave: (apiKey: string) => void;
  isOpen: boolean;
  onClose?: () => void;
  canClose: boolean;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave, isOpen, onClose, canClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');

  // Pre-fill if exists in localStorage, so user can edit easily
  useEffect(() => {
    if (isOpen) {
      const storedKey = localStorage.getItem('gemini_api_key');
      if (storedKey) setApiKey(storedKey);
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) {
      setError('API Key is required.');
      return;
    }
    localStorage.setItem('gemini_api_key', apiKey.trim());
    onSave(apiKey.trim());
    setError('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-4">Enter Gemini API Key</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6 text-sm">
          To use this application, you need to provide your own Google Gemini API Key. It will be stored securely in your browser's local storage and used for all requests.
        </p>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              API Key
            </label>
            <input
              type="password"
              id="api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full p-2 border border-slate-300 rounded-md bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-700 dark:text-white dark:border-slate-600"
              placeholder="AIza..."
            />
            {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
          </div>
          
          <div className="flex justify-end gap-3 pt-2">
            {canClose && onClose && (
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-200 rounded-lg hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                    Cancel
                </button>
            )}
            <button
              type="submit"
              className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800 transition-colors"
            >
              Save Key
            </button>
          </div>
        </form>
        
        <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-700 text-center">
            <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
                Get a free API Key from Google AI Studio
            </a>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;
