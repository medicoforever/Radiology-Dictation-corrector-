
import React from 'react';

const PauseIcon: React.FC<{className?: string}> = ({className = "w-8 h-8"}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
  </svg>
);

export default PauseIcon;
