import React from 'react';

const ReorderIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5 text-slate-400" }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    aria-hidden="true"
  >
    <circle cx="10" cy="6" r="1.5" />
    <circle cx="14" cy="6" r="1.5" />
    <circle cx="10" cy="12" r="1.5" />
    <circle cx="14" cy="12" r="1.5" />
    <circle cx="10" cy="18" r="1.5" />
    <circle cx="14" cy="18" r="1.5" />
  </svg>
);

export default ReorderIcon;