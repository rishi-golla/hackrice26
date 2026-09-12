export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Frame = {
  id?: string;
  capturedAt?: number;
  displayId: string;
  bounds: Rect;
  workArea: Rect;
  imageWidth: number;
  imageHeight: number;
  scaleFactor?: number;
  png?: Uint8Array;
};

export type CursorSample = {
  x: number;
  y: number;
  displayId: string;
  at: number;
};

export type OcrWord = {
  text: string;
  confidence: number;
  box: Rect;
  lineId: string;
};

export type PurchaseCandidate = {
  amountCents: number | null;
  sourceText: string;
  state: 'preview' | 'confirm' | 'no-candidate';
  buttonBox: Rect | null;
  totalBox: Rect | null;
  reason:
    | 'single-total'
    | 'ambiguous'
    | 'missing-total'
    | 'missing-button'
    | 'unsupported-currency'
    | 'low-confidence'
    | 'stale-frame';
};
