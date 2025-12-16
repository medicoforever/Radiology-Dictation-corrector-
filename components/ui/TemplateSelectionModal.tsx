import React, { useState, useEffect, useMemo } from 'react';
import { ReportTemplate } from '../../constants';
import SearchIcon from '../icons/SearchIcon';
import CloseIcon from '../icons/CloseIcon';

interface TemplateSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  templates: ReportTemplate[];
  onSelectTemplate: (template: ReportTemplate) => void;
}

const TemplateSelectionModal: React.FC<TemplateSelectionModalProps> = ({ isOpen, onClose, templates, onSelectTemplate }) => {
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  const filteredTemplates = useMemo(() => {
    if (!searchQuery) {
      return templates;
    }
    const lowercasedQuery = searchQuery.toLowerCase();
    return templates.filter(
      (template) =>
        template.name.toLowerCase().includes(lowercasedQuery) ||
        template.description.toLowerCase().includes(lowercasedQuery)
    );
  }, [searchQuery, templates]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="p-4 border-b dark:border-slate-700 flex justify-between items-center flex-shrink-0">
          <h2 id="template-modal-title" className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Select a Report Template
          </h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700" aria-label="Close template selection">
            <CloseIcon className="w-6 h-6 text-slate-600 dark:text-slate-400" />
          </button>
        </header>
        <div className="p-4 flex-shrink-0">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full p-2 pl-10 border border-slate-300 rounded-md bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600"
              aria-label="Search for report templates"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2">
              <SearchIcon className="w-5 h-5 text-slate-400" />
            </div>
          </div>
        </div>
        <div className="overflow-y-auto px-4 pb-4">
          {filteredTemplates.length > 0 ? (
            <ul className="space-y-2">
              {filteredTemplates.map((template) => (
                <li key={template.name}>
                  <button
                    onClick={() => onSelectTemplate(template)}
                    className="w-full text-left p-3 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <p className="font-semibold text-blue-800 dark:text-blue-300">{template.name}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{template.description}</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-slate-500 dark:text-slate-400 py-8">
              No templates found.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplateSelectionModal;