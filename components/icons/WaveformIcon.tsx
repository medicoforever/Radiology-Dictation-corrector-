
import React from 'react';

const WaveformIcon: React.FC<{className?: string}> = ({className = "w-6 h-6"}) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={className} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <path d="M3 10v4" />
    <path d="M7 6v12" />
    <path d="M11 2v20" />
    <path d="M15 6v12" />
    <path d="M19 10v4" />
  </svg>
);

export default WaveformIcon;
