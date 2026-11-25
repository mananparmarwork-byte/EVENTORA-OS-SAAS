import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { saveBlob } from '@/pdf/generate';

/**
 * One preview window used EVERYWHERE a PDF can be made (new bill, saved bill, invoices, reports, sample).
 * The PDF is built in the browser and shown on screen. Nothing is downloaded and nothing is saved until the person presses a button.
 */
export type PreviewRequest = {
  title: string;
  eyebrow?: string;
  filename: string;
  build: () => Promise<Blob>;
  /** Optional main action shown inside the preview, e.g. "Save quotation". The preview closes after it is pressed. */
  primaryLabel?: string;
  onPrimary?: () => void;
};

function PdfPreviewModal({ req, onClose }: { req: PreviewRequest; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const build = useRef(req.build);

  useEffect(() => {
    let alive = true;
    let made = '';
    build.current()
      .then((b) => { if (!alive) return; made = URL.createObjectURL(b); setBlob(b); setUrl(made); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not create the preview.'); });
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, []);

  const openFull = () => { if (url) window.open(url, '_blank'); };

  return (
    <Modal
      title={req.title}
      eyebrow={req.eyebrow ?? 'Preview'}
      onClose={onClose}
      width="max-w-5xl"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={openFull} disabled={!url}><ExternalLink size={15} /> Open full screen</Button>
          <Button variant={req.onPrimary ? 'outline' : 'gold'} onClick={() => blob && saveBlob(blob, req.filename)} disabled={!blob}><Download size={15} /> Download PDF</Button>
          {req.onPrimary && <Button variant="gold" onClick={() => { req.onPrimary?.(); onClose(); }}>{req.primaryLabel ?? 'Save'}</Button>}
        </>
      )}
    >
      {error ? (
        <p className="rounded-xl border border-error/30 bg-error-bg p-4 text-sm text-error">{error}</p>
      ) : !url ? (
        <div className="grid h-[60dvh] place-items-center text-sm text-text-secondary"><span className="flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Preparing your preview…</span></div>
      ) : (
        <>
          <iframe title={req.title} src={`${url}#toolbar=0&navpanes=0&view=FitH`} className="h-[62dvh] w-full rounded-xl border border-border bg-white" />
          <p className="mt-3 text-xs text-text-secondary">This is exactly what the PDF will look like. Nothing has been downloaded or saved yet. If the page above stays blank on your phone, tap <strong>Open full screen</strong>.</p>
        </>
      )}
    </Modal>
  );
}

export function usePdfPreview() {
  const [req, setReq] = useState<(PreviewRequest & { key: number }) | null>(null);
  const close = useCallback(() => setReq(null), []);
  const preview = useCallback((r: PreviewRequest) => setReq({ ...r, key: Date.now() }), []);
  const element = req ? <PdfPreviewModal key={req.key} req={req} onClose={close} /> : null;
  return { preview, element };
}
