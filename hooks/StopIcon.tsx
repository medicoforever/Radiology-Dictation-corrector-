
import React from 'react';

const StopIcon: React.FC<{className?: string}> = ({className = "w-8 h-8"}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
  </svg>
);

export default StopIcon;
