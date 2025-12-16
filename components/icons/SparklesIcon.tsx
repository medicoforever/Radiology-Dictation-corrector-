
import React from 'react';

const SparklesIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
        <path fillRule="evenodd" d="M10.868 2.884c.321-.772 1.415-.772 1.736 0l1.681 4.048 4.448.648c.84.122 1.178 1.14.566 1.732l-3.218 3.138.76 4.43c.145.838-.734 1.48-1.49 1.088L10 15.175l-3.976 2.09c-.756.392-1.634-.25-1.49-1.088l.76-4.43-3.218-3.138c-.612-.592-.274-1.61.566-1.732l4.448-.648L9.132 2.884z" clipRule="evenodd" />
    </svg>
);

export default SparklesIcon;
