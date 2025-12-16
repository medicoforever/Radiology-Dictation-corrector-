
import React from 'react';

const ResumeIcon: React.FC<{className?: string}> = ({className = "w-8 h-8"}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M8 5v14l11-7z" />
  </svg>
);

export default ResumeIcon;
