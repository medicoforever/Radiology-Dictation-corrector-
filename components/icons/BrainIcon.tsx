import React from 'react';

const BrainIcon: React.FC<{ className?: string }> = ({ className = "w-6 h-6" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v0A2.5 2.5 0 0 1 9.5 7h-3A2.5 2.5 0 0 1 4 4.5v0A2.5 2.5 0 0 1 6.5 2h3Z" />
        <path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v0A2.5 2.5 0 0 1 14.5 7h-3A2.5 2.5 0 0 1 9 4.5v0A2.5 2.5 0 0 1 11.5 2h3Z" />
        <path d="M12 13a2.5 2.5 0 0 1 2.5-2.5h4A2.5 2.5 0 0 1 21 13v0a2.5 2.5 0 0 1-2.5 2.5h-4A2.5 2.5 0 0 1 12 13Z" />
        <path d="M12 13a2.5 2.5 0 0 0-2.5-2.5h-4A2.5 2.5 0 0 0 3 13v0a2.5 2.5 0 0 0 2.5 2.5h4A2.5 2.5 0 0 0 12 13Z" />
        <path d="M16 22a2.5 2.5 0 0 0 2.5-2.5v-3A2.5 2.5 0 0 0 16 14h-3a2.5 2.5 0 0 0-2.5 2.5v3A2.5 2.5 0 0 0 13 22h3Z" />
        <path d="M8 22a2.5 2.5 0 0 1-2.5-2.5v-3A2.5 2.5 0 0 1 8 14h3a2.5 2.5 0 0 1 2.5 2.5v3A2.5 2.5 0 0 1 11 22H8Z" />
        <path d="M12 4.5v4" />
        <path d="M12 10.5v4" />
        <path d="M12 16.5v4" />
    </svg>
);

export default BrainIcon;
