import React, { useState, useEffect, useRef } from 'react';
import ChatInterface from './ChatInterface';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { continueAudioDictation, modifyFindingWithAudio, modifyReportWithAudio, runComplexImpressionGeneration, transcribeAudioForPrompt, processMedia } from '../services/geminiService';
import Spinner from './ui/Spinner';
import PencilIcon from './icons/PencilIcon';
import MicPlusIcon from './icons/MicPlusIcon';
import StopIcon from './icons/StopIcon';
import { generateSingleDictationHTML } from '../services/htmlGenerator';
import SelectionCopier from './ui/SelectionCopier';
import MicPencilIcon from './icons/MicPencilIcon';
import MicScribbleIcon from './icons/MicScribbleIcon';
import ReorderIcon from './icons/ReorderIcon';
import MergeIcon from './icons/MergeIcon';
import CustomPromptInput from './ui/CustomPromptInput';
import { IdentifiedError } from '../types';
import WarningIcon from './icons/WarningIcon';
import BrainIcon from './icons/BrainIcon';
import MicIcon from './icons/MicIcon';
import DownloadIcon from './icons/DownloadIcon';


interface ChatMessage {
  author: 'You' | 'AI';
  text: string;
}

interface ResultsDisplayProps {
  findings: string[];
  onReset: () => void;
  audioBlob: Blob | null;
  chatHistory: ChatMessage[];
  isChatting: boolean;
  onSendMessage: (message: string | Blob) => void;
  onSwitchToBatch: () => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  onReprocess: () => void;
  onUpdateFinding: (index: number, newText: string) => void;
  onAllFindingsUpdate: (findings: string[]) => void;
  onContinueDictation: (audioBlob: Blob) => Promise<void>;
  customPrompt: string;
  onCustomPromptChange: (prompt: string) => void;
  isLive?: boolean;
  onStopLive?: () => void;
  liveStatus?: string;
  liveError?: string | null;
  onPauseLive?: () => void;
  onResumeLive?: () => void;
  identifiedErrors?: IdentifiedError[];
  errorCheckStatus?: 'idle' | 'checking' | 'complete';
}

const parseStructuredFinding = (finding: string) => {
  const parts = finding.split('###');
  if (parts.length > 1 && parts[0].trim() !== '') {
    return {
      isStructured: true,
      title: parts[0],
      points: parts.slice(1).filter(p => p.trim() !== ''),
    };
  }
  return {
    isStructured: false,
    title: finding,
    points: [],
  };
};


declare const ClipboardItem: any;

