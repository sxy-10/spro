import React, { useState } from 'react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  exportContent: string;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  exportContent
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(exportContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="export-modal-backdrop" onClick={onClose}>
      <div className="export-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3 className="export-modal-title">导出出行方案</h3>
          <button type="button" className="btn-close-modal" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="export-modal-body">
          <pre className="export-markdown-content">{exportContent}</pre>
        </div>

        <div className="export-modal-footer">
          <button type="button" className="btn-modal-cancel" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn-modal-copy" onClick={handleCopy}>
            {copied ? '✓ 已复制到剪贴板' : '复制长文排版'}
          </button>
        </div>
      </div>
    </div>
  );
};
