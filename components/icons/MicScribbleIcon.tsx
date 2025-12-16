import React from 'react';

const MicScribbleIcon: React.FC<{className?: string}> = ({className = "w-5 h-5"}) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <path d="M21.5 13.6a2.5 2.5 0 0 0-3.5-3.5L12 16" />
        <path d="m14 18 4-4" />
        <path d="m11 15-1.5 1.5" />
        <path d="M3 21h18" />
    </svg>
);

export default MicScribbleIcon;