const ResultsDisplay: React.FC<ResultsDisplayProps> = ({ 
  findings, 
  onReset, 
  audioBlob, 
  chatHistory, 
  isChatting, 
  onSendMessage, 
  onSwitchToBatch,
  selectedModel,
  onModelChange,
  onReprocess,
  onUpdateFinding,
  onAllFindingsUpdate,
  onContinueDictation,
  customPrompt,
  onCustomPromptChange,
  isLive = false,
  onStopLive,
  liveStatus,
  liveError,
  onPauseLive,
  onResumeLive,
  identifiedErrors = [],
  errorCheckStatus = 'idle'
}) => {
  const [isAllCopied, setIsAllCopied] = useState<boolean>(false);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set<number>());
  const [copyNotification, setCopyNotification] = useState<{ text: string; visible: boolean }>({ text: '', visible: false });
  const [multiSelectMode, setMultiSelectMode] = useState<boolean>(false);

  // State for Edit Mode
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [dictatingIndex, setDictatingIndex] = useState<number | null>(null);
  const [dictateEditingIndex, setDictateEditingIndex] = useState<number | null>(null);
  const [processingIndex, setProcessingIndex] = useState<number | null>(null);
  const [continuationError, setContinuationError] = useState<{ index: number; message: string } | null>(null);
  const appendRecorder = useAudioRecorder();
  const modifyRecorder = useAudioRecorder();
  const { startRecording: startAppendingRecording, stopRecording: stopAppendingRecording, error: appendRecorderError } = appendRecorder;
  const { startRecording: startModifyRecording, stopRecording: stopModifyRecording, error: modifyRecorderError } = modifyRecorder;

  // State for 'Continue Dictation' feature
  const continuationRecorder = useAudioRecorder();
  const { startRecording: startContinuingRecording, stopRecording: stopContinuingRecording, error: continueRecorderError } = continuationRecorder;
  const [continuationState, setContinuationState] = useState<{ status: 'idle' | 'recording' | 'processing'; error: string | null }>({ status: 'idle', error: null });

  // State for 'Dictate Report Changes' feature
  const [modificationState, setModificationState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [modificationError, setModificationError] = useState<string | null>(null);
  const modificationRecorder = useAudioRecorder();

  // State for 'Complex Impression Generation' feature
  const [isComplexGeneratorVisible, setIsComplexGeneratorVisible] = useState(false);
  const [complexInput, setComplexInput] = useState('');
  const [agenticStatus, setAgenticStatus] = useState<'idle' | 'processing' | 'error'>('idle');
  const [agenticError, setAgenticError] = useState<string | null>(null);
  const complexInputRecorder = useAudioRecorder();
  const [expertNotes, setExpertNotes] = useState<string | null>(null);
  // FIX: Add state to handle transcription loading state for the complex impression mic.
  const [isTranscribingComplex, setIsTranscribingComplex] = useState(false);


  // State for selection copier
  const [selectionSnippets, setSelectionSnippets] = useState<Record<number, string>>({});
  const [copier, setCopier] = useState<{ visible: boolean; x: number; y: number; text: string } | null>(null);
  const findingsContainerRef = useRef<HTMLDivElement>(null);

  // State for Drag and Drop
  const [reorderMode, setReorderMode] = useState<boolean>(false);
  const [mergeMode, setMergeMode] = useState<boolean>(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [undoState, setUndoState] = useState<string[] | null>(null);
  const [isMakingSelection, setIsMakingSelection] = useState<boolean>(false);


  useEffect(() => {
    const container = findingsContainerRef.current;
    if (!container) return;

    const handleMouseDown = () => {
      setIsMakingSelection(true);
    };

    const handleMouseUp = () => {
      setIsMakingSelection(false);
    };

    container.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      if (container) {
          container.removeEventListener('mousedown', handleMouseDown);
      }
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (appendRecorderError && dictatingIndex !== null) {
      setContinuationError({ index: dictatingIndex, message: appendRecorderError });
      setDictatingIndex(null);
    }
  }, [appendRecorderError, dictatingIndex]);

  useEffect(() => {
    if (modifyRecorderError && dictateEditingIndex !== null) {
      setContinuationError({ index: dictateEditingIndex, message: modifyRecorderError });
      setDictateEditingIndex(null);
    }
  }, [modifyRecorderError, dictateEditingIndex]);

  useEffect(() => {
    if (continueRecorderError) {
      setContinuationState({ status: 'idle', error: continueRecorderError });
    }
  }, [continueRecorderError]);

  useEffect(() => {
    if (modificationRecorder.error) {
      setModificationError(modificationRecorder.error);
      setModificationState('idle');
    }
  }, [modificationRecorder.error]);

  useEffect(() => {
    if (complexInputRecorder.error) {
        setAgenticError(complexInputRecorder.error);
    }
  }, [complexInputRecorder.error]);


  useEffect(() => {
    const handleMouseUp = (event: MouseEvent) => {
      // Small timeout to let click events fire first
      setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
          if (!multiSelectMode) setCopier(null);
          return;
        }
        
        const selectedText = selection.toString().trim();
        if (selectedText.length === 0) {
          if (!multiSelectMode) setCopier(null);
          return;
        }

        const range = selection.getRangeAt(0);
        let parentElement = range.commonAncestorContainer;
        if (parentElement.nodeType === Node.TEXT_NODE) {
          parentElement = parentElement.parentElement!;
        }
        
        const findingItem = (parentElement as HTMLElement).closest('.finding-item');
        
        if (findingItem && findingItem.contains(parentElement)) {
          const indexStr = findingItem.getAttribute('data-finding-index');
          if (indexStr) {
            const index = parseInt(indexStr, 10);

            if (multiSelectMode) {
              setSelectionSnippets(prev => ({ ...prev, [index]: selectedText }));
            } else {
              setCopier({
                visible: true,
                x: event.clientX,
                y: event.clientY,
                text: selectedText,
              });
            }
          }
        } else {
          if (!multiSelectMode) setCopier(null);
        }
      }, 10);
    };

    const container = findingsContainerRef.current;
    container?.addEventListener('mouseup', handleMouseUp as EventListener);
    
    return () => {
      container?.removeEventListener('mouseup', handleMouseUp as EventListener);
    };
  }, [multiSelectMode]);


  const showNotification = (text: string) => {
    setCopyNotification({ text, visible: true });
    setTimeout(() => setCopyNotification({ text: '', visible: false }), 2000);
  };
  
  const copyToClipboard = async (plainText: string, htmlText: string) => {
    try {
      const htmlBlob = new Blob([htmlText], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      // The type definition for ClipboardItem is not standard in all environments, so we use `any`
      const clipboardItem = new (window as any).ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob,
      });
      await navigator.clipboard.write([clipboardItem]);
      return true;
    } catch (err) {
      console.error('Failed to copy rich text, falling back to plain text: ', err);
      try {
        await navigator.clipboard.writeText(plainText);
        return true;
      } catch (fallbackErr) {
        console.error('Failed to copy text with fallback: ', fallbackErr);
        return false;
      }
    }
  };

  const copySelection = async (indices: Set<number>) => {
    if (indices.size === 0) {
      showNotification('Selection cleared.');
      return;
    }

    const sortedIndices = Array.from(indices).sort((a, b) => a - b);
    
    const { plain, html } = sortedIndices.reduce((acc, i) => {
      const snippet = selectionSnippets[i];
      if (snippet) {
        acc.plain.push(snippet);
        acc.html.push(`<strong>${snippet}</strong>`);
      } else {
        const finding = findings[i];
        const isBold = finding.startsWith('BOLD::');
        const cleanFinding = isBold ? finding.substring(6) : finding;
        const isTitle = cleanFinding.trim() === 'C.T.SCAN OF BRAIN (PLAIN)';
        const { isStructured, title, points } = parseStructuredFinding(cleanFinding);
        const isImpression = isStructured && title.trim().toUpperCase() === 'IMPRESSION:';
        const isItalic = !isStructured && cleanFinding.startsWith('*') && cleanFinding.endsWith('*');

        if (isTitle) {
          acc.plain.push(cleanFinding);
          acc.html.push(`<p style="text-align:center;"><strong><u>${cleanFinding}</u></strong></p>`);
        } else if (isImpression) {
            acc.plain.push(`${title.toUpperCase()}\n${points.map(p => `• ${p}`).join('\n')}`);
            acc.html.push(`<p><strong style="text-decoration: underline;">${title.toUpperCase()}</strong></p><ul>${points.map(p => `<li><strong>${p}</strong></li>`).join('')}</ul>`);
        } else if (isStructured) {
          acc.plain.push([title, ...points].join('\n'));
          let htmlContent = isBold ? `<p><strong>${title}</strong></p>` : `<p>${title}</p>`;
          htmlContent += points.map(p => isBold ? `<p><strong>${p}</strong></p>` : `<p>${p}</p>`).join('');
          acc.html.push(htmlContent);
        } else {
          if (isItalic) {
              acc.plain.push(cleanFinding.slice(1, -1));
              acc.html.push(`<p><em>${cleanFinding.slice(1, -1)}</em></p>`);
          } else {
              acc.plain.push(cleanFinding);
              acc.html.push(isBold ? `<p><strong>${cleanFinding}</strong></p>` : `<p>${cleanFinding}</p>`);
          }
        }
      }
      return acc;
    }, { plain: [] as string[], html: [] as string[] });

    const plainText = plain.join('\n');
    const htmlText = html.join('');

    const success = await copyToClipboard(plainText, htmlText);
    const notificationText = success
      ? `Copied ${plain.length} finding${plain.length > 1 ? 's' : ''}!`
      : 'Copy failed!';
    showNotification(notificationText);
  };
  
  const handleMultiSelectToggle = (index: number) => {
    // Check if we are *entering* multi-select mode with a fresh text selection
    if (!multiSelectMode) {
      setMultiSelectMode(true);
      setCopier(null); // Hide copier when entering multi-select
      
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();
      
      if (selection && selectedText && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const startNode = range.startContainer;
        const parentFindingItem = (startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode as HTMLElement)?.closest('.finding-item');
        
        if (parentFindingItem) {
            const selectedIndexStr = parentFindingItem.getAttribute('data-finding-index');
            if (selectedIndexStr) {
                const selectedIndex = parseInt(selectedIndexStr, 10);
                // If the current selection is on the item we are toggling, save the snippet.
                if (selectedIndex === index) {
                    setSelectionSnippets(prev => ({ ...prev, [index]: selectedText }));
                }
            }
        }
      }
    }

    // FIX: Added explicit number generic to new Set
    const newSelectedIndices = new Set<number>(selectedIndices);
    if (newSelectedIndices.has(index)) {
      newSelectedIndices.delete(index);
      // Remove snippet if deselecting
      setSelectionSnippets(prev => {
        const newSnippets = {...prev};
        delete newSnippets[index];
        return newSnippets;
      });
    } else {
      newSelectedIndices.add(index);
    }
    setSelectedIndices(newSelectedIndices);
    copySelection(newSelectedIndices);
  };
  
  const handleFindingClick = async (index: number) => {
    // Prevent single-copy if user is selecting text
    if (window.getSelection()?.toString().length) {
      return;
    }

    if (multiSelectMode) {
      handleMultiSelectToggle(index);
      return;
    }
    
    // Single-copy logic
    const findingToCopy = findings[index];
    const isBold = findingToCopy.startsWith('BOLD::');
    const cleanFinding = isBold ? findingToCopy.substring(6) : findingToCopy;
    const isTitle = cleanFinding.trim() === 'C.T.SCAN OF BRAIN (PLAIN)';
    const { isStructured, title, points } = parseStructuredFinding(cleanFinding);
    const isImpression = isStructured && title.trim().toUpperCase() === 'IMPRESSION:';
    const isItalic = !isStructured && cleanFinding.startsWith('*') && cleanFinding.endsWith('*');

    let plainText: string;
    let htmlText: string;

    if (isTitle) {
      plainText = cleanFinding;
      htmlText = `<p style="text-align:center;"><strong><u>${cleanFinding}</u></strong></p>`;
    } else if (isImpression) {
        plainText = `${title.toUpperCase()}\n${points.map(p => `• ${p}`).join('\n')}`;
        htmlText = `<p><strong style="text-decoration: underline;">${title.toUpperCase()}</strong></p><ul>${points.map(p => `<li><strong>${p}</strong></li>`).join('')}</ul>`;
    } else if (isStructured) {
        plainText = [title, ...points].join('\n');
        let htmlContent = isBold ? `<p><strong>${title}</strong></p>` : `<p>${title}</p>`;
        htmlContent += points.map(p => isBold ? `<p><strong>${p}</strong></p>` : `<p>${p}</p>`).join('');
        htmlText = htmlContent;
    } else {
        if (isItalic) {
            plainText = cleanFinding.slice(1, -1);
            htmlText = `<p><em>${plainText}</em></p>`;
        } else {
            plainText = cleanFinding;
            htmlText = isBold ? `<p><strong>${cleanFinding}</strong></p>` : `<p>${cleanFinding}</p>`;
        }
    }
    
    const success = await copyToClipboard(plainText, htmlText);
    
    if(success) {
      // Briefly highlight the copied item
      setSelectedIndices(new Set<number>([index]));
      // Explicitly type the new Set to be Set<number> to match the state type.
      // FIX: Explicitly type new Set() as Set<number> to match state type.
      setTimeout(() => setSelectedIndices(new Set<number>()), 500);
      showNotification('Copied!');
    } else {
      showNotification('Copy failed!');
    }
  };

  const handleSelectionHandleClick = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    handleMultiSelectToggle(index);
  };


  const handleCopyAll = async () => {
    if (!findings || findings.length === 0) return;
    
    const allTextPlain = findings.map(f => {
      const isBold = f.startsWith('BOLD::');
      const cleanFinding = isBold ? f.substring(6) : f;
      const { isStructured, title, points } = parseStructuredFinding(cleanFinding);
      const isImpression = isStructured && title.trim().toUpperCase() === 'IMPRESSION:';

      if (isImpression) {
          return `${title.toUpperCase()}\n${points.map(p => `• ${p}`).join('\n')}`;
      }
      if (isStructured) {
        return [title, ...points].join('\n');
      }
      if (cleanFinding.startsWith('*') && cleanFinding.endsWith('*')) {
        return cleanFinding.slice(1, -1);
      }
      return cleanFinding;
    }).join('\n\n');

    const allTextHtml = findings.map(f => {
      const isBold = f.startsWith('BOLD::');
      const cleanFinding = isBold ? f.substring(6) : f;
      const isTitle = cleanFinding.trim() === 'C.T.SCAN OF BRAIN (PLAIN)';
      const { isStructured, title, points } = parseStructuredFinding(cleanFinding);
      const isImpression = isStructured && title.trim().toUpperCase() === 'IMPRESSION:';
      
      if (isTitle) {
          return `<p style="text-align:center;"><strong><u>${cleanFinding}</u></strong></p>`;
      }
      if (isImpression) {
          return `<p><strong style="text-decoration: underline;">${title.toUpperCase()}</strong></p><ul>${points.map(p => `<li><strong>${p}</strong></li>`).join('')}</ul>`;
      }
      if (isStructured) {
        let htmlContent = isBold ? `<p><strong>${title}</strong></p>` : `<p>${title}</p>`;
        htmlContent += points.map(p => isBold ? `<p><strong>${p}</strong></p>` : `<p>${p}</p>`).join('');
        return htmlContent;
      }
      if (cleanFinding.startsWith('*') && cleanFinding.endsWith('*')) {
        return `<p><em>${cleanFinding.slice(1, -1)}</em></p>`;
      }
      return isBold ? `<p><strong>${cleanFinding}</strong></p>` : `<p>${cleanFinding}</p>`;
    }).join('');


    const success = await copyToClipboard(allTextPlain, allTextHtml);
    if (success) {
        setIsAllCopied(true);
        setTimeout(() => setIsAllCopied(false), 2000);
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
  
  const handleRecordNew = () => {
    setExpertNotes(null);
    onReset();
  }

  const handleDownloadHTML = () => {
    if (!findings || findings.length === 0) return;
    try {
      const htmlContent = generateSingleDictationHTML(findings);
      const blob = new Blob([htmlContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      a.href = url;
      a.download = 'radiology-report.html';
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (err) {
      console.error('Failed to generate or download HTML:', err);
      showNotification('Failed to create HTML file.');
    }
  };

  // --- Edit Mode Handlers ---
  const handleStartEdit = (index: number) => {
    setUndoState(null);
    setEditingIndex(index);

    const findingToEdit = findings[index];
    const isBold = findingToEdit.startsWith('BOLD::');
    const cleanFinding = isBold ? findingToEdit.substring(6) : findingToEdit;
    
    const { isStructured, title, points } = parseStructuredFinding(cleanFinding);
    const textForEditing = isStructured ? [title, ...points].join('\n') : cleanFinding;
    
    setEditingText(textForEditing);
    setDictatingIndex(null);
    setDictateEditingIndex(null);
    setProcessingIndex(null);
    setContinuationError(null);
    // Explicitly type the new Set to be Set<number> to match the state type.
    // FIX: Explicitly type new Set() as Set<number> to match state type.
    setSelectedIndices(new Set<number>());
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditingText('');
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null) {
      setUndoState(findings);
      const originalFinding = findings[editingIndex];
      const isBold = originalFinding.startsWith('BOLD::');
      const { isStructured } = parseStructuredFinding(originalFinding);

      let newText = editingText;
      if (isStructured) {
        newText = editingText.split('\n').filter(line => line.trim() !== '').join('###');
      }
      
      if(isBold) {
        newText = `BOLD::${newText}`;
      }
      
      onUpdateFinding(editingIndex, newText);
    }
    handleCancelEdit();
  };

  const handleStartDictation = async (index: number) => {
    setUndoState(null);
    if (isLive) onPauseLive?.();
    setEditingIndex(null);
    setDictateEditingIndex(null);
    setProcessingIndex(null);
    setContinuationError(null);
    // Explicitly type the new Set to be Set<number> to match the state type.
    // FIX: Explicitly type new Set() as Set<number> to match state type.
    setSelectedIndices(new Set<number>());
    setDictatingIndex(index);
    await startAppendingRecording();
  };

  const handleStopDictation = async () => {
    if (dictatingIndex === null) return;

    const audioBlob = await stopAppendingRecording();
    const currentIndex = dictatingIndex;
    setDictatingIndex(null);

    if (audioBlob && audioBlob.size > 0) {
      setProcessingIndex(currentIndex);
      setUndoState(findings);
      try {
        const existingText = findings[currentIndex];
        const newText = await continueAudioDictation(existingText, audioBlob, customPrompt);
        const separator = existingText.trim().length > 0 && !existingText.endsWith(' ') ? ' ' : '';
        const updatedText = existingText + separator + newText.trim();
        onUpdateFinding(currentIndex, updatedText);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unknown error occurred.';
        setContinuationError({ index: currentIndex, message });
      } finally {
        setProcessingIndex(null);
      }
    }
    if (isLive) onResumeLive?.();
  };

  const handleStartDictateEdit = async (index: number) => {
    setUndoState(null);
    if (isLive) onPauseLive?.();
    setEditingIndex(null);
    setDictatingIndex(null);
    setProcessingIndex(null);
    setContinuationError(null);
    // Explicitly type the new Set to be Set<number> to match the state type.
    // FIX: Explicitly type new Set() as Set<number> to match state type.
    setSelectedIndices(new Set<number>());
    setDictateEditingIndex(index);
    await startModifyRecording();
  };

  const handleStopDictateEdit = async () => {
    if (dictateEditingIndex === null) return;

    const audioBlob = await stopModifyRecording();
    const currentIndex = dictateEditingIndex;
    setDictateEditingIndex(null);

    if (audioBlob && audioBlob.size > 0) {
        setProcessingIndex(currentIndex);
        setUndoState(findings);
        try {
            const existingText = findings[currentIndex];
            const modifiedText = await modifyFindingWithAudio(existingText, audioBlob, customPrompt);
            onUpdateFinding(currentIndex, modifiedText);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred.';
            setContinuationError({ index: currentIndex, message });
        } finally {
            setProcessingIndex(null);
        }
    }
    if (isLive) onResumeLive?.();
  };

  const handleStartContinue = async () => {
    setUndoState(null);
    setContinuationState({ status: 'recording', error: null });
    await startContinuingRecording();
  };

  const handleStopContinue = async () => {
      const audioBlob = await stopContinuingRecording();
      if (audioBlob && audioBlob.size > 0) {
          setContinuationState({ status: 'processing', error: null });
          try {
              setUndoState(findings);
              await onContinueDictation(audioBlob);
              setContinuationState({ status: 'idle', error: null });
          } catch (err) {
              const message = err instanceof Error ? err.message : 'An unknown error occurred.';
              setContinuationState({ status: 'idle', error: message });
          }
      } else {
          setContinuationState({ status: 'idle', error: null });
      }
  };
  
  const handleCopyFromCopier = async (text: string) => {
    const success = await copyToClipboard(text, `<strong>${text}</strong>`);
    showNotification(success ? 'Copied selection!' : 'Copy failed!');
    setCopier(null);
  };

  const handleStartModification = async () => {
    setUndoState(null);
    if (isLive) onPauseLive?.();
    setModificationError(null);
    setModificationState('recording');
    await modificationRecorder.startRecording();
  };

  const handleStopModification = async () => {
      const audioBlob = await modificationRecorder.stopRecording();
      if (audioBlob && audioBlob.size > 0) {
          setModificationState('processing');
          try {
              setUndoState(findings);
              const newFindings = await modifyReportWithAudio(findings, audioBlob, selectedModel, customPrompt);
              onAllFindingsUpdate(newFindings);
              setModificationState('idle');
          } catch (err) {
              const message = err instanceof Error ? err.message : 'An unknown error occurred.';
              setModificationError(message);
              setModificationState('idle');
          }
      } else {
          setModificationState('idle');
      }
      if (isLive) onResumeLive?.();
  };

  // --- Complex Impression Handlers ---
    const handleComplexMicClick = async () => {
        setAgenticError(null);
        if (complexInputRecorder.isRecording) {
            setIsTranscribingComplex(true);
            try {
                const audioBlob = await complexInputRecorder.stopRecording();
                if (audioBlob && audioBlob.size > 0) {
                    const transcript = await transcribeAudioForPrompt(audioBlob);
                    setComplexInput(prev => prev ? `${prev} ${transcript}` : transcript);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'An unknown error occurred during transcription.';
                setAgenticError(message);
            } finally {
                setIsTranscribingComplex(false);
            }
        } else {
            await complexInputRecorder.startRecording();
        }
    };

    const handleGenerateComplexImpression = async () => {
        setAgenticStatus('processing');
        setAgenticError(null);
        setExpertNotes(null); // Clear previous notes
        try {
            setUndoState(findings);
            const result = await runComplexImpressionGeneration(findings, complexInput);
            onAllFindingsUpdate(result.findings);
            setExpertNotes(result.expertNotes); // Set new notes
            setIsComplexGeneratorVisible(false);
            setComplexInput('');
            setAgenticStatus('idle');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unknown error occurred.';
            setAgenticError(`Failed to generate impression: ${message}`);
            setAgenticStatus('error');
        }
    };

    const handleDownloadExpertNotes = () => {
        if (!expertNotes) return;
        
        // Simple markdown to HTML conversion for Word-compatible file
        let htmlContent = expertNotes
          .replace(/^## (.*$)/gim, '<h2>$1</h2>')
          .replace(/^### (.*$)/gim, '<h3>$1</h3>')
          .replace(/\n/g, '<br />');
    
        const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' "+
                   "xmlns:w='urn:schemas-microsoft-com:office:word' "+
                   "xmlns='http://www.w3.org/TR/REC-html40'>"+
                   "<head><meta charset='utf-8'><title>Expert Notes</title></head><body>";
        const footer = "</body></html>";
        const source = header + htmlContent + footer;
    
        const fileBlob = new Blob([source], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        // FIX: Fixed variable name from blob to fileBlob
        const url = URL.createObjectURL(fileBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'expert-notes.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

  // --- Drag and Drop Handlers ---
  const handleToggleReorderMode = () => {
    setUndoState(null);
    setReorderMode(prev => !prev);
    setMergeMode(false);
  };
  const handleToggleMergeMode = () => {
    setUndoState(null);
    setMergeMode(prev => !prev);
    setReorderMode(false);
  };

  // Reorder
  const handleReorderDragStart = (index: number) => {
    dragItem.current = index;
    setDraggedIndex(index);
  };
  const handleReorderDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null && dragItem.current !== dragOverItem.current) {
        setUndoState(findings);
        let newFindings = [...findings];
        const draggedItemContent = newFindings.splice(dragItem.current, 1)[0];
        newFindings.splice(dragOverItem.current, 0, draggedItemContent);
        onAllFindingsUpdate(newFindings);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDraggedIndex(null);
  };

  // Merge
  const handleMergeDragStart = (e: React.DragEvent, index: number) => {
      e.dataTransfer.setData("sourceIndex", index.toString());
      setDraggedIndex(index);
  };
  const handleMergeDrop = (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      const sourceIndexStr = e.dataTransfer.getData("sourceIndex");
      if (sourceIndexStr === null) return;
      const sourceIndex = parseInt(sourceIndexStr, 10);

      if (sourceIndex === targetIndex) {
          setDragOverIndex(null);
          setDraggedIndex(null);
          return;
      }
      
      // Store pre-merge state for undo
      setUndoState(findings);

      const sourceFinding = findings[sourceIndex];
      const targetFinding = findings[targetIndex];
      
      const mergedText = targetFinding + ' ' + sourceFinding;
      
      const newFindings = findings
          .map((finding, index) => index === targetIndex ? mergedText : finding)
          .filter((_, index) => index !== sourceIndex);
          
      onAllFindingsUpdate(newFindings);
      
      setDragOverIndex(null);
      setDraggedIndex(null);
  };
  
  const handleUndo = () => {
    if (undoState) {
      onAllFindingsUpdate(undoState);
      setUndoState(null); // Can only undo once.
    }
  };

  const ErrorLegend = () => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mb-4 p-2 rounded-md bg-slate-100 dark:bg-slate-700/50">
      <strong>Error Key:</strong>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
        <span>Potential Error</span>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="w-3 h-3 rounded-full bg-sky-500"></div>
        <span>Clarification</span>
      </div>
    </div>
  );


  return (
    <div className="p-4">
      {multiSelectMode && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-slate-800 text-white rounded-full shadow-lg flex items-center gap-4 px-5 py-2 transition-all duration-300 ease-in-out">
            <p className="text-sm font-semibold">Multi-select Mode</p>
            <label htmlFor="multi-select-toggle-single" className="flex items-center cursor-pointer">
              <span className="mr-2 text-sm font-medium text-slate-300">OFF</span>
              <div className="relative">
                <input 
                  type="checkbox" 
                  id="multi-select-toggle-single" 
                  className="sr-only peer" 
                  checked={multiSelectMode}
                  onChange={() => {
                    setMultiSelectMode(false);
                    // Explicitly type the new Set to be Set<number> to match the state type.
                    // FIX: Explicitly type new Set() as Set<number> to match state type.
                    setSelectedIndices(new Set<number>());
                    setSelectionSnippets({});
                  }}
                />
                <div className="w-12 h-6 bg-slate-600 rounded-full peer-checked:bg-blue-600"></div>
                <div className="absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-6"></div>
              </div>
              <span className="ml-2 text-sm font-medium">ON</span>
            </label>
          </div>
        )}
      {copier && copier.visible && (
        <SelectionCopier 
          x={copier.x}
          y={copier.y}
          textToCopy={copier.text}
          onCopy={handleCopyFromCopier}
          onClose={() => setCopier(null)}
        />
      )}
      {copyNotification.visible && (
        <div className="fixed bottom-4 right-4 bg-slate-800 text-white text-sm font-bold py-2 px-4 rounded-lg shadow-lg z-50 transition-all duration-300 ease-in-out" role="alert">
          {copyNotification.text}
        </div>
      )}

      {isLive && (
        <div className="flex items-center gap-3 justify-center mb-6 p-3 bg-red-50 text-red-700 rounded-lg shadow-sm border border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-500/30">
            <div className="w-3 h-3 bg-red-500 rounded-full animate-ping flex-shrink-0"></div>
            <p className="font-semibold text-center text-sm">
                {liveError ? liveError : liveStatus || 'Live Dictation in Progress'}
            </p>
        </div>
      )}

      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Corrected Findings</h2>
            {errorCheckStatus === 'checking' && (
                <div className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
                    <Spinner className="w-4 h-4" />
                    <span>Checking for errors...</span>
                </div>
            )}
        </div>
      </div>

      {errorCheckStatus === 'complete' && identifiedErrors.length > 0 && <ErrorLegend />}

      {!isLive && audioBlob && (
        <div className="bg-slate-100 dark:bg-slate-900/50 p-3 rounded-lg mb-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label htmlFor="model-select-reprocess" className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">Process again with:</label>
            <select 
                id="model-select-reprocess"
                value={selectedModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="bg-white border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 w-full dark:bg-slate-700 dark:border-slate-600 dark:text-white"
                aria-label="Select AI model for reprocessing"
            >
                <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="gemini-robotics-er-1.5-preview">Gemini Robotics ER 1.5 Preview</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
            </select>
          </div>
          <button
              onClick={() => {
                setExpertNotes(null);
                setUndoState(findings);
                onReprocess();
              }}
              className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors w-full sm:w-auto flex-shrink-0"
            >
              Update Transcript
            </button>
        </div>
      )}

       <CustomPromptInput
          prompt={customPrompt}
          onPromptChange={onCustomPromptChange}
          className="mb-6"
        />

      {!isLive && <p className="text-slate-600 dark:text-slate-400 mb-6">Click any finding to copy it. To select multiple findings, click the circle on the left of each item. Use the 'Continue Dictation' button at the bottom to add more findings to this report.</p>}
      <div className="text-sm text-slate-500 dark:text-slate-400 mb-6 p-3 bg-slate-100 dark:bg-slate-700/50 rounded-lg flex flex-col sm:flex-row gap-4 items-center">
        <div className="flex items-center gap-2">
            <MicPlusIcon className="w-5 h-5 flex-shrink-0" />
            <span>Use this to <strong>append</strong> new dictation to the end of a finding.</span>
        </div>
        <div className="flex items-center gap-2">
            <MicPencilIcon className="w-5 h-5 flex-shrink-0" />
            <span>Use this to <strong>dictate changes</strong> or corrections to an existing finding.</span>
        </div>
      </div>
      {findings.length > 0 && (
        <div className="flex justify-end items-center gap-2 mb-4">
             {undoState && (
                <button
                    onClick={handleUndo}
                    className="text-sm font-semibold py-1 px-3 rounded-lg bg-yellow-400 text-yellow-900 hover:bg-yellow-500 transition-colors"
                >
                    Undo
                </button>
            )}
            <button
                onClick={handleToggleMergeMode}
                className={`text-sm font-semibold py-1 px-3 rounded-lg transition-colors flex items-center gap-1.5 ${mergeMode ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}
            >
                <MergeIcon className={`w-4 h-4 ${mergeMode ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`} />
                {mergeMode ? 'Done' : 'Merge'}
            </button>
            <button
                onClick={handleToggleReorderMode}
                className={`text-sm font-semibold py-1 px-3 rounded-lg transition-colors flex items-center gap-1.5 ${reorderMode ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}
            >
                <ReorderIcon className={`w-4 h-4 ${reorderMode ? 'text-white' : 'text-slate-600 dark:text-slate-400'}`} />
                {reorderMode ? 'Done' : 'Reorder'}
            </button>
            <button
                onClick={handleCopyAll}
                className={`text-base font-semibold py-2 px-4 rounded-lg transition-colors ${isAllCopied ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300' : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'}`}
            >
                {isAllCopied ? 'Copied!' : 'Copy All'}
            </button>
        </div>
      )}

        <div className="space-y-3" ref={findingsContainerRef}>
        {findings.map((finding, index) => {
            const isBold = finding.startsWith('BOLD::');
            const cleanFinding = isBold ? finding.substring(6) : finding;
            const isTitle = cleanFinding.trim() === 'C.T.SCAN OF BRAIN (PLAIN)';
            const { isStructured, title, points } = parseStructuredFinding(cleanFinding);
            const isImpression = isStructured && title.trim().toUpperCase() === 'IMPRESSION:';
            const isItalic = !isStructured && cleanFinding.startsWith('*') && cleanFinding.endsWith('*');
            const textToDisplay = isItalic ? cleanFinding.slice(1, -1) : isStructured ? title : cleanFinding;

            const textContainerClasses = isTitle
                ? 'text-center font-bold underline'
                : isItalic
                ? 'italic'
                : isBold
                ? 'font-bold'
                : '';
            
            const isSelected = selectedIndices.has(index);
            const isEditingThis = editingIndex === index;
            const isDictatingThis = dictatingIndex === index;
            const isDictateEditingThis = dictateEditingIndex === index;
            const isProcessingThis = processingIndex === index;
            const hasErrorThis = continuationError?.index === index;
            const isCurrentlyActive = isEditingThis || isDictatingThis || isProcessingThis || hasErrorThis || isDictateEditingThis;
            
            const isReorderingThisBatch = reorderMode;
            const isMergingThisBatch = mergeMode;
            const isDraggingThis = draggedIndex === index;
            const isDragOverTarget = isMergingThisBatch && dragOverIndex === index && draggedIndex !== index;
            
            const errorsForThisFinding = identifiedErrors.filter(e => e.findingIndex === index);
            
            let highestSeverity: IdentifiedError['severity'] | null = null;
            if (errorsForThisFinding.length > 0) {
                if (errorsForThisFinding.some(e => e.severity === 'WARNING')) {
                    highestSeverity = 'WARNING';
                } else {
                    highestSeverity = 'INFO';
                }
            }

            const hasError = highestSeverity !== null;
            
            const errorClasses = {
                WARNING: 'bg-yellow-50 border-yellow-500 dark:bg-yellow-900/20 dark:border-yellow-500',
                INFO: 'bg-sky-50 border-sky-500 dark:bg-sky-900/20 dark:border-sky-500',
            };
            const iconErrorClasses = {
                WARNING: 'text-yellow-600 dark:text-yellow-400',
                INFO: 'text-sky-600 dark:text-sky-400',
            };
            const tooltipErrorClasses = {
                WARNING: 'text-yellow-400',
                INFO: 'text-sky-400',
            };


            return (
                <div
                    key={index}
                    data-finding-index={index}
                    draggable={isReorderingThisBatch || isMergingThisBatch}
                    onDragStart={
                        isReorderingThisBatch ? () => handleReorderDragStart(index) :
                        isMergingThisBatch ? (e) => handleMergeDragStart(e, index) :
                        undefined
                    }
                    onDragEnd={
                        isReorderingThisBatch ? handleReorderDragEnd :
                        isMergingThisBatch ? () => { setDraggedIndex(null); setDragOverIndex(null); } :
                        undefined
                    }
                    onDragEnter={isReorderingThisBatch ? () => (dragOverItem.current = index) : undefined}
                    onDrop={isMergingThisBatch ? (e) => handleMergeDrop(e, index) : undefined}
                    onDragOver={(isReorderingThisBatch || isMergingThisBatch) ? (e) => e.preventDefault() : undefined}
                    onDragEnterCapture={isMergingThisBatch ? (e) => { e.preventDefault(); setDragOverIndex(index); } : undefined}
                    onDragLeaveCapture={isMergingThisBatch ? (e) => { e.preventDefault(); setDragOverIndex(null); } : undefined}
                    className={`finding-item relative group p-3 pl-10 border-l-4 rounded-r-lg transition-all duration-200 ${
                        isSelected && !isCurrentlyActive && !isReorderingThisBatch && !isMergingThisBatch
                        ? 'bg-blue-100 border-blue-600 dark:bg-blue-900/30 dark:border-blue-500 shadow-md'
                        : isDragOverTarget
                        ? 'bg-green-100 border-green-500 dark:bg-green-900/30 dark:border-green-500 ring-2 ring-green-200 dark:ring-green-700'
                        : hasError
                        ? errorClasses[highestSeverity!]
                        : 'bg-slate-50 border-blue-500 dark:bg-slate-700/50 dark:border-blue-500'
                    } ${!isCurrentlyActive && !isReorderingThisBatch && !isMergingThisBatch ? 'hover:bg-blue-50 dark:hover:bg-slate-700' : ''} ${isDraggingThis ? 'opacity-50 bg-slate-200 dark:bg-slate-600' : ''} ${isReorderingThisBatch ? 'cursor-grab' : ''} ${isMergingThisBatch ? 'cursor-copy' : ''}`}
                    role={(isReorderingThisBatch || isMergingThisBatch) ? 'listitem' : 'button'}
                    aria-pressed={isSelected && !isCurrentlyActive}
                    tabIndex={isCurrentlyActive ? -1 : 0}
                    onClick={(isReorderingThisBatch || isMergingThisBatch || isCurrentlyActive) ? undefined : () => handleFindingClick(index)}
                    onKeyDown={(isReorderingThisBatch || isMergingThisBatch || isCurrentlyActive) ? undefined : (e) => (e.key === ' ' || e.key === 'Enter') && handleFindingClick(index)}
                >
                    {(isReorderingThisBatch || isMergingThisBatch) ? (
                        <div className="absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center" aria-label="Drag to reorder or merge">
                            {isReorderingThisBatch && <ReorderIcon />}
                            {isMergingThisBatch && <MergeIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />}
                        </div>
                    ) : (
                        <div
                            onClick={(e) => !isCurrentlyActive && handleSelectionHandleClick(e, index)}
                            className={`absolute left-0 top-0 bottom-0 w-8 flex items-center justify-center ${isCurrentlyActive ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-disabled={isCurrentlyActive}
                            aria-label="Toggle selection for this finding"
                        >
                            <div className={`w-4 h-4 rounded-full border-2 transition-colors ${isSelected && !isCurrentlyActive ? 'bg-blue-600 border-blue-600 dark:bg-blue-500 dark:border-blue-500' : 'border-slate-400 bg-white group-hover:border-blue-500 dark:border-slate-500 dark:bg-slate-600 dark:group-hover:border-blue-400'}`}></div>
                        </div>
                    )}
                        
                        {isEditingThis ? (
                        <div className="flex flex-col gap-2">
                            <textarea 
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full p-2 border rounded-md font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600"
                            rows={Math.max(3, editingText.split('\n').length)}
                            autoFocus
                            />
                            <div className="flex justify-end gap-2">
                            <button onClick={handleCancelEdit} className="text-sm font-semibold py-1 px-3 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-300 dark:hover:bg-slate-500">Cancel</button>
                            <button onClick={handleSaveEdit} className="text-sm font-semibold py-1 px-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700">Save</button>
                            </div>
                        </div>
                    ) : isProcessingThis ? (
                        <div className="flex items-center gap-2">
                            <Spinner className="w-5 h-5" />
                            <p className="font-semibold text-slate-600 dark:text-slate-300">Processing...</p>
                        </div>
                    ) : hasErrorThis ? (
                        <div className="text-red-600 dark:text-red-400">
                            <p className="font-semibold">Error:</p>
                            <p className="text-sm">{continuationError.message}</p>
                            <button onClick={() => setContinuationError(null)} className="text-sm text-blue-600 hover:underline mt-1 dark:text-blue-400">Try again</button>
                        </div>
                    ) : (
                        <>
                            <div
                                className={`text-slate-700 dark:text-slate-200 whitespace-pre-wrap ${!isCurrentlyActive && !isReorderingThisBatch && !isMergingThisBatch ? 'cursor-pointer' : 'cursor-default'} ${textContainerClasses}`}
                            >
                                {isImpression ? (
                                    <>
                                        <span className="font-bold underline uppercase">{title}</span>
                                        <ul className="list-disc list-inside pl-4 mt-1">
                                            {points.map((point, i) => (
                                                <li key={i} className="font-bold">{point}</li>
                                            ))}
                                        </ul>
                                    </>
                                ) : isStructured ? (
                                    <>
                                    <span>{title}</span>
                                    {points.map((point, i) => (<span key={i} className="block">{point}</span>))}
                                    </>
                                ) : (
                                    textToDisplay
                                )}
                            </div>
                            {isDictatingThis ? (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-full shadow-lg border border-slate-200 dark:border-slate-700">
                                    <div className="w-3 h-3 bg-red-500 rounded-full animate-ping ml-1"></div>
                                    <button onClick={handleStopDictation} aria-label="Stop dictation" className="p-1 text-slate-600 dark:text-slate-300 hover:text-red-600 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                                        <StopIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ) : isDictateEditingThis ? (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-full shadow-lg border border-slate-200 dark:border-slate-700">
                                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-ping ml-1"></div>
                                    <button onClick={handleStopDictateEdit} aria-label="Stop dictation edit" className="p-1 text-slate-600 dark:text-slate-300 hover:text-red-600 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                                        <StopIcon className="w-5 h-5" />
                                    </button>
                                </div>
                            ) : !isReorderingThisBatch && !isMergingThisBatch && (
                                <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 ${!isMakingSelection && 'group-hover:opacity-100'} transition-opacity bg-slate-100 dark:bg-slate-700 p-1 rounded-md shadow-sm`}>
                                    {hasError && (
                                        <div className="group/tooltip relative flex items-center">
                                        <WarningIcon className={`w-5 h-5 ${iconErrorClasses[highestSeverity!]}`} />
                                        <div className="absolute bottom-full mb-2 -right-1/2 translate-x-1/2 w-64 p-2 text-xs text-white bg-slate-800 rounded-md shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-10">
                                            <ul className="list-disc list-inside text-left">
                                            {errorsForThisFinding.map((error, i) => (
                                                <li key={i} className={tooltipErrorClasses[error.severity]}>{error.errorDescription}</li>
                                            ))}
                                            </ul>
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-slate-800"></div>
                                        </div>
                                        </div>
                                    )}
                                    <button onClick={() => handleStartEdit(index)} aria-label="Edit text" className="p-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                                        <PencilIcon />
                                    </button>
                                    <button onClick={() => handleStartDictation(index)} aria-label="Append dictation" className="p-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                                        <MicPlusIcon />
                                    </button>
                                        <button onClick={() => handleStartDictateEdit(index)} aria-label="Dictate changes" className="p-1 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-full hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
                                        <MicPencilIcon />
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )
        })}
        </div>

      <div className="mt-6 p-4 border rounded-lg bg-slate-50 dark:bg-slate-700/50 dark:border-slate-700">
          <div className="flex items-start sm:items-center gap-3 flex-col sm:flex-row">
              <MicScribbleIcon className="w-8 h-8 text-slate-600 dark:text-slate-300 flex-shrink-0" />
              <div className="flex-grow">
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200">Dictate Report Changes</h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                      Use this to dictate global changes to the entire report, like 'remove all measurements' or 'rephrase the conclusion to be more concise'.
                  </p>
              </div>
              <div className="sm:ml-4 flex-shrink-0 w-full sm:w-auto">
                  {modificationState === 'idle' ? (
                      <button onClick={handleStartModification} className="w-full bg-blue-100 text-blue-800 font-bold py-2 px-4 rounded-lg hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/80 transition-colors">
                          Start Dictating Changes
                      </button>
                  ) : modificationState === 'recording' ? (
                      <div className="w-full flex items-center justify-center gap-4 bg-red-100 dark:bg-red-900/20 p-2 rounded-lg">
                          <div className="flex items-center gap-2">
                              <div className="w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                              <span className="font-semibold text-red-700 dark:text-red-300">Recording...</span>
                          </div>
                          <button onClick={handleStopModification} className="flex items-center justify-center gap-1 bg-red-600 text-white font-bold py-1 px-3 rounded-lg hover:bg-red-700">
                              <StopIcon className="w-5 h-5"/>
                              Stop
                          </button>
                      </div>
                  ) : modificationState === 'processing' ? (
                      <div className="w-full flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 p-2 rounded-lg">
                          <Spinner className="w-6 h-6"/>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">Applying Changes...</span>
                      </div>
                  ) : null}
              </div>
          </div>
          {modificationError && <p className="text-red-500 dark:text-red-400 text-sm mt-2">{modificationError}</p>}
      </div>
      
      {/* Complex Impression Generator Section */}
      {isComplexGeneratorVisible ? (
          <div className="mt-6 p-4 border-2 border-dashed rounded-lg bg-slate-50 dark:bg-slate-700/50 dark:border-slate-600">
              {agenticStatus === 'processing' ? (
                  <div className="flex flex-col items-center justify-center p-4">
                      <Spinner />
                      <p className="font-semibold text-slate-700 dark:text-slate-200 mt-4">Running agentic analysis...</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">This may take a minute.</p>
                  </div>
              ) : (
                  <>
                      <div className="flex items-start sm:items-center gap-3 flex-col sm:flex-row">
                          <BrainIcon className="w-8 h-8 text-slate-600 dark:text-slate-300 flex-shrink-0" />
                          <div className="flex-grow">
                              <h4 className="font-semibold text-slate-800 dark:text-slate-200">Additional Findings for Complex Impression</h4>
                              <p className="text-sm text-slate-600 dark:text-slate-400">
                                  Provide relevant findings from patient history or other reports to generate a more comprehensive impression.
                              </p>
                          </div>
                      </div>
                      <div className="relative mt-4">
                          <textarea
                              value={complexInput}
                              onChange={(e) => setComplexInput(e.target.value)}
                              placeholder="e.g., 'Patient has a history of metastatic lung cancer.'"
                              className="w-full p-2 pr-12 border border-slate-300 rounded-md text-sm bg-white text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:bg-slate-900 dark:text-white dark:border-slate-600 dark:placeholder-slate-400"
                              rows={3}
                              aria-label="Additional findings for complex impression"
                          />
                          <button
                              onClick={handleComplexMicClick}
                              disabled={isTranscribingComplex}
                              className={`absolute bottom-2 right-2 p-1.5 rounded-full text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                  complexInputRecorder.isRecording
                                  ? 'bg-red-600 hover:bg-red-700 animate-pulse'
                                  : 'bg-blue-600 hover:bg-blue-700'
                              }`}
                              aria-label={complexInputRecorder.isRecording ? 'Stop dictating' : 'Dictate additional findings'}
                          >
                              {isTranscribingComplex ? <Spinner className="w-5 h-5 text-white" /> : complexInputRecorder.isRecording ? <StopIcon className="w-5 h-5" /> : <MicIcon className="w-5 h-5" />}
                          </button>
                      </div>
                      {agenticError && <p className="text-red-500 dark:text-red-400 text-sm mt-2">{agenticError}</p>}
                      <div className="mt-4 flex justify-end gap-2">
                          <button onClick={() => setIsComplexGeneratorVisible(false)} className="bg-slate-200 text-slate-800 font-bold py-2 px-4 rounded-lg hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-500">
                              Cancel
                          </button>
                          <button onClick={handleGenerateComplexImpression} disabled={isTranscribingComplex} className="bg-blue-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                              Generate Impression
                          </button>
                      </div>
                  </>
              )}
          </div>
      ) : null}

      {!isLive && chatHistory.length > 0 && (
        <ChatInterface 
          history={chatHistory} 
          isChatting={isChatting} 
          onSendMessage={onSendMessage} 
        />
      )}

      {!isLive && (
        <div className="mt-8 pt-6 border-t dark:border-slate-700 flex flex-col sm:flex-row justify-center items-center gap-4 flex-wrap">
            {continuationState.status === 'idle' ? (
                <>
                    <button
                        onClick={handleStartContinue}
                        className="bg-green-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-50 transition-colors w-full sm:w-auto"
                    >
                        Continue Dictation
                    </button>
                    <button
                        onClick={() => setIsComplexGeneratorVisible(true)}
                        className="bg-purple-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 transition-colors w-full sm:w-auto flex items-center gap-2"
                    >
                        <BrainIcon className="w-5 h-5" />
                        Complex Impression
                    </button>
                    {expertNotes && (
                        <button
                            onClick={handleDownloadExpertNotes}
                            className="bg-teal-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-opacity-50 transition-colors w-full sm:w-auto flex items-center gap-2"
                        >
                            <DownloadIcon className="w-5 h-5" />
                            Download Expert Notes
                        </button>
                    )}
                    {audioBlob && (
                      <button
                          onClick={handleDownload}
                          className="bg-slate-500 text-white font-bold py-2 px-6 rounded-lg hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-opacity-50 transition-colors w-full sm:w-auto"
                      >
                          Download Audio
                      </button>
                    )}
                    <button
                        onClick={handleRecordNew}
                        className="bg-red-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-50 transition-colors w-full sm:w-auto"
                    >
                        Record New
                    </button>
                    <button
                        onClick={handleDownloadHTML}
                        className="bg-blue-600 text-white font-bold py-2 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 transition-colors w-full sm:w-auto"
                    >
                        Download Report as HTML
                    </button>
                </>
            ) : null}
            {continuationState.status === 'recording' && (
                <div className="w-full flex items-center justify-center gap-4 bg-red-100 dark:bg-red-900/20 p-2 rounded-lg">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
                        <span className="font-semibold text-red-700 dark:text-red-300">Recording...</span>
                    </div>
                    <button
                        onClick={handleStopContinue}
                        className="flex items-center justify-center gap-2 bg-red-600 text-white font-bold py-1 px-4 rounded-lg hover:bg-red-700"
                        aria-label="Stop continuing dictation"
                    >
                        <StopIcon className="w-5 h-5"/>
                        Stop
                    </button>
                </div>
            )}
            {continuationState.status === 'processing' && (
                <div className="w-full flex items-center justify-center gap-2 bg-slate-100 dark:bg-slate-700 p-2 rounded-lg">
                    <Spinner className="w-6 h-6"/>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Processing...</span>
                </div>
            )}
        </div>
      )}
      {continuationState.error && (
        <p className="text-center text-red-500 dark:text-red-400 mt-4" role="alert">{continuationState.error}</p>
      )}

    </div>
  );
};

export default ResultsDisplay;
