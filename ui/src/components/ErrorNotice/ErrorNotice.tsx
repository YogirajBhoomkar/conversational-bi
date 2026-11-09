import { useState } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloudOffIcon from '@mui/icons-material/CloudOffOutlined';
import HourglassIcon from '@mui/icons-material/HourglassEmptyOutlined';
import InfoIcon from '@mui/icons-material/InfoOutlined';
import type { Failure } from '../../types';
import './ErrorNotice.css';

// A turn that could not be answered, shown as a calm notice instead of an error line: what happened in a few words,
// what to do, a button to ask the same question again, and the reference to quote if it keeps happening.
const ICONS = { unavailable: CloudOffIcon, busy: HourglassIcon, timeout: HourglassIcon, failed: InfoIcon, refused: InfoIcon } as const;

export default function ErrorNotice({ failure, onRetry }: { failure: Failure; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[failure.kind ?? 'failed'] ?? InfoIcon;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(failure.reference ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no clipboard (an old browser or a locked-down frame): the reference stays selectable
    }
  };

  return (
    <div className="notice" role="alert">
      <Icon className="notice__icon" fontSize="small" aria-hidden />
      <div className="notice__body">
        <div className="notice__title">{failure.title ?? 'Something went wrong'}</div>
        <p className="notice__detail">{failure.detail}</p>
        {(onRetry || failure.reference) && (
          <div className="notice__actions">
            {onRetry && failure.retryable !== false && (
              <ButtonBase className="notice__retry" onClick={onRetry}>
                <RefreshIcon fontSize="small" aria-hidden /> Try again
              </ButtonBase>
            )}
            {failure.reference && (
              <span className="notice__ref">
                Reference <code>{failure.reference}</code>
                <ButtonBase className="notice__copy" onClick={copy} aria-label="Copy the reference">
                  {copied ? 'Copied' : 'Copy'}
                </ButtonBase>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
