
import React, { useRef, useEffect, useState } from 'react';
import CopyIcon from '../icons/CopyIcon';

interface SelectionCopierProps {
  x: number;
  y: number;
  textToCopy: string;
  onCopy: (text: string) => void;
  onClose: () => void;
}

const SelectionCopier: React.FC<SelectionCopierProps> = ({ x, y, textToCopy, onCopy, onClose }) => {
  const copierRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: 0,
    left: 0,
    opacity: 0, // Render invisible first to measure
    transform: 'translate(-50%, 12px)', // Center on X, position below Y
    transition: 'opacity 0.1s ease-in-out',
  });


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (copierRef.current && !copierRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    // Add a small delay to prevent the same click that triggered it from closing it
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // This effect calculates the final position once the element is in the DOM and measured.
  useEffect(() => {
    if (copierRef.current) {
      const rect = copierRef.current.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const windowWidth = window.innerWidth;

      let top = y;
      let left = x;
      let transform = '';

      // Vertical positioning: default below cursor
      let yTransform = '12px';
      if (top + rect.height + 20 > windowHeight) {
        // Not enough space below, position above
        yTransform = `calc(-100% - 12px)`;
      }

      // Horizontal positioning: default centered on cursor
      let xTransform = '-50%';
      // Check if it overflows left
      if (left - rect.width / 2 < 10) {
        left = 10;
        xTransform = '0%';
      }
      // Check if it overflows right
      else if (left + rect.width / 2 > windowWidth - 10) {
        left = windowWidth - 10;
        xTransform = '-100%';
      }
      
      transform = `translate(${xTransform}, ${yTransform})`;

      setStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        opacity: 1,
        transform: transform,
        transition: 'opacity 0.1s ease-in-out',
      });
    }
  }, [x, y, textToCopy]); // Re-calculate if position or content changes

  const handleCopyClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent this click from being caught by outside click handler
    onCopy(textToCopy);
  };

  return (
    <div
      ref={copierRef}
      style={style}
      className="z-50 flex items-center gap-2 p-2 bg-white rounded-md shadow-lg border border-slate-200 dark:bg-slate-900 dark:border-slate-700"
    >
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200 max-w-xs truncate">
        Copy selection
      </span>
      <button
        onClick={handleCopyClick}
        className="flex items-center justify-center p-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
        aria-label="Copy selected text"
      >
        <CopyIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

export default SelectionCopier;