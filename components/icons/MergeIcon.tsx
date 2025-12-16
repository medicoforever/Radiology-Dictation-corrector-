import React from 'react';

const MergeIcon: React.FC<{ className?: string }> = ({ className = "w-4 h-4" }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M8 6h10a2 2 0 0 1 2 2v10" />
    <path d="M4 18V8a2 2 0 0 1 2-2h2" />
    <polyline points="12 18 8 14 12 10" />
  </svg>
);

export default MergeIcon;
